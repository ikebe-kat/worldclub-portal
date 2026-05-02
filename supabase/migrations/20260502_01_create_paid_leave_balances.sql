-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: 有給残高テーブル
-- 注意:
--   * 同一Supabaseプロジェクトを kat-kintai-app と共有しているため、
--     全レコードに company_id を持たせ worldclub レコードは
--     company_id='c2d368f0-aa9b-4f70-b082-43ec07723d6c' でフィルタする。
--   * KAT の trg_01/02/03 は触らない。
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.paid_leave_balances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  fiscal_year integer NOT NULL,                 -- 付与年度（例: 2026）
  carry_over  integer NOT NULL DEFAULT 0,       -- 繰越（日）
  granted     integer NOT NULL DEFAULT 0,       -- 付与（日）
  consumed    integer NOT NULL DEFAULT 0,       -- 消化（日）
  remaining   integer GENERATED ALWAYS AS (carry_over + granted - consumed) STORED,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, fiscal_year)
);

CREATE INDEX IF NOT EXISTS idx_paid_leave_balances_company
  ON public.paid_leave_balances (company_id, employee_id);

COMMENT ON TABLE  public.paid_leave_balances IS '有給休暇残高（年度単位）';
COMMENT ON COLUMN public.paid_leave_balances.remaining IS '繰越+付与-消化（自動計算）';
