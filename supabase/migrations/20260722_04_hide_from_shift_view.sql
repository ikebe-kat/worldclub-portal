-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: シフト表の行非表示フラグを wc_payroll_settings に追加
--
-- 【背景】
--   出勤簿タブの「シフト表」サブタブ(ShiftViewSub.tsx)から、
--   特定社員の行を恒久的に除外したい。氏名・コードを画面コードに
--   直書きせず、マスタでON/OFFを管理する。
--
-- 【変更】
--   1. wc_payroll_settings に bool 列 hide_from_shift_view を追加
--        既定 false（表示）。日本語コメント必須。
--   2. 島寄裕子(WC008) を true に UPDATE。
--
-- 【触らないもの】
--   - 給与計算 wc_fn_calculate_monthly_payroll のロジックは不変
--     （このフラグは給与関数から一切参照されない、UI表示専用）
--   - 他社員の該当列は既定 false のまま
--   - attendance_daily/leave_requests 等の実データには一切UPDATEしない
--   - KAT/明石共通関数・既存トリガーには一切触れない
--
-- 【適用手順（池邉さん）】
--   Supabase Dashboard → SQL Editor で本ファイル全体を貼り付けて実行、
--   または supabase db query --linked --file <path> でも可。
--   コード側は同時にpush済み。適用直後から反映される。
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.wc_payroll_settings
  ADD COLUMN IF NOT EXISTS hide_from_shift_view boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.wc_payroll_settings.hide_from_shift_view IS
  'シフト表で行を非表示にする。true=出勤簿タブ内「シフト表」サブタブの一覧から該当社員の行を除外し、かつ本人ログイン時にはシフト表サブタブ自体を表示しない。既定false。給与計算関数からは参照されないUI表示専用フラグ。';

-- 島寄裕子(WC008) を非表示に
UPDATE public.wc_payroll_settings s
   SET hide_from_shift_view = true,
       updated_at = now()
  FROM public.employees e
 WHERE e.id = s.employee_id
   AND s.company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid
   AND e.employee_code = 'WC008';
