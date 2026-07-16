import { supabaseServer } from "@/lib/supabaseServer";
import { NextRequest, NextResponse } from "next/server";

const EVENT_COLUMNS = [
  "company_id", "creator_employee_id", "creator_code", "creator_name",
  "title", "start_date", "end_date", "is_all_day", "start_time", "end_time",
  "color", "target_calendar", "repeat_type", "repeat_until", "memo",
];
const EXCEPTION_COLUMNS = ["event_id", "exception_date"];

const sanitize = (allowed: string[], data: any): Record<string, any> => {
  const out: Record<string, any> = {};
  if (!data) return out;
  for (const k of allowed) if (k in data) out[k] = data[k];
  return out;
};

const applyFilters = (query: any, filters: any[]) => {
  for (const f of filters || []) {
    switch (f.op) {
      case "eq":     query = query.eq(f.column, f.value); break;
      case "neq":    query = query.neq(f.column, f.value); break;
      case "in":     query = query.in(f.column, f.value); break;
      case "gte":    query = query.gte(f.column, f.value); break;
      case "lte":    query = query.lte(f.column, f.value); break;
      case "not_is": query = query.not(f.column, "is", f.value); break;
      case "not_eq": query = query.not(f.column, "eq", f.value); break;
    }
  }
  return query;
};

const applyOrder = (query: any, order: any[]) => {
  for (const o of order || []) {
    query = query.order(o.column, { ascending: o.ascending ?? true });
  }
  return query;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    switch (body.action) {
      case "list_events": {
        let q: any = supabaseServer.from("custom_events").select(body.select || "*");
        q = applyFilters(q, body.filters);
        if (body.or) q = q.or(body.or);
        q = applyOrder(q, body.order);
        if (body.limit) q = q.limit(body.limit);
        if (body.single) q = q.maybeSingle();
        const { data, error } = await q;
        return NextResponse.json({ data: data ?? (body.single ? null : []), error: error?.message || null });
      }

      case "insert_event": {
        const payload = sanitize(EVENT_COLUMNS, body.data);
        const { error } = await supabaseServer.from("custom_events").insert(payload);
        return NextResponse.json({ data: null, error: error?.message || null });
      }

      case "update_event": {
        if (!body.id) return NextResponse.json({ data: null, error: "missing_id" }, { status: 400 });
        const payload = sanitize(EVENT_COLUMNS, body.data);
        const { error } = await supabaseServer.from("custom_events").update(payload).eq("id", body.id);
        return NextResponse.json({ data: null, error: error?.message || null });
      }

      case "delete_event": {
        if (!body.id) return NextResponse.json({ data: null, error: "missing_id" }, { status: 400 });
        const { error } = await supabaseServer.from("custom_events").delete().eq("id", body.id);
        return NextResponse.json({ data: null, error: error?.message || null });
      }

      case "expand_events": {
        if (!body.company_id || !body.year || !body.month)
          return NextResponse.json({ data: null, error: "missing_params" }, { status: 400 });
        const { data, error } = await supabaseServer.rpc("fn_expand_custom_events", {
          p_company_id: body.company_id,
          p_year: body.year,
          p_month: body.month,
        });
        return NextResponse.json({ data: data ?? [], error: error?.message || null });
      }

      case "insert_exception": {
        const payload = sanitize(EXCEPTION_COLUMNS, body.data);
        if (!payload.event_id || !payload.exception_date)
          return NextResponse.json({ data: null, error: "missing_params" }, { status: 400 });
        const { error } = await supabaseServer.from("custom_event_exceptions").insert(payload);
        return NextResponse.json({ data: null, error: error?.message || null });
      }

      default:
        return NextResponse.json({ data: null, error: "unknown_action" }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ data: null, error: `server_error: ${e?.message || "unknown"}` }, { status: 500 });
  }
}
