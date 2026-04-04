"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { T } from "@/lib/constants";
import { supabase } from "@/lib/supabase";

/* ── 労基法テーブル定数 ── */
const GRANT_MONTHS = [6, 18, 30, 42, 54, 66, 78];
const DAYS_FULL = [10, 11, 12, 14, 16, 18, 20];
const DAYS_PART: Record<number, number[]> = {
  4: [7, 8, 9, 10, 12, 13, 15],
  3: [5, 6, 6, 8, 9, 10, 11],
  2: [3, 4, 4, 5, 6, 6, 7],
  1: [1, 2, 2, 2, 3, 3, 3],
};

function addMonths(d: Date, m: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + m);
  return r;
}

function getGrantDays(index: number, weekly: number): number {
  const idx = Math.min(index, 6);
  if (weekly >= 5) return DAYS_FULL[idx];
  if (DAYS_PART[weekly]) return DAYS_PART[weekly][idx];
  return DAYS_FULL[idx];
}

function calcNextGrant(hireDate: Date, afterDate: Date, weekly: number): { date: Date; days: number } | null {
  for (let i = 0; i < GRANT_MONTHS.length; i++) {
    const gd = addMonths(hireDate, GRANT_MONTHS[i]);
    if (gd >= afterDate) return { date: gd, days: getGrantDays(i, weekly) };
  }
  let m = 78;
  for (let j = 0; j < 50; j++) {
    m += 12;
    const gd = addMonths(hireDate, m);
    if (gd >= afterDate) return { date: gd, days: getGrantDays(6, weekly) };
  }
  return null;
}

function calcPrevGrantDate(hireDate: Date, beforeDate: Date): Date {
  let prev = new Date(hireDate);
  for (let i = 0; i < GRANT_MONTHS.length; i++) {
    const gd = addMonths(hireDate, GRANT_MONTHS[i]);
    if (gd < beforeDate) prev = gd; else return prev;
  }
  let m = 78;
  for (let j = 0; j < 50; j++) {
    m += 12;
    const gd = addMonths(hireDate, m);
    if (gd < beforeDate) prev = gd; else return prev;
  }
  return prev;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
}

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

/* ── 年5日ステータス色 ── */
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  "達成":    { bg: "#DBEAFE", color: "#1D4ED8" },
  "順調":    { bg: "#D1FAE5", color: "#065F46" },
  "注意":    { bg: "#FEF3C7", color: "#92400E" },
  "急いで！": { bg: "#FEE2E2", color: "#991B1B" },
  "—":       { bg: "#F3F4F6", color: "#9CA3AF" },
};

interface Grant {
  id: string;
  employee_id: string;
  grant_date: string;
  grant_days: number;
  remaining_days: number;
  expiry_date: string;
  is_expired: boolean;
  granted: boolean;
}

interface EmpInfo {
  id: string;
  code: string;
  name: string;
  store_name: string;
  store_id: string;
  hire_date: string | null;
  weekly: number;
}

interface LeaveRow {
  code: string;
  name: string;
  store: string;
  total: number;
  slot1_rem: number | null;
  slot1_exp: string | null;
  slot2_rem: number | null;
  slot2_exp: string | null;
  next_date: string | null;
  next_days: number | null;
  five_day_status: string;
  five_day_taken: number;
  five_day_needed: number;
  five_day_deadline: string | null;
}

