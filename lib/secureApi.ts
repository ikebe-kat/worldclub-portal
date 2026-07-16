type Filter = { column: string; op: string; value: any };
type Order = { column: string; ascending?: boolean };

async function postApi(url: string, body: any): Promise<{ data: any; error?: string | null }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return { data: null, error: `non_json_response_${res.status}` };
    }
    return await res.json();
  } catch (e: any) {
    return { data: null, error: `fetch_error: ${e?.message || "unknown"}` };
  }
}

export type CustomEventsAction =
  | "list_events" | "insert_event" | "update_event" | "delete_event"
  | "expand_events" | "insert_exception"
  | "list_histories" | "insert_history";

export function customEventsApi(params: {
  action: CustomEventsAction;
  select?: string;
  filters?: Filter[];
  or?: string;
  order?: Order[];
  limit?: number;
  single?: boolean;
  id?: string;
  data?: Record<string, any>;
  company_id?: string;
  year?: number;
  month?: number;
}): Promise<{ data: any; error?: string | null }> {
  return postApi("/api/custom-events", params);
}
