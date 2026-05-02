-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: 子育て支援金カラム追加（wc_payroll_settings）
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.wc_payroll_settings
  ADD COLUMN IF NOT EXISTS child_support_allowance integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.wc_payroll_settings.child_support_allowance IS
  '子育て支援金（月額）。給与計算時に支給額に加算';

-- ── 該当者の値を投入 ──
UPDATE public.wc_payroll_settings SET child_support_allowance = 609, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '小川靖志';

UPDATE public.wc_payroll_settings SET child_support_allowance = 609, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '岩澤歩';

UPDATE public.wc_payroll_settings SET child_support_allowance = 368, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '寺井恵美';

UPDATE public.wc_payroll_settings SET child_support_allowance = 506, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '小森達也';

UPDATE public.wc_payroll_settings SET child_support_allowance = 299, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '南亜矢子';

UPDATE public.wc_payroll_settings SET child_support_allowance = 184, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '島寄裕子';

UPDATE public.wc_payroll_settings SET child_support_allowance = 184, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '新田真由美';
