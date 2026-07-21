"use client";
import { useState, useEffect, useCallback, useRef } from "react";
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
  child_support_deduction: number;
  other_allowance: number;
  car_deduction: number; resident_tax: number;
  hourly_weekday: number; hourly_weekend: number;
  scheduled_end_time: string | null; scheduled_minutes: number;
  break_minutes_fixed: number | null;
  social_insurance: number; commute_per_day: number;
  dependents: number; is_payroll_only: boolean; is_active: boolean;
  is_calc_target: boolean; sort_order: number;
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
  child_support_deduction: number;
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

/* ═══════════════ 単一列定義（画面header/body/totals・Excel cols/cellVal/totalVals の唯一の情報源） ═══════════════
 * ここに1行足せば、画面テーブル・合計行・Excel出力すべてに列が追加される。
 * value(r) が値の唯一の取り出し方（DBカラムそのものでも派生式でも）。
 * 合計は自動: sum(rows.map(c.value)) を format に応じて表示。
 */
type ColFormat = "text" | "status" | "days" | "time" | "money" | "count";
type ColSticky = { side: "left" | "right"; offset: number; minWidth: number; shadow?: boolean };
type ColDef = {
  key: string;
  label: string;
  format: ColFormat;
  value: (r: Monthly) => number | string;
  editable?: keyof Monthly;              // 指定時、画面はEditableCellを使う（confirmedなら自動でdisabled）
  noTotal?: boolean;                     // trueなら合計行に集計を出さない（扶養など）
  totalOverride?: string;                // 合計セルに文字を出す（"合計"など）
  headerBg: string;
  headerColor?: string;
  bodyBg?: string;
  totalBg?: string;
  bodyExtra?: React.CSSProperties;
  totalExtra?: React.CSSProperties;
  sticky?: ColSticky;
  excelWidth: number;                    // Excel列幅（px相当 / 5 が実際のwidth）
  step?: string;                         // インライン編集時のinput step（半休0.5対応など、既定は"1"）
};

