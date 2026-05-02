-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: attendance_daily に休憩自己申告カラム追加
--   * akashi-portal が既に同名カラムを使っている場合は IF NOT EXISTS でno-op
--   * KAT のコードはこのカラムを参照しないので影響なし
--   * NULL許容＋デフォルトNULLなので既存KAT行のINSERTにも非影響
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.attendance_daily
  ADD COLUMN IF NOT EXISTS break_minutes_self_reported integer;

COMMENT ON COLUMN public.attendance_daily.break_minutes_self_reported IS
  'パート従業員が打刻時に自己申告した休憩時間（分）。NULL=未申告。worldclub/akashi で使用';
