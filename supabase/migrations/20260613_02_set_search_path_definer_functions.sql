-- ═══════════════════════════════════════════════════════════════
-- SECURITY DEFINER 関数に SET search_path を追加
--
-- ALTER FUNCTION ... SET のみ。関数本体は一切変更しない。
-- search_path 未指定の DEFINER 関数は search_path injection の
-- 脆弱性があるため、public, pg_temp に固定する。
-- ═══════════════════════════════════════════════════════════════

ALTER FUNCTION public.akashi_annual_leave_grant()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.akashi_daily_leave_check()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.create_default_pin()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.is_entry_admin()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.notify_calendar_event()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.notify_upcoming_events()
  SET search_path = public, pg_temp;
