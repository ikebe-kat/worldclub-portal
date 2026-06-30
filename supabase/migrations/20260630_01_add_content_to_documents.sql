-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: documents テーブルに content カラム追加
--
-- 給与明細(doc_type='payslip')をHTML本文として保存するために使用。
-- 通常のファイル配布行（file_url）では NULL のまま。
--
-- 本マイグレーションは記録目的。
-- 本番DBには既に SQL Editor で実行済み（2026/6/30）。
-- IF NOT EXISTS 付きなので再実行しても安全。
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content text;
