-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: 半休日に不足控除が発生するバグを修正
--
-- 【バグ】
--   正社員が半休(午前有給/午後有給)を取った日、attendance_daily には
--   残り半日ぶんの実労働(actual_hours>0)が記録される。
--   → worked_days に +1 されるため v_scheduled_days でその日を「1日勤務予定」と
--     数えるが、shortfall計算では所定を480分フルで期待してしまう。
--   → 240分不足として扱われ、遅刻早退・不足控除が発生。
--   小森 6/24 午前有給 → 実労働4h、予定480分と差分240分不足 → 8,695円の誤控除。
--
-- 【修正】
--   予定所定分の合計から (半休日数 × scheduled_minutes/2) を引く。
--   ＝ 半休日はその日「所定 scheduled_minutes/2 分だけ働く予定」として扱う。
--   例: 正社員(scheduled_minutes=480)の半休日は 240分が期待所定 → 実労働240分なら
--     shortfall=0、実労働180分(3h)なら shortfall=60分（正しく残り所定に対する不足だけ控除）。
--
-- 【変更しない】
--   - 全日有給: wc_fn_calc_attendance_daily トリガーが actual_hours=NULL に
--     しているため worked_days/worked_min に入らず、v_scheduled_days にも積まれず、
--     shortfall計算に登場しない。従来通り控除ゼロ。
--   - 欠勤: absent_days++ で v_scheduled_days に積まれる → その日フル480分が
--     shortfallに乗る。従来通りの欠勤控除挙動を維持。
--   - パート: employment_type <> '正社員' なので shortfall分岐に入らない。
--     従来通り時給×分で計算のみ。
--   - unit_per_min の分母 (v_scheduled_days * scheduled_minutes) は
--     変更しない（分単価は月所定フルベースを維持）。
--
-- 【触らないもの】
--   - paid_leave_grants (有給残高) には一切UPDATEしない
--   - wc_payroll_monthly の既存行にも直接UPDATEしない
--     → 適用後 PayrollSub の「再計算」ボタンで draft行のみ更新
--   - 既存トリガー wc_fn_calc_attendance_daily / wc_fn_sync_over_under は変更なし
--   - KAT/明石の共通関数・トリガーには一切触れない
--
-- 【適用手順（池邉さん）】
--   Supabase Dashboard → SQL Editor で本ファイル全体を貼り付けて実行、
--   または supabase db query --linked --file <path> でも可。
--   その後、給与管理タブで対象月を開いて「再計算」→ 対象月のdraft行のみ更新される。
--   confirmed 済み行は保護されるため、必要なら一旦戻して再計算 → 再確定。
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.wc_fn_calculate_monthly_payroll(p_target_month text, p_caller_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_paid_leave_days numeric(4,1);
  v_half_leave_days int;               -- ★追加: 半休(午前有給/午後有給)の日数
  v_absent_days     int;
  v_base int;
  v_fixed int;
  v_pos int;
  v_fam int;
  v_child int;
  v_other int;
  v_scheduled_days int;
  v_expected_min   int;                -- ★追加: 半休を差し引いた期待所定分
  v_shortfall_min int;
  v_late_early_ded int;
  v_unit_per_min numeric;
  v_weekday_amt int;
  v_weekend_amt int;
  v_overtime_amt int;
  v_paid_leave_amt int;
  v_commute int;
  v_gross int;
  v_shaho int;
  v_emp_ins int;
  v_inc_tax int;
  v_res_tax int;
  v_car int;
  v_total_ded int;
  v_net int;
  v_taxable int;
  v_count int := 0;
  v_excluded_ids uuid[];
  v_is_excluded  boolean;
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

  SELECT array_agg(employee_id) INTO v_excluded_ids
    FROM public.fn_employment_status_in_period(v_company_id, v_period_start, v_period_end, 'payroll'::text)
    WHERE status = 'excluded';
  IF v_excluded_ids IS NULL THEN v_excluded_ids := '{}'; END IF;

  FOR v_setting IN
    SELECT s.*
    FROM public.wc_payroll_settings s
    LEFT JOIN public.employees e ON e.id = s.employee_id
    WHERE s.company_id = v_company_id
      AND s.is_calc_target = true
      AND (
        (s.employee_id IS NULL AND s.is_active = true)
        OR
        (s.employee_id IS NOT NULL AND (e.resigned_at IS NULL OR e.resigned_at >= v_period_start))
      )
    ORDER BY s.sort_order, s.display_name
  LOOP
    v_worked_days := 0; v_worked_min := 0;
    v_weekday_min := 0; v_weekend_min := 0;
    v_overtime_min := 0; v_paid_leave_days := 0;
    v_half_leave_days := 0; v_absent_days := 0;

    v_is_excluded := v_setting.employee_id IS NOT NULL AND v_setting.employee_id = ANY(v_excluded_ids);

    IF NOT v_is_excluded AND NOT v_setting.is_payroll_only AND v_setting.employee_id IS NOT NULL THEN
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
        COALESCE(SUM(CASE
          WHEN reason LIKE '%有給（全日）%' THEN 1.0
          WHEN reason LIKE '%午前有給%' OR reason LIKE '%午後有給%' THEN 0.5
          ELSE 0
        END), 0),
        -- ★追加: 半休(午前有給 or 午後有給)の日数（全日は含めない）
        COUNT(*) FILTER (WHERE reason LIKE '%午前有給%' OR reason LIKE '%午後有給%'),
        COUNT(*) FILTER (WHERE reason = '欠勤')
      INTO
        v_worked_days, v_worked_min,
        v_weekday_min, v_weekend_min,
        v_overtime_min, v_paid_leave_days,
        v_half_leave_days, v_absent_days
      FROM att;
    END IF;

    IF v_is_excluded THEN
      v_base := 0; v_fixed := 0; v_pos := 0; v_fam := 0; v_child := 0; v_other := 0;
      v_commute := 0; v_late_early_ded := 0; v_shortfall_min := 0; v_expected_min := 0;
      v_weekday_amt := 0; v_weekend_amt := 0; v_overtime_amt := 0; v_paid_leave_amt := 0;
      v_gross := 0; v_shaho := 0; v_emp_ins := 0; v_inc_tax := 0; v_res_tax := 0; v_car := 0;
      v_total_ded := 0; v_net := 0; v_taxable := 0;
    ELSE
      v_base    := v_setting.base_salary;
      v_fixed   := v_setting.fixed_overtime;
      v_pos     := v_setting.position_allowance;
      v_fam     := v_setting.family_allowance;
      v_child   := COALESCE(v_setting.child_support_deduction, 0);
      v_commute := v_setting.commute_per_day * v_worked_days;

      SELECT COALESCE(other_allowance, 0) INTO v_other
        FROM public.wc_payroll_monthly
       WHERE company_id = v_company_id
         AND payroll_setting_id = v_setting.id
         AND target_month = p_target_month;
      IF NOT FOUND THEN
        v_other := 0;
      END IF;

      v_late_early_ded := 0;
      v_shortfall_min := 0;
      v_expected_min := 0;
      IF v_setting.employment_type = '正社員' THEN
        v_scheduled_days := v_worked_days + v_absent_days;
        IF v_scheduled_days > 0 THEN
          -- ★変更: 半休日はその日「scheduled_minutes/2 分だけ働く予定」として扱う
          --   → 予定所定合計から (半休日数 × scheduled_minutes/2) を引く。
          --   半休日に残り所定を満たさなければ、その差分だけ shortfall として控除される。
          --   全日有給は actual_hours=NULL で worked_days/scheduled_days に入らない
          --   ため、この式で自動的に控除ゼロを維持する。
          v_expected_min := (v_scheduled_days * v_setting.scheduled_minutes)
                            - (v_half_leave_days * (v_setting.scheduled_minutes / 2));
          v_shortfall_min := v_expected_min - v_worked_min;
          IF v_shortfall_min < 0 THEN v_shortfall_min := 0; END IF;
          IF v_shortfall_min > 0 THEN
            -- 分単価の分母は月所定フルベースを維持（挙動を変えないため）
            v_unit_per_min := (v_base + v_pos)::numeric
                              / (v_scheduled_days * v_setting.scheduled_minutes)::numeric;
            v_late_early_ded := floor(v_unit_per_min * v_shortfall_min)::int;
          END IF;
        END IF;
      END IF;

      IF v_setting.employment_type = 'パート' THEN
        v_weekday_amt   := floor(v_setting.hourly_weekday::numeric * v_worked_min / 60.0)::int;
        v_weekend_amt   := 0;
        v_overtime_amt  := floor(v_setting.hourly_weekday::numeric * v_global.overtime_multiplier
                                  * v_overtime_min / 60.0)::int;
        v_paid_leave_amt := floor(v_setting.hourly_weekday::numeric
                                   * v_setting.scheduled_minutes / 60.0
                                   * v_paid_leave_days)::int;
      ELSE
        v_weekday_amt := 0; v_weekend_amt := 0;
        v_overtime_amt := 0; v_paid_leave_amt := 0;
      END IF;

      v_gross := v_base + v_fixed + v_pos + v_fam + v_other
               + v_weekday_amt + v_weekend_amt + v_overtime_amt + v_paid_leave_amt
               + v_commute
               - v_late_early_ded;

      v_shaho   := v_setting.social_insurance;
      v_res_tax := v_setting.resident_tax;
      v_car     := v_setting.car_deduction;
      v_emp_ins := floor(v_gross::numeric * v_emp_insurance_rate)::int;

      v_taxable := v_gross - v_commute - v_shaho - v_child - v_emp_ins;
      IF v_taxable < 0 THEN v_taxable := 0; END IF;
      v_inc_tax := public.wc_fn_lookup_income_tax(v_taxable, v_setting.dependents);

      v_total_ded := v_shaho + v_emp_ins + v_inc_tax + v_res_tax + v_car + v_child;
      v_net       := v_gross - v_total_ded;
    END IF;

    INSERT INTO public.wc_payroll_monthly (
      company_id, payroll_setting_id, employee_id, display_name,
      target_month, period_start, period_end, pay_date,
      worked_days, worked_minutes, weekday_minutes, weekend_minutes,
      overtime_minutes, night_minutes, paid_leave_days,
      base_salary, fixed_overtime, position_allowance, family_allowance,
      child_support_allowance, child_support_deduction, other_allowance,
      late_early_absence_deduction,
      weekday_amount, weekend_amount, overtime_amount, paid_leave_amount,
      commute_amount, gross_amount,
      social_insurance, employment_insurance, income_tax, resident_tax, car_deduction,
      total_deduction, net_amount, dependents,
      status, calculated_at, detail_json
    ) VALUES (
      v_company_id, v_setting.id, v_setting.employee_id, v_setting.display_name,
      p_target_month, v_period_start, v_period_end, v_pay_date,
      v_worked_days, v_worked_min, v_worked_min, 0,
      v_overtime_min, 0, v_paid_leave_days,
      v_base, v_fixed, v_pos, v_fam,
      0, v_child, v_other,
      v_late_early_ded,
      v_weekday_amt, v_weekend_amt, v_overtime_amt, v_paid_leave_amt,
      v_commute, v_gross,
      v_shaho, v_emp_ins, v_inc_tax, v_res_tax, v_car,
      v_total_ded, v_net, COALESCE(v_setting.dependents, 0),
      'draft', now(),
      jsonb_build_object(
        'employment_type', v_setting.employment_type,
        'hourly_weekday',  v_setting.hourly_weekday,
        'scheduled_minutes', v_setting.scheduled_minutes,
        'dependents',      v_setting.dependents,
        'taxable',         v_taxable,
        'employment_insurance_rate', v_emp_insurance_rate,
        'late_early_absence_deduction', v_late_early_ded,
        'shortfall_min', v_shortfall_min,
        'expected_min',  v_expected_min,     -- ★追加: 半休控除後の期待所定分（デバッグ用）
        'half_leave_days', v_half_leave_days, -- ★追加: 半休日数（デバッグ用）
        'absent_days', v_absent_days,
        'on_leave_excluded', v_is_excluded
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
      child_support_deduction = EXCLUDED.child_support_deduction,
      other_allowance    = EXCLUDED.other_allowance,
      late_early_absence_deduction = EXCLUDED.late_early_absence_deduction,
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
$function$;

GRANT EXECUTE ON FUNCTION public.wc_fn_calculate_monthly_payroll(text, uuid) TO authenticated, anon;
