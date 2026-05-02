"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { T } from "@/lib/constants";
import { supabase } from "@/lib/supabase";
import Dialog from "@/components/ui/Dialog";

const COMPANY_ID = "c2d368f0-aa9b-4f70-b082-43ec07723d6c";

type Tab = "calc" | "master";

interface Setting {
  id: string;
  employee_id: string | null;
  display_name: string;
  employment_type: "正社員" | "パート" | "その他";
  base_salary: number; fixed_overtime: number;
  position_allowance: number; family_allowance: number;
  child_support_allowance: number;
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

const yen = (n: number | null | undefined) => (n == null ? "—" : `¥${Math.round(n).toLocaleString("ja-JP")}`);
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
        padding: "0 16px",
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
        let ok = 0, fail = 0;
        for (const r of confirmed) {
          const setting = await supabase.from("wc_payroll_settings").select("employee_id").eq("id", r.payroll_setting_id!).maybeSingle();
          const empId = setting.data?.employee_id;
          if (!empId) { continue; }
          const html = renderPayslipHTML(r);
          const { error } = await supabase.from("documents").insert({
            company_id: COMPANY_ID,
            employee_id: empId,
            title: `給与明細 ${r.target_month}`,
            content: html,
            content_type: "html",
            category: "給与明細",
            issued_at: new Date().toISOString(),
          });
          if (error) fail++; else ok++;
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

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap", padding: "0 16px" }}>
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
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, backgroundColor: "#fff" }}>
            <thead>
              <tr style={{ backgroundColor: T.primary, color: "#fff" }}>
                {[
                  "氏名","状態","出勤日数","労働時間","残業時間","深夜早朝","有給(日)",
                  "平日時間","土日時間","基本給","固定残業手当","役職手当","家族手当","諸手当",
                  "子育て支援金","有給金額","給料計","交通費","非課税","総支給",
                  "課税計","社保","雇保","社保計","所得税","住民税","車","控除計",
                  "扶養","差引支給額",""
                ].map((h, i) => (
                  <th key={i} style={{ padding: "6px 4px", fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", textAlign: i < 2 ? "left" : "right" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                // 派生値（DB不要、既存カラムから算出）
                const salaryTotal     = r.gross_amount - r.commute_amount;       // 給料計
                const nonTaxable      = r.commute_amount;                        // 非課税
                const taxableTotal    = Math.max(0, r.gross_amount - nonTaxable - r.social_insurance - r.employment_insurance); // 課税計
                const insuranceTotal  = r.social_insurance + r.employment_insurance; // 社保計
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={tdNarrow}>{r.display_name}</td>
                    <td style={tdNarrow}>
                      <span style={{
                        padding: "2px 6px", borderRadius: 10, fontSize: 9, fontWeight: 700, color: "#fff",
                        backgroundColor: r.status === "confirmed" ? T.primary : T.warning,
                      }}>{r.status === "confirmed" ? "確定" : "下書"}</span>
                    </td>
                    <td style={tdNum}>{r.worked_days}</td>
                    <td style={tdNum}>{minToHM(r.worked_minutes)}</td>
                    <td style={tdNum}>{minToHM(r.overtime_minutes)}</td>
                    <td style={tdNum}>{minToHM(r.night_minutes)}</td>
                    <td style={tdNum}>{r.paid_leave_days}</td>
                    <td style={tdNum}>{minToHM(r.weekday_minutes)}</td>
                    <td style={tdNum}>{minToHM(r.weekend_minutes)}</td>
                    <td style={tdNum}>{yen(r.base_salary)}</td>
                    <td style={tdNum}>{yen(r.fixed_overtime)}</td>
                    <td style={tdNum}>{yen(r.position_allowance)}</td>
                    <td style={tdNum}>{yen(r.family_allowance)}</td>
                    <td style={tdNum}>{yen(r.other_allowance)}</td>
                    <td style={tdNum}>{yen(r.child_support_allowance)}</td>
                    <td style={tdNum}>{yen(r.paid_leave_amount)}</td>
                    <td style={{ ...tdNum, fontWeight: 600 }}>{yen(salaryTotal)}</td>
                    <td style={tdNum}>{yen(r.commute_amount)}</td>
                    <td style={tdNum}>{yen(nonTaxable)}</td>
                    <td style={{ ...tdNum, fontWeight: 600 }}>{yen(r.gross_amount)}</td>
                    <td style={tdNum}>{yen(taxableTotal)}</td>
                    <td style={tdNum}>{yen(r.social_insurance)}</td>
                    <td style={tdNum}>{yen(r.employment_insurance)}</td>
                    <td style={{ ...tdNum, fontWeight: 600 }}>{yen(insuranceTotal)}</td>
                    <td style={tdNum}>{yen(r.income_tax)}</td>
                    <td style={tdNum}>{yen(r.resident_tax)}</td>
                    <td style={tdNum}>{yen(r.car_deduction)}</td>
                    <td style={{ ...tdNum, color: T.danger, fontWeight: 600 }}>{yen(r.total_deduction)}</td>
                    <td style={tdNum}>{r.dependents}</td>
                    <td style={{ ...tdNum, fontWeight: 700, color: T.primary }}>{yen(r.net_amount)}</td>
                    <td style={tdNarrow}>
                      <button onClick={() => printOne(r)} style={{
                        padding: "4px 8px", borderRadius: 4, border: `1px solid ${T.border}`,
                        backgroundColor: "#fff", color: T.text, fontSize: 10, cursor: "pointer",
                      }}>明細</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
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
    </div>
  );
}

/* ═══════════════ マスタ編集ビュー ═══════════════ */
function MasterView({ employee: _employee }: { employee: any }) {
  const [rows, setRows] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Setting | null>(null);
  const [saving, setSaving] = useState(false);
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

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const { error } = await supabase.from("wc_payroll_settings").update({
      base_salary: editing.base_salary,
      fixed_overtime: editing.fixed_overtime,
      position_allowance: editing.position_allowance,
      family_allowance: editing.family_allowance,
      child_support_allowance: editing.child_support_allowance,
      car_deduction: editing.car_deduction,
      resident_tax: editing.resident_tax,
      hourly_weekday: editing.hourly_weekday,
      hourly_weekend: editing.hourly_weekend,
      scheduled_end_time: editing.scheduled_end_time || null,
      scheduled_minutes: editing.scheduled_minutes,
      break_minutes_fixed: editing.break_minutes_fixed,
      social_insurance: editing.social_insurance,
      commute_per_day: editing.commute_per_day,
      dependents: editing.dependents,
      updated_at: new Date().toISOString(),
    }).eq("id", editing.id);
    setSaving(false);
    if (error) { setDialog({ message: "保存失敗: " + error.message }); return; }
    setEditing(null); load();
  };

  const N = (val: number, set: (n: number) => void) => (
    <input type="number" value={val ?? 0} onChange={e => set(parseInt(e.target.value || "0", 10))}
      style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: `1px solid ${T.border}`, fontSize: 14 }} />
  );

  return (
    <div>
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textSec }}>読み込み中...</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, backgroundColor: "#fff" }}>
            <thead>
              <tr style={{ backgroundColor: T.primary, color: "#fff" }}>
                {["氏名", "区分", "基本給/平日", "土日/役職", "固定残業", "家族", "支援金", "社保", "住民税", "車", "交通費", "扶養", ""].map((h, i) => (
                  <th key={i} style={{ padding: "8px 6px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={tdStyle}>{r.display_name}</td>
                  <td style={tdStyle}>{r.employment_type}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {r.employment_type === "パート" ? `${r.hourly_weekday}/h` : yen(r.base_salary)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {r.employment_type === "パート" ? `${r.hourly_weekend}/h` : yen(r.position_allowance)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{yen(r.fixed_overtime)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{yen(r.family_allowance)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{yen(r.child_support_allowance)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{yen(r.social_insurance)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{yen(r.resident_tax)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{yen(r.car_deduction)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{yen(r.commute_per_day)}/日</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{r.dependents}</td>
                  <td style={tdStyle}>
                    <button onClick={() => setEditing({ ...r })} style={{
                      padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.primary}`,
                      backgroundColor: "#fff", color: T.primary, fontSize: 11, cursor: "pointer",
                    }}>編集</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }} onClick={() => setEditing(null)}>
          <div style={{ backgroundColor: "#fff", borderRadius: 8, padding: 20, width: "100%", maxWidth: 480, maxHeight: "90vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>{editing.display_name} の給与マスタ</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
              {editing.employment_type === "正社員" ? (
                <>
                  <Field label="基本給">{N(editing.base_salary, n => setEditing({ ...editing, base_salary: n }))}</Field>
                  <Field label="固定残業手当">{N(editing.fixed_overtime, n => setEditing({ ...editing, fixed_overtime: n }))}</Field>
                  <Field label="役職手当">{N(editing.position_allowance, n => setEditing({ ...editing, position_allowance: n }))}</Field>
                  <Field label="家族手当">{N(editing.family_allowance, n => setEditing({ ...editing, family_allowance: n }))}</Field>
                  <Field label="子育て支援金">{N(editing.child_support_allowance, n => setEditing({ ...editing, child_support_allowance: n }))}</Field>
                  <Field label="車（控除）">{N(editing.car_deduction, n => setEditing({ ...editing, car_deduction: n }))}</Field>
                  <Field label="住民税">{N(editing.resident_tax, n => setEditing({ ...editing, resident_tax: n }))}</Field>
                </>
              ) : (
                <>
                  <Field label="平日時給">{N(editing.hourly_weekday, n => setEditing({ ...editing, hourly_weekday: n }))}</Field>
                  <Field label="土日時給">{N(editing.hourly_weekend, n => setEditing({ ...editing, hourly_weekend: n }))}</Field>
                  <Field label="所定終業 (HH:MM)">
                    <input type="time" value={editing.scheduled_end_time?.slice(0, 5) || ""} onChange={e => setEditing({ ...editing, scheduled_end_time: e.target.value })}
                      style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: `1px solid ${T.border}`, fontSize: 14 }} />
                  </Field>
                  <Field label="所定労働(分)">{N(editing.scheduled_minutes, n => setEditing({ ...editing, scheduled_minutes: n }))}</Field>
                  <Field label="休憩固定(分/NULL可)">
                    <input type="number" value={editing.break_minutes_fixed ?? ""} onChange={e => setEditing({ ...editing, break_minutes_fixed: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                      placeholder="未指定=申告制" style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: `1px solid ${T.border}`, fontSize: 14 }} />
                  </Field>
                  <Field label="役職手当">{N(editing.position_allowance, n => setEditing({ ...editing, position_allowance: n }))}</Field>
                  <Field label="家族手当">{N(editing.family_allowance, n => setEditing({ ...editing, family_allowance: n }))}</Field>
                  <Field label="子育て支援金">{N(editing.child_support_allowance, n => setEditing({ ...editing, child_support_allowance: n }))}</Field>
                </>
              )}
              <Field label="社会保険">{N(editing.social_insurance, n => setEditing({ ...editing, social_insurance: n }))}</Field>
              <Field label="交通費(日額)">{N(editing.commute_per_day, n => setEditing({ ...editing, commute_per_day: n }))}</Field>
              <Field label="扶養人数">{N(editing.dependents, n => setEditing({ ...editing, dependents: n }))}</Field>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setEditing(null)} style={{ flex: 1, padding: 10, borderRadius: 4, border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.textSec, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>キャンセル</button>
              <button onClick={save} disabled={saving} style={{ flex: 1, padding: 10, borderRadius: 4, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{saving ? "保存中..." : "保存"}</button>
            </div>
          </div>
        </div>
      )}

      {dialog && <Dialog message={dialog.message} mode="alert" onOk={() => setDialog(null)} onCancel={() => setDialog(null)} />}
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div style={{ fontSize: 11, color: T.textSec, marginBottom: 3 }}>{label}</div>
    {children}
  </div>
);

const navBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: "50%", border: `1px solid ${T.border}`,
  backgroundColor: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700,
};
const tdStyle: React.CSSProperties = {
  padding: "8px 6px", fontSize: 12, color: T.text, whiteSpace: "nowrap",
};
const tdNarrow: React.CSSProperties = {
  padding: "4px 4px", fontSize: 11, color: T.text, whiteSpace: "nowrap",
};
const tdNum: React.CSSProperties = {
  padding: "4px 4px", fontSize: 11, color: T.text, whiteSpace: "nowrap", textAlign: "right",
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