// ガード付き数値取得: null/undefined/NaN を 0 に落とす（Excel derivedのNaNガード）
const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const COLS: ColDef[] = [
  {
    key: "display_name", label: "氏名", format: "text",
    value: r => r.display_name || "",
    totalOverride: "合計",
    headerBg: "#1a4b24", headerColor: "#fff",
    sticky: { side: "left", offset: 0, minWidth: 72 },
    excelWidth: 80,
  },
  {
    key: "status", label: "状態", format: "status",
    value: r => r.status,
    headerBg: "#1a4b24", headerColor: "#fff",
    sticky: { side: "left", offset: 72, minWidth: 50, shadow: true },
    excelWidth: 50,
  },
  { key: "worked_days",      label: "出勤日数", format: "days", value: r => num(r.worked_days),      editable: "worked_days",      headerBg: "#DBEAFE", excelWidth: 55 },
  { key: "worked_minutes",   label: "労働時間", format: "time", value: r => num(r.worked_minutes),   editable: "worked_minutes",   headerBg: "#DBEAFE", excelWidth: 60 },
  { key: "overtime_minutes", label: "残業時間", format: "time", value: r => num(r.overtime_minutes), editable: "overtime_minutes", headerBg: "#DBEAFE", excelWidth: 60 },
  { key: "night_minutes",    label: "深夜早朝", format: "time", value: r => num(r.night_minutes),    editable: "night_minutes",    headerBg: "#DBEAFE", excelWidth: 60 },
  { key: "paid_leave_days",  label: "有給(日)", format: "days", value: r => num(r.paid_leave_days),  editable: "paid_leave_days",  headerBg: "#DBEAFE", excelWidth: 55, step: "0.5" },
  { key: "weekday_minutes",  label: "平日時間", format: "time", value: r => num(r.weekday_minutes),  editable: "weekday_minutes",  headerBg: "#DBEAFE", excelWidth: 60 },
  { key: "weekend_minutes",  label: "土日時間", format: "time", value: r => num(r.weekend_minutes),  editable: "weekend_minutes",  headerBg: "#DBEAFE", excelWidth: 60 },
  { key: "base_salary",        label: "基本給",       format: "money", value: r => num(r.base_salary),        editable: "base_salary",        headerBg: "#DCFCE7", excelWidth: 70 },
  { key: "fixed_overtime",     label: "固定残業手当", format: "money", value: r => num(r.fixed_overtime),     editable: "fixed_overtime",     headerBg: "#DCFCE7", excelWidth: 75 },
  { key: "position_allowance", label: "役職手当",     format: "money", value: r => num(r.position_allowance), editable: "position_allowance", headerBg: "#DCFCE7", excelWidth: 65 },
  { key: "family_allowance",   label: "家族手当",     format: "money", value: r => num(r.family_allowance),   editable: "family_allowance",   headerBg: "#DCFCE7", excelWidth: 65 },
  { key: "other_allowance",    label: "諸手当",       format: "money", value: r => num(r.other_allowance),    editable: "other_allowance",    headerBg: "#DCFCE7", excelWidth: 60 },
  { key: "paid_leave_amount",  label: "有給金額",     format: "money", value: r => num(r.paid_leave_amount),  editable: "paid_leave_amount",  headerBg: "#DCFCE7", excelWidth: 65 },
  {
    // 給料計 = 総支給 - 交通費（派生・唯一の定義箇所）
    key: "salaryTotal", label: "給料計", format: "money",
    value: r => num(r.gross_amount) - num(r.commute_amount),
    headerBg: "#BBF7D0", bodyBg: "#BBF7D0", totalBg: "#b0e8bf",
    bodyExtra: { fontWeight: 600 },
    excelWidth: 70,
  },
  { key: "commute_amount", label: "交通費", format: "money", value: r => num(r.commute_amount), editable: "commute_amount", headerBg: "#D1FAE5", excelWidth: 60 },
  {
    // 非課税 = 交通費（派生・唯一の定義箇所）
    key: "nonTaxable", label: "非課税", format: "money",
    value: r => num(r.commute_amount),
    headerBg: "#D1FAE5", excelWidth: 60,
  },
  {
    key: "gross_amount", label: "総支給", format: "money",
    value: r => num(r.gross_amount),
    headerBg: "#A7F3D0", bodyBg: "#A7F3D0", totalBg: "#8fe0a8",
    bodyExtra: { fontWeight: 600 },
    excelWidth: 70,
  },
  {
    // 課税計 = max(0, 総支給 - 交通費 - 社保 - 雇保)（派生・唯一の定義箇所）
    key: "taxableTotal", label: "課税計", format: "money",
    value: r => Math.max(0, num(r.gross_amount) - num(r.commute_amount) - num(r.social_insurance) - num(r.employment_insurance)),
    headerBg: "#FEF3C7", excelWidth: 70,
  },
  { key: "social_insurance",     label: "社保", format: "money", value: r => num(r.social_insurance),     editable: "social_insurance",     headerBg: "#FEE2E2", excelWidth: 60 },
  { key: "employment_insurance", label: "雇保", format: "money", value: r => num(r.employment_insurance), editable: "employment_insurance", headerBg: "#FEE2E2", excelWidth: 60 },
  {
    // 社保計 = 社保 + 雇保（派生・唯一の定義箇所）
    key: "insuranceTotal", label: "社保計", format: "money",
    value: r => num(r.social_insurance) + num(r.employment_insurance),
    headerBg: "#FECACA", bodyBg: "#FECACA", totalBg: "#f5b8b8",
    bodyExtra: { fontWeight: 600 },
    excelWidth: 60,
  },
  { key: "income_tax",    label: "所得税", format: "money", value: r => num(r.income_tax),    editable: "income_tax",    headerBg: "#FEE2E2", excelWidth: 60 },
  { key: "resident_tax",  label: "住民税", format: "money", value: r => num(r.resident_tax),  editable: "resident_tax",  headerBg: "#FEE2E2", excelWidth: 60 },
  { key: "car_deduction", label: "車",    format: "money", value: r => num(r.car_deduction), editable: "car_deduction", headerBg: "#FEE2E2", excelWidth: 55 },
  {
    // 支援金（読取専用・DB由来）
    key: "child_support_deduction", label: "支援金", format: "money",
    value: r => num(r.child_support_deduction),
    headerBg: "#FEE2E2", excelWidth: 60,
  },
  {
    key: "total_deduction", label: "控除計", format: "money",
    value: r => num(r.total_deduction),
    headerBg: "#FCA5A5", bodyBg: "#FCA5A5", totalBg: "#f09090",
    bodyExtra: { fontWeight: 600, color: T.danger },
    totalExtra: { color: T.danger },
    excelWidth: 70,
  },
  { key: "dependents", label: "扶養", format: "count", value: r => num(r.dependents), editable: "dependents", noTotal: true, headerBg: "#EDE9FE", excelWidth: 45 },
  {
    key: "net_amount", label: "差引支給額", format: "money",
    value: r => num(r.net_amount),
    headerBg: "#DDD6FE", bodyBg: "#DDD6FE", totalBg: "#c9c0f0",
    bodyExtra: { fontSize: 15, fontWeight: 700, color: T.primary },
    totalExtra: { fontSize: 15, color: T.primary },
    sticky: { side: "right", offset: 104, minWidth: 80, shadow: true },
    excelWidth: 80,
  },
];

