-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: wc_payroll_monthly に Excel入力シート用の追加カラム
--
--   night_minutes  深夜早朝勤務分（将来拡張、現状0で出力）
--   dependents     扶養人数（計算時の wc_payroll_settings からスナップショット）
--
-- 派生値（給料計／非課税／課税計／社保計／控除計）は既存カラムから
-- フロント側で計算するためDBには持たせない。
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.wc_payroll_monthly
  ADD COLUMN IF NOT EXISTS night_minutes integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.wc_payroll_monthly.night_minutes IS '深夜早朝勤務分（将来拡張）';

ALTER TABLE public.wc_payroll_monthly
  ADD COLUMN IF NOT EXISTS dependents    integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.wc_payroll_monthly.dependents IS
  '扶養人数（計算時点の wc_payroll_settings.dependents をスナップショット）';

-- ── 計算関数を再定義：dependents を monthly に転記 ──
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

  v_base int; v_fixed int; v_pos int; v_fam int; v_child int;
  v_weekday_amt int; v_weekend_amt int; v_overtime_amt int;
  v_paid_leave_amt int; v_commute int;
  v_gross int;
  v_shaho int; v_emp_ins int; v_inc_tax int; v_res_tax int; v_car int;
  v_total_ded int; v_net int;
  v_taxable int;

  v_count int := 0;
BEGIN
  v_period_end   := (p_target_month || '-20')::date;
  v_period_start := (v_period_end - INTERVAL '1 month' + INTERVAL '1 day')::date;
  v_pay_date     := (date_trunc('month', v_period_end) + INTERVAL '1 month - 1 day')::date;

  SELECT * INTO v_global FROM public.wc_payroll_global WHERE company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wc_payroll_global not configured for company %', v_company_id;
  END IF;

  v_emp_insurance_rate := CASE
    WHEN v_period_start >= v_global.insurance_switch_date
      THEN v_global.employment_insurance_new
    ELSE v_global.employment_insurance_old
  END;

  FOR v_setting IN
    SELECT * FROM public.wc_payroll_settings
     WHERE company_id = v_company_id AND is_active = true
     ORDER BY sort_order, display_name
  LOOP
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

    v_base    := v_setting.base_salary;
    v_fixed   := v_setting.fixed_overtime;
    v_pos     := v_setting.position_allowance;
    v_fam     := v_setting.family_allowance;
    v_child   := COALESCE(v_setting.child_support_allowance, 0);
    v_commute := v_setting.commute_per_day * v_worked_days;

    IF v_setting.employment_type = 'パート' THEN
      v_weekday_amt   := round(v_setting.hourly_weekday::numeric * v_weekday_min / 60.0)::int;
      v_weekend_amt   := round(v_setting.hourly_weekend::numeric * v_weekend_min / 60.0)::int;
      v_overtime_amt  := round(v_setting.hourly_weekday::numeric * v_global.overtime_multiplier
                                * v_overtime_min / 60.0)::int;
      v_paid_leave_amt := round(v_setting.hourly_weekday::numeric
                                 * v_setting.scheduled_minutes / 60.0
                                 * v_paid_leave_days)::int;
    ELSE
      v_weekday_amt := 0; v_weekend_amt := 0;
      v_overtime_amt := 0; v_paid_leave_amt := 0;
    END IF;

    v_gross := v_base + v_fixed + v_pos + v_fam + v_child
             + v_weekday_amt + v_weekend_amt + v_overtime_amt + v_paid_leave_amt
             + v_commute;

    v_shaho   := v_setting.social_insurance;
    v_res_tax := v_setting.resident_tax;
    v_car     := v_setting.car_deduction;
    v_emp_ins := round(v_gross::numeric * v_emp_insurance_rate)::int;

    v_taxable := v_gross - v_commute - v_shaho - v_emp_ins;
    IF v_taxable < 0 THEN v_taxable := 0; END IF;
    v_inc_tax := public.wc_fn_lookup_income_tax(v_taxable, v_setting.dependents);

    v_total_ded := v_shaho + v_emp_ins + v_inc_tax + v_res_tax + v_car;
    v_net       := v_gross - v_total_ded;

    INSERT INTO public.wc_payroll_monthly (
      company_id, payroll_setting_id, employee_id, display_name,
      target_month, period_start, period_end, pay_date,
      worked_days, worked_minutes, weekday_minutes, weekend_minutes,
      overtime_minutes, night_minutes, paid_leave_days,
      base_salary, fixed_overtime, position_allowance, family_allowance,
      child_support_allowance,
      weekday_amount, weekend_amount, overtime_amount, paid_leave_amount,
      commute_amount, gross_amount,
      social_insurance, employment_insurance, income_tax, resident_tax, car_deduction,
      total_deduction, net_amount, dependents,
      status, calculated_at, detail_json
    ) VALUES (
      v_company_id, v_setting.id, v_setting.employee_id, v_setting.display_name,
      p_target_month, v_period_start, v_period_end, v_pay_date,
      v_worked_days, v_worked_min, v_weekday_min, v_weekend_min,
      v_overtime_min, 0, v_paid_leave_days,
      v_base, v_fixed, v_pos, v_fam, v_child,
      v_weekday_amt, v_weekend_amt, v_overtime_amt, v_paid_leave_amt,
      v_commute, v_gross,
      v_shaho, v_emp_ins, v_inc_tax, v_res_tax, v_car,
      v_total_ded, v_net, COALESCE(v_setting.dependents, 0),
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
      night_minutes      = EXCLUDED.night_minutes,
      paid_leave_days    = EXCLUDED.paid_leave_days,
      base_salary        = EXCLUDED.base_salary,
      fixed_overtime     = EXCLUDED.fixed_overtime,
      position_allowance = EXCLUDED.position_allowance,
      family_allowance   = EXCLUDED.family_allowance,
      child_support_allowance = EXCLUDED.child_support_allowance,
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
      dependents         = EXCLUDED.dependents,
      detail_json        = EXCLUDED.detail_json,
      calculated_at      = now(),
      updated_at         = now()
    WHERE wc_payroll_monthly.status = 'draft';

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wc_fn_calculate_monthly_payroll(text, uuid) TO authenticated, anon;
