-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: 勤怠日次計算トリガー（wc_trg_*）
--
-- 重要:
--   * KAT の trg_01 / trg_02 / trg_03 は触らない
--   * このトリガーは WHEN 句で worldclub の company_id に絞り、
--     KAT 行・akashi 行には絶対に発火しない
--   * トリガー名を wc_trg_99_* にしてアルファベット順で最後に発火させ、
--     KAT トリガーが計算した値を上書きする
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.wc_fn_calc_attendance_daily()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_emp_type           text;
  v_break_fixed        integer;
  v_scheduled_end      time;
  v_break_min          integer;
  v_work_min           integer;
  v_overtime_approved  boolean;
  v_overtime_min       integer := 0;
BEGIN
  -- 二重ガード（WHEN 句があるが念のため）
  IF NEW.company_id <> 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid THEN
    RETURN NEW;
  END IF;

  -- 全日休系は労働時間計算しない
  IF NEW.reason IS NOT NULL AND (
     NEW.reason LIKE '%有給（全日）%'
  OR NEW.reason LIKE '%公休（全日）%'
  OR NEW.reason = '欠勤'
  ) THEN
    NEW.actual_hours := NULL;
    NEW.over_under   := NULL;
    RETURN NEW;
  END IF;

  -- 打刻未完了
  IF NEW.punch_in IS NULL OR NEW.punch_out IS NULL THEN
    RETURN NEW;
  END IF;

  -- 給与マスタから雇用区分・休憩固定・所定終業を取得
  SELECT s.employment_type, s.break_minutes_fixed, s.scheduled_end_time
    INTO v_emp_type, v_break_fixed, v_scheduled_end
    FROM public.wc_payroll_settings s
   WHERE s.employee_id = NEW.employee_id
     AND s.company_id  = NEW.company_id
   LIMIT 1;

  -- 休憩分（パート: 固定or自己申告 / 正社員: 60分固定）
  IF v_emp_type = 'パート' THEN
    IF v_break_fixed IS NOT NULL THEN
      v_break_min := v_break_fixed;                                 -- 松浦40分
    ELSE
      v_break_min := COALESCE(NEW.break_minutes_self_reported, 0);  -- 申告ベース
    END IF;
  ELSIF v_emp_type = '正社員' THEN
    v_break_min := 60;
  ELSE
    v_break_min := COALESCE(NEW.break_minutes, 60);
  END IF;
  NEW.break_minutes := v_break_min;

  -- 実労働分
  v_work_min := (EXTRACT(EPOCH FROM (NEW.punch_out - NEW.punch_in)) / 60)::int - v_break_min;
  IF v_work_min < 0 THEN v_work_min := 0; END IF;
  NEW.actual_hours := round((v_work_min::numeric / 60.0)::numeric, 2);

  -- パート残業: 承認済みかつ所定終業超過分のみ（1分単位）
  IF v_emp_type = 'パート' AND v_scheduled_end IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.wc_overtime_requests o
       WHERE o.employee_id     = NEW.employee_id
         AND o.attendance_date = NEW.attendance_date
         AND o.status          = 'approved'
    ) INTO v_overtime_approved;
    IF v_overtime_approved AND NEW.punch_out > v_scheduled_end THEN
      v_overtime_min := (EXTRACT(EPOCH FROM (NEW.punch_out - v_scheduled_end)) / 60)::int;
      IF v_overtime_min < 0 THEN v_overtime_min := 0; END IF;
    END IF;
  END IF;

  -- over_under は worldclub では「承認済み残業分（分）」を格納
  NEW.over_under := v_overtime_min;

  RETURN NEW;
END;
$$;

-- 既存のトリガーがあれば置き換え（CREATE OR REPLACE は TRIGGER に使えないので DROP→CREATE）
DROP TRIGGER IF EXISTS wc_trg_99_calc_attendance_daily ON public.attendance_daily;
CREATE TRIGGER wc_trg_99_calc_attendance_daily
BEFORE INSERT OR UPDATE OF punch_in, punch_out, reason, break_minutes_self_reported
ON public.attendance_daily
FOR EACH ROW
WHEN (NEW.company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid)
EXECUTE FUNCTION public.wc_fn_calc_attendance_daily();

COMMENT ON FUNCTION public.wc_fn_calc_attendance_daily IS
  'worldclub: 勤怠データから労働時間と承認済み残業分を再計算するBEFOREトリガー関数';
