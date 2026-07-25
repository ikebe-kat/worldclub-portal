import { supabaseServer } from "@/lib/supabaseServer";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const companyId = url.searchParams.get("company_id");
    if (!companyId) {
      return NextResponse.json({ data: [], error: "company_id is required" }, { status: 400 });
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { data: [], error: "SUPABASE_SERVICE_ROLE_KEY is not configured for this environment" },
        { status: 500 },
      );
    }

    const { data, error } = await supabaseServer
      .from("calendar_groups")
      .select("group_key, display_name, sort_order")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true });

    const mapped = (data || []).map((r: any) => ({ id: r.group_key, label: r.display_name }));
    return NextResponse.json({ data: mapped, error: error?.message || null });
  } catch {
    return NextResponse.json({ data: [], error: "server_error" }, { status: 500 });
  }
}
