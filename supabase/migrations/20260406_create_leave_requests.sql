-- ═══════════════════════════════════════════
-- leave_requests — 公休申請（シフト管理用）
-- ═══════════════════════════════════════════

create table if not exists public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  store_id      uuid not null references public.stores(id),
  employee_id   uuid not null references public.employees(id),
  attendance_date  date not null,                        -- 申請対象日
  type          text not null default 'shift_koukyuu', -- 申請種別
  status        text not null default 'pending',       -- pending / approved / returned
  approved_by   uuid references public.employees(id),  -- 承認者
  approved_at   timestamptz,
  request_comment text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- 同一従業員・同一日に同一typeは1件のみ
  unique (employee_id, attendance_date, type)
);

-- RLS
alter table public.leave_requests enable row level security;

create policy "leave_requests_select" on public.leave_requests
  for select using (true);

create policy "leave_requests_insert" on public.leave_requests
  for insert with check (true);

create policy "leave_requests_update" on public.leave_requests
  for update using (true);

create policy "leave_requests_delete" on public.leave_requests
  for delete using (true);

-- インデックス
create index if not exists idx_leave_requests_emp_date
  on public.leave_requests (employee_id, attendance_date);

create index if not exists idx_leave_requests_company_status
  on public.leave_requests (company_id, status);
