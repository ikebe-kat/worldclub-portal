-- ═══════════════════════════════════════════════════════════════
-- ワールドクラブ全社員の work_pattern_code を 1000-1900 に更新
-- 正社員定時: 10:00-19:00（実働8時間、休憩1時間）
-- ※ 池邉さんがSQL Editorで手動実行する前提
-- ═══════════════════════════════════════════════════════════════

UPDATE public.employees
SET work_pattern_code = '1000-1900',
    updated_at = now()
WHERE company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'
  AND is_active = true;
