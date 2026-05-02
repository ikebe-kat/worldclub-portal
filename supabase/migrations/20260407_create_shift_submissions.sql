-- ═══════════════════════════════════════════
-- shift_submissions — シフト希望提出記録
-- ═══════════════════════════════════════════

create table if not exists public.shift_submissions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  employee_id   uuid not null references public.employees(id),
  target_month  text not null,                     -- 例 '2026-05'
  submitted_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),

  unique (employee_id, target_month)
);

alter table public.shift_submissions enable row level security;

create policy "shift_submissions_select" on public.shift_submissions for select using (true);
create policy "shift_submissions_insert" on public.shift_submissions for insert with check (true);
create policy "shift_submissions_update" on public.shift_submissions for update using (true);
create policy "shift_submissions_delete" on public.shift_submissions for delete using (true);

create index if not exists idx_shift_submissions_company_month
  on public.shift_submissions (company_id, target_month);
