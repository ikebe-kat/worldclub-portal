-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: 給与マスタ初期投入
-- 始業10:00全員共通。所定労働時間 = 終業 - 10:00 - 休憩
-- パート休憩: 松浦潤子=40分固定、その他=打刻時申告（settings側はNULL）
--
-- ※ employees テーブルに該当 employee_code が無くても master 行は作成する。
--   employee_id は scalar subquery で引き、見つからなければ NULL のまま。
-- ═══════════════════════════════════════════════════════════════

-- ── 正社員 ──
INSERT INTO public.wc_payroll_settings
  (company_id, employee_id, display_name, employment_type,
   base_salary, position_allowance, family_allowance, car_deduction, resident_tax,
   social_insurance, commute_per_day, dependents)
SELECT
  'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid,
  (SELECT id FROM public.employees
    WHERE employee_code = v.emp_code
      AND company_id    = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid
    LIMIT 1),
  v.name, '正社員',
  v.base, v.pos, v.fam, v.car, v.rt, v.shaho, v.commute, v.dep
FROM (VALUES
  ('WC001', '小川靖志',  490000, 30000, 10000, 30000, 36000, 79102, 280, 1),
  ('WC002', '岩澤歩',    480000, 30000, 10000, 40000,     0, 79102, 240, 1),
  ('WC003', '寺井恵美',  310000,     0,     0,     0,     0, 47760, 640, 0),
  ('WC004', '小森達也',  400000, 30000, 20000,     0,     0, 64536, 200, 2)
) AS v(emp_code, name, base, pos, fam, car, rt, shaho, commute, dep)
ON CONFLICT (company_id, display_name) DO UPDATE SET
  employee_id        = EXCLUDED.employee_id,
  base_salary        = EXCLUDED.base_salary,
  position_allowance = EXCLUDED.position_allowance,
  family_allowance   = EXCLUDED.family_allowance,
  car_deduction      = EXCLUDED.car_deduction,
  resident_tax       = EXCLUDED.resident_tax,
  social_insurance   = EXCLUDED.social_insurance,
  commute_per_day    = EXCLUDED.commute_per_day,
  dependents         = EXCLUDED.dependents,
  updated_at         = now();

-- ── パート ──
-- scheduled_minutes = 終業 - 10:00 - 休憩(60分／松浦のみ40分) を分単位で算出
INSERT INTO public.wc_payroll_settings
  (company_id, employee_id, display_name, employment_type,
   hourly_weekday, hourly_weekend, scheduled_end_time, scheduled_minutes,
   break_minutes_fixed, position_allowance,
   social_insurance, commute_per_day, dependents)
SELECT
  'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid,
  (SELECT id FROM public.employees
    WHERE employee_code = v.emp_code
      AND company_id    = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid
    LIMIT 1),
  v.name, 'パート',
  v.hw, v.hwe, v.endt::time, v.smin,
  v.bfix, v.pos, v.shaho, v.commute, 0
FROM (VALUES
  -- emp_code, name,             hw,   hwe,  end,    smin, bfix, pos, shaho, commute
  ('WC005',  '小澤直美',         1150, 1250, '19:00', 480, NULL::int,    0, 23995, 120),
  ('WC006',  '増田彩華',         1300, 1400, '19:00', 480, NULL::int,    0,     0, 520),
  ('WC007',  '小池眞加',         1500, 1600, '19:00', 480, NULL::int,    0,     0, 240),
  ('WC008',  '島寄裕子',         1300, 1400, '17:00', 360, NULL::int,    0, 23880, 128),
  ('WC009',  '加藤知子',         1300, 1400, '17:00', 360, NULL::int,    0,     0, 160),
  ('WC010',  '南亜矢子',         1450, 1550, '19:00', 480, NULL::int, 10000, 36699,   0),
  ('WC011',  '新田真由美',       1300, 1400, '17:00', 360, NULL::int,    0, 23880,   0),
  ('WC012',  '秋田奈津季',       1150, 1250, '16:00', 300, NULL::int,    0,     0, 140),
  ('WC013',  '中嶋亜紀',         1150, 1250, '17:00', 360, NULL::int,    0,     0, 460),
  ('WC014',  '小寺慎一',         1150, 1250, '19:00', 480, NULL::int,    0, 28230, 900),
  ('WC015',  '松浦潤子',         1450, 1450, '15:40', 300,   40,         0,     0, 108),
  ('WC016',  '塚田真由美',       1250, 1350, '19:00', 480, NULL::int,    0, 28230, 480)
) AS v(emp_code, name, hw, hwe, endt, smin, bfix, pos, shaho, commute)
ON CONFLICT (company_id, display_name) DO UPDATE SET
  employee_id         = EXCLUDED.employee_id,
  hourly_weekday      = EXCLUDED.hourly_weekday,
  hourly_weekend      = EXCLUDED.hourly_weekend,
  scheduled_end_time  = EXCLUDED.scheduled_end_time,
  scheduled_minutes   = EXCLUDED.scheduled_minutes,
  break_minutes_fixed = EXCLUDED.break_minutes_fixed,
  position_allowance  = EXCLUDED.position_allowance,
  social_insurance    = EXCLUDED.social_insurance,
  commute_per_day     = EXCLUDED.commute_per_day,
  updated_at          = now();

-- ── 給与表示専用（employees に未登録）：田中亜矢子 ──
INSERT INTO public.wc_payroll_settings
  (company_id, employee_id, display_name, employment_type, is_payroll_only)
VALUES
  ('c2d368f0-aa9b-4f70-b082-43ec07723d6c', NULL, '田中亜矢子', 'その他', true)
ON CONFLICT (company_id, display_name) DO UPDATE SET
  is_payroll_only = true, updated_at = now();
