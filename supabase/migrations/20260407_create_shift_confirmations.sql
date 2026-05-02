-- ═══════════════════════════════════════════
-- shift_confirmations — シフト確定記録
-- ═══════════════════════════════════════════

create table if not exists public.shift_confirmations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  confirmed_by  uuid not null references public.employees(id),
  target_month  text not null,                     -- 例 '2026-05'
  confirmed_at  timestamptz not null default now(),
  note          text,
  created_at    timestamptz not null default now(),

  unique (company_id, target_month)
);

alter table public.shift_confirmations enable row level security;

create policy "shift_confirmations_select" on public.shift_confirmations for select using (true);
create policy "shift_confirmations_insert" on public.shift_confirmations for insert with check (true);
create policy "shift_confirmations_update" on public.shift_confirmations for update using (true);
create policy "shift_confirmations_delete" on public.shift_confirmations for delete using (true);

create index if not exists idx_shift_confirmations_company_month
  on public.shift_confirmations (company_id, target_month);
