-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: 給与計算関数に is_calc_target 条件を追加
--
-- 変更点: 対象者ループの WHERE に AND is_calc_target = true を追加。
-- これにより is_calc_target=false の社員（産休等）は給与計算ループに
-- 入らず、その月の wc_payroll_monthly 行が作られない。
--
-- それ以外のロジック（勤怠集計・支給計算・控除計算・UPSERT・
-- confirmed保護・諸手当・子育て支援金・floor丸め・土日時給統一）は
-- 一切変更しない。
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.wc_fn_calculate_monthly_payroll(
  p_target_month text,     -- 対象年月 'YYYY-MM'
  p_caller_id    uuid      -- 実行者のemployee_id
) RETURNS integer          -- 計算した社員数を返す
LANGUAGE plpgsql
SECURITY DEFINER           -- RLSバイパス用（anon/authenticatedから呼べる）
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid := 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid;
  v_period_end   date;     -- 締め日（当月20日）
  v_period_start date;     -- 開始日（前月21日）
  v_pay_date     date;     -- 支給日（当月末日）
  v_global       record;   -- wc_payroll_global（全社給与設定）
  v_setting      record;   -- wc_payroll_settings（社員別給与マスタ）1行
  v_emp_insurance_rate numeric(5,4);  -- 雇用保険料率

  v_worked_days     int;   -- 出勤日数
  v_worked_min      int;   -- 労働分合計
  v_weekday_min     int;   -- 平日労働分
  v_weekend_min     int;   -- 土日祝労働分
  v_overtime_min    int;   -- 残業分
  v_paid_leave_days int;   -- 有給取得日数

  v_base int;              -- 基本給
  v_fixed int;             -- 固定残業代
  v_pos int;               -- 役職手当
  v_fam int;               -- 家族手当
  v_child int;             -- 子育て支援金（控除側）
  v_other int;             -- 諸手当
  v_weekday_amt int;       -- パート平日金額
  v_weekend_amt int;       -- パート土日金額
  v_overtime_amt int;      -- 残業代
  v_paid_leave_amt int;    -- 有給金額
  v_commute int;           -- 交通費
  v_gross int;             -- 総支給額
  v_shaho int;             -- 社会保険料
  v_emp_ins int;           -- 雇用保険料
  v_inc_tax int;           -- 所得税
  v_res_tax int;           -- 住民税
  v_car int;               -- 車両控除
  v_total_ded int;         -- 控除合計
  v_net int;               -- 差引支給額
  v_taxable int;           -- 課税対象額

  v_count int := 0;        -- 処理件数カウンタ
