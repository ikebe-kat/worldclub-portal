"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { T } from "@/lib/constants";
import { supabase } from "@/lib/supabase";
import Dialog from "@/components/ui/Dialog";

const COMPANY_ID = "c2d368f0-aa9b-4f70-b082-43ec07723d6c";
const PUSH_URL = "https://pktqlbpdjemmomfanvgt.supabase.co/functions/v1/send-push";

type Tab = "calc" | "master";

interface Setting {
  id: string;
  employee_id: string | null;
  display_name: string;
  employment_type: "正社員" | "パート" | "その他";
  base_salary: number; fixed_overtime: number;
  position_allowance: number; family_allowance: number;
  child_support_allowance: number;
  other_allowance: number;
  car_deduction: number; resident_tax: number;
  hourly_weekday: number; hourly_weekend: number;
  scheduled_end_time: string | null; scheduled_minutes: number;
  break_minutes_fixed: number | null;
  social_insurance: number; commute_per_day: number;
  dependents: number; is_payroll_only: boolean; is_active: boolean;
  sort_order: number;
}

interface Monthly {
  id: string;
  payroll_setting_id: string | null;
  display_name: string;
  target_month: string;
  period_start: string; period_end: string; pay_date: string | null;
  worked_days: number; worked_minutes: number;
  weekday_minutes: number; weekend_minutes: number;
  overtime_minutes: number; night_minutes: number;
  paid_leave_days: number;
  base_salary: number; fixed_overtime: number;
  position_allowance: number; family_allowance: number;
  child_support_allowance: number;
  other_allowance: number;
  weekday_amount: number; weekend_amount: number;
  overtime_amount: number; paid_leave_amount: number;
  commute_amount: number; gross_amount: number;
  social_insurance: number; employment_insurance: number;
  income_tax: number; resident_tax: number; car_deduction: number;
  total_deduction: number; net_amount: number;
  dependents: number;
  status: "draft" | "confirmed";
  detail_json: any;
}

const yen = (n: number | null | undefined) => (n == null ? "—" : n === 0 ? "－" : `¥${Math.round(n).toLocaleString("ja-JP")}`);
const minToHM = (m: number | null | undefined) => {
  if (m == null) return "—";
  const sign = m < 0 ? "-" : "";
  const abs = Math.abs(m);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
};

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
function currentYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ═══════════════ インライン編集セル ═══════════════
 * クリック→input、Enter or blur で onSave、Escape で cancel。
 * グローバル CSS の `input { font-size: 16px !important }` を上書きするため
 * ref.style.setProperty で !important を付与する。
 * 数値以外（時刻=分）の場合 toMin/fromMin で表示・編集を変換可能。
 */
type EditableCellProps = {
  value: number;
  display: string;
  onSave: (n: number) => Promise<void> | void;
  baseStyle: React.CSSProperties;
  parse?: (raw: string) => number;       // input文字列→保存する数値
  step?: string;
  disabled?: boolean;
};
function EditableCell({ value, display, onSave, baseStyle, parse, step = "1", disabled }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    setDraft(String(value ?? 0));
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      // グローバル `input { font-size: 16px !important }` を上書き（セル幅維持の要）
      el.style.setProperty("font-size", "inherit", "important");
      el.style.setProperty("padding", "0", "important");
      el.style.setProperty("margin",  "0", "important");
      el.focus();
      el.select();
    });
  }, [editing, value]);

  if (disabled) {
    return <td style={baseStyle}>{display}</td>;
  }

  const commit = async () => {
    if (saving) return;
    const n = parse ? parse(draft) : parseFloat(draft);
    if (Number.isNaN(n)) { setEditing(false); return; }
    if (n === value) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(n); }
    finally { setSaving(false); setEditing(false); }
  };

  if (editing) {
    // 編集中は td 自体の padding/border を打ち消し、input でセルを完全に埋める。
    // baseStyle の borderRight だけ残してレイアウトを保持。
    return (
      <td style={{
        ...baseStyle,
        padding: 0,
        // borderRight は baseStyle 由来のものをそのまま保持
      }}>
        <input
          ref={inputRef}
          type="number"
          step={step}
          value={draft}
          disabled={saving}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
          }}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            border: "1px solid #059669",
            background: "#F0FDF4",
            color: T.text,
            textAlign: (baseStyle.textAlign as any) ?? "right",
            boxSizing: "border-box",
            outline: "none",
            borderRadius: 0,
          }}
        />
      </td>
    );
  }
  return (
    <td
      style={{ ...baseStyle, cursor: "pointer" }}
      title="クリックで編集"
      onClick={() => setEditing(true)}
    >
      {display}
    </td>
  );
}

