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
  total: number;
  slot1_rem: number | null;
  slot1_exp: string | null;
  slot2_rem: number | null;
  slot2_exp: string | null;
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

    const empIds = emps.map((e: any) => e.id);

    /* ── paid_leave_balances を employee_id でフィルタ ──
       テーブルのスキーマが2種類ありうる:
       A) fiscal_year制: company_id, fiscal_year, carry_over, granted, consumed, remaining
       B) slot制: employee_id, slot, grant_date, expiry_date, granted_days, remaining_days, is_expired
       employee_id はどちらにも存在するので、まず employee_id で取得し、
       返ってきたデータの形で処理を分岐する */
    let balData: any[] = [];
    if (empIds.length > 0) {
      const { data, error } = await supabase
        .from("paid_leave_balances")
        .select("*")
        .in("employee_id", empIds);
      if (error) console.error("paid_leave_balances query:", error.message);
      balData = data || [];
    }

    const currentFY = new Date().getFullYear();

    const balMap: Record<string, { total: number; slot1_rem: number | null; slot1_exp: string | null; slot2_rem: number | null; slot2_exp: string | null }> = {};

    balData.forEach((b: any) => {
      const eid = b.employee_id;
      if (!balMap[eid]) balMap[eid] = { total: 0, slot1_rem: null, slot1_exp: null, slot2_rem: null, slot2_exp: null };

      if (b.fiscal_year !== undefined) {
        /* ── fiscal_year制 ── */
        if (b.fiscal_year !== currentFY) return;
        const rem = b.remaining ?? (b.carry_over ?? 0) + (b.granted ?? 0) - (b.consumed ?? 0);
        balMap[eid].total = rem;
      } else {
        /* ── slot制（database.types.ts準拠） ── */
        if (b.is_expired) return;
        const rem = b.remaining_days ?? 0;
        balMap[eid].total += rem;
        if (balMap[eid].slot1_rem == null) {
          balMap[eid].slot1_rem = rem;
          balMap[eid].slot1_exp = b.expiry_date ? b.expiry_date.replace(/-/g, "/") : null;
        } else if (balMap[eid].slot2_rem == null) {
          balMap[eid].slot2_rem = rem;
          balMap[eid].slot2_exp = b.expiry_date ? b.expiry_date.replace(/-/g, "/") : null;
        }
      }
    });

    const result: LeaveRow[] = emps.map((emp: any) => {
      const bal = balMap[emp.id] || { total: 0, slot1_rem: null, slot1_exp: null, slot2_rem: null, slot2_exp: null };
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

  const hasSlots = filtered.some(r => r.slot1_rem != null);
  const totalRemaining = filtered.reduce((s, r) => s + r.total, 0);

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
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: hasSlots ? 700 : 480 }}>
              <thead>
                <tr style={{ backgroundColor: T.primary }}>
                  {["店舗","CD","氏名","有給残",
                    ...(hasSlots ? ["①残","①消滅日","②残","②消滅日"] : []),
                  ].map(h => (
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
                    <td style={{ padding: "8px 6px", textAlign: "center", fontWeight: 700, fontSize: 14, color: r.total <= 0 ? T.danger : T.text }}>{r.total}日</td>
                    {hasSlots && <>
                      <td style={{ padding: "8px 6px", textAlign: "center", color: r.slot1_rem != null ? T.text : T.textMuted }}>{r.slot1_rem != null ? `${r.slot1_rem}日` : "—"}</td>
                      <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: T.textMuted }}>{r.slot1_exp || "—"}</td>
                      <td style={{ padding: "8px 6px", textAlign: "center", color: r.slot2_rem != null ? T.text : T.textMuted }}>{r.slot2_rem != null ? `${r.slot2_rem}日` : "—"}</td>
                      <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: T.textMuted }}>{r.slot2_exp || "—"}</td>
                    </>}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={hasSlots ? 8 : 4} style={{ padding: "30px", textAlign: "center", color: T.textMuted, fontSize: 13 }}>データがありません</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
