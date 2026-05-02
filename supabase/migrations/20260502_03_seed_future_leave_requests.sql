-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: 既知の未来有給を leave_requests に承認済みで挿入
--   WC002 岩澤歩  : 2026/05/18
--   WC003 寺井恵美: 2026/05/06
--   WC010 南亜矢子: 2026/05/11, 2026/05/20
-- ※ 5/11 は日曜だが、南さんは土日も出勤するパートのため意図通り。
-- ═══════════════════════════════════════════════════════════════

WITH wc AS (
  SELECT
    'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid AS cid,
    '06027f43-fa49-4b2e-8009-903456b0ce33'::uuid AS sid
)
-- ※ 20260406_create_leave_requests.sql の table 定義に approver_id は無いので除外。
--   reason カラムも初期定義には無いが本番DBには存在するため含める（ShiftSub.tsx も書き込み済み）。
INSERT INTO public.leave_requests
  (company_id, store_id, employee_id, attendance_date, type, status, reason,
   approved_by, approved_at)
SELECT
  wc.cid, wc.sid, e.id, v.dt::date,
  'yukyu', 'approved', '有給（全日）',
  e.id, now()
FROM wc
CROSS JOIN (VALUES
  ('WC002', '2026-05-18'),
  ('WC003', '2026-05-06'),
  ('WC010', '2026-05-11'),
  ('WC010', '2026-05-20')
) AS v(emp_code, dt)
JOIN public.employees e
  ON e.employee_code = v.emp_code AND e.company_id = wc.cid
ON CONFLICT DO NOTHING;
