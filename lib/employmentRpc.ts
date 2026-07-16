import { supabase } from '@/lib/supabase';

export type EmploymentStatus = 'active' | 'not_employed' | 'excluded';
export type ExclusionTarget = 'payroll' | 'insurance' | 'paid_leave' | 'attendance';

export async function fetchEmploymentStatus(
  companyId: string,
  periodStart: string,
  periodEnd: string,
  target: ExclusionTarget,
): Promise<Map<string, EmploymentStatus>> {
  const { data, error } = await supabase.rpc('fn_employment_status_in_period', {
    p_company_id: companyId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_target: target,
  });
  if (error) throw new Error(`fn_employment_status_in_period: ${error.message}`);
  const m = new Map<string, EmploymentStatus>();
  for (const row of (data || [])) {
    m.set(row.employee_id, row.status as EmploymentStatus);
  }
  return m;
}

export async function fetchLeaveDays(
  companyId: string,
  periodStart: string,
  periodEnd: string,
  target: ExclusionTarget,
): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('fn_leave_days_in_period', {
    p_company_id: companyId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_target: target,
  });
  if (error) throw new Error(`fn_leave_days_in_period: ${error.message}`);
  const s = new Set<string>();
  for (const row of (data || [])) {
    s.add(`${row.employee_id}|${row.leave_date}`);
  }
  return s;
}

export const leaveKey = (empId: string, date: string) => `${empId}|${date}`;