BEGIN
  v_period_end   := (p_target_month || '-20')::date;
  v_period_start := (v_period_end - INTERVAL '1 month' + INTERVAL '1 day')::date;
  v_pay_date     := (date_trunc('month', v_period_end) + INTERVAL '1 month - 1 day')::date;

  SELECT * INTO v_global FROM public.wc_payroll_global WHERE company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wc_payroll_global not configured for company %', v_company_id;
  END IF;

  -- 雇用保険料率（切替日前後で旧/新を判定）
  v_emp_insurance_rate := CASE
    WHEN v_period_start >= v_global.insurance_switch_date
      THEN v_global.employment_insurance_new
    ELSE v_global.employment_insurance_old
  END;

  FOR v_setting IN
    SELECT * FROM public.wc_payroll_settings
     WHERE company_id = v_company_id AND is_active = true AND is_calc_target = true
     ORDER BY sort_order, display_name
  LOOP
    v_worked_days := 0; v_worked_min := 0;
    v_weekday_min := 0; v_weekend_min := 0;
    v_overtime_min := 0; v_paid_leave_days := 0;

    -- 勤怠集計（is_payroll_only=false かつ employee_id ありの場合のみ）
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

    -- マスタから固定項目を取得
    v_base    := v_setting.base_salary;
    v_fixed   := v_setting.fixed_overtime;
    v_pos     := v_setting.position_allowance;
    v_fam     := v_setting.family_allowance;
    v_child   := COALESCE(v_setting.child_support_deduction, 0);   -- ★変更: 控除側から取得
    v_other   := COALESCE(v_setting.other_allowance, 0);
    v_commute := v_setting.commute_per_day * v_worked_days;

    -- パートの時給計算
    IF v_setting.employment_type = 'パート' THEN
      v_weekday_amt   := floor(v_setting.hourly_weekday::numeric * v_worked_min / 60.0)::int;        -- ★変更: 平日+土日の合計×平日時給に統一
      v_weekend_amt   := 0;                                                                           -- ★変更: 土日時給廃止→0固定
      v_overtime_amt  := floor(v_setting.hourly_weekday::numeric * v_global.overtime_multiplier
                                * v_overtime_min / 60.0)::int;                                        -- ★変更: round→floor
      v_paid_leave_amt := floor(v_setting.hourly_weekday::numeric
                                 * v_setting.scheduled_minutes / 60.0
                                 * v_paid_leave_days)::int;                                           -- ★変更: round→floor
    ELSE
      v_weekday_amt := 0; v_weekend_amt := 0;
      v_overtime_amt := 0; v_paid_leave_amt := 0;
    END IF;

    -- 総支給額（★変更: v_child を除外）
    v_gross := v_base + v_fixed + v_pos + v_fam + v_other
             + v_weekday_amt + v_weekend_amt + v_overtime_amt + v_paid_leave_amt
             + v_commute;

    -- 控除項目
    v_shaho   := v_setting.social_insurance;
    v_res_tax := v_setting.resident_tax;
    v_car     := v_setting.car_deduction;
    v_emp_ins := floor(v_gross::numeric * v_emp_insurance_rate)::int;                                 -- ★変更: round→floor

    -- 課税対象額（★変更: v_child を控除）
    v_taxable := v_gross - v_commute - v_shaho - v_child - v_emp_ins;
    IF v_taxable < 0 THEN v_taxable := 0; END IF;
    v_inc_tax := public.wc_fn_lookup_income_tax(v_taxable, v_setting.dependents);

    -- 控除計（★変更: v_child を加算）
    v_total_ded := v_shaho + v_emp_ins + v_inc_tax + v_res_tax + v_car + v_child;
    v_net       := v_gross - v_total_ded;

    -- UPSERT（draft行のみ更新、confirmed行は保護）
    INSERT INTO public.wc_payroll_monthly (
      company_id, payroll_setting_id, employee_id, display_name,
      target_month, period_start, period_end, pay_date,
      worked_days, worked_minutes, weekday_minutes, weekend_minutes,
      overtime_minutes, night_minutes, paid_leave_days,
      base_salary, fixed_overtime, position_allowance, family_allowance,
      child_support_allowance, child_support_deduction, other_allowance,    -- ★変更: deduction列追加
      weekday_amount, weekend_amount, overtime_amount, paid_leave_amount,
      commute_amount, gross_amount,
      social_insurance, employment_insurance, income_tax, resident_tax, car_deduction,
      total_deduction, net_amount, dependents,
      status, calculated_at, detail_json
    ) VALUES (
      v_company_id, v_setting.id, v_setting.employee_id, v_setting.display_name,
      p_target_month, v_period_start, v_period_end, v_pay_date,
      v_worked_days, v_worked_min, v_worked_min, 0,                                                -- ★変更: 合計をweekday側に寄せ、weekend=0
      v_overtime_min, 0, v_paid_leave_days,
      v_base, v_fixed, v_pos, v_fam,
      0, v_child, v_other,                                                  -- ★変更: allowance=0, deduction=v_child
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
      child_support_deduction = EXCLUDED.child_support_deduction,           -- ★変更: deduction列追加
      other_allowance    = EXCLUDED.other_allowance,
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
