-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: パート休憩ロジックを self_reported 優先に変更（案A）
--
-- 【背景】
--   松浦潤子(WC015)は wc_payroll_settings.break_minutes_fixed=40 が設定されており、
--   現行の wc_fn_calc_attendance_daily は「パートで fixed が非NULLなら fixed 一択、
--   fixed がNULLのときだけ self_reported を採用」する分岐だった。
--   その結果、小川(管理者)が AdminTab から break_minutes_self_reported を
--   入力しても、トリガー発火のたびに fixed=40 で上書きされてしまう。
--
-- 【修正（案A）】
--   パート分岐を次の1行に変更（優先順: self_reported → fixed → 0）:
--     v_break_min := COALESCE(NEW.break_minutes_self_reported, v_break_fixed, 0);
--   → 通常日は self_reported=NULL なので fixed(40) が採用され従来通り。
--     管理者が self_reported に数値を入れた日はその値が優先され、上書き可能に。
--     現時点で break_minutes_fixed が設定されているWCパートは松浦さんのみ
--     (他 11 名は fixed=NULL で既に self_reported ベース)。
--
-- 【変更しないもの】
--   - 早出クランプの v_sched_start 第2項 COALESCE(v_break_fixed, 60)
--     は据え置き（所定開始時刻の算出は fixed マスタベースを維持、
--     早く来た分のクランプ挙動は変えない）
--   - 正社員 60分固定分岐は不変
--   - その他雇用形態(NEW.break_minutes, NULLなら60)の分岐は不変
--   - 全日休/欠勤で actual_hours=NULL にする早期returnは不変
--   - 残業ロジック(v_overtime_min)は不変
--   - trg_01_round_punch_* / trg_02_calculate_attendance / trg_attendance_paid_leave
--     等のKAT/明石共通トリガーには一切触れない
--   - WC専用トリガー wc_trg_99_calc_attendance_daily の登録は既存のまま
--
-- 【適用手順（池邉さん）】
--   Supabase Dashboard → SQL Editor で本ファイル全体を貼り付けて実行、
--   または supabase db query --linked --file <path> でも可。
--   関数の CREATE OR REPLACE のみで、attendance_daily の実データ更新はしない。
--   適用後は、松浦さんの過去日を再計算したいときだけ AdminTab で
--   punch_in/out を触るか break_minutes_self_reported を入力し直すと
--   トリガーが発火して actual_hours が新ロジックで再算出される。
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.wc_fn_calc_attendance_daily()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_emp_type           text;
  v_break_fixed        integer;
  v_scheduled_end      time;
  v_sched_min          integer;
  v_break_min          integer;
  v_sched_start        time;
  v_in                 time;
  v_out                time;
  v_work_min           integer;
  v_overtime_approved  boolean;
  v_overtime_min       integer := 0;
BEGIN
  IF NEW.company_id <> 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid THEN
    RETURN NEW;
  END IF;
  IF NEW.reason IS NOT NULL AND (
     NEW.reason LIKE '%有給（全日）%'
  OR NEW.reason LIKE '%公休（全日）%'
  OR NEW.reason = '欠勤'
  ) THEN
    NEW.actual_hours := NULL;
    NEW.over_under   := NULL;
    RETURN NEW;
  END IF;
  IF NEW.punch_in IS NULL OR NEW.punch_out IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.employment_type, s.break_minutes_fixed, s.scheduled_end_time, s.scheduled_minutes
    INTO v_emp_type, v_break_fixed, v_scheduled_end, v_sched_min
    FROM public.wc_payroll_settings s
   WHERE s.employee_id = NEW.employee_id
     AND s.company_id  = NEW.company_id
   LIMIT 1;

  -- 実休憩
  IF v_emp_type = 'パート' THEN
    -- ★案A: self_reported が入っていればそれを優先、無ければ fixed、それも無ければ 0
    --   松浦: 通常日は self_reported=NULL → fixed=40 採用（従来通り）
    --   小川が self_reported を入れた日 → その値が採用（管理者上書きOK）
    --   他パート(fixed=NULL): self_reported を採用、未申告なら 0（従来通り）
    v_break_min := COALESCE(NEW.break_minutes_self_reported, v_break_fixed, 0);
  ELSIF v_emp_type = '正社員' THEN
    v_break_min := 60;
  ELSE
    v_break_min := COALESCE(NEW.break_minutes, 60);
  END IF;
  NEW.break_minutes := v_break_min;

  -- パート・正社員ともクランプ（所定枠で切る）
  -- ※ v_sched_start の第2項 COALESCE(v_break_fixed, 60) は据え置き。
  --   所定開始時刻はマスタ固定休憩ベースで算出し、早出クランプ挙動を変えない。
  IF v_emp_type IN ('パート', '正社員') THEN
    v_sched_start := v_scheduled_end - make_interval(mins => v_sched_min + COALESCE(v_break_fixed, 60));
    v_in  := GREATEST(NEW.punch_in::time,  v_sched_start);
    v_out := LEAST   (NEW.punch_out::time, v_scheduled_end);
    v_work_min := (EXTRACT(EPOCH FROM (v_out - v_in)) / 60)::int - v_break_min;
    IF v_work_min < 0 THEN v_work_min := 0; END IF;
    NEW.actual_hours := round((v_work_min::numeric / 60.0), 2);
  ELSE
    v_work_min := (EXTRACT(EPOCH FROM (NEW.punch_out::time - NEW.punch_in::time)) / 60)::int - v_break_min;
    IF v_work_min < 0 THEN v_work_min := 0; END IF;
    NEW.actual_hours := round((v_work_min::numeric / 60.0), 2);
  END IF;

  -- 残業はパートのみ（承認済み＆所定終業超過分）
  IF v_emp_type = 'パート' AND v_scheduled_end IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.wc_overtime_requests o
       WHERE o.employee_id     = NEW.employee_id
         AND o.attendance_date = NEW.attendance_date
         AND o.status          = 'approved'
    ) INTO v_overtime_approved;
    IF v_overtime_approved AND NEW.punch_out::time > v_scheduled_end THEN
      v_overtime_min := (EXTRACT(EPOCH FROM (NEW.punch_out::time - v_scheduled_end)) / 60)::int;
      IF v_overtime_min < 0 THEN v_overtime_min := 0; END IF;
    END IF;
  END IF;

  NEW.over_under := v_overtime_min;
  RETURN NEW;
END;
$function$;
