"use client";
// ═══════════════════════════════════════════
// ShiftSub.tsx — シフト管理（公休マトリクス）
// 管理者（WC001）と本部メンバーのみアクセス
// ═══════════════════════════════════════════
import { useState, useEffect, useCallback, useRef } from "react";
import { T, DOW, stepMonth } from "@/lib/constants";
import Dialog from "@/components/ui/Dialog";
import { supabase } from "@/lib/supabase";

const COMPANY_ID = "c2d368f0-aa9b-4f70-b082-43ec07723d6c";
const STORE_ID   = "06027f43-fa49-4b2e-8009-903456b0ce33";

const PUSH_URL = "https://pktqlbpdjemmomfanvgt.supabase.co/functions/v1/send-push";

/* ── 色定義 ── */
const C = {
  koukyuu:   "#1a4b24",   // 緑 = 公休（確定）
  pending:   "#EAB308",   // 黄 = 公休（申請中）
  yukyu:     "#3B82F6",   // 青 = 有給
  returned:  "#EF4444",   // 赤 = 差し戻し
  workday:   "#fff",      // 白 = 出勤
  saturday:  "#EBF5FB",   // 土曜列背景
  sunday:    "#FDEDEC",   // 日曜列背景
} as const;

interface Emp {
  id: string;
  employee_code: string;
  full_name: string;
  employment_type: string;
}

interface LeaveReq {
  id: string;
  employee_id: string;
  attendance_date: string;
  type: string;
  status: string;
}

interface AttRow {
  employee_id: string;
  attendance_date: string;
  reason: string | null;
}

/* 苗字を取得 */
const surname = (name: string) => (name || "").split(/\s+/)[0] || name;

/* 月の日数 */
const daysInMonth = (yr: number, mo: number) => new Date(yr, mo, 0).getDate();

