ALTER TABLE public.paid_leave_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paid_leave_balances_select" ON public.paid_leave_balances
  FOR SELECT USING (true);

CREATE POLICY "paid_leave_balances_insert" ON public.paid_leave_balances
  FOR INSERT WITH CHECK (true);

CREATE POLICY "paid_leave_balances_update" ON public.paid_leave_balances
  FOR UPDATE USING (true);

CREATE POLICY "paid_leave_balances_delete" ON public.paid_leave_balances
  FOR DELETE USING (true);
