-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: 残業申請の承認状態変化を勤怠(over_under)に即時同期
--
-- 【目的】
--   wc_overtime_requests(status) の INSERT/UPDATE/DELETE を検知し、
--   その日の attendance_daily.over_under を正しい値に再計算する。
--   これにより「承認しても出勤簿を保存し直さないと過不足に乗らない」穴を塞ぐ。
--
-- 【網羅ケース】
--   ・INSERT(approved で新規)                      → over_under 反映
--   ・UPDATE(pending→approved / rejected→approved) → over_under 反映
--   ・UPDATE(approved→rejected / →pending)         → over_under = 0
--   ・DELETE(approved行の削除)                      → over_under = 0
--   ・打刻前(該当日の attendance_daily 行なし)      → 何もしない（次の打刻で既存 BEFORE トリガーが拾う）
--
-- 【設計方針】
--   ・既存の wc_fn_calc_attendance_daily / wc_trg_99_calc_attendance_daily は
--     一切改変しない
--   ・新規に wc_fn_sync_over_under(uuid, date) 関数を追加し、
--     指定 (社員, 日) の attendance_daily.over_under だけを直接 UPDATE する
--   ・attendance_daily の over_under 列は既存 BEFORE トリガーの
--     監視列(punch_in / punch_out / reason / break_minutes_self_reported)に
--     含まれないため、この UPDATE で既存トリガーは再帰しない
--   ・KAT/明石には絶対発火しないよう company_id で二重ガード
--     (wc_overtime_requests は WC 専用テーブルだが念のため)
-- ═══════════════════════════════════════════════════════════════

-- ── ① 過不足同期関数 ──────────────────────────────
-- 指定した (employee_id, attendance_date) の attendance_daily.over_under を
-- 承認済み残業分に再計算する。既存 wc_fn_calc_attendance_daily の
-- 残業計算ロジックと同じルールを、attendance_daily 側は変更せずに再計算専用として保持する。
CREATE OR REPLACE FUNCTION public.wc_fn_sync_over_under(
  p_employee_id uuid,
  p_attendance_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid := 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid;
  v_att_id uuid;
  v_punch_out time;
  v_reason text;
  v_emp_type text;
  v_scheduled_end time;
  v_overtime_approved boolean := false;
  v_overtime_min integer := 0;
BEGIN
  -- 該当日の attendance_daily 行を取得（WCのみ）
  SELECT a.id, a.punch_out, a.reason
    INTO v_att_id, v_punch_out, v_reason
    FROM public.attendance_daily a
   WHERE a.employee_id     = p_employee_id
     AND a.company_id      = v_company_id
     AND a.attendance_date = p_attendance_date
   LIMIT 1;

  -- 打刻行がまだ無い（打刻前に承認した等） → 何もしない
  -- 次の打刻時に既存 BEFORE トリガー(wc_fn_calc_attendance_daily)が status=approved を拾って自然に計算する
  IF v_att_id IS NULL THEN
    RETURN;
  END IF;

  -- 全日休系は over_under を NULL に（既存 BEFORE トリガーと整合）
  IF v_reason IS NOT NULL AND (
     v_reason LIKE '%有給（全日）%'
  OR v_reason LIKE '%公休（全日）%'
  OR v_reason = '欠勤'
  ) THEN
    UPDATE public.attendance_daily
       SET over_under = NULL,
           updated_at = now()
     WHERE id = v_att_id
       AND over_under IS DISTINCT FROM NULL;
    RETURN;
  END IF;

  -- 打刻未完了 → 残業計算不能。ただし承認取消時などに 0 に戻すため既存 over_under はクリアしておく
  IF v_punch_out IS NULL THEN
    UPDATE public.attendance_daily
       SET over_under = 0,
           updated_at = now()
     WHERE id = v_att_id
       AND over_under IS DISTINCT FROM 0;
    RETURN;
  END IF;

  -- 給与マスタから雇用区分・所定終業を取得
  SELECT s.employment_type, s.scheduled_end_time
    INTO v_emp_type, v_scheduled_end
    FROM public.wc_payroll_settings s
   WHERE s.employee_id = p_employee_id
     AND s.company_id  = v_company_id
   LIMIT 1;

  -- パートかつ所定終業設定があるときのみ残業計算
  IF v_emp_type = 'パート' AND v_scheduled_end IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.wc_overtime_requests o
       WHERE o.employee_id     = p_employee_id
         AND o.attendance_date = p_attendance_date
         AND o.status          = 'approved'
    ) INTO v_overtime_approved;

    IF v_overtime_approved AND v_punch_out > v_scheduled_end THEN
      v_overtime_min := (EXTRACT(EPOCH FROM (v_punch_out - v_scheduled_end)) / 60)::int;
      IF v_overtime_min < 0 THEN v_overtime_min := 0; END IF;
    END IF;
  END IF;

  -- 実際に値が変わる場合のみ UPDATE（無駄な updated_at 更新を避ける）
  UPDATE public.attendance_daily
     SET over_under = v_overtime_min,
         updated_at = now()
   WHERE id = v_att_id
     AND (over_under IS DISTINCT FROM v_overtime_min);
END;
$$;

COMMENT ON FUNCTION public.wc_fn_sync_over_under(uuid, date) IS
  'worldclub: 指定社員・日の attendance_daily.over_under を、承認済み残業有無に基づいて再計算。既存 wc_fn_calc_attendance_daily の残業ロジックを attendance_daily 側から呼び出せる形で提供。';


-- ── ② wc_overtime_requests トリガー関数 ──────────────────────────────
-- INSERT / UPDATE / DELETE を検知し、対象日の sync を呼ぶ。
-- UPDATE で (employee_id, attendance_date) が変わる場合は旧側と新側両方を sync。
CREATE OR REPLACE FUNCTION public.wc_fn_overtime_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wc uuid := 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- 二重ガード：WC 以外は無視
    IF OLD.company_id = v_wc THEN
      PERFORM public.wc_fn_sync_over_under(OLD.employee_id, OLD.attendance_date);
    END IF;
    RETURN OLD;
  END IF;

  -- INSERT / UPDATE
  -- 二重ガード：WC 以外は無視
  IF NEW.company_id <> v_wc THEN
    RETURN NEW;
  END IF;

  -- UPDATE で対象(社員・日)が変わった場合、旧側もリセット
  IF TG_OP = 'UPDATE'
     AND (OLD.company_id = v_wc)
     AND (OLD.employee_id <> NEW.employee_id OR OLD.attendance_date <> NEW.attendance_date)
  THEN
    PERFORM public.wc_fn_sync_over_under(OLD.employee_id, OLD.attendance_date);
  END IF;

  PERFORM public.wc_fn_sync_over_under(NEW.employee_id, NEW.attendance_date);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.wc_fn_overtime_status_changed() IS
  'worldclub: wc_overtime_requests の変更(INSERT/UPDATE/DELETE)で対象日の attendance_daily.over_under を同期する AFTER トリガー関数。';


-- ── ③ トリガー登録 ──────────────────────────────
-- 既存トリガーがあれば置き換え（安全に DROP → CREATE）
DROP TRIGGER IF EXISTS wc_trg_overtime_sync ON public.wc_overtime_requests;

CREATE TRIGGER wc_trg_overtime_sync
AFTER INSERT OR UPDATE OR DELETE ON public.wc_overtime_requests
FOR EACH ROW
EXECUTE FUNCTION public.wc_fn_overtime_status_changed();

COMMENT ON TRIGGER wc_trg_overtime_sync ON public.wc_overtime_requests IS
  'worldclub: 残業申請の変更時に attendance_daily.over_under を自動同期';