/* 日付文字列生成 */
const dateStr = (yr: number, mo: number, d: number) =>
  `${yr}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/* 曜日取得 (0=日〜6=土) */
const dowOf = (yr: number, mo: number, d: number) => new Date(yr, mo - 1, d).getDay();

export default function ShiftSub({ employee }: { employee: any }) {
  const now = new Date();
  const [yr, setYr] = useState(now.getFullYear());
  const [mo, setMo] = useState(now.getMonth() + 1);
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [leaveReqs, setLeaveReqs] = useState<LeaveReq[]>([]);
  const [attData, setAttData] = useState<AttRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [dialog, setDialog] = useState<{ message: string; mode: "alert" | "confirm"; confirmLabel?: string; confirmColor?: string; onOk: () => void } | null>(null);

  /* ── 管理者による直接トグル（緑セル）のローカル管理 ── */
  // adminToggles: key = "empId|YYYY-MM-DD", value = true(ON) / false(OFF=削除済)
  const [adminToggles, setAdminToggles] = useState<Record<string, boolean>>({});

  const days = daysInMonth(yr, mo);

  /* ── データ取得 ── */
  const loadData = useCallback(async () => {
    setLoading(true);
    const monthStart = dateStr(yr, mo, 1);
    const monthEnd = dateStr(yr, mo, days);

    // 従業員一覧（is_active=true, 本部除外）
    const { data: emps } = await supabase.from("employees")
      .select("id, employee_code, full_name, employment_type")
      .eq("company_id", COMPANY_ID)
      .eq("store_id", STORE_ID)
      .eq("is_active", true)
      .order("employee_code");

    // leave_requests（当月）
    const { data: reqs } = await supabase.from("leave_requests")
      .select("id, employee_id, attendance_date, type, status")
      .eq("company_id", COMPANY_ID)
      .eq("type", "shift_koukyuu")
      .gte("attendance_date", monthStart)
      .lte("attendance_date", monthEnd);

    // attendance_daily（当月：有給・公休確認用）
    const { data: att } = await supabase.from("attendance_daily")
      .select("employee_id, attendance_date, reason")
      .eq("company_id", COMPANY_ID)
      .gte("attendance_date", monthStart)
      .lte("attendance_date", monthEnd);

    setEmployees(emps || []);
    setLeaveReqs(reqs || []);
    setAttData(att || []);
    setAdminToggles({});
    setLoading(false);
  }, [yr, mo, days]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── リアルタイム購読 ── */
  useEffect(() => {
    const ch = supabase.channel("shift-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "leave_requests" }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadData]);

  /* ── 月切替 ── */
  const stepMo = (dir: 1 | -1) => {
    const [ny, nm] = stepMonth(yr, mo, dir);
    setYr(ny); setMo(nm);
  };

  /* ── セル状態判定 ── */
  const getCellState = (empId: string, day: number): "approved" | "pending" | "returned" | "yukyu" | "admin_set" | "workday" => {
    const ds = dateStr(yr, mo, day);
    const key = `${empId}|${ds}`;

    // admin直接トグル確認
    if (adminToggles[key] === true) return "admin_set";
    if (adminToggles[key] === false) return "workday"; // admin がOFFにした

    // leave_requests
    const req = leaveReqs.find(r => r.employee_id === empId && r.attendance_date === ds);
    if (req) {
      if (req.status === "approved") return "approved";
      if (req.status === "pending") return "pending";
      if (req.status === "returned") return "returned";
    }

    // attendance_daily
    const att = attData.find(a => a.employee_id === empId && a.attendance_date === ds);
    if (att?.reason?.includes("有給")) return "yukyu";
    if (att?.reason === "公休" || att?.reason === "公休（全日）") return "approved";

    return "workday";
  };

  /* ── セルの背景色 ── */
  const cellBg = (state: string) => {
    switch (state) {
      case "approved":  return C.koukyuu;
      case "admin_set": return C.koukyuu;
      case "pending":   return C.pending;
      case "returned":  return C.returned;
      case "yukyu":     return C.yukyu;
      default:          return C.workday;
    }
  };

  /* ── セルの文字色 ── */
  const cellFg = (state: string) => {
    if (state === "workday") return T.textMuted;
    return "#fff";
  };

  /* ── セルラベル ── */
  const cellLabel = (state: string) => {
    switch (state) {
      case "approved":  return "休";
      case "admin_set": return "休";
      case "pending":   return "申";
      case "returned":  return "戻";
      case "yukyu":     return "有";
      default:          return "";
    }
  };

  /* ── 未承認件数 ── */
  const pendingCount = leaveReqs.filter(r => r.status === "pending").length;

  /* ── セルタップ処理 ── */
  const handleCellTap = async (emp: Emp, day: number) => {
    const ds = dateStr(yr, mo, day);
    const state = getCellState(emp.id, day);
    const key = `${emp.id}|${ds}`;

    if (state === "yukyu") return; // 有給は変更不可

    if (state === "pending") {
      // 申請中→承認/差し戻しポップアップ
      setDialog({
        message: `${surname(emp.full_name)}の${mo}/${day}の公休申請`,
        mode: "confirm",
        confirmLabel: "承認",
        confirmColor: C.koukyuu,
        onOk: async () => {
          setDialog(null);
          const req = leaveReqs.find(r => r.employee_id === emp.id && r.attendance_date === ds && r.status === "pending");
          if (req) {
            await supabase.from("leave_requests").update({
              status: "approved",
              approved_by: employee.id,
              approved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq("id", req.id);
            loadData();
          }
        },
      });
      // 差し戻しボタンは別途表示する（下記 pendingDialog で対応）
      return;
    }

    if (state === "returned") {
      // 差し戻し済み→削除してworkdayに戻す
      const req = leaveReqs.find(r => r.employee_id === emp.id && r.attendance_date === ds);
      if (req) {
        await supabase.from("leave_requests").delete().eq("id", req.id);
        loadData();
      }
      return;
    }

    if (state === "approved") {
      // 確定公休→管理者がOFFにする
      const req = leaveReqs.find(r => r.employee_id === emp.id && r.attendance_date === ds);
      if (req) {
        await supabase.from("leave_requests").delete().eq("id", req.id);
      }
      setAdminToggles(prev => ({ ...prev, [key]: false }));
      loadData();
      return;
    }

    if (state === "admin_set") {
      // 管理者がONにしたものを再タップでOFF
      setAdminToggles(prev => ({ ...prev, [key]: false }));
      // DBからも削除
      const req = leaveReqs.find(r => r.employee_id === emp.id && r.attendance_date === ds);
      if (req) {
        await supabase.from("leave_requests").delete().eq("id", req.id);
      }
      return;
    }

    // workday→公休ON（管理者直接設定 → approved で insert）
    await supabase.from("leave_requests").upsert({
      company_id: COMPANY_ID,
      store_id: STORE_ID,
      employee_id: emp.id,
      attendance_date: ds,
      type: "shift_koukyuu",
      status: "approved",
      approved_by: employee.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "employee_id,attendance_date,type" });
    setAdminToggles(prev => ({ ...prev, [key]: true }));
    loadData();
  };

  /* ── 申請の承認/差し戻しダイアログ ── */
  const [pendingDialog, setPendingDialog] = useState<{ emp: Emp; day: number; reqId: string } | null>(null);

  const handlePendingTap = (emp: Emp, day: number) => {
    const ds = dateStr(yr, mo, day);
    const req = leaveReqs.find(r => r.employee_id === emp.id && r.attendance_date === ds && r.status === "pending");
    if (req) {
      setPendingDialog({ emp, day, reqId: req.id });
    }
  };

  const approvePending = async () => {
    if (!pendingDialog) return;
    await supabase.from("leave_requests").update({
      status: "approved",
      approved_by: employee.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", pendingDialog.reqId);
    setPendingDialog(null);
    loadData();
  };

  const returnPending = async () => {
    if (!pendingDialog) return;
    await supabase.from("leave_requests").update({
      status: "returned",
      updated_at: new Date().toISOString(),
    }).eq("id", pendingDialog.reqId);

    // プッシュ通知送信
    fetch(PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "request_processed",
        payload: {
          employee_id: pendingDialog.emp.id,
          category: `公休申請（${mo}/${pendingDialog.day}）`,
          status: "差し戻し",
        },
      }),
    }).catch(() => {});

    setPendingDialog(null);
    loadData();
  };

  /* ── 確定ボタン処理 ── */
  const handleConfirm = async () => {
    setDialog({
      message: `${yr}年${mo}月のシフトを確定しますか？\n確定済み公休をattendance_dailyに一括登録します。`,
      mode: "confirm",
      confirmLabel: "確定",
      confirmColor: C.koukyuu,
      onOk: async () => {
        setDialog(null);
        setConfirming(true);

        const upserts: any[] = [];
        for (const emp of employees) {
          for (let d = 1; d <= days; d++) {
            const state = getCellState(emp.id, d);
            if (state === "approved" || state === "admin_set") {
              const ds = dateStr(yr, mo, d);
              const dow = DOW[dowOf(yr, mo, d)];
              upserts.push({
                company_id: COMPANY_ID,
                employee_id: emp.id,
                store_id: STORE_ID,
                attendance_date: ds,
                day_of_week: dow,
                reason: "公休（全日）",
                updated_at: new Date().toISOString(),
              });
            }
          }
        }

        if (upserts.length > 0) {
          // バッチupsert（50件ずつ）
          for (let i = 0; i < upserts.length; i += 50) {
            const batch = upserts.slice(i, i + 50);
            await supabase.from("attendance_daily")
              .upsert(batch, { onConflict: "employee_id,attendance_date" });
          }
        }

        setConfirming(false);
        setDialog({ message: `${upserts.length}件の公休を登録しました。`, mode: "alert", onOk: () => { setDialog(null); loadData(); } });
      },
    });
  };

  /* ── 従業員を正社員→パートの順に並べる ── */
  const sortedEmps = [...employees].sort((a, b) => {
    const aCode = parseInt(a.employee_code.replace("WC", ""), 10);
    const bCode = parseInt(b.employee_code.replace("WC", ""), 10);
    return aCode - bCode;
  });

  // 正社員/パート区切り用
  const seishaCount = sortedEmps.filter(e => e.employment_type === "正社員").length;

  /* ── レンダリング ── */
  const tableRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      {/* ── ヘッダー：月選択 + 未承認バッジ + 確定ボタン ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 12, flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => stepMo(-1)} style={navBtn}>&lt;</button>
          <span style={{ fontSize: 16, fontWeight: 700, color: T.text, minWidth: 120, textAlign: "center" }}>
            {yr}年{mo}月
          </span>
          <button onClick={() => stepMo(1)} style={navBtn}>&gt;</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {pendingCount > 0 && (
            <span style={{
              backgroundColor: C.pending, color: "#fff", borderRadius: 12,
              padding: "3px 10px", fontSize: 12, fontWeight: 700,
            }}>
              未承認 {pendingCount}件
            </span>
          )}
          <button
            onClick={handleConfirm}
            disabled={confirming}
            style={{
              padding: "8px 20px", borderRadius: 6, border: "none",
              backgroundColor: C.koukyuu, color: "#fff",
              fontSize: 13, fontWeight: 700, cursor: confirming ? "not-allowed" : "pointer",
              opacity: confirming ? 0.6 : 1,
            }}
          >
            {confirming ? "処理中..." : "確定"}
          </button>
        </div>
      </div>

      {/* ── 凡例 ── */}
      <div style={{
        display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap",
        padding: "8px 12px", backgroundColor: "#fff", borderRadius: 8,
        border: `1px solid ${T.border}`,
      }}>
        {[
          { color: C.koukyuu, label: "公休（確定）" },
          { color: C.pending, label: "公休（申請中）" },
          { color: C.yukyu, label: "有給" },
          { color: C.returned, label: "差し戻し" },
          { color: "#E5E7EB", label: "出勤", textColor: T.textMuted },
        ].map((item) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{
              width: 16, height: 16, borderRadius: 3,
              backgroundColor: item.color,
              border: item.color === "#E5E7EB" ? `1px solid ${T.border}` : "none",
            }} />
            <span style={{ fontSize: 11, color: T.textSec }}>{item.label}</span>
          </div>
        ))}
      </div>

      {/* ── シフト表 ── */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textSec }}>読み込み中...</div>
      ) : (
        <div ref={tableRef} style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{
            borderCollapse: "collapse", fontSize: 11, minWidth: "100%",
            backgroundColor: "#fff", borderRadius: 8, overflow: "hidden",
          }}>
            <thead>
              <tr>
                <th style={{
                  ...thStyle, position: "sticky", left: 0, zIndex: 10,
                  backgroundColor: C.koukyuu, color: "#fff", minWidth: 60,
                }}>
                  名前
                </th>
                {Array.from({ length: days }, (_, i) => {
                  const d = i + 1;
                  const dow = dowOf(yr, mo, d);
                  const isSun = dow === 0;
                  const isSat = dow === 6;
                  return (
                    <th key={d} style={{
                      ...thStyle,
                      backgroundColor: isSun ? C.sunday : isSat ? C.saturday : C.koukyuu,
                      color: isSun ? "#DC2626" : isSat ? "#2563EB" : "#fff",
                      minWidth: 28,
                    }}>
                      <div>{d}</div>
                      <div style={{ fontSize: 9, fontWeight: 400 }}>{DOW[dow]}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedEmps.map((emp, idx) => {
                const isPartBorder = idx === seishaCount && seishaCount > 0;
                return (
                  <tr key={emp.id} style={{
                    borderTop: isPartBorder ? `3px solid ${C.koukyuu}` : undefined,
                  }}>
                    <td style={{
                      ...tdNameStyle, position: "sticky", left: 0, zIndex: 5,
                      backgroundColor: "#fff",
                      borderTop: isPartBorder ? `3px solid ${C.koukyuu}` : `1px solid ${T.border}`,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>
                        {surname(emp.full_name)}
                      </div>
                      <div style={{ fontSize: 9, color: T.textMuted }}>
                        {emp.employment_type === "正社員" ? "社" : "P"}
                      </div>
                    </td>
                    {Array.from({ length: days }, (_, i) => {
                      const d = i + 1;
                      const state = getCellState(emp.id, d);
                      const dow = dowOf(yr, mo, d);
                      const isSun = dow === 0;
                      const isSat = dow === 6;

                      let bg = cellBg(state);
                      if (state === "workday") {
                        bg = isSun ? C.sunday : isSat ? C.saturday : "#fff";
                      }

                      return (
                        <td
                          key={d}
                          onClick={() => {
                            if (state === "pending") {
                              handlePendingTap(emp, d);
                            } else {
                              handleCellTap(emp, d);
                            }
                          }}
                          style={{
                            ...tdCellStyle,
                            backgroundColor: bg,
                            color: cellFg(state),
                            cursor: state === "yukyu" ? "default" : "pointer",
                            borderTop: isPartBorder ? `3px solid ${C.koukyuu}` : `1px solid ${T.border}`,
                          }}
                        >
                          {cellLabel(state)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 使い方ガイド ── */}
      <div style={{
        marginTop: 16, padding: "12px 14px", backgroundColor: T.primaryLight,
        borderRadius: 8, border: `1px solid ${T.border}`,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.koukyuu, marginBottom: 6 }}>
          使い方
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: T.textSec, lineHeight: "20px" }}>
          <li>空きセルをタップ → 公休ON（緑）、もう一回タップでOFF</li>
          <li>黄色（申請中）セルをタップ → 承認 or 差し戻しを選択</li>
          <li>差し戻しすると本人にプッシュ通知が届きます</li>
          <li>「確定」ボタンで緑（確定公休）をattendance_dailyに一括登録</li>
          <li>青（有給）セルは変更できません</li>
        </ul>
      </div>

      {/* ── 申請承認/差し戻しダイアログ ── */}
      {pendingDialog && (
        <div
          style={{
            position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 2000,
          }}
          onClick={() => setPendingDialog(null)}
        >
          <div
            style={{
              backgroundColor: "#fff", borderRadius: 12,
              padding: "24px 20px", width: "100%", maxWidth: 320,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, color: T.text, textAlign: "center", marginBottom: 20, lineHeight: "22px" }}>
              {surname(pendingDialog.emp.full_name)}の{mo}/{pendingDialog.day}の公休申請
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={returnPending}
                style={{
                  flex: 1, padding: 12, borderRadius: 6,
                  border: `1px solid ${C.returned}`, backgroundColor: "#fff",
                  color: C.returned, fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >
                差し戻し
              </button>
              <button
                onClick={approvePending}
                style={{
                  flex: 1, padding: 12, borderRadius: 6, border: "none",
                  backgroundColor: C.koukyuu, color: "#fff",
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >
                承認
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 汎用ダイアログ ── */}
      {dialog && (
        <Dialog
          message={dialog.message}
          mode={dialog.mode}
          confirmLabel={dialog.confirmLabel}
          confirmColor={dialog.confirmColor}
          onOk={dialog.onOk}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/* ── スタイル定数 ── */
const navBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: "50%", border: `1px solid ${T.border}`,
  backgroundColor: "#fff", cursor: "pointer", fontSize: 14,
  display: "flex", alignItems: "center", justifyContent: "center",
  color: T.text, fontWeight: 700,
};

const thStyle: React.CSSProperties = {
  padding: "6px 2px", textAlign: "center", fontSize: 11, fontWeight: 600,
  borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap",
};

const tdNameStyle: React.CSSProperties = {
  padding: "6px 8px", borderRight: `1px solid ${T.border}`,
  borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap",
};

const tdCellStyle: React.CSSProperties = {
  padding: "6px 2px", textAlign: "center", fontSize: 10, fontWeight: 700,
  borderRight: `1px solid ${T.borderLight}`, borderBottom: `1px solid ${T.border}`,
  minWidth: 28, userSelect: "none", transition: "background-color 0.15s",
};
