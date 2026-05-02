"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { T } from "@/lib/constants";
import { supabase } from "@/lib/supabase";

const COMPANY_ID = "c2d368f0-aa9b-4f70-b082-43ec07723d6c";

function storeShort(name: string | null) {
  if (!name) return "—";
  if (name.includes("八代")) return "八代";
  if (name.includes("健軍")) return "健軍";
  if (name.includes("大津") || name.includes("菊陽")) return "大津";
  if (name.includes("本社")) return "本社";
  if (name.includes("経理") || name.includes("人事") || name.includes("DX")) return "業務部";
  if (name.includes("御領")) return "御領";
  return name;
}

interface LeaveRow {
  code: string;
  name: string;
  store: string;
  store_id: string;
  carry_over: number;
  granted: number;
  consumed: number;
  remaining: number;
}

export default function PaidLeaveSub({ employee }: { employee: any }) {
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeFilter, setStoreFilter] = useState("all");
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);

    const { data: sd } = await supabase.from("stores").select("id, store_name").eq("company_id", COMPANY_ID);
    const storeList = (sd || []).map((s: any) => ({ id: s.id, name: s.store_name || "" }));
    setStores(storeList);
    const storeMap: Record<string, string> = {};
    storeList.forEach(s => { storeMap[s.id] = s.name; });

    const { data: ed } = await supabase
      .from("employees")
      .select("id, employee_code, full_name, store_id, is_active")
      .eq("company_id", COMPANY_ID)
      .order("employee_code");
    const emps = (ed || []).filter((e: any) => e.is_active !== false && !["W02","W49","W67"].includes(e.employee_code));

    const { data: balData, error: balErr } = await supabase
      .from("paid_leave_balances")
      .select("employee_id, carry_over, granted, consumed, remaining")
      .eq("company_id", COMPANY_ID);

    if (balErr) console.error("paid_leave_balances:", balErr.message);

    const balMap: Record<string, { carry_over: number; granted: number; consumed: number; remaining: number }> = {};
    (balData || []).forEach((b: any) => {
      balMap[b.employee_id] = {
        carry_over: b.carry_over ?? 0,
        granted: b.granted ?? 0,
        consumed: b.consumed ?? 0,
        remaining: b.remaining ?? 0,
      };
    });

    const result: LeaveRow[] = emps.map((emp: any) => {
      const bal = balMap[emp.id] || { carry_over: 0, granted: 0, consumed: 0, remaining: 0 };
      return {
        code: emp.employee_code,
        name: emp.full_name,
        store: storeShort(storeMap[emp.store_id] || null),
        store_id: emp.store_id,
        ...bal,
      };
    });

    setRows(result);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const ch = supabase
      .channel("plb-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "paid_leave_balances" }, () => {
        fetchData();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchData]);

  const filtered = useMemo(() => {
    if (storeFilter === "all") return rows;
    return rows.filter(r => r.store_id === storeFilter);
  }, [rows, storeFilter]);

  const totalRemaining = filtered.reduce((s, r) => s + r.remaining, 0);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12, color: T.textSec }}>
          <option value="all">全店舗</option>
          {stores.map(s => <option key={s.id} value={s.id}>{storeShort(s.name)}</option>)}
        </select>
        <div style={{ marginLeft: "auto", fontSize: 12, color: T.textSec }}>
          対象: <strong style={{ color: T.text }}>{filtered.length}名</strong>
          {" "}／ 合計残: <strong style={{ color: T.primary }}>{totalRemaining}日</strong>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: T.textMuted, fontSize: 14 }}>読み込み中...</div>
      ) : (
        <div style={{ borderRadius: 6, border: `1px solid ${T.border}`, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 560 }}>
              <thead>
                <tr style={{ backgroundColor: T.primary }}>
                  {["店舗","CD","氏名","繰越","付与","消化","有給残"].map(h => (
                    <th key={h} style={{ padding: "8px 6px", color: "#fff", fontWeight: 600, fontSize: 12, textAlign: "center", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.code} style={{ borderBottom: `1px solid ${T.borderLight}`, backgroundColor: "#fff" }}>
                    <td style={{ padding: "8px 6px", fontSize: 11, color: T.textSec, textAlign: "center", whiteSpace: "nowrap" }}>{r.store}</td>
                    <td style={{ padding: "8px 6px", fontSize: 11, color: T.textMuted, textAlign: "center" }}>{r.code}</td>
                    <td style={{ padding: "8px 6px", fontWeight: 600, color: T.text, whiteSpace: "nowrap" }}>{r.name}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 12, color: r.carry_over > 0 ? T.text : T.textMuted }}>{r.carry_over}日</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 12, color: T.primary, fontWeight: 600 }}>{r.granted}日</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 12, color: r.consumed > 0 ? T.danger : T.textMuted }}>{r.consumed}日</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontWeight: 700, fontSize: 14, color: r.remaining <= 0 ? T.danger : T.text }}>{r.remaining}日</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: "30px", textAlign: "center", color: T.textMuted, fontSize: 13 }}>データがありません</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
