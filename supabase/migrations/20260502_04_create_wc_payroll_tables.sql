-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: 給与計算テーブル群
--   wc_payroll_settings  社員別給与マスタ
--   wc_payroll_global    全社設定
--   wc_payroll_monthly   月次給与結果
--   wc_overtime_requests 残業申請（パート）
--   wc_jp_holidays       日本の祝日（worldclub専用）
-- 全テーブル名に wc_ プレフィックスを付け、KAT 側と完全に分離する。
-- ═══════════════════════════════════════════════════════════════

-- ── 社員別給与マスタ ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wc_payroll_settings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL,
  employee_id        uuid REFERENCES public.employees(id) ON DELETE CASCADE,  -- NULL可（田中亜矢子等）
  display_name       text NOT NULL,
  employment_type    text NOT NULL CHECK (employment_type IN ('正社員','パート','その他')),
  -- 正社員用
  base_salary        integer NOT NULL DEFAULT 0,           -- 基本給
  fixed_overtime     integer NOT NULL DEFAULT 0,           -- 固定残業手当
  position_allowance integer NOT NULL DEFAULT 0,           -- 役職手当
  family_allowance   integer NOT NULL DEFAULT 0,           -- 家族手当
  car_deduction      integer NOT NULL DEFAULT 0,           -- 車（控除）
  resident_tax       integer NOT NULL DEFAULT 0,           -- 住民税
  -- パート用
  hourly_weekday     integer NOT NULL DEFAULT 0,           -- 平日時給
  hourly_weekend     integer NOT NULL DEFAULT 0,           -- 土日(祝)時給
  scheduled_end_time time,                                 -- 所定終業時刻（残業判定用）
  scheduled_minutes  integer NOT NULL DEFAULT 0,           -- 所定労働時間（分／有給金額計算用）
  break_minutes_fixed integer,                             -- 休憩固定（NULLなら打刻時申告）
  -- 共通
  social_insurance   integer NOT NULL DEFAULT 0,           -- 社会保険
  commute_per_day    integer NOT NULL DEFAULT 0,           -- 交通費（日額）
  dependents         integer NOT NULL DEFAULT 0,           -- 扶養人数（所得税表参照用）
  is_payroll_only    boolean NOT NULL DEFAULT false,       -- 給与表示のみ（出退勤なし）
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, display_name)
);
CREATE INDEX IF NOT EXISTS idx_wc_payroll_settings_emp
  ON public.wc_payroll_settings (company_id, employee_id);

-- ── 全社設定 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wc_payroll_global (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid NOT NULL UNIQUE,
  employment_insurance_old    numeric(5,4) NOT NULL DEFAULT 0.0055,  -- 雇用保険率（旧 ～R8.3）
  employment_insurance_new    numeric(5,4) NOT NULL DEFAULT 0.0050,  -- 雇用保険率（新 R8.4～）
  insurance_switch_date       date NOT NULL DEFAULT '2026-04-01',    -- 切替日
  overtime_multiplier         numeric(4,2) NOT NULL DEFAULT 1.25,    -- 残業割増率
  closing_day                 integer NOT NULL DEFAULT 20,           -- 締め日
  pay_day_label               text    NOT NULL DEFAULT '当月末',
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- ── 月次給与結果 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wc_payroll_monthly (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  payroll_setting_id  uuid REFERENCES public.wc_payroll_settings(id) ON DELETE CASCADE,
  employee_id         uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  display_name        text NOT NULL,
  target_month        text NOT NULL,            -- 'YYYY-MM' (締日を含む月)
  period_start        date NOT NULL,            -- 前月21日
  period_end          date NOT NULL,            -- 当月20日
  pay_date            date,                     -- 当月末日
  -- 勤怠
  worked_days         integer NOT NULL DEFAULT 0,
  worked_minutes      integer NOT NULL DEFAULT 0,
  weekday_minutes     integer NOT NULL DEFAULT 0,
  weekend_minutes     integer NOT NULL DEFAULT 0,
  overtime_minutes    integer NOT NULL DEFAULT 0,
  paid_leave_days     integer NOT NULL DEFAULT 0,
  -- 支給
  base_salary         integer NOT NULL DEFAULT 0,
  fixed_overtime      integer NOT NULL DEFAULT 0,
  position_allowance  integer NOT NULL DEFAULT 0,
  family_allowance    integer NOT NULL DEFAULT 0,
  weekday_amount      integer NOT NULL DEFAULT 0,
  weekend_amount      integer NOT NULL DEFAULT 0,
  overtime_amount     integer NOT NULL DEFAULT 0,
  paid_leave_amount   integer NOT NULL DEFAULT 0,
  other_allowance     integer NOT NULL DEFAULT 0,
  commute_amount      integer NOT NULL DEFAULT 0,
  gross_amount        integer NOT NULL DEFAULT 0,
  -- 控除
  social_insurance    integer NOT NULL DEFAULT 0,
  employment_insurance integer NOT NULL DEFAULT 0,
  income_tax          integer NOT NULL DEFAULT 0,
  resident_tax        integer NOT NULL DEFAULT 0,
  car_deduction       integer NOT NULL DEFAULT 0,
  total_deduction     integer NOT NULL DEFAULT 0,
  -- 差引支給
  net_amount          integer NOT NULL DEFAULT 0,
  -- 状態
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  calculated_at       timestamptz,
  confirmed_at        timestamptz,
  confirmed_by        uuid REFERENCES public.employees(id),
  detail_json         jsonb,                    -- PDF描画用ディテール
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, payroll_setting_id, target_month)
);
CREATE INDEX IF NOT EXISTS idx_wc_payroll_monthly_target
  ON public.wc_payroll_monthly (company_id, target_month);

-- ── 残業申請（パート用） ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wc_overtime_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  employee_id     uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  reason          text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by     uuid REFERENCES public.employees(id),
  approved_at     timestamptz,
  reject_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS idx_wc_overtime_status
  ON public.wc_overtime_requests (company_id, status, attendance_date);

-- ── 日本の祝日 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wc_jp_holidays (
  holiday_date date PRIMARY KEY,
  name         text NOT NULL
);

COMMENT ON TABLE public.wc_payroll_settings IS 'worldclub: 社員別給与マスタ（時給・社保・住民税等）';
COMMENT ON TABLE public.wc_payroll_global   IS 'worldclub: 全社給与設定';
COMMENT ON TABLE public.wc_payroll_monthly  IS 'worldclub: 月次給与計算結果';
COMMENT ON TABLE public.wc_overtime_requests IS 'worldclub: パートの残業事前/当日申請';
COMMENT ON TABLE public.wc_jp_holidays      IS 'worldclub: 日本の祝日（土日扱い判定用）';
