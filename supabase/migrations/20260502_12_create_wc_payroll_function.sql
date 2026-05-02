-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: 月次給与計算関数 wc_fn_calculate_monthly_payroll
--
-- 引数:
--   p_target_month text  例 '2026-05'  (この月の20日が締め日)
--   p_caller_id    uuid  実行者の employees.id（監査用）
-- 動作:
--   1. 既存の draft があれば洗い替え（confirmed は触らない）
--   2. wc_payroll_settings の全アクティブ社員について
--      attendance_daily を集計し wc_payroll_monthly に upsert
--   3. 結果件数を返す
-- ═══════════════════════════════════════════════════════════════

-- ※ SECURITY DEFINER: supabase.rpc 経由の anon/authenticated ロール実行で
--    wc_* テーブルが RLS により 0 行に見える問題を回避するため、
--    関数は所有者（postgres）権限で実行する。
--    search_path も明示し、不正な schema での解決を防ぐ。

CREATE OR REPLACE FUNCTION public.wc_fn_lookup_income_tax(
  p_taxable integer, p_dependents integer
) RETURNS integer
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dep integer := LEAST(GREATEST(p_dependents, 0), 7);
  v_row record;
  v_overflow integer;
  v_max_tax integer;
BEGIN
  IF p_taxable < 0 THEN RETURN 0; END IF;

  IF p_taxable >= 740000 THEN
    SELECT * INTO v_row FROM public.wc_income_tax_table
     WHERE bracket_min = 700000 LIMIT 1;
    v_max_tax := CASE v_dep
       WHEN 0 THEN v_row.d0 WHEN 1 THEN v_row.d1 WHEN 2 THEN v_row.d2
       WHEN 3 THEN v_row.d3 WHEN 4 THEN v_row.d4 WHEN 5 THEN v_row.d5
       WHEN 6 THEN v_row.d6 ELSE v_row.d7 END;
    v_overflow := p_taxable - 740000;
    RETURN v_max_tax + (v_overflow * 0.2042)::int;
  END IF;

  SELECT * INTO v_row FROM public.wc_income_tax_table
   WHERE bracket_min <= p_taxable AND bracket_max > p_taxable
   LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;

  RETURN CASE v_dep
    WHEN 0 THEN v_row.d0 WHEN 1 THEN v_row.d1 WHEN 2 THEN v_row.d2
    WHEN 3 THEN v_row.d3 WHEN 4 THEN v_row.d4 WHEN 5 THEN v_row.d5
    WHEN 6 THEN v_row.d6 ELSE v_row.d7 END;
END;
$$;