export default function PaidLeaveSub({ employee }: { employee: any }) {
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeFilter, setStoreFilter] = useState("all");
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);

  const fetchData = useCallback(async () => {
    if (!employee?.company_id) return;
    setLoading(true);

    /* 店舗 */
    const { data: sd } = await supabase.from("stores").select("id, store_name").eq("company_id", employee.company_id);
    const storeList = (sd || []).map((s: any) => ({ id: s.id, name: s.store_name || "" }));
    setStores(storeList);
    const storeMap: Record<string, string> = {};
    storeList.forEach(s => { storeMap[s.id] = s.name; });

    /* 従業員 */
    const { data: ed } = await supabase.from("employees").select("id, employee_code, full_name, store_id, hire_date, weekly_work_days").eq("company_id", employee.company_id).order("employee_code");
    const emps: EmpInfo[] = (ed || []).filter((e: any) => !["W02","W49","W67"].includes(e.employee_code)).map((e: any) => ({
      id: e.id, code: e.employee_code, name: e.full_name,
      store_name: storeMap[e.store_id] || "", store_id: e.store_id,
      hire_date: e.hire_date, weekly: e.weekly_work_days ?? 5,
    }));

    /* 付与履歴（全件） */
    const { data: gd } = await supabase.from("paid_leave_grants").select("*").eq("company_id", employee.company_id);
    const grants: Grant[] = (gd || []).map((g: any) => ({ ...g, grant_days: Number(g.grant_days), remaining_days: Number(g.remaining_days) }));

    /* 有給消費カウント用: attendance_daily */
    const { data: attData } = await supabase.from("attendance_daily").select("employee_id, attendance_date, reason").eq("company_id", employee.company_id);
    const attByEmp: Record<string, { date: string; reason: string }[]> = {};
    (attData || []).forEach((a: any) => {
      if (!a.reason) return;
      if (!attByEmp[a.employee_id]) attByEmp[a.employee_id] = [];
      attByEmp[a.employee_id].push({ date: a.attendance_date, reason: a.reason });
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result: LeaveRow[] = emps.map(emp => {
      const empGrants = grants.filter(g => g.employee_id === emp.id);
      const activeGrants = empGrants.filter(g => !g.is_expired).sort((a, b) => a.grant_date.localeCompare(b.grant_date));

      /* 合計残 */
      const total = activeGrants.reduce((sum, g) => sum + g.remaining_days, 0);

      /* スロット表示（残がある or マイナスのもの） */
      const visibleSlots = activeGrants.filter(g => g.remaining_days !== 0);
      const slot1 = visibleSlots[0] || null;
      const slot2 = visibleSlots[1] || null;

      /* 次回発生日・日数 */
      let nextDate: string | null = null;
      let nextDays: number | null = null;
      if (emp.hire_date) {
        const hire = new Date(emp.hire_date);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const ng = calcNextGrant(hire, tomorrow, emp.weekly);
        if (ng) {
          nextDate = fmtDate(ng.date);
          nextDays = ng.days;
        }
      }

      /* 年5日チェック */
      let fiveStatus = "—";
      let fiveTaken = 0;
      let fiveNeeded = 0;
      let fiveDeadline: string | null = null;

      /* 直近の10日以上付与を探す */
      const qualifyingGrants = empGrants.filter(g => g.granted !== false && g.grant_days >= 10 && !g.is_expired);
      if (qualifyingGrants.length > 0 && emp.hire_date) {
        const latestQualifying = qualifyingGrants.sort((a, b) => b.grant_date.localeCompare(a.grant_date))[0];
        const grantDate = new Date(latestQualifying.grant_date);
        const hire = new Date(emp.hire_date);
        const tomorrow2 = new Date(grantDate);
        tomorrow2.setDate(tomorrow2.getDate() + 1);
        const nextAfterGrant = calcNextGrant(hire, tomorrow2, emp.weekly);

        if (nextAfterGrant && nextAfterGrant.date > today) {
          fiveDeadline = fmtDate(nextAfterGrant.date);
          const daysUntil = Math.ceil((nextAfterGrant.date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          /* この期間内の有給取得日数をカウント */
          const empAtt = attByEmp[emp.id] || [];
          empAtt.forEach(a => {
            const ad = new Date(a.date);
            if (ad >= grantDate && ad < nextAfterGrant.date) {
              if (a.reason.includes("有給") && !a.reason.includes("半有")) fiveTaken += 1;
              if (a.reason.includes("半有(前)")) fiveTaken += 0.5;
              if (a.reason.includes("半有(後)")) fiveTaken += 0.5;
            }
          });

          fiveNeeded = Math.max(0, 5 - fiveTaken);

          if (fiveTaken >= 5) fiveStatus = "達成";
          else if (daysUntil <= 60 && fiveNeeded > 0) fiveStatus = "急いで！";
          else if (daysUntil <= 120 && fiveNeeded >= 3) fiveStatus = "注意";
          else fiveStatus = "順調";
        }
      }

      return {
        code: emp.code, name: emp.name, store: storeShort(emp.store_name),
        total: Math.round(total * 10) / 10,
        slot1_rem: slot1 ? Math.round(slot1.remaining_days * 10) / 10 : null,
        slot1_exp: slot1 ? slot1.expiry_date.replace(/-/g, "/") : null,
        slot2_rem: slot2 ? Math.round(slot2.remaining_days * 10) / 10 : null,
        slot2_exp: slot2 ? slot2.expiry_date.replace(/-/g, "/") : null,
        next_date: nextDate, next_days: nextDays,
        five_day_status: fiveStatus, five_day_taken: Math.round(fiveTaken * 10) / 10,
        five_day_needed: Math.round(fiveNeeded * 10) / 10, five_day_deadline: fiveDeadline,
      };
    });

    setRows(result);
    setLoading(false);
  }, [employee?.company_id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* Realtime: paid_leave_grantsが変わったら再取得 */
  useEffect(() => {
    if (!employee?.company_id) return;
    const ch = supabase
      .channel("plg-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "paid_leave_grants" }, () => {
        fetchData();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [employee?.company_id, fetchData]);

  const filtered = useMemo(() => {
    if (storeFilter === "all") return rows;
    const storeName = stores.find(s => s.id === storeFilter)?.name || "";
    return rows.filter(r => r.store === storeShort(storeName));
  }, [rows, storeFilter, stores]);

  /* サマリー */
  const summary = useMemo(() => {
    let alert = 0, caution = 0, ok = 0, done = 0;
    filtered.forEach(r => {
      if (r.five_day_status === "急いで！") alert++;
      else if (r.five_day_status === "注意") caution++;
      else if (r.five_day_status === "順調") ok++;
      else if (r.five_day_status === "達成") done++;
    });
    return { alert, caution, ok, done, total: filtered.length };
  }, [filtered]);

  const SC = ({ l, v, c }: { l: string; v: number; c: string }) => (
    <div style={{ backgroundColor: "#fff", padding: "8px 4px", borderRadius: 6, border: `1px solid ${T.border}`, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: T.textSec, marginBottom: 2 }}>{l}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: c }}>{v}<span style={{ fontSize: 10, fontWeight: 400 }}>人</span></div>
    </div>
  );

  return (
    <div>
      {/* フィルタ */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12, color: T.textSec }}>
          <option value="all">全店舗</option>
          {stores.map(s => <option key={s.id} value={s.id}>{storeShort(s.name)}</option>)}
        </select>
        <div style={{ marginLeft: "auto", fontSize: 12, color: T.textSec }}>
          対象: <strong style={{ color: T.text }}>{filtered.length}名</strong>
        </div>
      </div>

      {/* 年5日サマリー */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 16 }}>
        <SC l="🔴 急いで" v={summary.alert} c={summary.alert > 0 ? "#DC2626" : T.textMuted} />
        <SC l="🟡 注意" v={summary.caution} c={summary.caution > 0 ? "#D97706" : T.textMuted} />
        <SC l="🟢 順調" v={summary.ok} c="#059669" />
        <SC l="✅ 達成" v={summary.done} c="#1D4ED8" />
      </div>

      {/* テーブル */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: T.textMuted, fontSize: 14 }}>読み込み中...</div>
      ) : (
        <div style={{ borderRadius: 6, border: `1px solid ${T.border}`, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 900 }}>
              <thead>
                <tr style={{ backgroundColor: T.primary }}>
                  {["店舗","CD","氏名","有給残","①残","①消滅日","②残","②消滅日","次回発生日","次回日数","年5日","取得済","あと"].map(h => (
                    <th key={h} style={{ padding: "8px 5px", color: "#fff", fontWeight: 600, fontSize: 11, textAlign: "center", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const ss = STATUS_STYLE[r.five_day_status] || STATUS_STYLE["—"];
                  return (
                    <tr key={r.code} style={{ borderBottom: `1px solid ${T.borderLight}`, backgroundColor: r.five_day_status === "急いで！" ? "#FEF2F2" : r.five_day_status === "注意" ? "#FFFBEB" : "#fff" }}>
                      <td style={{ padding: "7px 5px", fontSize: 11, color: T.textSec, textAlign: "center", whiteSpace: "nowrap" }}>{r.store}</td>
                      <td style={{ padding: "7px 5px", fontSize: 11, color: T.textMuted, textAlign: "center" }}>{r.code}</td>
                      <td style={{ padding: "7px 5px", fontWeight: 600, color: T.text, whiteSpace: "nowrap" }}>{r.name}</td>
                      <td style={{ padding: "7px 5px", textAlign: "center", fontWeight: 700, fontSize: 13, color: r.total < 0 ? T.danger : r.total === 0 ? T.textMuted : T.text }}>{r.total}日</td>
                      <td style={{ padding: "7px 5px", textAlign: "center", color: r.slot1_rem != null ? T.text : T.textMuted }}>{r.slot1_rem != null ? `${r.slot1_rem}日` : "—"}</td>
                      <td style={{ padding: "7px 5px", textAlign: "center", fontSize: 10, color: T.textMuted }}>{r.slot1_exp || "—"}</td>
                      <td style={{ padding: "7px 5px", textAlign: "center", color: r.slot2_rem != null ? T.text : T.textMuted }}>{r.slot2_rem != null ? `${r.slot2_rem}日` : "—"}</td>
                      <td style={{ padding: "7px 5px", textAlign: "center", fontSize: 10, color: T.textMuted }}>{r.slot2_exp || "—"}</td>
                      <td style={{ padding: "7px 5px", textAlign: "center", fontSize: 11, color: T.primary, fontWeight: 600 }}>{r.next_date || "—"}</td>
                      <td style={{ padding: "7px 5px", textAlign: "center", fontWeight: 600, color: r.next_days != null ? T.text : T.textMuted }}>{r.next_days != null ? `${r.next_days}日` : "—"}</td>
                      <td style={{ padding: "5px", textAlign: "center" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, backgroundColor: ss.bg, color: ss.color, whiteSpace: "nowrap" }}>{r.five_day_status}</span>
                      </td>
                      <td style={{ padding: "7px 5px", textAlign: "center", fontSize: 11, color: r.five_day_taken > 0 ? T.text : T.textMuted }}>{r.five_day_status !== "—" ? `${r.five_day_taken}日` : "—"}</td>
                      <td style={{ padding: "7px 5px", textAlign: "center", fontSize: 11, fontWeight: 600, color: r.five_day_needed > 0 ? T.danger : T.success }}>{r.five_day_status !== "—" ? `${r.five_day_needed}日` : "—"}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={13} style={{ padding: "30px", textAlign: "center", color: T.textMuted, fontSize: 13 }}>データがありません</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
