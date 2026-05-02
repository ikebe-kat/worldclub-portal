-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: 社会保険料の修正（2026/05 確定値）
-- ═══════════════════════════════════════════════════════════════

UPDATE public.wc_payroll_settings SET social_insurance = 74809, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'
   AND display_name = '小川靖志';

UPDATE public.wc_payroll_settings SET social_insurance = 74809, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'
   AND display_name = '岩澤歩';

UPDATE public.wc_payroll_settings SET social_insurance = 45168, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'
   AND display_name = '寺井恵美';

UPDATE public.wc_payroll_settings SET social_insurance = 62106, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'
   AND display_name = '小森達也';

UPDATE public.wc_payroll_settings SET social_insurance = 22584, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'
   AND display_name = '島寄裕子';

UPDATE public.wc_payroll_settings SET social_insurance = 22584, updated_at = now()
 WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'
   AND display_name = '新田真由美';
