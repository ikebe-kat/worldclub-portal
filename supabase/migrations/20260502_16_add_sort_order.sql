-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: wc_payroll_settings に表示順カラム sort_order を追加
-- + 16名分の固定順を投入
-- + 松浦もも子は is_active=false にして一覧から除外
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.wc_payroll_settings
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 999;

COMMENT ON COLUMN public.wc_payroll_settings.sort_order IS
  '一覧表示順（小さいほど上）。未指定は 999（末尾）';

-- ── 表示順を投入 ──
UPDATE public.wc_payroll_settings SET sort_order =  1, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '小川靖志';
UPDATE public.wc_payroll_settings SET sort_order =  2, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '岩澤歩';
UPDATE public.wc_payroll_settings SET sort_order =  3, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '寺井恵美';
UPDATE public.wc_payroll_settings SET sort_order =  4, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '小森達也';
UPDATE public.wc_payroll_settings SET sort_order =  5, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '松浦潤子';
UPDATE public.wc_payroll_settings SET sort_order =  6, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '小池眞加';
UPDATE public.wc_payroll_settings SET sort_order =  7, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '島寄裕子';
UPDATE public.wc_payroll_settings SET sort_order =  8, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '加藤知子';
UPDATE public.wc_payroll_settings SET sort_order =  9, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '新田真由美';
UPDATE public.wc_payroll_settings SET sort_order = 10, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '南亜矢子';
UPDATE public.wc_payroll_settings SET sort_order = 11, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '増田彩華';
UPDATE public.wc_payroll_settings SET sort_order = 12, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '小澤直美';
UPDATE public.wc_payroll_settings SET sort_order = 13, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '秋田奈津季';
UPDATE public.wc_payroll_settings SET sort_order = 14, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '中嶋亜紀';
UPDATE public.wc_payroll_settings SET sort_order = 15, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '小寺慎一';
UPDATE public.wc_payroll_settings SET sort_order = 16, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '塚田真由美';

-- 田中亜矢子（給与表示専用）は末尾
UPDATE public.wc_payroll_settings SET sort_order = 99, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c' AND display_name = '田中亜矢子';

-- ── 松浦もも子は除外（is_active=false） ──
UPDATE public.wc_payroll_settings
   SET is_active = false, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'
   AND display_name = '松浦もも子';