CREATE OR REPLACE FUNCTION public.wc_fn_calculate_monthly_payroll(
  p_target_month text,
  p_caller_id    uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid := 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid;
  v_period_end   date;
  v_period_start date;
  v_pay_date     date;
  v_global       record;
  v_setting      record;
  v_emp_insurance_rate numeric(5,4);

  v_worked_days     int;
  v_worked_min      int;
  v_weekday_min     int;
  v_weekend_min     int;
  v_overtime_min    int;
  v_paid_leave_days int;

  v_base int; v_fixed int; v_pos int; v_fam int;
  v_weekday_amt int; v_weekend_amt int; v_overtime_amt int;
  v_paid_leave_amt int; v_commute int;
  v_gross int;
  v_shaho int; v_emp_ins int; v_inc_tax int; v_res_tax int; v_car int;
  v_total_ded int; v_net int;
  v_taxable int;

  v_count int := 0;
BEGIN
  -- 期間: 前月21日〜当月20日
  v_period_end   := (p_target_month || '-20')::date;
  v_period_start := (v_period_end - INTERVAL '1 month' + INTERVAL '1 day')::date;
  v_pay_date     := (date_trunc('month', v_period_end) + INTERVAL '1 month - 1 day')::date;

  SELECT * INTO v_global FROM public.wc_payroll_global WHERE company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wc_payroll_global not configured for company %', v_company_id;
  END IF;

  -- 雇用保険率: 期間開始月で旧/新切替
  v_emp_insurance_rate := CASE
    WHEN v_period_start >= v_global.insurance_switch_date
      THEN v_global.employment_insurance_new
    ELSE v_global.employment_insurance_old
  END;

  FOR v_setting IN
    SELECT * FROM public.wc_payroll_settings
     WHERE company_id = v_company_id AND is_active = true
     ORDER BY display_name
  LOOP
    -- ───── 出退勤集計（is_payroll_only は集計スキップ） ─────
    v_worked_days := 0; v_worked_min := 0;
    v_weekday_min := 0; v_weekend_min := 0;
    v_overtime_min := 0; v_paid_leave_days := 0;

    IF NOT v_setting.is_payroll_only AND v_setting.employee_id IS NOT NULL THEN
      WITH att AS (
        SELECT
          a.attendance_date, a.actual_hours, a.over_under, a.reason,
          (EXTRACT(DOW FROM a.attendance_date) IN (0, 6)
           OR EXISTS (SELECT 1 FROM public.wc_jp_holidays h
                       WHERE h.holiday_date = a.attendance_date)) AS is_weekend_day
        FROM public.attendance_daily a
        WHERE a.employee_id = v_setting.employee_id
          AND a.company_id  = v_company_id
          AND a.attendance_date BETWEEN v_period_start AND v_period_end
      )
      SELECT
        COUNT(*) FILTER (WHERE actual_hours IS NOT NULL AND actual_hours > 0),
        COALESCE(SUM(((actual_hours * 60)::int - COALESCE(over_under, 0))
                     ) FILTER (WHERE actual_hours IS NOT NULL), 0),
        COALESCE(SUM(((actual_hours * 60)::int - COALESCE(over_under, 0))
                     ) FILTER (WHERE actual_hours IS NOT NULL AND NOT is_weekend_day), 0),
        COALESCE(SUM(((actual_hours * 60)::int - COALESCE(over_under, 0))
                     ) FILTER (WHERE actual_hours IS NOT NULL AND is_weekend_day), 0),
        COALESCE(SUM(over_under) FILTER (WHERE over_under IS NOT NULL), 0),
        COUNT(*) FILTER (WHERE reason LIKE '%有給（全日）%')
      INTO
        v_worked_days, v_worked_min,
        v_weekday_min, v_weekend_min,
        v_overtime_min, v_paid_leave_days
      FROM att;
    END IF;

    -- ───── 支給計算 ─────
    v_base    := v_setting.base_salary;
    v_fixed   := v_setting.fixed_overtime;
    v_pos     := v_setting.position_allowance;
    v_fam     := v_setting.family_allowance;
    v_commute := v_setting.commute_per_day * v_worked_days;

    IF v_setting.employment_type = 'パート' THEN
      v_weekday_amt   := round(v_setting.hourly_weekday::numeric * v_weekday_min / 60.0)::int;
      v_weekend_amt   := round(v_setting.hourly_weekend::numeric * v_weekend_min / 60.0)::int;
      v_overtime_amt  := round(v_setting.hourly_weekday::numeric * v_global.overtime_multiplier
                                * v_overtime_min / 60.0)::int;
      -- 有給金額: 平日時給 × 所定労働時間 × 有給日数
      v_paid_leave_amt := round(v_setting.hourly_weekday::numeric
                                 * v_setting.scheduled_minutes / 60.0
                                 * v_paid_leave_days)::int;
    ELSE
      v_weekday_amt := 0; v_weekend_amt := 0;
      v_overtime_amt := 0; v_paid_leave_amt := 0;
    END IF;

    v_gross := v_base + v_fixed + v_pos + v_fam
             + v_weekday_amt + v_weekend_amt + v_overtime_amt + v_paid_leave_amt
             + v_commute;

    -- ───── 控除計算 ─────
    v_shaho   := v_setting.social_insurance;
    v_res_tax := v_setting.resident_tax;
    v_car     := v_setting.car_deduction;
    -- 雇用保険: 通勤費含む総支給に率
    v_emp_ins := round(v_gross::numeric * v_emp_insurance_rate)::int;

    -- 課税対象: 総支給 - 通勤費(非課税) - 社保 - 雇保
    v_taxable := v_gross - v_commute - v_shaho - v_emp_ins;
    IF v_taxable < 0 THEN v_taxable := 0; END IF;
    v_inc_tax := public.wc_fn_lookup_income_tax(v_taxable, v_setting.dependents);

    v_total_ded := v_shaho + v_emp_ins + v_inc_tax + v_res_tax + v_car;
    v_net       := v_gross - v_total_ded;

    -- ───── 結果upsert（draftのみ。confirmedは触らない） ─────
    INSERT INTO public.wc_payroll_monthly (
      company_id, payroll_setting_id, employee_id, display_name,
      target_month, period_start, period_end, pay_date,
      worked_days, worked_minutes, weekday_minutes, weekend_minutes,
      overtime_minutes, paid_leave_days,
      base_salary, fixed_overtime, position_allowance, family_allowance,
      weekday_amount, weekend_amount, overtime_amount, paid_leave_amount,
      commute_amount, gross_amount,
      social_insurance, employment_insurance, income_tax, resident_tax, car_deduction,
      total_deduction, net_amount,
      status, calculated_at, detail_json
    ) VALUES (
      v_company_id, v_setting.id, v_setting.employee_id, v_setting.display_name,
      p_target_month, v_period_start, v_period_end, v_pay_date,
      v_worked_days, v_worked_min, v_weekday_min, v_weekend_min,
      v_overtime_min, v_paid_leave_days,
      v_base, v_fixed, v_pos, v_fam,
      v_weekday_amt, v_weekend_amt, v_overtime_amt, v_paid_leave_amt,
      v_commute, v_gross,
      v_shaho, v_emp_ins, v_inc_tax, v_res_tax, v_car,
      v_total_ded, v_net,
      'draft', now(),
      jsonb_build_object(
        'employment_type', v_setting.employment_type,
        'hourly_weekday',  v_setting.hourly_weekday,
        'hourly_weekend',  v_setting.hourly_weekend,
        'scheduled_minutes', v_setting.scheduled_minutes,
        'dependents',      v_setting.dependents,
        'taxable',         v_taxable,
        'employment_insurance_rate', v_emp_insurance_rate
      )
    )
    ON CONFLICT (company_id, payroll_setting_id, target_month) DO UPDATE SET
      worked_days        = EXCLUDED.worked_days,
      worked_minutes     = EXCLUDED.worked_minutes,
      weekday_minutes    = EXCLUDED.weekday_minutes,
      weekend_minutes    = EXCLUDED.weekend_minutes,
      overtime_minutes   = EXCLUDED.overtime_minutes,
      paid_leave_days    = EXCLUDED.paid_leave_days,
      base_salary        = EXCLUDED.base_salary,
      fixed_overtime     = EXCLUDED.fixed_overtime,
      position_allowance = EXCLUDED.position_allowance,
      family_allowance   = EXCLUDED.family_allowance,
      weekday_amount     = EXCLUDED.weekday_amount,
      weekend_amount     = EXCLUDED.weekend_amount,
      overtime_amount    = EXCLUDED.overtime_amount,
      paid_leave_amount  = EXCLUDED.paid_leave_amount,
      commute_amount     = EXCLUDED.commute_amount,
      gross_amount       = EXCLUDED.gross_amount,
      social_insurance   = EXCLUDED.social_insurance,
      employment_insurance = EXCLUDED.employment_insurance,
      income_tax         = EXCLUDED.income_tax,
      resident_tax       = EXCLUDED.resident_tax,
      car_deduction      = EXCLUDED.car_deduction,
      total_deduction    = EXCLUDED.total_deduction,
      net_amount         = EXCLUDED.net_amount,
      detail_json        = EXCLUDED.detail_json,
      calculated_at      = now(),
      updated_at         = now()
    WHERE wc_payroll_monthly.status = 'draft';

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.wc_fn_calculate_monthly_payroll IS
  'worldclub: 月次給与計算（前月21日〜当月20日、当月末日支給）。draftのみ更新。SECURITY DEFINERでRLSをバイパス';

-- 認証済みユーザーがRPC経由で実行できるように
GRANT EXECUTE ON FUNCTION public.wc_fn_calculate_monthly_payroll(text, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.wc_fn_lookup_income_tax(integer, integer)   TO authenticated, anon;
