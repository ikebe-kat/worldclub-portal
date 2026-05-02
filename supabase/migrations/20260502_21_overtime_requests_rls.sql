-- ============================================================
-- 全テーブル RLS ポリシー一括設定
-- 問題: テーブルにRLSが有効だがポリシーが未作成 → anonキーから全操作拒否
-- ============================================================

-- ─── wc_overtime_requests ───
ALTER TABLE wc_overtime_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wc_overtime_requests_select" ON wc_overtime_requests;
DROP POLICY IF EXISTS "wc_overtime_requests_insert" ON wc_overtime_requests;
DROP POLICY IF EXISTS "wc_overtime_requests_update" ON wc_overtime_requests;
CREATE POLICY "wc_overtime_requests_select" ON wc_overtime_requests FOR SELECT USING (true);
CREATE POLICY "wc_overtime_requests_insert" ON wc_overtime_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "wc_overtime_requests_update" ON wc_overtime_requests FOR UPDATE USING (true);

-- ─── leave_requests ───
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_requests_select" ON leave_requests;
DROP POLICY IF EXISTS "leave_requests_insert" ON leave_requests;
DROP POLICY IF EXISTS "leave_requests_update" ON leave_requests;
DROP POLICY IF EXISTS "leave_requests_delete" ON leave_requests;
CREATE POLICY "leave_requests_select" ON leave_requests FOR SELECT USING (true);
CREATE POLICY "leave_requests_insert" ON leave_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "leave_requests_update" ON leave_requests FOR UPDATE USING (true);
CREATE POLICY "leave_requests_delete" ON leave_requests FOR DELETE USING (true);

-- ─── shift_submissions ───
ALTER TABLE shift_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shift_submissions_select" ON shift_submissions;
DROP POLICY IF EXISTS "shift_submissions_insert" ON shift_submissions;
DROP POLICY IF EXISTS "shift_submissions_update" ON shift_submissions;
CREATE POLICY "shift_submissions_select" ON shift_submissions FOR SELECT USING (true);
CREATE POLICY "shift_submissions_insert" ON shift_submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "shift_submissions_update" ON shift_submissions FOR UPDATE USING (true);

-- ─── shift_confirmations ───
ALTER TABLE shift_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shift_confirmations_select" ON shift_confirmations;
DROP POLICY IF EXISTS "shift_confirmations_insert" ON shift_confirmations;
DROP POLICY IF EXISTS "shift_confirmations_update" ON shift_confirmations;
CREATE POLICY "shift_confirmations_select" ON shift_confirmations FOR SELECT USING (true);
CREATE POLICY "shift_confirmations_insert" ON shift_confirmations FOR INSERT WITH CHECK (true);
CREATE POLICY "shift_confirmations_update" ON shift_confirmations FOR UPDATE USING (true);

-- ─── documents ───
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "documents_select" ON documents;
DROP POLICY IF EXISTS "documents_insert" ON documents;
CREATE POLICY "documents_select" ON documents FOR SELECT USING (true);
CREATE POLICY "documents_insert" ON documents FOR INSERT WITH CHECK (true);

-- ─── custom_events ───
ALTER TABLE custom_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "custom_events_select" ON custom_events;
DROP POLICY IF EXISTS "custom_events_insert" ON custom_events;
DROP POLICY IF EXISTS "custom_events_update" ON custom_events;
CREATE POLICY "custom_events_select" ON custom_events FOR SELECT USING (true);
CREATE POLICY "custom_events_insert" ON custom_events FOR INSERT WITH CHECK (true);
CREATE POLICY "custom_events_update" ON custom_events FOR UPDATE USING (true);

-- ─── variable_hours ───
ALTER TABLE variable_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "variable_hours_select" ON variable_hours;
CREATE POLICY "variable_hours_select" ON variable_hours FOR SELECT USING (true);

-- ─── hope_holiday_quotas ───
ALTER TABLE hope_holiday_quotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hope_holiday_quotas_select" ON hope_holiday_quotas;
CREATE POLICY "hope_holiday_quotas_select" ON hope_holiday_quotas FOR SELECT USING (true);

-- ─── holiday_calendars ───
ALTER TABLE holiday_calendars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "holiday_calendars_select" ON holiday_calendars;
CREATE POLICY "holiday_calendars_select" ON holiday_calendars FOR SELECT USING (true);