// 表示文字列化（画面body・合計行で使用。Excel側は数値のままセルに入れる）
const fmtDisplay = (c: ColDef, v: number | string): string => {
  switch (c.format) {
    case "text":   return String(v ?? "");
    case "status": return v === "confirmed" ? "確定" : "下書";
    case "days":
    case "count":  return String(v);
    case "time":   return minToHM(v as number);
    case "money":  return yen(v as number);
  }
};

// 合計値算出（画面フッター・Excel合計行の唯一の定義箇所）
const totalOf = (c: ColDef, rows: Monthly[]): number | string => {
  if (c.totalOverride !== undefined) return c.totalOverride;
  if (c.noTotal) return "";
  if (c.format === "text" || c.format === "status") return "";
  return rows.reduce((a, r) => a + num(c.value(r)), 0);
};

const isTextCol = (c: ColDef) => c.format === "text" || c.format === "status";

// sticky スタイル生成（header/body/totals の3種）
const stickyHeader = (c: ColDef): React.CSSProperties => {
  if (!c.sticky) return { position: "sticky", top: 0, zIndex: 3 };
  const s: React.CSSProperties = { position: "sticky", top: 0, zIndex: 5, minWidth: c.sticky.minWidth };
  if (c.sticky.side === "left") s.left = c.sticky.offset; else s.right = c.sticky.offset;
  if (c.sticky.shadow) s.boxShadow = c.sticky.side === "left" ? "2px 0 4px rgba(0,0,0,0.1)" : "-2px 0 4px rgba(0,0,0,0.1)";
  return s;
};
const stickyBody = (c: ColDef): React.CSSProperties => {
  if (!c.sticky) return {};
  const s: React.CSSProperties = {
    position: "sticky", zIndex: 1, minWidth: c.sticky.minWidth,
    backgroundColor: c.bodyBg ?? "#fff",
  };
  if (c.sticky.side === "left") s.left = c.sticky.offset; else s.right = c.sticky.offset;
  if (c.sticky.shadow) s.boxShadow = c.sticky.side === "left" ? "2px 0 4px rgba(0,0,0,0.1)" : "-2px 0 4px rgba(0,0,0,0.1)";
  return s;
};
const stickyTotals = (c: ColDef): React.CSSProperties => {
  if (!c.sticky) return {};
  const s: React.CSSProperties = { position: "sticky", zIndex: 4, minWidth: c.sticky.minWidth };
  if (c.sticky.side === "left") s.left = c.sticky.offset; else s.right = c.sticky.offset;
  if (c.sticky.shadow) s.boxShadow = c.sticky.side === "left" ? "2px 0 4px rgba(0,0,0,0.1)" : "-2px 0 4px rgba(0,0,0,0.1)";
  return s;
};

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
    // gross は DB関数(wc_fn_calculate_monthly_payroll 現行世代③)と整合：
    // 子育て支援金は総支給に加算しない（控除項目扱い）
    next.gross_amount    = next.base_salary + next.fixed_overtime + next.position_allowance
                         + next.family_allowance + next.other_allowance
                         + next.weekday_amount + next.weekend_amount + next.overtime_amount
                         + next.paid_leave_amount + next.commute_amount;
    // total_deduction は DB関数と整合：子育て支援金を控除計に加算
    next.total_deduction = next.social_insurance + next.employment_insurance
                         + next.income_tax + next.resident_tax + next.car_deduction
                         + next.child_support_deduction;
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

  const distributeOne = async (r: Monthly): Promise<{ ok: boolean; message?: string }> => {
    if (!r.payroll_setting_id) return { ok: false, message: "payroll_setting_id 未設定" };
    const setting = await supabase.from("wc_payroll_settings").select("employee_id").eq("id", r.payroll_setting_id).maybeSingle();
    const empId = setting.data?.employee_id;
    if (!empId) return { ok: false, message: "対象社員が特定できません" };
    const docName = `給与明細 ${r.target_month}`;
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
    if (error) {
      console.error("[distributeOne] insert error:", error);
      return { ok: false, message: error.message };
    }
    fetch(PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "document_delivered", payload: { employee_id: empId, document_name: docName } }),
    }).catch(() => {});
    return { ok: true };
  };

  const distribute = async () => {
    setDialog({
      message: `${ym}の給与明細を全社員のポータル(書類)に配布しますか？`,
      onOk: async () => {
        setDialog(null);
        const confirmed = rows.filter(r => r.status === "confirmed" && r.payroll_setting_id);
        let ok = 0, fail = 0;
        let lastErr = "";
        for (const r of confirmed) {
          const res = await distributeOne(r);
          if (res.ok) ok++;
          else { fail++; if (res.message) lastErr = res.message; }
        }
        const suffix = fail > 0 && lastErr ? `\n直近エラー: ${lastErr}` : "";
        setDialog({ message: `配布完了：${ok}件成功 / ${fail}件失敗${suffix}` });
      },
    });
  };

  const distributeRow = async (r: Monthly) => {
    setDialog({
      message: `${r.display_name}さんに${ym}の給与明細を配布しますか？`,
      onOk: async () => {
        setDialog(null);
        const res = await distributeOne(r);
        setDialog({
          message: res.ok
            ? `${r.display_name}さんに配布しました`
            : `${r.display_name}さんの配布に失敗しました${res.message ? `: ${res.message}` : ""}`,
        });
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

  const exportExcel = async () => {
    if (rows.length === 0) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();

    const thin: any = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    const hdrFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDDDDD" } };
    const totalFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9ECEF" } };
    const bFont: any = { bold: true, size: 10, name: "Yu Gothic" };
    const nFont: any = { size: 10, name: "Yu Gothic" };
    const tFont: any = { bold: true, size: 12, name: "Yu Gothic" };

    const ws = wb.addWorksheet("給与");
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    COLS.forEach((c, i) => { ws.getColumn(i + 1).width = Math.round(c.excelWidth / 5); });

    // タイトル
    let rIdx = 1;
    ws.getCell(rIdx, 1).value = `ワールドクラブ 給与 ${ym}`;
    ws.getCell(rIdx, 1).font = tFont;
    rIdx += 2;

    // ヘッダ行
    COLS.forEach((c, i) => {
      const cell = ws.getCell(rIdx, i + 1);
      cell.value = c.label;
      cell.font = bFont;
      cell.alignment = { horizontal: "center", wrapText: true };
      cell.border = thin;
      cell.fill = hdrFill;
    });
    rIdx++;

    // データ行
    const writeCell = (cell: any, c: ColDef, v: number | string) => {
      cell.border = thin;
      if (c.format === "status") {
        cell.value = v === "confirmed" ? "確定" : "下書";
        return;
      }
      if (c.format === "text") {
        cell.value = String(v ?? "");
        return;
      }
      const n = num(v);
      if (c.format === "time") {
        const abs = Math.abs(n);
        const h = Math.floor(abs / 60);
        const m = abs % 60;
        cell.value = `${n < 0 ? "-" : ""}${h}:${String(m).padStart(2, "0")}`;
        cell.alignment = { horizontal: "right" };
        cell.numFmt = "0:00";
        return;
      }
      cell.value = n;
      cell.alignment = { horizontal: "right" };
      if (c.format === "money") cell.numFmt = "#,##0";
    };

    for (const row of rows) {
      COLS.forEach((c, i) => {
        const cell = ws.getCell(rIdx, i + 1);
        cell.font = c.key === "net_amount" ? { ...nFont, bold: true } : nFont;
        writeCell(cell, c, c.value(row));
      });
      rIdx++;
    }

    // 合計行
    COLS.forEach((c, i) => {
      const cell = ws.getCell(rIdx, i + 1);
      cell.font = bFont;
      cell.border = thin;
      cell.fill = totalFill;
      const v = totalOf(c, rows);
      if (v === "" || v == null) { cell.value = null; return; }
      if (isTextCol(c)) { cell.value = String(v); return; }
      cell.alignment = { horizontal: "right" };
      if (c.format === "time") {
        const n = num(v);
        const abs = Math.abs(n);
        const h = Math.floor(abs / 60);
        const m = abs % 60;
        cell.value = `${n < 0 ? "-" : ""}${h}:${String(m).padStart(2, "0")}`;
      } else {
        cell.value = v;
        if (c.format === "money") cell.numFmt = "#,##0";
      }
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ワールドクラブ_給与_${ym}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
          <button onClick={exportExcel} disabled={rows.length === 0} style={{
            padding: "8px 16px", borderRadius: 3, border: `1px solid ${T.border}`,
            backgroundColor: "#fff", color: T.text, fontSize: 13, fontWeight: 700,
            cursor: rows.length === 0 ? "not-allowed" : "pointer",
            opacity: rows.length === 0 ? 0.5 : 1,
          }}>Excel出力</button>
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
                {COLS.map(c => (
                  <th key={c.key} style={{
                    padding: "4px 2px", fontSize: 9, fontWeight: 600,
                    whiteSpace: "normal", wordBreak: "keep-all",
                    lineHeight: 1.15, verticalAlign: "bottom",
                    textAlign: isTextCol(c) ? "left" : "right",
                    backgroundColor: c.headerBg,
                    color: c.headerColor ?? T.text,
                    borderRight: "1px solid #D1D5DB",
                    borderBottom: "2px solid #374151",
                    ...stickyHeader(c),
                  }}>{c.label}</th>
                ))}
                {/* 明細ボタン列 */}
                <th style={{
                  padding: "4px 2px", fontSize: 9, fontWeight: 600,
                  backgroundColor: "#1a4b24", color: "#fff",
                  borderRight: "1px solid #D1D5DB", borderBottom: "2px solid #374151",
                  position: "sticky", right: 52, top: 0, zIndex: 5, minWidth: 52,
                }}></th>
                {/* 送信ボタン列 */}
                <th style={{
                  padding: "4px 2px", fontSize: 9, fontWeight: 600,
                  backgroundColor: "#1a4b24", color: "#fff",
                  borderRight: "1px solid #D1D5DB", borderBottom: "2px solid #374151",
                  position: "sticky", right: 0, top: 0, zIndex: 5, minWidth: 52,
                }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom: "1px solid #9CA3AF" }} className="payroll-row">
                  {COLS.map(c => {
                    const v = c.value(r);
                    const display = fmtDisplay(c, v);
                    const baseStyle: React.CSSProperties = {
                      ...(isTextCol(c) ? tdNarrow : tdNum),
                      ...(c.bodyBg ? { backgroundColor: c.bodyBg } : {}),
                      ...(c.bodyExtra ?? {}),
                      ...stickyBody(c),
                    };

                    // 状態列: 「確定/下書」バッジ
                    if (c.format === "status") {
                      return (
                        <td key={c.key} style={baseStyle}>
                          <span style={{
                            padding: "2px 6px", borderRadius: 10, fontSize: 9, fontWeight: 700, color: "#fff",
                            backgroundColor: r.status === "confirmed" ? T.primary : T.warning,
                          }}>{display}</span>
                        </td>
                      );
                    }

                    // 編集可能列: EditableCell（disabledは中で処理）
                    if (c.editable) {
                      return (
                        <EditableCell
                          key={c.key}
                          value={num(r[c.editable])}
                          display={display}
                          onSave={(n) => updateMonthly(r, c.editable!, n)}
                          baseStyle={baseStyle}
                          step={c.step}
                          disabled={r.status === "confirmed"}
                        />
                      );
                    }

                    // 派生・読取専用列
                    return <td key={c.key} style={baseStyle}>{display}</td>;
                  })}
                  {/* 明細ボタン */}
                  <td style={{ ...tdNarrow, position: "sticky", right: 52, zIndex: 1, backgroundColor: "#fff", minWidth: 52 }}>
                    <button onClick={() => printOne(r)} style={{
                      padding: "4px 8px", borderRadius: 4, border: `1px solid ${T.border}`,
                      backgroundColor: "#fff", color: T.text, fontSize: 10, cursor: "pointer",
                    }}>明細</button>
                  </td>
                  {/* 送信ボタン */}
                  <td style={{ ...tdNarrow, position: "sticky", right: 0, zIndex: 1, backgroundColor: "#fff", minWidth: 52 }}>
                    <button onClick={() => distributeRow(r)} disabled={r.status !== "confirmed"} style={{
                      padding: "4px 8px", borderRadius: 4, border: "none",
                      backgroundColor: r.status === "confirmed" ? T.success : "#D1D5DB",
                      color: "#fff", fontSize: 10, cursor: r.status === "confirmed" ? "pointer" : "not-allowed",
                      opacity: r.status === "confirmed" ? 1 : 0.5,
                    }}>送信</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "3px solid #374151", fontWeight: 700 }}>
                {COLS.map(c => {
                  const v = totalOf(c, rows);
                  const style: React.CSSProperties = {
                    ...tfNum,
                    ...(c.totalBg ? { backgroundColor: c.totalBg } : {}),
                    ...(c.totalExtra ?? {}),
                    ...stickyTotals(c),
                    ...(isTextCol(c) ? { textAlign: "left" } : {}),
                  };
                  if (v === "" || v == null) return <td key={c.key} style={style}></td>;
                  if (isTextCol(c)) return <td key={c.key} style={style}>{String(v)}</td>;
                  return <td key={c.key} style={style}>{fmtDisplay(c, v as number)}</td>;
                })}
                {/* 明細ボタン列（合計行は空） */}
                <td style={{ ...tfNum, position: "sticky", right: 52, zIndex: 4, minWidth: 52 }}></td>
                {/* 送信ボタン列（合計行は空） */}
                <td style={{ ...tfNum, position: "sticky", right: 0, zIndex: 4, minWidth: 52 }}></td>
              </tr>
            </tfoot>
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

  const updateField = async (r: Setting, field: keyof Setting, value: number | null | string | boolean) => {
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
                  "氏名","区分","計算","基本給","固定残業","役職","家族","諸手当","支援金",
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
              {rows.map(r => {
                const rowBg = r.is_calc_target === false ? "#F3F4F6" : "#fff";
                return (
                <tr key={r.id} style={{ borderBottom: "1px solid #9CA3AF" }} className="payroll-row">
                  <td style={{ ...tdStyle, position: "sticky", left: 0, zIndex: 1, backgroundColor: rowBg, minWidth: 72 }}>
                    {r.display_name}
                    {r.is_calc_target === false && <span style={{ display: "block", fontSize: 9, color: "#9CA3AF", lineHeight: 1 }}>計算対象外</span>}
                  </td>
                  <td style={{ ...tdStyle, position: "sticky", left: 72, zIndex: 1, backgroundColor: rowBg, minWidth: 56, boxShadow: "2px 0 4px rgba(0,0,0,0.1)" }}>{r.employment_type}</td>
                  <td style={{ ...tdStyle, textAlign: "center", minWidth: 40 }}>
                    <input type="checkbox" checked={r.is_calc_target !== false} onChange={e => updateField(r, "is_calc_target", e.target.checked)} />
                  </td>
                  <NumCell r={r} field="base_salary" />
                  <NumCell r={r} field="fixed_overtime" />
                  <NumCell r={r} field="position_allowance" />
                  <NumCell r={r} field="family_allowance" />
                  <NumCell r={r} field="other_allowance" />
                  <NumCell r={r} field="child_support_deduction" />
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
              );
              })}
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
    ${row("通勤費（非課税）", yen(r.commute_amount))}
  ` : `
    ${row("基本給", yen(r.base_salary))}
    ${row("固定残業手当", yen(r.fixed_overtime))}
    ${row("役職手当", yen(r.position_allowance))}
    ${row("家族手当", yen(r.family_allowance))}
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
          ${row("子育て支援金", yen(r.child_support_deduction))}
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