export default function PayrollSub({ employee }: { employee: any }) {
  const [tab, setTab] = useState<Tab>("calc");
  const myCode = employee?.employee_code || "";
  const isWcAdmin = myCode === "WC001" || ["W02", "W49", "W67"].includes(myCode);

  if (!isWcAdmin) {
    return <div style={{ padding: 24, color: T.textSec, fontSize: 13 }}>給与管理は権限がありません。</div>;
  }

  return (
    <div>
      <div style={{
        display: "flex", gap: 4, marginBottom: 16,
        borderBottom: `1px solid ${T.border}`,
      }}>
        {([
          { key: "calc", label: "月次計算" },
          { key: "master", label: "給与マスタ" },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "8px 16px", border: "none", cursor: "pointer", backgroundColor: "transparent",
            borderBottom: tab === t.key ? `2px solid ${T.primary}` : "2px solid transparent",
            color: tab === t.key ? T.primary : T.textSec,
            fontSize: 13, fontWeight: 700,
          }}>{t.label}</button>
        ))}
      </div>
      {tab === "calc" ? <CalcView employee={employee} /> : <MasterView employee={employee} />}
    </div>
  );
}

// 月次計算テーブル各列のヘッダー背景色（インデックスは表示列順 0-29）
// 5つの「計」「総支給」「差引支給額」列はデータ行にも同色を適用（インラインで個別指定）。
const HEADER_BG = [
  "#1a4b24", "#1a4b24",                                                          // 0,1   氏名/状態 (T.primary)
  "#DBEAFE","#DBEAFE","#DBEAFE","#DBEAFE","#DBEAFE","#DBEAFE","#DBEAFE",          // 2-8   勤怠系
  "#DCFCE7","#DCFCE7","#DCFCE7","#DCFCE7","#DCFCE7","#DCFCE7",                    // 9-14  支給明細
  "#BBF7D0",                                                                     // 15    給料計
  "#D1FAE5","#D1FAE5",                                                            // 16,17 交通費・非課税
  "#A7F3D0",                                                                     // 18    総支給
  "#FEF3C7",                                                                     // 19    課税計
  "#FEE2E2","#FEE2E2",                                                            // 20,21 社保・雇保
  "#FECACA",                                                                     // 22    社保計
  "#FEE2E2","#FEE2E2","#FEE2E2",                                                  // 23,24,25 所得税・住民税・車
  "#FCA5A5",                                                                     // 26    控除計
  "#EDE9FE",                                                                     // 27    扶養
  "#DDD6FE",                                                                     // 28    差引支給額
  "#1a4b24",                                                                     // 29    明細ボタン列
];

