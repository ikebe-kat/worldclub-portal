-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: wc_payroll_global 初期値
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.wc_payroll_global
  (company_id, employment_insurance_old, employment_insurance_new,
   insurance_switch_date, overtime_multiplier, closing_day, pay_day_label)
VALUES
  ('c2d368f0-aa9b-4f70-b082-43ec07723d6c',
   0.0055, 0.0050, '2026-04-01', 1.25, 20, '当月末')
ON CONFLICT (company_id) DO UPDATE SET
  employment_insurance_old = EXCLUDED.employment_insurance_old,
  employment_insurance_new = EXCLUDED.employment_insurance_new,
  insurance_switch_date    = EXCLUDED.insurance_switch_date,
  overtime_multiplier      = EXCLUDED.overtime_multiplier,
  closing_day              = EXCLUDED.closing_day,
  pay_day_label            = EXCLUDED.pay_day_label,
  updated_at               = now();
