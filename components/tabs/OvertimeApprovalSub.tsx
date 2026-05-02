"use client";
import { useState, useEffect, useCallback } from "react";
import { T } from "@/lib/constants";
import { supabase } from "@/lib/supabase";
import Dialog from "@/components/ui/Dialog";

const COMPANY_ID = "c2d368f0-aa9b-4f70-b082-43ec07723d6c";

interface OvertimeReq {
  id: string;
  employee_id: string;
  attendance_date: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  reject_reason: string | null;
  created_at: string;
  full_name?: string;
  employee_code?: string;
}

const surname = (n: string) => (n || "").split(/\s+/)[0] || n;

export default function OvertimeApprovalSub({ employee }: { employee: any }) {
  const [reqs, setReqs] = useState<OvertimeReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [rejectFor, setRejectFor] = useState<OvertimeReq | null>(null);
  const [rejectText, setRejectText] = useState("");
  const [dialog, setDialog] = useState<{ message: string } | null>(null);

  const myCode = employee?.employee_code || "";
  const isOgawa = myCode === "WC001";
  const isWcAdmin = isOgawa || ["W02", "W49", "W67"].includes(myCode);

  const load = useCallback(async () => {
    setLoading(true);
    const q = supabase
      .from("wc_overtime_requests")
      .select("id, employee_id, attendance_date, status, reason, reject_reason, created_at, employees!inner(full_name, employee_code)")
      .eq("company_id", COMPANY_ID)
      .order("attendance_date", { ascending: false })
      .limit(200);
    const { data, error } = await (filter === "pending" ? q.eq("status", "pending") : q);
    setLoading(false);
    if (error) {
      console.error("[OvertimeApprovalSub] load error:", error);
      return;
    }
    setReqs(((data || []) as any[]).map(r => ({
      ...r,
      full_name: r.employees?.full_name,
      employee_code: r.employees?.employee_code,
    })));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // リアルタイム購読
  useEffect(() => {
    const ch = supabase.channel("wc_overtime_requests_admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "wc_overtime_requests", filter: `company_id=eq.${COMPANY_ID}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const approve = async (r: OvertimeReq) => {
    const { error } = await supabase.from("wc_overtime_requests").update({
      status: "approved",
      approved_by: employee.id,
      approved_at: new Date().toISOString(),
      reject_reason: null,
      updated_at: new Date().toISOString(),
    }).eq("id", r.id);
    if (error) { setDialog({ message: "承認に失敗: " + error.message }); return; }
    load();
  };

  const reject = async () => {
    if (!rejectFor) return;
    if (!rejectText.trim()) { setDialog({ message: "却下理由を入力してください" }); return; }
    const { error } = await supabase.from("wc_overtime_requests").update({
      status: "rejected",
      reject_reason: rejectText.trim(),
      approved_by: employee.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", rejectFor.id);
    if (error) { setDialog({ message: "却下に失敗: " + error.message }); return; }
    setRejectFor(null); setRejectText(""); load();
  };

  if (!isWcAdmin) {
    return <div style={{ padding: 24, color: T.textSec, fontSize: 13 }}>残業承認は権限がありません。</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["pending", "all"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "6px 14px", borderRadius: 4,
            border: filter === f ? "none" : `1px solid ${T.border}`,
            backgroundColor: filter === f ? T.primary : "#fff",
            color: filter === f ? "#fff" : T.text,
            fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>{f === "pending" ? "申請中" : "全件"}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textSec }}>読み込み中...</div>
      ) : reqs.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textMuted }}>
          {filter === "pending" ? "申請はありません" : "履歴はありません"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {reqs.map(r => (
            <div key={r.id} style={{
              padding: 12, border: `1px solid ${T.border}`, borderRadius: 6,
              backgroundColor: "#fff", display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
                  {surname(r.full_name || "")}（{r.employee_code}）　{r.attendance_date}
                </div>
                {r.reason && <div style={{ fontSize: 11, color: T.textSec, marginTop: 4 }}>{r.reason}</div>}
                {r.reject_reason && <div style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>却下理由: {r.reject_reason}</div>}
              </div>
              {r.status === "pending" ? (
                <>
                  <button onClick={() => { setRejectFor(r); setRejectText(""); }} style={{
                    padding: "6px 12px", borderRadius: 4,
                    border: `1px solid ${T.danger}`, backgroundColor: "#fff",
                    color: T.danger, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>却下</button>
                  <button onClick={() => approve(r)} style={{
                    padding: "6px 12px", borderRadius: 4, border: "none",
                    backgroundColor: T.primary, color: "#fff",
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>承認</button>
                </>
              ) : (
                <span style={{
                  padding: "4px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700,
                  color: "#fff",
                  backgroundColor: r.status === "approved" ? T.primary : T.textMuted,
                }}>{r.status === "approved" ? "承認済" : "却下"}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {rejectFor && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }} onClick={() => setRejectFor(null)}>
          <div style={{ backgroundColor: "#fff", borderRadius: 8, padding: "24px 20px", width: "100%", maxWidth: 320 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, color: T.text, marginBottom: 14, textAlign: "center" }}>却下理由を入力</div>
            <textarea value={rejectText} onChange={e => setRejectText(e.target.value)} placeholder="却下理由"
              style={{ width: "100%", padding: "8px 10px", borderRadius: 4, border: `1px solid ${T.border}`, fontSize: 13, minHeight: 56, marginBottom: 14, boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setRejectFor(null)} style={{ flex: 1, padding: 12, borderRadius: 4, border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.textSec, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>キャンセル</button>
              <button onClick={reject} style={{ flex: 1, padding: 12, borderRadius: 4, border: "none", backgroundColor: T.danger, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>却下</button>
            </div>
          </div>
        </div>
      )}

      {dialog && (
        <Dialog message={dialog.message} mode="alert" onOk={() => setDialog(null)} onCancel={() => setDialog(null)} />
      )}
    </div>
  );
}