/* ═══════════════ 月次計算ビュー ═══════════════ */
function CalcView({ employee }: { employee: any }) {
  const [ym, setYm] = useState<string>(currentYM());
  const [rows, setRows] = useState<Monthly[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [dialog, setDialog] = useState<{ message: string; onOk?: () => void } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: monthly }, { data: settings }] = await Promise.all([
      supabase.from("wc_payroll_monthly").select("*")
        .eq("company_id", COMPANY_ID).eq("target_month", ym),
      supabase.from("wc_payroll_settings").select("id, sort_order")
        .eq("company_id", COMPANY_ID),
    ]);
    const orderMap = new Map<string, number>();
    (settings || []).forEach((s: any) => orderMap.set(s.id, s.sort_order ?? 999));
    const sorted = ((monthly || []) as any[]).sort((a, b) => {
      const ao = orderMap.get(a.payroll_setting_id) ?? 999;
      const bo = orderMap.get(b.payroll_setting_id) ?? 999;
      return ao - bo;
    });
    setRows(sorted);
    setLoading(false);
  }, [ym]);
  useEffect(() => { load(); }, [load]);

  const runCalc = async () => {
    setCalculating(true);
    const { data, error } = await supabase.rpc("wc_fn_calculate_monthly_payroll", {
      p_target_month: ym, p_caller_id: employee.id,
    });
    setCalculating(false);
    if (error) { setDialog({ message: "計算失敗: " + error.message }); return; }
    setDialog({ message: `${data}件計算しました` });
    load();
  };

  /* インライン編集: 1セル更新 → 派生(gross/total_deduction/net)を再計算 → DBへ一括update */
  const updateMonthly = async (r: Monthly, field: keyof Monthly, value: number) => {
    if (r.status === "confirmed") {
      setDialog({ message: "確定済みは編集できません。" });
      return;
    }
    const next: Monthly = { ...r, [field]: value };
    next.gross_amount    = next.base_salary + next.fixed_overtime + next.position_allowance
                         + next.family_allowance + next.child_support_allowance + next.other_allowance
                         + next.weekday_amount + next.weekend_amount + next.overtime_amount
                         + next.paid_leave_amount + next.commute_amount;
    next.total_deduction = next.social_insurance + next.employment_insurance
                         + next.income_tax + next.resident_tax + next.car_deduction;
    next.net_amount      = next.gross_amount - next.total_deduction;

    const { error } = await supabase.from("wc_payroll_monthly").update({
      [field]: value,
      gross_amount:    next.gross_amount,
      total_deduction: next.total_deduction,
      net_amount:      next.net_amount,
      updated_at:      new Date().toISOString(),
    }).eq("id", r.id);
    if (error) { setDialog({ message: "保存失敗: " + error.message }); return; }
    setRows(prev => prev.map(x => x.id === r.id ? next : x));
  };

  const confirmAll = async () => {
    setDialog({
      message: `${ym}の給与を確定しますか？確定後はマスタ変更を反映するには再計算→再確定が必要です。`,
      onOk: async () => {
        setDialog(null);
        const { error } = await supabase.from("wc_payroll_monthly")
          .update({ status: "confirmed", confirmed_at: new Date().toISOString(), confirmed_by: employee.id })
          .eq("company_id", COMPANY_ID).eq("target_month", ym).eq("status", "draft");
        if (error) { setDialog({ message: "確定失敗: " + error.message }); return; }
        load();
      },
    });
  };

  const distribute = async () => {
    setDialog({
      message: `${ym}の給与明細を全社員のポータル(書類)に配布しますか？`,
      onOk: async () => {
        setDialog(null);
        const confirmed = rows.filter(r => r.status === "confirmed" && r.payroll_setting_id);
        const docName = `給与明細 ${ym}`;
        let ok = 0, fail = 0;
        for (const r of confirmed) {
          const setting = await supabase.from("wc_payroll_settings").select("employee_id").eq("id", r.payroll_setting_id!).maybeSingle();
          const empId = setting.data?.employee_id;
          if (!empId) { continue; }
          const html = renderPayslipHTML(r);
          await supabase.from("documents")
            .delete()
            .eq("company_id", COMPANY_ID)
            .eq("employee_id", empId)
            .eq("doc_type", "payslip")
            .eq("document_name", docName);
          const { error } = await supabase.from("documents").insert({
            company_id: COMPANY_ID,
            employee_id: empId,
            document_name: docName,
            category: "給与明細",
            doc_type: "payslip",
            content: html,
            upload_date: new Date().toISOString(),
            uploader: employee.full_name,
          });
          if (error) { fail++; continue; }
          ok++;
          fetch(PUSH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "document_delivered",
              payload: { employee_id: empId, document_name: docName },
            }),
          }).catch(() => {});
        }
        setDialog({ message: `配布完了：${ok}件成功 / ${fail}件失敗` });
      },
    });
  };

  const printOne = async (r: Monthly) => {
    const html = renderPayslipHTML(r);
    const w = window.open("", "_blank", "width=820,height=1100");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  const totals = useMemo(() => {
    if (rows.length === 0) return null;
    const s = (f: keyof Monthly) => rows.reduce((a, r) => a + ((r[f] as number) ?? 0), 0);
    return {
      worked_days: s("worked_days"),
      worked_minutes: s("worked_minutes"),
      overtime_minutes: s("overtime_minutes"),
      night_minutes: s("night_minutes"),
      paid_leave_days: s("paid_leave_days"),
      weekday_minutes: s("weekday_minutes"),
      weekend_minutes: s("weekend_minutes"),
      base_salary: s("base_salary"),
      fixed_overtime: s("fixed_overtime"),
      position_allowance: s("position_allowance"),
      family_allowance: s("family_allowance"),
      other_allowance: s("other_allowance"),
      paid_leave_amount: s("paid_leave_amount"),
      salaryTotal: rows.reduce((a, r) => a + (r.gross_amount - r.commute_amount), 0),
      commute_amount: s("commute_amount"),
      nonTaxable: s("commute_amount"),
      gross_amount: s("gross_amount"),
      taxableTotal: rows.reduce((a, r) => a + Math.max(0, r.gross_amount - r.commute_amount - r.social_insurance - r.employment_insurance), 0),
      social_insurance: s("social_insurance"),
      employment_insurance: s("employment_insurance"),
      insuranceTotal: s("social_insurance") + s("employment_insurance"),
      income_tax: s("income_tax"),
      resident_tax: s("resident_tax"),
      car_deduction: s("car_deduction"),
      total_deduction: s("total_deduction"),
      net_amount: s("net_amount"),
    };
  }, [rows]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={() => setYm(prevMonth(ym))} style={navBtn}>&lt;</button>
        <span style={{ fontSize: 16, fontWeight: 700, minWidth: 100, textAlign: "center" }}>{ym}</span>
        <button onClick={() => setYm(nextMonth(ym))} style={navBtn}>&gt;</button>
        <span style={{ fontSize: 11, color: T.textSec }}>
          {rows[0] && `期間: ${rows[0].period_start} 〜 ${rows[0].period_end}　支給日: ${rows[0].pay_date ?? "—"}`}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={runCalc} disabled={calculating} style={{
            padding: "8px 16px", borderRadius: 4, border: "none",
            backgroundColor: T.primary, color: "#fff", fontSize: 13, fontWeight: 700,
            cursor: calculating ? "not-allowed" : "pointer", opacity: calculating ? 0.6 : 1,
          }}>{calculating ? "計算中..." : "再計算"}</button>
          <button onClick={confirmAll} disabled={!rows.some(r => r.status === "draft")} style={{
            padding: "8px 16px", borderRadius: 4, border: `1px solid ${T.primary}`,
            backgroundColor: "#fff", color: T.primary, fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>確定</button>
          <button onClick={distribute} disabled={!rows.some(r => r.status === "confirmed")} style={{
            padding: "8px 16px", borderRadius: 4, border: `1px solid ${T.success}`,
            backgroundColor: "#fff", color: T.success, fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>明細配布</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textSec }}>読み込み中...</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textMuted }}>
          まだ計算されていません。「再計算」を押して下さい。
        </div>
      ) : (
        <div style={{ overflow: "auto", width: "100%", maxWidth: "100%", maxHeight: "calc(100vh - 220px)" }}>
          <table style={{
            borderCollapse: "collapse", fontSize: 10,
            backgroundColor: "#fff", minWidth: 1200,
          }}>
            <thead>
              <tr>
                {[
                  "氏名","状態","出勤日数","労働時間","残業時間","深夜早朝","有給(日)",
                  "平日時間","土日時間","基本給","固定残業手当","役職手当","家族手当","諸手当",
                  "有給金額","給料計","交通費","非課税","総支給",
                  "課税計","社保","雇保","社保計","所得税","住民税","車","控除計",
                  "扶養","差引支給額",""
                ].map((h, i) => {
                  const sticky: React.CSSProperties =
                    i === 0 ? { position: "sticky", left: 0, top: 0, zIndex: 5, minWidth: 72 } :
                    i === 1 ? { position: "sticky", left: 72, top: 0, zIndex: 5, minWidth: 50, boxShadow: "2px 0 4px rgba(0,0,0,0.1)" } :
                    i === 28 ? { position: "sticky", right: 52, top: 0, zIndex: 5, minWidth: 80, boxShadow: "-2px 0 4px rgba(0,0,0,0.1)" } :
                    i === 29 ? { position: "sticky", right: 0, top: 0, zIndex: 5, minWidth: 52 } :
                    { position: "sticky", top: 0, zIndex: 3 };
                  return (
                    <th key={i} style={{
                      padding: "4px 2px", fontSize: 9, fontWeight: 600,
                      whiteSpace: "normal", wordBreak: "keep-all",
                      lineHeight: 1.15, verticalAlign: "bottom",
                      textAlign: i < 2 ? "left" : "right",
                      backgroundColor: HEADER_BG[i],
                      color: (i < 2 || i === 29) ? "#fff" : T.text,
                      borderRight: "1px solid #D1D5DB",
                      borderBottom: "2px solid #374151",
                      ...sticky,
                    }}>{h}</th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const salaryTotal    = r.gross_amount - r.commute_amount;
                const nonTaxable     = r.commute_amount;
                const taxableTotal   = Math.max(0, r.gross_amount - nonTaxable - r.social_insurance - r.employment_insurance);
                const insuranceTotal = r.social_insurance + r.employment_insurance;
                const ec = (field: keyof Monthly, display: string, baseStyle: React.CSSProperties) => (
                  <EditableCell
                    value={(r[field] as number) ?? 0}
                    display={display}
                    onSave={(n) => updateMonthly(r, field, n)}
                    baseStyle={baseStyle}
                    disabled={r.status === "confirmed"}
                  />
                );
                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid #9CA3AF" }} className="payroll-row">
                    <td style={{ ...tdNarrow, position: "sticky", left: 0, zIndex: 1, backgroundColor: "#fff", minWidth: 72 }}>{r.display_name}</td>
                    <td style={{ ...tdNarrow, position: "sticky", left: 72, zIndex: 1, backgroundColor: "#fff", minWidth: 50, boxShadow: "2px 0 4px rgba(0,0,0,0.1)" }}>
                      <span style={{
                        padding: "2px 6px", borderRadius: 10, fontSize: 9, fontWeight: 700, color: "#fff",
                        backgroundColor: r.status === "confirmed" ? T.primary : T.warning,
                      }}>{r.status === "confirmed" ? "確定" : "下書"}</span>
                    </td>
                    {ec("worked_days",     String(r.worked_days),       tdNum)}
                    {ec("worked_minutes",  minToHM(r.worked_minutes),   tdNum)}
                    {ec("overtime_minutes",minToHM(r.overtime_minutes), tdNum)}
                    {ec("night_minutes",   minToHM(r.night_minutes),    tdNum)}
                    {ec("paid_leave_days", String(r.paid_leave_days),   tdNum)}
                    {ec("weekday_minutes", minToHM(r.weekday_minutes),  tdNum)}
                    {ec("weekend_minutes", minToHM(r.weekend_minutes),  tdNum)}
                    {ec("base_salary",          yen(r.base_salary),             tdNum)}
                    {ec("fixed_overtime",       yen(r.fixed_overtime),          tdNum)}
                    {ec("position_allowance",   yen(r.position_allowance),      tdNum)}
                    {ec("family_allowance",     yen(r.family_allowance),        tdNum)}
                    {ec("other_allowance",      yen(r.other_allowance),         tdNum)}
                    {ec("paid_leave_amount",    yen(r.paid_leave_amount),       tdNum)}
                    {/* 16 給料計（派生・編集不可） */}
                    <td style={{ ...tdNum, fontWeight: 600, backgroundColor: "#BBF7D0" }}>{yen(salaryTotal)}</td>
                    {ec("commute_amount", yen(r.commute_amount), tdNum)}
                    {/* 18 非課税（派生・編集不可、= commute_amount） */}
                    <td style={tdNum}>{yen(nonTaxable)}</td>
                    {/* 19 総支給（派生・編集不可） */}
                    <td style={{ ...tdNum, fontWeight: 600, backgroundColor: "#A7F3D0" }}>{yen(r.gross_amount)}</td>
                    {/* 20 課税計（派生・編集不可） */}
                    <td style={tdNum}>{yen(taxableTotal)}</td>
                    {ec("social_insurance",     yen(r.social_insurance),     tdNum)}
                    {ec("employment_insurance", yen(r.employment_insurance), tdNum)}
                    {/* 23 社保計（派生・編集不可） */}
                    <td style={{ ...tdNum, fontWeight: 600, backgroundColor: "#FECACA" }}>{yen(insuranceTotal)}</td>
                    {ec("income_tax",    yen(r.income_tax),    tdNum)}
                    {ec("resident_tax",  yen(r.resident_tax),  tdNum)}
                    {ec("car_deduction", yen(r.car_deduction), tdNum)}
                    {/* 27 控除計（派生・編集不可） */}
                    <td style={{ ...tdNum, color: T.danger, fontWeight: 600, backgroundColor: "#FCA5A5" }}>{yen(r.total_deduction)}</td>
                    {ec("dependents", String(r.dependents), tdNum)}
                    {/* 29 差引支給額（派生・編集不可） */}
                    <td style={{ ...tdNum, fontSize: 15, fontWeight: 700, color: T.primary, backgroundColor: "#DDD6FE", position: "sticky", right: 52, zIndex: 1, minWidth: 80, boxShadow: "-2px 0 4px rgba(0,0,0,0.1)" }}>{yen(r.net_amount)}</td>
                    <td style={{ ...tdNarrow, position: "sticky", right: 0, zIndex: 1, backgroundColor: "#fff", minWidth: 52 }}>
                      <button onClick={() => printOne(r)} style={{
                        padding: "4px 8px", borderRadius: 4, border: `1px solid ${T.border}`,
                        backgroundColor: "#fff", color: T.text, fontSize: 10, cursor: "pointer",
                      }}>明細</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {totals && (
              <tfoot>
                <tr style={{ borderTop: "3px solid #374151", fontWeight: 700 }}>
                  <td style={{ ...tfNum, position: "sticky", left: 0, zIndex: 4, minWidth: 72, textAlign: "left" }}>合計</td>
                  <td style={{ ...tfNum, position: "sticky", left: 72, zIndex: 4, minWidth: 50, boxShadow: "2px 0 4px rgba(0,0,0,0.1)" }}></td>
                  <td style={tfNum}>{totals.worked_days}</td>
                  <td style={tfNum}>{minToHM(totals.worked_minutes)}</td>
                  <td style={tfNum}>{minToHM(totals.overtime_minutes)}</td>
                  <td style={tfNum}>{minToHM(totals.night_minutes)}</td>
                  <td style={tfNum}>{totals.paid_leave_days}</td>
                  <td style={tfNum}>{minToHM(totals.weekday_minutes)}</td>
                  <td style={tfNum}>{minToHM(totals.weekend_minutes)}</td>
                  <td style={tfNum}>{yen(totals.base_salary)}</td>
                  <td style={tfNum}>{yen(totals.fixed_overtime)}</td>
                  <td style={tfNum}>{yen(totals.position_allowance)}</td>
                  <td style={tfNum}>{yen(totals.family_allowance)}</td>
                  <td style={tfNum}>{yen(totals.other_allowance)}</td>
                  <td style={tfNum}>{yen(totals.paid_leave_amount)}</td>
                  <td style={{ ...tfNum, backgroundColor: "#b0e8bf" }}>{yen(totals.salaryTotal)}</td>
                  <td style={tfNum}>{yen(totals.commute_amount)}</td>
                  <td style={tfNum}>{yen(totals.nonTaxable)}</td>
                  <td style={{ ...tfNum, backgroundColor: "#8fe0a8" }}>{yen(totals.gross_amount)}</td>
                  <td style={tfNum}>{yen(totals.taxableTotal)}</td>
                  <td style={tfNum}>{yen(totals.social_insurance)}</td>
                  <td style={tfNum}>{yen(totals.employment_insurance)}</td>
                  <td style={{ ...tfNum, backgroundColor: "#f5b8b8" }}>{yen(totals.insuranceTotal)}</td>
                  <td style={tfNum}>{yen(totals.income_tax)}</td>
                  <td style={tfNum}>{yen(totals.resident_tax)}</td>
                  <td style={tfNum}>{yen(totals.car_deduction)}</td>
                  <td style={{ ...tfNum, color: T.danger, backgroundColor: "#f09090" }}>{yen(totals.total_deduction)}</td>
                  <td style={tfNum}></td>
                  <td style={{ ...tfNum, fontSize: 15, color: T.primary, backgroundColor: "#c9c0f0", position: "sticky", right: 52, zIndex: 4, minWidth: 80, boxShadow: "-2px 0 4px rgba(0,0,0,0.1)" }}>{yen(totals.net_amount)}</td>
                  <td style={{ ...tfNum, position: "sticky", right: 0, zIndex: 4, minWidth: 52 }}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {dialog && (
        <Dialog
          message={dialog.message}
          mode={dialog.onOk ? "confirm" : "alert"}
          onOk={dialog.onOk ?? (() => setDialog(null))}
          onCancel={() => setDialog(null)}
        />
      )}
      <style>{`.payroll-row:hover > td { background-color: #F0FDF4 !important; }`}</style>
    </div>
  );
}

/* ═══════════════ マスタ編集ビュー ═══════════════
 * 全フィールドはセルクリックで直接編集（編集ボタン廃止）。
 * Enter/Blurで wc_payroll_settings に即UPDATE、Escでキャンセル。
 */
function MasterView({ employee: _employee }: { employee: any }) {
  const [rows, setRows] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ message: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("wc_payroll_settings")
      .select("*")
      .eq("company_id", COMPANY_ID).eq("is_active", true)
      .order("sort_order", { ascending: true });
    setRows((data || []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const updateField = async (r: Setting, field: keyof Setting, value: number | null | string) => {
    const { error } = await supabase.from("wc_payroll_settings").update({
      [field]: value, updated_at: new Date().toISOString(),
    }).eq("id", r.id);
    if (error) { setDialog({ message: "保存失敗: " + error.message }); return; }
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, [field]: value } as Setting : x));
  };

  /* マスタ用セル（数値）。EditableCellを再利用 */
  const NumCell = ({ r, field, suffix = "" }: { r: Setting; field: keyof Setting; suffix?: string }) => {
    const v = (r[field] as number) ?? 0;
    return (
      <EditableCell
        value={v}
        display={yen(v) + suffix}
        onSave={(n) => updateField(r, field, n)}
        baseStyle={{ ...tdStyle, textAlign: "right", minWidth: 76, maxWidth: 76, overflow: "hidden" }}
      />
    );
  };

  return (
    <div>
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textSec }}>読み込み中...</div>
      ) : (
        <div style={{ overflowX: "auto", width: "100%", maxWidth: "100%" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 11, backgroundColor: "#fff", minWidth: 1100 }}>
            <thead>
              <tr style={{ backgroundColor: T.primary, color: "#fff" }}>
                {[
                  "氏名","区分","基本給","固定残業","役職","家族","諸手当","支援金",
                  "平日時給","土日時給","所定終業","所定労働(分)","休憩固定",
                  "社保","住民税","車","交通費/日","扶養",
                ].map((h, i) => {
                  const sticky: React.CSSProperties =
                    i === 0 ? { position: "sticky", left: 0, zIndex: 3, minWidth: 72, backgroundColor: T.primary } :
                    i === 1 ? { position: "sticky", left: 72, zIndex: 3, minWidth: 56, backgroundColor: T.primary, boxShadow: "2px 0 4px rgba(0,0,0,0.1)" } : {};
                  return (
                    <th key={i} style={{
                      padding: "6px 4px", fontSize: 10, fontWeight: 600,
                      whiteSpace: "normal", wordBreak: "keep-all", lineHeight: 1.15,
                      borderRight: "1px solid #D1D5DB",
                      borderBottom: "2px solid #374151",
                      textAlign: i < 2 ? "left" : "right",
                      ...sticky,
                    }}>{h}</th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom: "1px solid #9CA3AF" }} className="payroll-row">
                  <td style={{ ...tdStyle, position: "sticky", left: 0, zIndex: 1, backgroundColor: "#fff", minWidth: 72 }}>{r.display_name}</td>
                  <td style={{ ...tdStyle, position: "sticky", left: 72, zIndex: 1, backgroundColor: "#fff", minWidth: 56, boxShadow: "2px 0 4px rgba(0,0,0,0.1)" }}>{r.employment_type}</td>
                  <NumCell r={r} field="base_salary" />
                  <NumCell r={r} field="fixed_overtime" />
                  <NumCell r={r} field="position_allowance" />
                  <NumCell r={r} field="family_allowance" />
                  <NumCell r={r} field="other_allowance" />
                  <NumCell r={r} field="child_support_allowance" />
                  <NumCell r={r} field="hourly_weekday" />
                  <NumCell r={r} field="hourly_weekend" />
                  {/* 所定終業: time editor */}
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <input
                      type="time"
                      value={(r.scheduled_end_time ?? "").slice(0,5)}
                      onChange={e => {
                        const v = e.target.value || null;
                        updateField(r, "scheduled_end_time", v as any);
                      }}
                      style={{ width: 80, fontSize: 11, padding: 1, border: `1px solid ${T.border}` }}
                    />
                  </td>
                  <NumCell r={r} field="scheduled_minutes" />
                  {/* 休憩固定: 正社員=60分固定(読取専用)、パート=編集可(NULLなら申告制) */}
                  {r.employment_type === "正社員" ? (
                    <td style={{ ...tdStyle, textAlign: "right" }}>60分固定</td>
                  ) : (
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <input
                        type="number"
                        defaultValue={r.break_minutes_fixed ?? ""}
                        placeholder="申告制"
                        onBlur={e => {
                          const raw = e.target.value;
                          const v = raw === "" ? null : parseInt(raw, 10);
                          if (v !== r.break_minutes_fixed) updateField(r, "break_minutes_fixed", v);
                        }}
                        style={{ width: 60, fontSize: 11, padding: 1, border: `1px solid ${T.border}`, textAlign: "right" }}
                      />
                    </td>
                  )}
                  <NumCell r={r} field="social_insurance" />
                  <NumCell r={r} field="resident_tax" />
                  <NumCell r={r} field="car_deduction" />
                  <NumCell r={r} field="commute_per_day" suffix="/日" />
                  <NumCell r={r} field="dependents" />
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12, padding: "8px 16px", fontSize: 11, color: T.textSec }}>
            ※ 各セルをクリックして直接編集。Enter で保存、Esc でキャンセル。
          </div>
        </div>
      )}

      {dialog && <Dialog message={dialog.message} mode="alert" onOk={() => setDialog(null)} onCancel={() => setDialog(null)} />}
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: "50%", border: `1px solid ${T.border}`,
  backgroundColor: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700,
};
const tdStyle: React.CSSProperties = {
  padding: "8px 6px", fontSize: 12, color: T.text, whiteSpace: "nowrap",
};
const tdNarrow: React.CSSProperties = {
  padding: "3px 2px", fontSize: 10, color: T.text,
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  borderRight: "1px solid #D1D5DB",
};
const tdNum: React.CSSProperties = {
  padding: "3px 2px", fontSize: 10, color: T.text,
  whiteSpace: "nowrap", textAlign: "right",
  overflow: "hidden", textOverflow: "ellipsis",
  borderRight: "1px solid #D1D5DB",
};

const tfNum: React.CSSProperties = {
  ...tdNum,
  fontWeight: 700,
  backgroundColor: "#e9ecef",
  position: "sticky",
  bottom: 0,
  zIndex: 2,
};

/* ═══════════════ 給与明細 PDF (HTML) 生成 ═══════════════ */
function renderPayslipHTML(r: Monthly): string {
  const det = r.detail_json || {};
  const isPart = det.employment_type === "パート";

  const row = (label: string, value: string | number, opts: { strong?: boolean; danger?: boolean } = {}) => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #ccc;font-size:12px;color:#333;${opts.strong ? "font-weight:700" : ""}">${label}</td>
      <td style="padding:6px 10px;border:1px solid #ccc;font-size:12px;text-align:right;${opts.danger ? "color:#c00;" : ""}${opts.strong ? "font-weight:700;font-size:13px;" : ""}">${value}</td>
    </tr>`;

  const supplySection = isPart ? `
    ${row("平日 " + Math.round(r.weekday_minutes/60*10)/10 + "h × " + (det.hourly_weekday ?? 0) + "円", yen(r.weekday_amount))}
    ${row("土日祝 " + Math.round(r.weekend_minutes/60*10)/10 + "h × " + (det.hourly_weekend ?? 0) + "円", yen(r.weekend_amount))}
    ${row("残業 " + Math.round(r.overtime_minutes/60*100)/100 + "h × 1.25", yen(r.overtime_amount))}
    ${row("有給金額 " + r.paid_leave_days + "日", yen(r.paid_leave_amount))}
    ${row("役職手当", yen(r.position_allowance))}
    ${row("家族手当", yen(r.family_allowance))}
    ${row("子育て支援金", yen(r.child_support_allowance))}
    ${row("通勤費（非課税）", yen(r.commute_amount))}
  ` : `
    ${row("基本給", yen(r.base_salary))}
    ${row("固定残業手当", yen(r.fixed_overtime))}
    ${row("役職手当", yen(r.position_allowance))}
    ${row("家族手当", yen(r.family_allowance))}
    ${row("子育て支援金", yen(r.child_support_allowance))}
    ${row("諸手当", yen(0))}
    ${row("通勤費（非課税）", yen(r.commute_amount))}
  `;

  return `<!DOCTYPE html><html lang="ja"><head>
    <meta charset="UTF-8" />
    <title>給与明細 ${r.display_name} ${r.target_month}</title>
    <style>
      @media print { @page { size: A4 portrait; margin: 16mm; } }
      body { font-family: "Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif; color:#222; margin:0; padding:24px; }
      h1 { font-size: 20px; text-align: center; margin: 0 0 8px; }
      .meta { font-size: 12px; color:#555; text-align: center; margin-bottom: 18px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
      h3 { font-size: 13px; background:#1a4b24; color:#fff; padding:6px 10px; margin:0 0 6px; border-radius:3px; }
      table { width: 100%; border-collapse: collapse; }
      .net { margin-top: 24px; padding: 14px 18px; border: 2px solid #1a4b24; border-radius: 6px; display:flex; justify-content:space-between; align-items:center; }
      .net .label { font-size: 14px; font-weight: 700; }
      .net .value { font-size: 28px; font-weight: 800; color:#1a4b24; }
      .footer { margin-top: 28px; text-align: center; font-size: 12px; color:#555; }
    </style></head><body>
    <h1>株式会社ワールドクラブ 給与支払明細書</h1>
    <div class="meta">
      対象期間：${r.period_start} 〜 ${r.period_end}　／　氏名：${r.display_name}　／　支給日：${r.pay_date ?? "—"}
    </div>
    <div class="grid">
      <div>
        <h3>支給</h3>
        <table>${supplySection}</table>
      </div>
      <div>
        <h3>控除</h3>
        <table>
          ${row("社会保険", yen(r.social_insurance))}
          ${row("雇用保険", yen(r.employment_insurance))}
          ${row("所得税", yen(r.income_tax))}
          ${row("住民税", yen(r.resident_tax))}
          ${row("車", yen(r.car_deduction))}
          ${row("控除合計", yen(r.total_deduction), { strong: true, danger: true })}
        </table>
        <h3 style="margin-top:14px">勤怠</h3>
        <table>
          ${row("出勤日数", r.worked_days + "日")}
          ${row("労働時間", minToHM(r.worked_minutes))}
          ${row("残業時間", minToHM(r.overtime_minutes))}
          ${row("有給日数", r.paid_leave_days + "日")}
        </table>
      </div>
    </div>
    <div class="net">
      <span class="label">差引支給額</span>
      <span class="value">${yen(r.net_amount)}</span>
    </div>
    <div class="footer">今月もご苦労さまでした。</div>
  </body></html>`;
}
