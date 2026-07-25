export interface CalGroup {
  id: string;
  label: string;
}

export async function fetchCalGroups(companyId: string): Promise<CalGroup[]> {
  const res = await fetch(`/api/calendar-groups?company_id=${encodeURIComponent(companyId)}`);
  const json = await res.json();
  return json.data || [];
}

export function calGroupLabel(groups: CalGroup[], id: string, fallback = "全店舗"): string {
  return groups.find((g) => g.id === id)?.label ?? fallback;
}
