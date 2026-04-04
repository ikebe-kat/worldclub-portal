"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { T, displayReason, displayChipLabel, isKoukyuPart } from "@/lib/constants";
import { Badge, ReasonBadges } from "@/components/ui";
import Dialog from "@/components/ui/Dialog";
import { supabase } from "@/lib/supabase";
import { getPermLevel, canEditPunch } from "@/lib/permissions";
import NotificationsSub from "@/components/tabs/NotificationsSub";
import PaidLeaveSub from "@/components/tabs/PaidLeaveSub";
import SharoushiSub from "@/components/tabs/SharoushiSub";
import EmployeeManageSub from "@/components/tabs/EmployeeManageSub";
import SettingsSub from "@/components/tabs/SettingsSub";

interface EmpOption { id: string; code: string; name: string; store_id: string; store_name: string; department: string | null; role: string | null; hire_date: string | null; paid_leave_grant_date: string | null; holiday_calendar: string | null; }
interface AttRow { id: string; attendance_date: string; day_of_week: string | null; punch_in: string | null; punch_out: string | null; reason: string | null; break_minutes: number | null; late_minutes: number | null; early_leave_minutes: number | null; actual_hours: number | null; scheduled_hours: number | null; overtime_hours: number | null; over_under: number | null; employee_note: string | null; admin_memo: string | null; is_holiday: boolean | null; work_pattern_code: string | null; }

type SubTab = "notifications" | "paidleave" | "sharoushi" | "individual" | "daily" | "monthly" | "requests" | "documents" | "employee_manage" | "settings";
const ALL_SUB_TABS: { id: SubTab; label: string; visibleTo: "owner_only" | "super_only" | "all" }[] = [
  { id: "notifications", label: "お知らせ", visibleTo: "owner_or_kondo" },
  { id: "paidleave", label: "有給管理", visibleTo: "owner_or_kondo" },
  { id: "sharoushi", label: "社労士出力", visibleTo: "owner_only" },
  { id: "individual", label: "個人出勤簿", visibleTo: "all" },
  { id: "daily", label: "日次一覧", visibleTo: "all" },
  { id: "monthly", label: "月次サマリ", visibleTo: "all" },
  { id: "requests", label: "申請管理", visibleTo: "super_only" },
  { id: "documents", label: "書類配布", visibleTo: "super_only" },
  { id: "employee_manage", label: "従業員管理", visibleTo: "super_only" },
  { id: "settings", label: "設定", visibleTo: "owner_only" },
];
const OWNER_CODES = ["W02", "W67"];
const SUPER_CODES = ["W02", "W49", "W67"];

const DOW = ["日","月","火","水","木","金","土"];
const fmTime = (t: string | null) => t ? t.slice(0,5) : "—";
const fmHours = (n: number) => { const h = Math.floor(Math.abs(n) / 60); const m = Math.abs(n) % 60; return `${n < 0 ? "-" : ""}${h}:${String(Math.round(m)).padStart(2,"0")}`; };
const fmDecimal = (n: number | null) => { if (n == null) return "—"; const tot = Math.round(Math.abs(n) * 60); const h = Math.floor(tot / 60); const m = tot % 60; return `${n < 0 ? "-" : ""}${h}:${String(m).padStart(2,"0")}`; };

function storeShort(name: string | null, dept?: string | null) {
  if (dept && ["人事", "経理", "DX", "人事総務"].some(d => dept.includes(d))) return "業務部";
  if (!name) return "—";
  if (name.includes("八代")) return "八代";
  if (name.includes("健軍")) return "健軍";
  if (name.includes("大津") || name.includes("菊陽")) return "大津";
  if (name.includes("本社") || name.includes("経理") || name.includes("人事") || name.includes("DX")) return "業務部";
  if (name.includes("御領")) return "御領";
  return name;
}

const HAMAMURA_CODE = "095";
function matchStoreFilter(emp: EmpOption, filter: string): boolean {
  if (filter === "all") return true;
  if (emp.code === HAMAMURA_CODE) return filter === "業務部" || filter === "健軍";
  return storeShort(emp.store_name, emp.department) === filter;
}

const STORE_FILTER_OPTIONS = [
  { value: "all", label: "全店舗" },
  { value: "八代", label: "八代" },
  { value: "大津", label: "大津" },
  { value: "健軍", label: "健軍" },
  { value: "業務部", label: "業務部" },
  { value: "御領", label: "御領" },
];

/* ── 4桁時間入力コンポーネント ── */
const TimeInput = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => {
  const [raw, setRaw] = useState("");
  useEffect(() => {
    if (value && value.includes(":")) {
      setRaw(value.replace(":", ""));
    } else {
      setRaw(value || "");
    }
  }, []);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
    setRaw(v);
    if (v.length === 4) {
      const hh = v.slice(0, 2);
      const mm = v.slice(2, 4);
      if (parseInt(hh) <= 23 && parseInt(mm) <= 59) {
        onChange(`${hh}:${mm}`);
      }
    } else if (v.length === 0) {
      onChange("");
    }
  };
  const display = raw.length >= 3 ? raw.slice(0, 2) + ":" + raw.slice(2) : raw;
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 3 }}>{label}</label>
      <input
        type="text" inputMode="numeric" placeholder="0930"
        value={display}
        onChange={handleChange}
        style={{ width: "100%", padding: "9px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 16, boxSizing: "border-box", fontFamily: "inherit", fontVariantNumeric: "tabular-nums", letterSpacing: 1 }}
      />
    </div>
  );
};

/* ── チップ ── */
const Chip = ({ label, selected, color, onClick }: { label: string; selected: boolean; color: string; onClick: () => void }) => (
  <button onClick={onClick} style={{
    padding: "10px 4px", borderRadius: 6, fontSize: 12, fontWeight: selected ? 600 : 400, cursor: "pointer",
    border: selected ? `2px solid ${color}` : `1px solid ${T.border}`,
    backgroundColor: selected ? color + "18" : "#fff",
    color: selected ? color : T.text, transition: "all 0.15s", whiteSpace: "nowrap",
  }}>{label}</button>
);
const Dot = ({ color, label }: { color: string; label: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
    <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: color }} />
    <span style={{ fontSize: 13, fontWeight: 600, color: T.textSec }}>{label}</span>
  </div>
);
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: 10 }}>
    <label style={{ fontSize: 11, color: T.textSec, display: "block", marginBottom: 3 }}>{label}</label>
    {children}
  </div>
);

/* ── 代休パーサー ── */
function parseDaikyu(reason: string): { type: "full" | "am" | "pm"; date: string } | null {
  const mFull = reason.match(/^代休(?:（(\d{4}\/\d{2}\/\d{2})分）)?$/);
  if (mFull) return { type: "full", date: mFull[1]?.replace(/\//g, "-") ?? "" };
  const mAm = reason.match(/^午前代休(?:（(\d{4}\/\d{2}\/\d{2})分）)?$/);
  if (mAm) return { type: "am", date: mAm[1]?.replace(/\//g, "-") ?? "" };
  const mPm = reason.match(/^午後代休(?:（(\d{4}\/\d{2}\/\d{2})分）)?$/);
  if (mPm) return { type: "pm", date: mPm[1]?.replace(/\//g, "-") ?? "" };
  return null;
}

/* ══════════════════════════════════════ */
/* ── 編集モーダル（チップ選択式）── */
/* ══════════════════════════════════════ */
interface EditModalProps { row: AttRow; empName: string; empCode: string; onClose: () => void; onSave: (updated: any) => void; }
const EditModal = ({ row, empName, empCode, onClose, onSave }: EditModalProps) => {
  const [punchIn, setPunchIn] = useState(row.punch_in?.slice(0,5) || "");
  const [punchOut, setPunchOut] = useState(row.punch_out?.slice(0,5) || "");
  const [note, setNote] = useState(row.employee_note || "");
  const [memo, setMemo] = useState(row.admin_memo || "");
  const [saving, setSaving] = useState(false);

  const [selZenjitsu, setSelZenjitsu] = useState<string | null>(null);
  const [selGozen, setSelGozen] = useState<string | null>(null);
  const [selGogo, setSelGogo] = useState<string | null>(null);
  const [selKinmu, setSelKinmu] = useState<string[]>([]);

  const [shucchoOpen, setShucchoOpen] = useState(false);
  const [shucchoWhere, setShucchoWhere] = useState("");
  const [shucchoFrom, setShucchoFrom] = useState(row.attendance_date);
  const [shucchoTo, setShucchoTo] = useState(row.attendance_date);

  const [daikyuMode, setDaikyuMode] = useState<"none" | "full" | "half">("none");
  const [daikyuHalf, setDaikyuHalf] = useState<"am" | "pm" | null>(null);
  const [daikyuDate, setDaikyuDate] = useState("");

  useEffect(() => {
    if (!row.reason) return;
    const parts = row.reason.split("+").map((s: string) => s.trim());
    const kinmuBuf: string[] = [];
    for (const p of parts) {
      if (p === "有給（全日）" || p === "希望休（全日）") { setSelZenjitsu(p); continue; }
      if (p === "午前有給" || p === "午前希望休") { setSelGozen(p); continue; }
      if (p === "午後有給" || p === "午後希望休") { setSelGogo(p); continue; }
      const dk = parseDaikyu(p);
      if (dk) {
        if (dk.type === "full") { setDaikyuMode("full"); setDaikyuDate(dk.date); }
        else { setDaikyuMode("half"); setDaikyuHalf(dk.type); setDaikyuDate(dk.date); }
        continue;
      }
      if (p === "出張" || p.startsWith("出張（")) {
        setShucchoOpen(true);
        const wm = p.match(/出張（(.+)）/);
        if (wm) setShucchoWhere(wm[1]);
        kinmuBuf.push("出張");
        continue;
      }
      kinmuBuf.push(p);
    }
    setSelKinmu(kinmuBuf);
  }, []);

  const toggleZenjitsu = (v: string) => { if (selZenjitsu === v) { setSelZenjitsu(null); return; } setSelZenjitsu(v); setSelGozen(null); setSelGogo(null); setDaikyuMode("none"); setDaikyuHalf(null); setDaikyuDate(""); };
  const toggleGozen = (v: string) => { if (selGozen === v) { setSelGozen(null); return; } setSelGozen(v); setSelZenjitsu(null); };
  const toggleGogo = (v: string) => { if (selGogo === v) { setSelGogo(null); return; } setSelGogo(v); setSelZenjitsu(null); };
  const toggleKinmu = (v: string) => {
    if (v === "出張") { if (selKinmu.includes("出張")) { setSelKinmu(prev => prev.filter(x => x !== "出張")); setShucchoOpen(false); } else { setSelKinmu(prev => [...prev, "出張"]); setShucchoOpen(true); } return; }
    if (v === "代休") { if (daikyuMode === "full") { setDaikyuMode("none"); setDaikyuDate(""); } else { setDaikyuMode("full"); setDaikyuHalf(null); setSelZenjitsu(null); setSelGozen(null); setSelGogo(null); } return; }
    if (v === "半日代休") { if (daikyuMode === "half") { setDaikyuMode("none"); setDaikyuHalf(null); setDaikyuDate(""); } else { setDaikyuMode("half"); setDaikyuHalf(null); setSelZenjitsu(null); } return; }
    setSelKinmu(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  };

  const previewReason = useMemo(() => {
    const parts: string[] = [];
    if (selZenjitsu) parts.push(selZenjitsu);
    if (selGozen) parts.push(selGozen);
    if (selGogo) parts.push(selGogo);
    if (daikyuMode === "full") { const ds = daikyuDate ? `（${daikyuDate.replace(/-/g, "/")}分）` : ""; parts.push(`代休${ds}`); }
    else if (daikyuMode === "half" && daikyuHalf) { const ds = daikyuDate ? `（${daikyuDate.replace(/-/g, "/")}分）` : ""; parts.push(`${daikyuHalf === "am" ? "午前" : "午後"}代休${ds}`); }
    for (const k of selKinmu) { if (k === "代休" || k === "半日代休") continue; if (k === "出張") { parts.push(shucchoWhere ? "出張（" + shucchoWhere + "）" : "出張"); continue; } parts.push(k); }
    return parts.length > 0 ? parts.join("+") : null;
  }, [selZenjitsu, selGozen, selGogo, selKinmu, daikyuMode, daikyuHalf, daikyuDate, shucchoWhere]);

  const d = new Date(row.attendance_date);
  const dateLabel = `${d.getMonth()+1}/${d.getDate()}（${DOW[d.getDay()]}）`;
  const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" };

  const handleSave = async () => {
    const yukyuDays = (selZenjitsu === "有給（全日）" ? 1 : 0) + (selGozen === "午前有給" ? 0.5 : 0) + (selGogo === "午後有給" ? 0.5 : 0);
    if (yukyuDays > 0) {
      let empId: string | null = null;
      if (row.id.startsWith("empty-")) {
        const { data: empRow } = await supabase.from("employees").select("id").eq("employee_code", empCode).maybeSingle();
        empId = empRow?.id || null;
      } else {
        const { data: attRow } = await supabase.from("attendance_daily").select("employee_id").eq("id", row.id).maybeSingle();
        empId = attRow?.employee_id || null;
      }
      if (empId) {
        const { data: grants } = await supabase.from("paid_leave_grants").select("remaining_days").eq("employee_id", empId).gt("remaining_days", 0);
        const totalRemaining = (grants || []).reduce((s: number, g: any) => s + Number(g.remaining_days), 0);
        if (totalRemaining < yukyuDays) { alert(`有給残が不足しています（残: ${totalRemaining}日）`); return; }
      }
    }
    /* 希望休上限チェック */
    const kibouDays = (selZenjitsu === "希望休（全日）" ? 1 : 0) + (selGozen === "午前希望休" ? 0.5 : 0) + (selGogo === "午後希望休" ? 0.5 : 0);
    if (kibouDays > 0) {
      const { data: empRow } = await supabase.from("employees").select("holiday_pattern, employee_code").eq("employee_code", empCode).maybeSingle();
      if (empRow && empRow.holiday_pattern && !isKoukyuPart(empRow.employee_code)) {
        const currentMonth = new Date(row.attendance_date).getMonth() + 1;
        const { data: quotaRow } = await supabase.from("hope_holiday_quotas").select("quota").eq("pattern_name", empRow.holiday_pattern).eq("month", currentMonth).maybeSingle();
        const quota = quotaRow?.quota ? Number(quotaRow.quota) : 0;
        if (quota > 0) {
          let empId: string | null = null;
          if (row.id.startsWith("empty-")) {
            const { data: eRow } = await supabase.from("employees").select("id").eq("employee_code", empCode).maybeSingle();
            empId = eRow?.id || null;
          } else {
            const { data: attRow } = await supabase.from("attendance_daily").select("employee_id").eq("id", row.id).maybeSingle();
            empId = attRow?.employee_id || null;
          }
          if (empId) {
            const startDate = `${row.attendance_date.slice(0,4)}-${row.attendance_date.slice(5,7)}-01`;
            const endDay = new Date(Number(row.attendance_date.slice(0,4)), Number(row.attendance_date.slice(5,7)), 0).getDate();
            const endDate = `${row.attendance_date.slice(0,4)}-${row.attendance_date.slice(5,7)}-${String(endDay).padStart(2,"0")}`;
            const { data: attRows } = await supabase.from("attendance_daily").select("reason, attendance_date").eq("employee_id", empId).gte("attendance_date", startDate).lte("attendance_date", endDate);
            const usedKibou = (attRows || []).reduce((s: number, r: any) => {
              if (r.attendance_date === row.attendance_date) return s;
              if (!r.reason) return s;
              if (r.reason.includes("希望休（全日）")) return s + 1;
              if (r.reason.includes("午前希望休") || r.reason.includes("午後希望休")) return s + 0.5;
              return s;
            }, 0);
            const remaining = quota - usedKibou;
            if (remaining < kibouDays) { alert(`希望休の上限に達しています（残: ${remaining}日 / 上限: ${quota}日）`); return; }
          }
        }
      }
    }
    setSaving(true);
    const toRaw = (time: string | null, dateStr: string) => {
      if (!time) return null;
      const [hh, mm] = time.split(":");
      const utcH = parseInt(hh) - 9;
      return `${dateStr}T${String(utcH < 0 ? utcH + 24 : utcH).padStart(2,"0")}:${mm}:00+00`;
    };
    onSave({
      punch_in: punchIn || null,
      punch_out: punchOut || null,
      punch_in_raw: toRaw(punchIn || null, row.attendance_date),
      punch_out_raw: toRaw(punchOut || null, row.attendance_date),
      reason: previewReason || null,
      employee_note: note || null,
      admin_memo: memo || null,
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1100, animation: "fadeIn 0.15s ease" }} onClick={onClose}>
      <div style={{ backgroundColor: "#fff", borderRadius: "12px 12px 0 0", padding: "20px", width: "100%", maxWidth: 440, maxHeight: "85vh", overflowY: "auto", animation: "slideUp 0.3s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border, margin: "0 auto 12px" }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>{empName} — {dateLabel}</div>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16 }}>打刻修正・事由変更</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <TimeInput label="出勤" value={punchIn} onChange={setPunchIn} />
          <TimeInput label="退勤" value={punchOut} onChange={setPunchOut} />
        </div>

        <div style={{ padding: "10px 14px", borderRadius: 6, backgroundColor: previewReason ? "#ECFDF5" : T.bg, marginBottom: 16, minHeight: 36, display: "flex", alignItems: "center" }}>
          {previewReason ? <ReasonBadges reason={previewReason} /> : <span style={{ fontSize: 13, color: T.textMuted }}>事由なし</span>}
        </div>

        <Dot color={T.holidayRed} label="休暇" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <Chip label="有給（全日）" selected={selZenjitsu === "有給（全日）"} color={T.yukyuBlue} onClick={() => toggleZenjitsu("有給（全日）")} />
          <Chip label={displayChipLabel("希望休（全日）", empCode)} selected={selZenjitsu === "希望休（全日）"} color={T.kibouYellow} onClick={() => toggleZenjitsu("希望休（全日）")} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <Chip label="午前有給" selected={selGozen === "午前有給"} color={T.yukyuBlue} onClick={() => toggleGozen("午前有給")} />
          <Chip label={displayChipLabel("午前希望休", empCode)} selected={selGozen === "午前希望休"} color={T.kibouYellow} onClick={() => toggleGozen("午前希望休")} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          <Chip label="午後有給" selected={selGogo === "午後有給"} color={T.yukyuBlue} onClick={() => toggleGogo("午後有給")} />
          <Chip label={displayChipLabel("午後希望休", empCode)} selected={selGogo === "午後希望休"} color={T.kibouYellow} onClick={() => toggleGogo("午後希望休")} />
        </div>

        <Dot color={T.kinmuGreen} label="勤務申請" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
          {["出張", "休日出勤", "代休", "半日代休", "遅刻", "早退", "欠勤"].map(k => (
            <Chip key={k} label={k}
              selected={k === "代休" ? daikyuMode === "full" : k === "半日代休" ? daikyuMode === "half" : selKinmu.includes(k)}
              color={T.kinmuGreen} onClick={() => toggleKinmu(k)} />
          ))}
        </div>

        {shucchoOpen && (
          <div style={{ padding: 14, borderRadius: 6, border: `1px solid ${T.kinmuGreen}`, backgroundColor: "#F0FFF4", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.kinmuGreen, marginBottom: 10 }}>出張の詳細</div>
            <Field label="行先（任意）"><input type="text" value={shucchoWhere} onChange={e => setShucchoWhere(e.target.value)} placeholder="例：東京、大阪" style={inputStyle} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field label="開始日"><input type="date" value={shucchoFrom} onChange={e => setShucchoFrom(e.target.value)} style={inputStyle} /></Field>
              <Field label="終了日"><input type="date" value={shucchoTo} onChange={e => setShucchoTo(e.target.value)} style={inputStyle} /></Field>
            </div>
          </div>
        )}

        {daikyuMode === "full" && (
          <div style={{ padding: 14, borderRadius: 6, border: `1px solid ${T.kinmuGreen}`, backgroundColor: "#F0FFF4", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.kinmuGreen, marginBottom: 10 }}>代休の対象日（休日出勤した日）</div>
            <Field label="対象日"><input type="date" value={daikyuDate} onChange={e => setDaikyuDate(e.target.value)} style={inputStyle} /></Field>
          </div>
        )}
        {daikyuMode === "half" && (
          <div style={{ padding: 14, borderRadius: 6, border: `1px solid ${T.kinmuGreen}`, backgroundColor: "#F0FFF4", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.kinmuGreen, marginBottom: 10 }}>半日代休の詳細</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <Chip label="午前代休" selected={daikyuHalf === "am"} color={T.kinmuGreen} onClick={() => setDaikyuHalf(daikyuHalf === "am" ? null : "am")} />
              <Chip label="午後代休" selected={daikyuHalf === "pm"} color={T.kinmuGreen} onClick={() => setDaikyuHalf(daikyuHalf === "pm" ? null : "pm")} />
            </div>
            <Field label="対象日（休日出勤した日）"><input type="date" value={daikyuDate} onChange={e => setDaikyuDate(e.target.value)} style={inputStyle} /></Field>
          </div>
        )}

        <Field label="従業員メモ"><input type="text" value={note} onChange={e => setNote(e.target.value)} style={inputStyle} /></Field>
        <Field label="管理者メモ"><input type="text" value={memo} onChange={e => setMemo(e.target.value)} style={inputStyle} /></Field>

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.textSec, fontSize: 14, cursor: "pointer" }}>キャンセル</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: "12px", borderRadius: 6, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 14, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "保存中..." : "保存"}</button>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════ */
/* ── 個人出勤簿サブタブ ── */
/* ══════════════════════════════════════ */
const IndividualSub = ({ employee }: { employee: any }) => {
  const perm = getPermLevel(employee?.role || null);
  const isSuper = perm === "super";
  const myCode = employee?.employee_code || "";
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [emps, setEmps] = useState<EmpOption[]>([]);
  const [storeFilter, setStoreFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedEmp, setSelectedEmp] = useState<EmpOption | null>(null);
  const [yr, setYr] = useState(new Date().getFullYear());
  const [mo, setMo] = useState(new Date().getMonth() + 1);
  const [rows, setRows] = useState<AttRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editRow, setEditRow] = useState<AttRow | null>(null);
  const [dialogMsg, setDialogMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!employee?.company_id) return;
    (async () => {
      const { data: sd } = await supabase.from("stores").select("id, store_name").eq("company_id", employee.company_id);
      const storeList = (sd || []).map((s: any) => ({ id: s.id, name: s.store_name || "" }));
      setStores(storeList);
      const storeMap: Record<string, string> = {};
      storeList.forEach((s: { id: string; name: string }) => { storeMap[s.id] = s.name; });
      const { data: ed } = await supabase.from("employees").select("id, employee_code, full_name, store_id, department, role, hire_date, paid_leave_grant_date, holiday_calendar").eq("company_id", employee.company_id).order("employee_code");
      setEmps((ed || []).filter((e: any) => !["W02","W49","W67"].includes(e.employee_code)).map((e: any) => ({ ...e, code: e.employee_code, name: e.full_name, store_name: storeMap[e.store_id] || "" })));
    })();
  }, [employee?.company_id]);

  const filteredEmps = useMemo(() => {
    let list = emps;
    if (perm === "admin") list = list.filter(e => canEditPunch(myCode, e.store_id, e.department));
    if (storeFilter !== "all") list = list.filter(e => matchStoreFilter(e, storeFilter));
    if (search) list = list.filter(e => e.name.includes(search) || e.code.includes(search));
    return list;
  }, [emps, storeFilter, search, perm, myCode]);

  const fetchAttendance = useCallback(async (empId: string) => {
    setLoading(true);
    const startDate = `${yr}-${String(mo).padStart(2,"0")}-01`;
    const endDay = new Date(yr, mo, 0).getDate();
    const endDate = `${yr}-${String(mo).padStart(2,"0")}-${String(endDay).padStart(2,"0")}`;

    const emp = emps.find(e => e.id === empId);
    const calType = emp?.holiday_calendar || null;
    let holidaySet = new Set<string>();
    if (calType) {
      const { data: hcData } = await supabase
        .from("holiday_calendars")
        .select("holiday_date")
        .eq("company_id", employee.company_id)
        .eq("calendar_type", calType)
        .gte("holiday_date", startDate)
        .lte("holiday_date", endDate);
      (hcData || []).forEach((h: any) => { holidaySet.add(h.holiday_date); });
    }

    const { data } = await supabase.from("attendance_daily").select("*").eq("employee_id", empId).gte("attendance_date", startDate).lte("attendance_date", endDate).order("attendance_date");
    const dataMap: Record<string, AttRow> = {};
    (data || []).forEach((r: any) => { dataMap[r.attendance_date] = r; });
    const allDays: AttRow[] = [];
    for (let d = 1; d <= endDay; d++) {
      const dateStr = `${yr}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const isHoliday = holidaySet.has(dateStr);
      if (dataMap[dateStr]) {
        const existing = dataMap[dateStr];
        if (existing.is_holiday == null && isHoliday) {
          allDays.push({ ...existing, is_holiday: true });
        } else {
          allDays.push(existing);
        }
      }
      else { allDays.push({ id: `empty-${d}`, attendance_date: dateStr, day_of_week: null, punch_in: null, punch_out: null, reason: null, break_minutes: null, late_minutes: null, early_leave_minutes: null, actual_hours: null, scheduled_hours: null, overtime_hours: null, over_under: null, employee_note: null, admin_memo: null, is_holiday: isHoliday || null, work_pattern_code: null }); }
    }
    setRows(allDays);
    setLoading(false);
  }, [yr, mo, emps, employee?.company_id]);

  useEffect(() => { if (filteredEmps.length === 1 && filteredEmps[0].id !== selectedEmp?.id) setSelectedEmp(filteredEmps[0]); }, [filteredEmps]);
  useEffect(() => { if (selectedEmp) fetchAttendance(selectedEmp.id); }, [selectedEmp, yr, mo, fetchAttendance]);

  const goMonth = (dir: number) => { let ny = yr, nm = mo + dir; if (nm > 12) { nm = 1; ny++; } else if (nm < 1) { nm = 12; ny--; } setYr(ny); setMo(nm); };

  const handleSave = async (updated: any) => {
    if (!editRow || !selectedEmp) return;
    if (editRow.id.startsWith("empty-")) {
      const { error } = await supabase.from("attendance_daily").upsert({
        employee_id: selectedEmp.id, company_id: employee.company_id,
        attendance_date: editRow.attendance_date,
        day_of_week: DOW[new Date(editRow.attendance_date).getDay()],
        punch_in: updated.punch_in, punch_out: updated.punch_out,
        punch_in_raw: updated.punch_in_raw, punch_out_raw: updated.punch_out_raw,
        reason: updated.reason, employee_note: updated.employee_note,
        admin_memo: updated.admin_memo, updated_at: new Date().toISOString(),
      }, { onConflict: "employee_id,attendance_date" });
      if (error) { setDialogMsg("保存に失敗しました"); } else { setDialogMsg("保存しました"); fetchAttendance(selectedEmp.id); }
    } else {
      const { error } = await supabase.from("attendance_daily").update({
        punch_in: updated.punch_in, punch_out: updated.punch_out,
        punch_in_raw: updated.punch_in_raw, punch_out_raw: updated.punch_out_raw,
        reason: updated.reason, employee_note: updated.employee_note,
        admin_memo: updated.admin_memo, updated_at: new Date().toISOString(),
      }).eq("id", editRow.id);
      if (error) { setDialogMsg("保存に失敗しました"); } else { setDialogMsg("保存しました"); fetchAttendance(selectedEmp.id); }
    }
    setEditRow(null);
  };

  const summary = useMemo(() => {
    let workDays = 0, holidays = 0, yukyuDays = 0, absentDays = 0, totalMinutes = 0, scheduledMinutes = 0, lateCount = 0, earlyCount = 0;
    rows.forEach(r => {
      if (r.is_holiday || r.reason === "公休") { holidays++; return; }
      if (r.reason?.includes("有給（全日）")) { yukyuDays++; return; }
      if (r.reason?.includes("午前有給") || r.reason?.includes("午後有給")) yukyuDays += 0.5;
      if (r.reason?.includes("希望休（全日）")) return;
      if (r.reason === "欠勤") { absentDays++; return; }
      if (r.actual_hours != null) { totalMinutes += Math.round(r.actual_hours * 60); workDays++; }
      if (r.scheduled_hours != null) scheduledMinutes += Math.round(r.scheduled_hours * 60);
      if (r.late_minutes && r.late_minutes > 0) lateCount++;
      if (r.early_leave_minutes && r.early_leave_minutes > 0) earlyCount++;
    });
    return { workDays, holidays, yukyuDays, absentDays, totalMinutes, scheduledMinutes, lateCount, earlyCount, diff: totalMinutes - scheduledMinutes };
  }, [rows]);

  const SC = ({ l, v, u, c }: { l: string; v: string | number; u?: string; c?: string }) => (<div style={{ backgroundColor: "#fff", padding: "10px 6px", borderRadius: 6, border: `1px solid ${T.border}`, textAlign: "center" }}><div style={{ fontSize: 10, color: T.textSec, marginBottom: 2 }}>{l}</div><div style={{ fontSize: 18, fontWeight: 700, color: c || T.text, fontVariantNumeric: "tabular-nums" }}>{v}{u && <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 1 }}>{u}</span>}</div></div>);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} style={{ padding: "9px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12, color: T.textSec }}>{STORE_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select value={selectedEmp?.id || ""} onChange={e => { const emp = emps.find(x => x.id === e.target.value); setSelectedEmp(emp || null); }} style={{ flex: 1, padding: "9px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, minWidth: 140 }}><option value="">従業員を選択</option>{filteredEmps.map(e => <option key={e.id} value={e.id}>{e.code} {e.name}</option>)}</select>
        <input type="text" placeholder="名前/CDで検索" value={search} onChange={e => setSearch(e.target.value)} style={{ padding: "9px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, width: 130 }} />
      </div>
      {!selectedEmp ? (<div style={{ textAlign: "center", padding: "60px 20px", color: T.textMuted }}><div style={{ fontSize: 24, marginBottom: 8 }}>👤</div><div style={{ fontSize: 14 }}>従業員を選択してください</div></div>) : (<>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{selectedEmp.name}</div>
            <div style={{ fontSize: 12, color: T.textSec }}>{storeShort(selectedEmp.store_name)} ・ {selectedEmp.department || "—"}</div>
            {isSuper && selectedEmp.hire_date && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>入社日: {selectedEmp.hire_date}</div>}
            {isSuper && selectedEmp.paid_leave_grant_date && <div style={{ fontSize: 11, color: T.yukyuBlue, marginTop: 1 }}>有給発生日: {selectedEmp.paid_leave_grant_date}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => goMonth(-1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: 6, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>◀</button>
            <span style={{ fontSize: 15, fontWeight: 700, color: T.text, minWidth: 80, textAlign: "center" }}>{yr}年{mo}月</span>
            <button onClick={() => goMonth(1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: 6, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>▶</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 10 }}><SC l="出勤" v={summary.workDays} u="日" c={T.primary} /><SC l="休日" v={summary.holidays} u="日" /><SC l="有給" v={summary.yukyuDays} u="日" c={T.yukyuBlue} /><SC l="欠勤" v={summary.absentDays} u="日" c={summary.absentDays > 0 ? T.danger : T.textMuted} /><SC l="遅刻" v={summary.lateCount} u="回" c={summary.lateCount > 0 ? T.warning : T.textMuted} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 16 }}><SC l="総労働" v={fmHours(summary.totalMinutes)} c={T.text} /><SC l="所定" v={fmHours(summary.scheduledMinutes)} c={T.text} /><SC l="所定外" v={`${summary.diff > 0 ? "+" : ""}${fmHours(summary.diff)}`} c={summary.diff > 0 ? T.success : summary.diff < 0 ? T.danger : T.textMuted} /></div>
        {loading ? (<div style={{ textAlign: "center", padding: "40px", color: T.textMuted, fontSize: 14 }}>読み込み中...</div>) : (
          <div style={{ borderRadius: 6, border: `1px solid ${T.border}`, overflow: "hidden" }}><div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 640 }}>
              <thead><tr style={{ backgroundColor: T.primary }}>{["日付","出勤","退勤","事由","実労働","所定外","備考",""].map(h => <th key={h} style={{ padding: "8px 6px", color: "#fff", fontWeight: 600, fontSize: 11, textAlign: "center", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>{rows.map(r => { const d = new Date(r.attendance_date); const dow = d.getDay(); const isOff = r.is_holiday || r.reason === "公休"; const hasReason = r.reason && r.reason !== "公休"; return (
                <tr key={r.id} style={{ backgroundColor: isOff ? "#FFF5F5" : hasReason ? "#FFFDE7" : "#fff", borderBottom: `1px solid ${T.borderLight}` }}>
                  <td style={{ padding: "8px 6px", fontWeight: 600, color: dow === 0 ? T.holidayRed : dow === 6 ? T.yukyuBlue : T.text, textAlign: "center", whiteSpace: "nowrap" }}>{d.getDate()}<span style={{ fontSize: 10, marginLeft: 1, fontWeight: 400 }}>({DOW[dow]})</span></td>
                  <td style={{ padding: "8px 6px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.punch_in ? T.text : T.textPH }}>{fmTime(r.punch_in)}</td>
                  <td style={{ padding: "8px 6px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.punch_out ? T.text : T.textPH }}>{fmTime(r.punch_out)}</td>
                  <td style={{ padding: "6px", textAlign: "center" }}>{r.reason ? <ReasonBadges reason={displayReason(r.reason, (r as any).emp_code || "") || r.reason} /> : r.is_holiday ? <ReasonBadges reason="休日" /> : "—"}</td>
                  <td style={{ padding: "8px 6px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.actual_hours != null ? T.text : T.textPH }}>{r.actual_hours != null ? fmDecimal(r.actual_hours) : "—"}</td>
                  <td style={{ padding: "8px 6px", textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: (r.over_under ?? 0) > 0 ? T.success : (r.over_under ?? 0) < 0 ? T.danger : T.textMuted }}>{r.over_under != null ? `${r.over_under > 0 ? "+" : ""}${fmDecimal(r.over_under)}` : "—"}</td>
                  <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 11, color: T.textSec, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.employee_note || r.admin_memo || "—"}</td>
                  <td style={{ padding: "6px", textAlign: "center" }}><button onClick={() => setEditRow(r)} style={{ padding: "5px 10px", borderRadius: 4, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>修正</button></td>
                </tr>); })}
                {rows.length === 0 && <tr><td colSpan={8} style={{ padding: "30px", textAlign: "center", color: T.textMuted, fontSize: 13 }}>データがありません</td></tr>}
              </tbody>
            </table>
          </div></div>
        )}
      </>)}
      {editRow && selectedEmp && <EditModal row={editRow} empName={selectedEmp.name} empCode={selectedEmp.code} onClose={() => setEditRow(null)} onSave={handleSave} />}
      {dialogMsg && <Dialog message={dialogMsg} onOk={() => setDialogMsg(null)} />}
      <style>{`@keyframes slideUp{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
    </div>
  );
};

/* ══════════════════════════════════════ */
/* ── 一斉編集モーダル ── */
/* ══════════════════════════════════════ */
interface BulkEditModalProps {
  checkedRows: (AttRow & { emp_code: string; emp_name: string; store_name: string })[];
  emps: EmpOption[];
  employee: any;
  selectedDate: string;
  selDow: number;
  onClose: () => void;
  onSaved: () => void;
}
const BulkEditModal = ({ checkedRows, emps, employee, selectedDate, selDow, onClose, onSaved }: BulkEditModalProps) => {
  const [bulkPunchIn, setBulkPunchIn] = useState("");
  const [bulkPunchOut, setBulkPunchOut] = useState("");
  const [bulkMemo, setBulkMemo] = useState("");
  const [saving, setSaving] = useState(false);

  const [selZenjitsu, setSelZenjitsu] = useState<string | null>(null);
  const [selGozen, setSelGozen] = useState<string | null>(null);
  const [selGogo, setSelGogo] = useState<string | null>(null);
  const [selKinmu, setSelKinmu] = useState<string[]>([]);
  const [shucchoOpen, setShucchoOpen] = useState(false);
  const [shucchoWhere, setShucchoWhere] = useState("");

  const toggleZenjitsu = (v: string) => { if (selZenjitsu === v) { setSelZenjitsu(null); return; } setSelZenjitsu(v); setSelGozen(null); setSelGogo(null); };
  const toggleGozen = (v: string) => { if (selGozen === v) { setSelGozen(null); return; } setSelGozen(v); setSelZenjitsu(null); };
  const toggleGogo = (v: string) => { if (selGogo === v) { setSelGogo(null); return; } setSelGogo(v); setSelZenjitsu(null); };
  const toggleKinmu = (v: string) => {
    if (v === "出張") { if (selKinmu.includes("出張")) { setSelKinmu(prev => prev.filter(x => x !== "出張")); setShucchoOpen(false); } else { setSelKinmu(prev => [...prev, "出張"]); setShucchoOpen(true); } return; }
    setSelKinmu(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  };

  const previewReason = useMemo(() => {
    const parts: string[] = [];
    if (selZenjitsu) parts.push(selZenjitsu);
    if (selGozen) parts.push(selGozen);
    if (selGogo) parts.push(selGogo);
    for (const k of selKinmu) { if (k === "出張") { parts.push(shucchoWhere ? "出張（" + shucchoWhere + "）" : "出張"); continue; } parts.push(k); }
    return parts.length > 0 ? parts.join("+") : null;
  }, [selZenjitsu, selGozen, selGogo, selKinmu, shucchoWhere]);

  const hasAnyInput = bulkPunchIn || bulkPunchOut || previewReason !== null || bulkMemo;

  const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" };

  const handleBulkSave = async () => {
    setSaving(true);
    const promises: Promise<any>[] = [];
    for (const row of checkedRows) {
      const empObj = emps.find(e => e.code === row.emp_code);
      const payload: any = { updated_at: new Date().toISOString() };
      if (bulkPunchIn) payload.punch_in = bulkPunchIn;
      if (bulkPunchOut) payload.punch_out = bulkPunchOut;
      if (previewReason !== null) payload.reason = previewReason || null;
      if (bulkMemo) payload.admin_memo = bulkMemo;

      if (row.id.startsWith("empty-")) {
        const empId = empObj?.id || row.id.replace("empty-", "");
        promises.push(supabase.from("attendance_daily").upsert({
          employee_id: empId, company_id: employee.company_id,
          attendance_date: selectedDate, day_of_week: DOW[selDow],
          ...payload,
        }, { onConflict: "employee_id,attendance_date" }));
      } else {
        promises.push(supabase.from("attendance_daily").update(payload).eq("id", row.id));
      }
    }
    await Promise.all(promises);
    setSaving(false);
    onSaved();
  };

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1100, animation: "fadeIn 0.15s ease" }} onClick={onClose}>
      <div style={{ backgroundColor: "#fff", borderRadius: "12px 12px 0 0", padding: "20px", width: "100%", maxWidth: 440, maxHeight: "85vh", overflowY: "auto", animation: "slideUp 0.3s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border, margin: "0 auto 12px" }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>一斉編集（{checkedRows.length}名）</div>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8, maxHeight: 40, overflow: "hidden", textOverflow: "ellipsis" }}>{checkedRows.map(r => r.emp_name).join("、")}</div>
        <div style={{ fontSize: 11, color: T.warning, marginBottom: 16, padding: "8px 10px", backgroundColor: "#FFFDE7", borderRadius: 6 }}>⚠ 入力した項目のみ上書きされます。空欄の項目は変更されません。</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <TimeInput label="出勤" value={bulkPunchIn} onChange={setBulkPunchIn} />
          <TimeInput label="退勤" value={bulkPunchOut} onChange={setBulkPunchOut} />
        </div>

        <div style={{ padding: "10px 14px", borderRadius: 6, backgroundColor: previewReason ? "#ECFDF5" : T.bg, marginBottom: 16, minHeight: 36, display: "flex", alignItems: "center" }}>
          {previewReason ? <ReasonBadges reason={previewReason} /> : <span style={{ fontSize: 13, color: T.textMuted }}>事由なし（変更しない）</span>}
        </div>

        <Dot color={T.holidayRed} label="休暇" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <Chip label="有給（全日）" selected={selZenjitsu === "有給（全日）"} color={T.yukyuBlue} onClick={() => toggleZenjitsu("有給（全日）")} />
          <Chip label="希望休（全日）" selected={selZenjitsu === "希望休（全日）"} color={T.kibouYellow} onClick={() => toggleZenjitsu("希望休（全日）")} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <Chip label="午前有給" selected={selGozen === "午前有給"} color={T.yukyuBlue} onClick={() => toggleGozen("午前有給")} />
          <Chip label="午前希望休" selected={selGozen === "午前希望休"} color={T.kibouYellow} onClick={() => toggleGozen("午前希望休")} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          <Chip label="午後有給" selected={selGogo === "午後有給"} color={T.yukyuBlue} onClick={() => toggleGogo("午後有給")} />
          <Chip label="午後希望休" selected={selGogo === "午後希望休"} color={T.kibouYellow} onClick={() => toggleGogo("午後希望休")} />
        </div>

        <Dot color={T.kinmuGreen} label="勤務申請" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
          {["出張", "休日出勤", "遅刻", "早退", "欠勤"].map(k => (
            <Chip key={k} label={k} selected={selKinmu.includes(k)} color={T.kinmuGreen} onClick={() => toggleKinmu(k)} />
          ))}
        </div>
        {shucchoOpen && (
          <div style={{ padding: 14, borderRadius: 6, border: `1px solid ${T.kinmuGreen}`, backgroundColor: "#F0FFF4", marginBottom: 12 }}>
            <Field label="行先（任意）"><input type="text" value={shucchoWhere} onChange={e => setShucchoWhere(e.target.value)} placeholder="例：東京" style={inputStyle} /></Field>
          </div>
        )}

        <Field label="管理者メモ"><input type="text" value={bulkMemo} onChange={e => setBulkMemo(e.target.value)} placeholder="一斉編集メモ" style={inputStyle} /></Field>

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.textSec, fontSize: 14, cursor: "pointer" }}>キャンセル</button>
          <button onClick={handleBulkSave} disabled={saving || !hasAnyInput} style={{ flex: 1, padding: "12px", borderRadius: 6, border: "none", backgroundColor: hasAnyInput ? T.primary : T.border, color: hasAnyInput ? "#fff" : T.textMuted, fontSize: 14, fontWeight: 600, cursor: saving || !hasAnyInput ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "保存中..." : `${checkedRows.length}名に適用`}</button>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════ */
/* ── 日次一覧サブタブ ── */
/* ══════════════════════════════════════ */
interface DailyRow extends AttRow { emp_code: string; emp_name: string; store_name: string; }

const DailySub = ({ employee }: { employee: any }) => {
  const perm = getPermLevel(employee?.role || null);
  const myCode = employee?.employee_code || "";
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [storeFilter, setStoreFilter] = useState("all");
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [emps, setEmps] = useState<EmpOption[]>([]);
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editRow, setEditRow] = useState<DailyRow | null>(null);
  const [editEmpName, setEditEmpName] = useState("");
  const [dialogMsg, setDialogMsg] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);

  useEffect(() => {
    if (!employee?.company_id) return;
    (async () => {
      const { data: sd } = await supabase.from("stores").select("id, store_name").eq("company_id", employee.company_id);
      const storeList = (sd || []).map((s: any) => ({ id: s.id, name: s.store_name || "" }));
      setStores(storeList);
      const storeMap: Record<string, string> = {};
      storeList.forEach((s: { id: string; name: string }) => { storeMap[s.id] = s.name; });
      const { data: ed } = await supabase.from("employees").select("id, employee_code, full_name, store_id, department, role, hire_date, paid_leave_grant_date, holiday_calendar").eq("company_id", employee.company_id).order("employee_code");
      setEmps((ed || []).filter((e: any) => !["W02","W49","W67"].includes(e.employee_code)).map((e: any) => ({ ...e, code: e.employee_code, name: e.full_name, store_name: storeMap[e.store_id] || "" })));
    })();
  }, [employee?.company_id]);

  const fetchDaily = useCallback(async () => {
    if (!selectedDate || emps.length === 0) return;
    setLoading(true);
    let scopedEmps = emps;
    if (perm === "admin") scopedEmps = emps.filter(e => canEditPunch(myCode, e.store_id, e.department));
    if (storeFilter !== "all") scopedEmps = scopedEmps.filter(e => matchStoreFilter(e, storeFilter));
    const empIds = scopedEmps.map(e => e.id);
    const empMap: Record<string, EmpOption> = {};
    scopedEmps.forEach(e => { empMap[e.id] = e; });

    const calTypes = [...new Set(scopedEmps.map(e => e.holiday_calendar).filter(Boolean))] as string[];
    const holidayByCalType: Record<string, boolean> = {};
    if (calTypes.length > 0) {
      const { data: hcData } = await supabase
        .from("holiday_calendars")
        .select("calendar_type")
        .eq("company_id", employee.company_id)
        .eq("holiday_date", selectedDate)
        .in("calendar_type", calTypes);
      (hcData || []).forEach((h: any) => { holidayByCalType[h.calendar_type] = true; });
    }

    const { data } = await supabase.from("attendance_daily").select("*").eq("attendance_date", selectedDate).in("employee_id", empIds).order("employee_id");
    const attMap: Record<string, AttRow> = {};
    (data || []).forEach((r: any) => { attMap[r.employee_id] = r; });
    const allRows: DailyRow[] = scopedEmps.map(emp => {
      const isHoliday = emp.holiday_calendar ? (holidayByCalType[emp.holiday_calendar] || false) : false;
      const att = attMap[emp.id];
      if (att) {
        const row: DailyRow = { ...att, emp_code: emp.code, emp_name: emp.name, store_name: emp.store_name };
        if (row.is_holiday == null && isHoliday) row.is_holiday = true;
        return row;
      }
      return { id: `empty-${emp.id}`, attendance_date: selectedDate, day_of_week: null, punch_in: null, punch_out: null, reason: null, break_minutes: null, late_minutes: null, early_leave_minutes: null, actual_hours: null, scheduled_hours: null, overtime_hours: null, over_under: null, employee_note: null, admin_memo: null, is_holiday: isHoliday || null, work_pattern_code: null, emp_code: emp.code, emp_name: emp.name, store_name: emp.store_name };
    });
    setRows(allRows);
    setLoading(false);
  }, [selectedDate, emps, storeFilter, perm, myCode, employee?.company_id]);

  useEffect(() => { if (emps.length > 0) fetchDaily(); }, [fetchDaily, emps]);

  const goDay = (dir: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + dir);
    setSelectedDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
  };
  const selDate = new Date(selectedDate);
  const selDow = selDate.getDay();
  const dateDisplay = `${selDate.getFullYear()}年${selDate.getMonth()+1}月${selDate.getDate()}日（${DOW[selDow]}）`;

  const summary = useMemo(() => {
    let total = rows.length, punched = 0, noPunch = 0, onLeave = 0, absent = 0;
    rows.forEach(r => {
      if (r.is_holiday) return;
      if (r.reason?.includes("有給") || r.reason?.includes("希望休") || r.reason?.includes("代休")) { onLeave++; return; }
      if (r.reason === "欠勤") { absent++; return; }
      if (r.punch_in && r.punch_out) { punched++; return; }
      if (!r.punch_in && !r.punch_out && !r.reason) { noPunch++; }
    });
    return { total, punched, noPunch, onLeave, absent };
  }, [rows]);

  const handleSave = async (updated: any) => {
    if (!editRow) return;
    const empObj = emps.find(e => e.code === editRow.emp_code);
    if (editRow.id.startsWith("empty-")) {
      const empId = empObj?.id || editRow.id.replace("empty-", "");
      const { error } = await supabase.from("attendance_daily").upsert({
        employee_id: empId, company_id: employee.company_id,
        attendance_date: selectedDate, day_of_week: DOW[selDow],
        punch_in: updated.punch_in, punch_out: updated.punch_out,
        punch_in_raw: updated.punch_in_raw, punch_out_raw: updated.punch_out_raw,
        reason: updated.reason, employee_note: updated.employee_note,
        admin_memo: updated.admin_memo, updated_at: new Date().toISOString(),
      }, { onConflict: "employee_id,attendance_date" });
      if (error) { setDialogMsg("保存に失敗しました"); } else { setDialogMsg("保存しました"); fetchDaily(); }
    } else {
      const { error } = await supabase.from("attendance_daily").update({
        punch_in: updated.punch_in, punch_out: updated.punch_out,
        punch_in_raw: updated.punch_in_raw, punch_out_raw: updated.punch_out_raw,
        reason: updated.reason, employee_note: updated.employee_note,
        admin_memo: updated.admin_memo, updated_at: new Date().toISOString(),
      }).eq("id", editRow.id);
      if (error) { setDialogMsg("保存に失敗しました"); } else { setDialogMsg("保存しました"); fetchDaily(); }
    }
    setEditRow(null);
  };

  const SC2 = ({ l, v, c }: { l: string; v: number; c?: string }) => (<div style={{ backgroundColor: "#fff", padding: "8px 4px", borderRadius: 6, border: `1px solid ${T.border}`, textAlign: "center" }}><div style={{ fontSize: 10, color: T.textSec, marginBottom: 2 }}>{l}</div><div style={{ fontSize: 18, fontWeight: 700, color: c || T.text }}>{v}<span style={{ fontSize: 10, fontWeight: 400 }}>人</span></div></div>);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => goDay(-1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: 6, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>◀</button>
        <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13 }} />
        <button onClick={() => goDay(1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: 6, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>▶</button>
        <button onClick={() => setSelectedDate(todayStr)} style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff", cursor: "pointer", fontSize: 12, color: T.primary, fontWeight: 600 }}>今日</button>
        <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12, color: T.textSec }}>{STORE_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <button onClick={() => { setSelectMode(!selectMode); setCheckedIds(new Set()); }} style={{ padding: "8px 12px", borderRadius: 6, border: selectMode ? `2px solid ${T.primary}` : `1px solid ${T.border}`, backgroundColor: selectMode ? T.primary + "15" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, color: selectMode ? T.primary : T.textSec }}>{selectMode ? "選択解除" : "選択"}</button>
      </div>
      {selectMode && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setCheckedIds(new Set(rows.map(r => r.id)))} style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff", cursor: "pointer", fontSize: 11, color: T.textSec }}>全選択</button>
          <button onClick={() => setCheckedIds(new Set())} style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff", cursor: "pointer", fontSize: 11, color: T.textSec }}>全解除</button>
          <span style={{ fontSize: 12, color: T.textSec }}>{checkedIds.size}名選択中</span>
          {checkedIds.size > 0 && <button onClick={() => setShowBulkModal(true)} style={{ padding: "8px 16px", borderRadius: 6, border: "none", backgroundColor: T.primary, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, marginLeft: "auto" }}>一斉編集</button>}
        </div>
      )}
      <div style={{ fontSize: 15, fontWeight: 700, color: selDow === 0 ? T.holidayRed : selDow === 6 ? T.yukyuBlue : T.text, marginBottom: 12 }}>{dateDisplay}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 16 }}>
        <SC2 l="対象" v={summary.total} c={T.primary} />
        <SC2 l="出勤済" v={summary.punched} c={T.success} />
        <SC2 l="未打刻" v={summary.noPunch} c={summary.noPunch > 0 ? T.warning : T.textMuted} />
        <SC2 l="休暇" v={summary.onLeave} c={T.yukyuBlue} />
        <SC2 l="欠勤" v={summary.absent} c={summary.absent > 0 ? T.danger : T.textMuted} />
      </div>
      {loading ? (<div style={{ textAlign: "center", padding: "40px", color: T.textMuted, fontSize: 14 }}>読み込み中...</div>) : (
        <div style={{ borderRadius: 6, border: `1px solid ${T.border}`, overflow: "hidden" }}><div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 700 }}>
            <thead><tr style={{ backgroundColor: T.primary }}>{[...(selectMode ? ["✓"] : []), "店舗","CD","氏名","出勤","退勤","事由","実労働","所定外","備考",""].map(h => <th key={h} style={{ padding: "8px 6px", color: "#fff", fontWeight: 600, fontSize: 11, textAlign: "center", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => {
              const isOff = r.reason?.includes("希望休") || r.reason?.includes("代休") || r.is_holiday;
              const isYukyu = r.reason?.includes("有給");
              const hasReason = r.reason && r.reason !== "公休";
              return (
                <tr key={r.id} style={{ backgroundColor: isOff ? "#FFF5F5" : isYukyu ? "#EFF6FF" : hasReason ? "#FFFDE7" : "#fff", borderBottom: `1px solid ${T.borderLight}` }}>
                  {selectMode && <td style={{ padding: "7px 4px", textAlign: "center" }}><input type="checkbox" checked={checkedIds.has(r.id)} onChange={e => { const next = new Set(checkedIds); if (e.target.checked) next.add(r.id); else next.delete(r.id); setCheckedIds(next); }} style={{ width: 16, height: 16, cursor: "pointer" }} /></td>}
                  <td style={{ padding: "7px 6px", fontSize: 11, color: T.textSec, textAlign: "center", whiteSpace: "nowrap" }}>{storeShort(r.store_name)}</td>
                  <td style={{ padding: "7px 6px", fontSize: 11, color: T.textMuted, textAlign: "center" }}>{r.emp_code}</td>
                  <td style={{ padding: "7px 6px", fontWeight: 600, color: T.text, whiteSpace: "nowrap" }}>{r.emp_name}</td>
                  <td style={{ padding: "7px 6px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.punch_in ? T.text : T.textPH }}>{fmTime(r.punch_in)}</td>
                  <td style={{ padding: "7px 6px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.punch_out ? T.text : T.textPH }}>{fmTime(r.punch_out)}</td>
                  <td style={{ padding: "5px", textAlign: "center" }}>{r.reason ? <ReasonBadges reason={displayReason(r.reason, (r as any).emp_code || "") || r.reason} /> : r.is_holiday ? <ReasonBadges reason="休日" /> : "—"}</td>
                  <td style={{ padding: "7px 6px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.actual_hours != null ? T.text : T.textPH }}>{r.actual_hours != null ? fmDecimal(r.actual_hours) : "—"}</td>
                  <td style={{ padding: "7px 6px", textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: (r.over_under ?? 0) > 0 ? T.success : (r.over_under ?? 0) < 0 ? T.danger : T.textMuted }}>{r.over_under != null ? `${r.over_under > 0 ? "+" : ""}${fmDecimal(r.over_under)}` : "—"}</td>
                  <td style={{ padding: "7px 6px", textAlign: "center", fontSize: 11, color: T.textSec, maxWidth: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.employee_note || r.admin_memo || "—"}</td>
                  <td style={{ padding: "5px", textAlign: "center" }}><button onClick={() => { setEditRow(r); setEditEmpName(r.emp_name); }} style={{ padding: "5px 10px", borderRadius: 4, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>修正</button></td>
                </tr>);
            })}
            {rows.length === 0 && <tr><td colSpan={selectMode ? 11 : 10} style={{ padding: "30px", textAlign: "center", color: T.textMuted, fontSize: 13 }}>データがありません</td></tr>}
            </tbody>
          </table>
        </div></div>
      )}
      {editRow && <EditModal row={editRow} empName={editEmpName} empCode={(editRow as any).emp_code || ""} onClose={() => setEditRow(null)} onSave={handleSave} />}
      {showBulkModal && <BulkEditModal
        checkedRows={rows.filter(r => checkedIds.has(r.id))}
        emps={emps}
        employee={employee}
        selectedDate={selectedDate}
        selDow={selDow}
        onClose={() => setShowBulkModal(false)}
        onSaved={() => { setShowBulkModal(false); setSelectMode(false); setCheckedIds(new Set()); fetchDaily(); setDialogMsg("一斉編集を保存しました"); }}
      />}
      {dialogMsg && <Dialog message={dialogMsg} onOk={() => setDialogMsg(null)} />}
      <style>{`@keyframes slideUp{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
    </div>
  );
};

/* ══════════════════════════════════════ */
/* ── 月次サマリサブタブ ── */
/* ══════════════════════════════════════ */
interface MonthlyRow {
  emp_code: string; emp_name: string; store_name: string;
  workDays: number; holidays: number; kibouDays: number; absences: number; yukyuDays: number;
  totalMin: number; scheduledMin: number; diffMin: number; overtimeMin: number;
  lateCount: number; earlyCount: number;
}

const MonthlySub = ({ employee }: { employee: any }) => {
  const perm = getPermLevel(employee?.role || null);
  const myCode = employee?.employee_code || "";
  const now = new Date();
  const [yr, setYr] = useState(now.getFullYear());
  const [mo, setMo] = useState(now.getMonth() + 1);
  const [storeFilter, setStoreFilter] = useState("all");
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [emps, setEmps] = useState<EmpOption[]>([]);
  const [rows, setRows] = useState<MonthlyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [varHours, setVarHours] = useState(0);

  useEffect(() => {
    if (!employee?.company_id) return;
    (async () => {
      const { data: sd } = await supabase.from("stores").select("id, store_name").eq("company_id", employee.company_id);
      const storeList = (sd || []).map((s: any) => ({ id: s.id, name: s.store_name || "" }));
      setStores(storeList);
      const storeMap: Record<string, string> = {};
      storeList.forEach((s: { id: string; name: string }) => { storeMap[s.id] = s.name; });
      const { data: ed } = await supabase.from("employees").select("id, employee_code, full_name, store_id, department, role, hire_date, paid_leave_grant_date, holiday_calendar").eq("company_id", employee.company_id).order("employee_code");
      setEmps((ed || []).filter((e: any) => !["W02","W49","W67"].includes(e.employee_code)).map((e: any) => ({ ...e, code: e.employee_code, name: e.full_name, store_name: storeMap[e.store_id] || "" })));
    })();
  }, [employee?.company_id]);

  const goMonth = (dir: number) => { let ny = yr, nm = mo + dir; if (nm > 12) { nm = 1; ny++; } else if (nm < 1) { nm = 12; ny--; } setYr(ny); setMo(nm); };

  const fetchMonthly = useCallback(async () => {
    if (emps.length === 0) return;
    setLoading(true);
    const startDate = `${yr}-${String(mo).padStart(2,"0")}-01`;
    const endDay = new Date(yr, mo, 0).getDate();
    const endDate = `${yr}-${String(mo).padStart(2,"0")}-${String(endDay).padStart(2,"0")}`;
    const yearMonth = `${yr}/${String(mo).padStart(2,"0")}`;

    let scopedEmps = emps;
    if (perm === "admin") scopedEmps = emps.filter(e => canEditPunch(myCode, e.store_id, e.department));
    if (storeFilter !== "all") scopedEmps = scopedEmps.filter(e => matchStoreFilter(e, storeFilter));

    const empIds = scopedEmps.map(e => e.id);
    const empMap: Record<string, EmpOption> = {};
    scopedEmps.forEach(e => { empMap[e.id] = e; });

    const calTypes = [...new Set(scopedEmps.map(e => e.holiday_calendar).filter(Boolean))] as string[];
    const holidayCountByCalType: Record<string, number> = {};
    if (calTypes.length > 0) {
      const { data: hcData } = await supabase
        .from("holiday_calendars")
        .select("calendar_type, holiday_date")
        .eq("company_id", employee.company_id)
        .gte("holiday_date", startDate)
        .lte("holiday_date", endDate)
        .in("calendar_type", calTypes);
      (hcData || []).forEach((h: any) => {
        holidayCountByCalType[h.calendar_type] = (holidayCountByCalType[h.calendar_type] || 0) + 1;
      });
    }

    const { data: attData } = await supabase.from("attendance_daily").select("employee_id, reason, actual_hours, scheduled_hours, overtime_hours, over_under, late_minutes, early_leave_minutes, is_holiday")
      .gte("attendance_date", startDate).lte("attendance_date", endDate).in("employee_id", empIds);

    const { data: varData } = await supabase.from("variable_hours").select("scheduled_hours")
      .eq("company_id", employee.company_id).eq("year_month", yearMonth).limit(1).maybeSingle();
    const monthScheduled = varData?.scheduled_hours ? Math.round(Number(varData.scheduled_hours) * 60) : 0;
    setVarHours(monthScheduled);

    const grouped: Record<string, any[]> = {};
    (attData || []).forEach((r: any) => {
      if (!grouped[r.employee_id]) grouped[r.employee_id] = [];
      grouped[r.employee_id].push(r);
    });

    const result: MonthlyRow[] = scopedEmps.map(emp => {
      const recs = grouped[emp.id] || [];
      let workDays = 0, kibouDays = 0, absences = 0, yukyuDays = 0;
      let totalMin = 0, overtimeMin = 0, lateCount = 0, earlyCount = 0;

      const holidays = emp.holiday_calendar ? (holidayCountByCalType[emp.holiday_calendar] || 0) : 0;

      recs.forEach((r: any) => {
        if (r.is_holiday || r.reason === "公休") { return; }
        if (r.reason?.includes("有給（全日）")) { yukyuDays++; }
        else if (r.reason?.includes("午前有給") || r.reason?.includes("午後有給")) { yukyuDays += 0.5; }
        if (r.reason?.includes("希望休（全日）")) { kibouDays++; return; }
        if (r.reason?.includes("午前希望休") || r.reason?.includes("午後希望休")) { kibouDays += 0.5; }
        if (r.reason === "欠勤") { absences++; return; }
        if (r.actual_hours != null && r.actual_hours > 0) workDays++;
        if (r.actual_hours != null) totalMin += Math.round(Number(r.actual_hours) * 60);
        if (r.overtime_hours != null) overtimeMin += Math.round(Number(r.overtime_hours) * 60);
        if (r.late_minutes && r.late_minutes > 0) lateCount++;
        if (r.early_leave_minutes && r.early_leave_minutes > 0) earlyCount++;
      });

      return {
        emp_code: emp.code, emp_name: emp.name, store_name: emp.store_name,
        workDays, holidays, kibouDays, absences, yukyuDays, totalMin,
        scheduledMin: monthScheduled, diffMin: totalMin - monthScheduled,
        overtimeMin, lateCount, earlyCount,
      };
    });

    setRows(result);
    setLoading(false);
  }, [yr, mo, emps, storeFilter, perm, myCode, employee?.company_id]);

  useEffect(() => { if (emps.length > 0) fetchMonthly(); }, [fetchMonthly, emps]);

  const totals = useMemo(() => {
    let tw = 0, ot = 0, wd = 0, kb = 0, ab = 0, yu = 0, la = 0, ea = 0;
    rows.forEach(r => { tw += r.totalMin; ot += r.overtimeMin; wd += r.workDays; kb += r.kibouDays; ab += r.absences; yu += r.yukyuDays; la += r.lateCount; ea += r.earlyCount; });
    return { tw, ot, wd, kb, ab, yu, la, ea, count: rows.length };
  }, [rows]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => goMonth(-1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: 6, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>◀</button>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.text, minWidth: 90, textAlign: "center" }}>{yr}年{mo}月</span>
        <button onClick={() => goMonth(1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: 6, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>▶</button>
        <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12, color: T.textSec }}>{STORE_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <div style={{ marginLeft: "auto", fontSize: 12, color: T.textSec }}>変形月所定: <strong style={{ color: T.text }}>{fmHours(varHours)}</strong></div>
      </div>

      {loading ? (<div style={{ textAlign: "center", padding: "40px", color: T.textMuted, fontSize: 14 }}>読み込み中...</div>) : (
        <div style={{ borderRadius: 6, border: `1px solid ${T.border}`, overflow: "hidden" }}><div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 860 }}>
            <thead><tr style={{ backgroundColor: T.primary }}>{["店舗","CD","氏名","出勤","休日","希望休","欠勤","有給","総労働","月所定","所定外","残業","遅刻","早退"].map(h => <th key={h} style={{ padding: "8px 5px", color: "#fff", fontWeight: 600, fontSize: 11, textAlign: "center", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.emp_code} style={{ borderBottom: `1px solid ${T.borderLight}`, backgroundColor: r.absences > 0 ? "#FFF5F5" : "#fff" }}>
                  <td style={{ padding: "7px 5px", fontSize: 11, color: T.textSec, textAlign: "center", whiteSpace: "nowrap" }}>{storeShort(r.store_name)}</td>
                  <td style={{ padding: "7px 5px", fontSize: 11, color: T.textMuted, textAlign: "center" }}>{r.emp_code}</td>
                  <td style={{ padding: "7px 5px", fontWeight: 600, color: T.text, whiteSpace: "nowrap" }}>{r.emp_name}</td>
                  <td style={{ padding: "7px 5px", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{r.workDays}</td>
                  <td style={{ padding: "7px 5px", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{r.holidays}</td>
                  <td style={{ padding: "7px 5px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.kibouDays > 0 ? T.kibouYellow : T.textMuted }}>{r.kibouDays}</td>
                  <td style={{ padding: "7px 5px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.absences > 0 ? T.danger : T.textMuted, fontWeight: r.absences > 0 ? 600 : 400 }}>{r.absences}</td>
                  <td style={{ padding: "7px 5px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.yukyuDays > 0 ? T.yukyuBlue : T.textMuted }}>{r.yukyuDays}</td>
                  <td style={{ padding: "7px 5px", textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmHours(r.totalMin)}</td>
                  <td style={{ padding: "7px 5px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: T.textSec }}>{fmHours(r.scheduledMin)}</td>
                  <td style={{ padding: "7px 5px", textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: r.overtimeMin > 0 ? T.success : T.textMuted }}>{r.overtimeMin > 0 ? fmHours(r.overtimeMin) : "0:00"}</td>
                  <td style={{ padding: "7px 5px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.overtimeMin > 0 ? T.warning : T.textMuted }}>{r.overtimeMin > 0 ? fmHours(r.overtimeMin) : "—"}</td>
                  <td style={{ padding: "7px 5px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.lateCount > 0 ? T.warning : T.textMuted }}>{r.lateCount}</td>
                  <td style={{ padding: "7px 5px", textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.earlyCount > 0 ? T.warning : T.textMuted }}>{r.earlyCount}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr style={{ backgroundColor: "#F8FAFC", borderTop: `2px solid ${T.border}`, fontWeight: 700 }}>
                  <td colSpan={3} style={{ padding: "8px 5px", textAlign: "center", fontSize: 11, color: T.textSec }}>合計（{totals.count}名）</td>
                  <td style={{ padding: "8px 5px", textAlign: "center", fontSize: 11 }}>{totals.wd}</td>
                  <td style={{ padding: "8px 5px", textAlign: "center", fontSize: 11 }}>—</td>
                  <td style={{ padding: "8px 5px", textAlign: "center", fontSize: 11, color: T.kibouYellow }}>{totals.kb}</td>
                  <td style={{ padding: "8px 5px", textAlign: "center", fontSize: 11, color: totals.ab > 0 ? T.danger : T.textMuted }}>{totals.ab}</td>
                  <td style={{ padding: "8px 5px", textAlign: "center", fontSize: 11, color: T.yukyuBlue }}>{totals.yu}</td>
                  <td style={{ padding: "8px 5px", textAlign: "center", fontSize: 11 }}>{fmHours(totals.tw)}</td>
                  <td style={{ padding: "8px 5px", textAlign: "center", fontSize: 11 }}>—</td>
                  <td style={{ padding: "8px 5px", textAlign: "center", fontSize: 11 }}>—</td>
                  <td style={{ padding: "8px 5px", textAlign: "center", fontSize: 11, color: T.warning }}>{fmHours(totals.ot)}</td>
                  <td style={{ padding: "8px 5px", textAlign: "center", fontSize: 11, color: T.warning }}>{totals.la}</td>
                  <td style={{ padding: "8px 5px", textAlign: "center", fontSize: 11, color: T.warning }}>{totals.ea}</td>
                </tr>
              )}
              {rows.length === 0 && <tr><td colSpan={14} style={{ padding: "30px", textAlign: "center", color: T.textMuted, fontSize: 13 }}>データがありません</td></tr>}
            </tbody>
          </table>
        </div></div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════ */
/* ── 申請管理サブタブ ── */
/* ══════════════════════════════════════ */
interface ChangeReq {
  id: string; employee_id: string; category: string; detail: string; message: string | null;
  file_url: string | null; status: string; reviewer_note: string | null;
  reviewed_by: string | null; reviewed_at: string | null; created_at: string; updated_at: string;
  emp_name?: string; emp_code?: string;
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "未処理": { bg: "#FEF3C7", color: "#92400E" },
  "承認": { bg: "#D1FAE5", color: "#065F46" },
  "却下": { bg: "#FEE2E2", color: "#991B1B" },
};

const RequestsSub = ({ employee }: { employee: any }) => {
  const [requests, setRequests] = useState<ChangeReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("未処理");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<{ message: string; mode: "alert" | "confirm"; onOk: () => void } | null>(null);

  const fetchRequests = useCallback(async () => {
    if (!employee?.company_id) return;
    setLoading(true);
    const { data: empData } = await supabase.from("employees").select("id, employee_code, full_name").eq("company_id", employee.company_id);
    const empMap: Record<string, { code: string; name: string }> = {};
    (empData || []).forEach((e: any) => { empMap[e.id] = { code: e.employee_code, name: e.full_name }; });
    const { data } = await supabase.from("change_requests").select("*").eq("company_id", employee.company_id).order("created_at", { ascending: false });
    const enriched = (data || []).map((r: any) => ({ ...r, emp_name: empMap[r.employee_id]?.name || "不明", emp_code: empMap[r.employee_id]?.code || "—" }));
    setRequests(enriched);
    setLoading(false);
  }, [employee?.company_id]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const filtered = useMemo(() => {
    if (filter === "全件") return requests;
    return requests.filter(r => r.status === filter);
  }, [requests, filter]);

  const handleProcess = async (req: ChangeReq, newStatus: "承認" | "却下") => {
    setProcessing(req.id);
    const { error } = await supabase.from("change_requests").update({
      status: newStatus, reviewer_note: reviewNotes[req.id] || null,
      reviewed_by: employee.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", req.id);
    setProcessing(null);
    if (error) { setDialogState({ message: "処理に失敗しました", mode: "alert", onOk: () => setDialogState(null) }); }
    else { fetchRequests(); }
  };

  const confirmProcess = (req: ChangeReq, newStatus: "承認" | "却下") => {
    const label = newStatus === "承認" ? "承認" : "却下";
    setDialogState({ message: `${req.emp_name}さんの「${req.category}」を${label}しますか？`, mode: "confirm", onOk: () => { setDialogState(null); handleProcess(req, newStatus); } });
  };

  const fmtDate = (d: string) => { const dt = new Date(d); return `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,"0")}/${String(dt.getDate()).padStart(2,"0")} ${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}`; };

  const counts = useMemo(() => {
    let pending = 0, approved = 0, rejected = 0;
    requests.forEach(r => { if (r.status === "未処理") pending++; else if (r.status === "承認") approved++; else if (r.status === "却下") rejected++; });
    return { pending, approved, rejected, total: requests.length };
  }, [requests]);

  const filterBtns: { label: string; value: string; count: number; color: string }[] = [
    { label: "未処理", value: "未処理", count: counts.pending, color: "#92400E" },
    { label: "承認", value: "承認", count: counts.approved, color: T.success },
    { label: "却下", value: "却下", count: counts.rejected, color: T.danger },
    { label: "全件", value: "全件", count: counts.total, color: T.textSec },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {filterBtns.map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)} style={{
            padding: "8px 14px", borderRadius: 20, fontSize: 12, fontWeight: filter === f.value ? 700 : 400,
            cursor: "pointer", border: filter === f.value ? `2px solid ${f.color}` : `1px solid ${T.border}`,
            backgroundColor: filter === f.value ? f.color + "15" : "#fff", color: filter === f.value ? f.color : T.textSec,
          }}>{f.label}<span style={{ marginLeft: 4, fontSize: 11, fontWeight: 700 }}>{f.count}</span></button>
        ))}
      </div>
      {loading ? (<div style={{ textAlign: "center", padding: "40px", color: T.textMuted, fontSize: 14 }}>読み込み中...</div>) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: T.textMuted }}><div style={{ fontSize: 24, marginBottom: 8 }}>📭</div><div style={{ fontSize: 14 }}>{filter === "未処理" ? "未処理の申請はありません" : "該当する申請はありません"}</div></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map(req => {
            const sc = STATUS_COLORS[req.status] || STATUS_COLORS["未処理"];
            const isPending = req.status === "未処理";
            return (
              <div key={req.id} style={{ border: `1px solid ${isPending ? T.primary + "40" : T.border}`, borderRadius: 8, padding: 16, backgroundColor: isPending ? "#FAFCFF" : "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div><span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{req.emp_name}</span><span style={{ fontSize: 11, color: T.textMuted, marginLeft: 6 }}>{req.emp_code}</span></div>
                  <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600, backgroundColor: sc.bg, color: sc.color }}>{req.status}</span>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, backgroundColor: T.primary + "15", color: T.primary }}>{req.category}</span>
                  <span style={{ fontSize: 11, color: T.textMuted, marginLeft: 8 }}>{fmtDate(req.created_at)}</span>
                </div>
                <div style={{ fontSize: 13, color: T.text, marginBottom: 6, lineHeight: 1.5 }}>{req.detail}</div>
                {req.message && <div style={{ fontSize: 12, color: T.textSec, marginBottom: 6, padding: "8px 10px", backgroundColor: T.bg, borderRadius: 6 }}>💬 {req.message}</div>}
                {req.file_url && <a href={req.file_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: T.primary, textDecoration: "underline", display: "inline-block", marginBottom: 8 }}>📎 添付ファイルを開く</a>}
                {!isPending && req.reviewer_note && (
                  <div style={{ fontSize: 12, color: T.textSec, marginTop: 6, padding: "8px 10px", backgroundColor: "#F8FAFC", borderRadius: 6, borderLeft: `3px solid ${req.status === "承認" ? T.success : T.danger}` }}>処理コメント: {req.reviewer_note}</div>
                )}
                {!isPending && req.reviewed_at && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>処理日時: {fmtDate(req.reviewed_at)}</div>}
                {isPending && (
                  <div style={{ marginTop: 10, borderTop: `1px solid ${T.borderLight}`, paddingTop: 10 }}>
                    <input type="text" placeholder="処理コメント（任意）" value={reviewNotes[req.id] || ""} onChange={e => setReviewNotes(prev => ({ ...prev, [req.id]: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, marginBottom: 8, boxSizing: "border-box" }} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => confirmProcess(req, "承認")} disabled={processing === req.id} style={{ flex: 1, padding: "10px", borderRadius: 6, border: "none", backgroundColor: T.success, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: processing === req.id ? 0.6 : 1 }}>{processing === req.id ? "処理中..." : "✓ 承認"}</button>
                      <button onClick={() => confirmProcess(req, "却下")} disabled={processing === req.id} style={{ flex: 1, padding: "10px", borderRadius: 6, border: `1px solid ${T.danger}`, backgroundColor: "#fff", color: T.danger, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: processing === req.id ? 0.6 : 1 }}>{processing === req.id ? "処理中..." : "✕ 却下"}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {dialogState && <Dialog message={dialogState.message} mode={dialogState.mode} onOk={dialogState.onOk} onCancel={() => setDialogState(null)} />}
    </div>
  );
};

/* ══════════════════════════════════════ */
/* ── 書類配布サブタブ ── */
/* ══════════════════════════════════════ */
interface DocRow {
  id: string; document_name: string; category: string; file_url: string;
  employee_id: string | null; upload_date: string; confirmed_at: string | null;
  emp_name?: string; emp_code?: string;
}

const DOC_CATEGORIES = ["源泉徴収票", "給与明細", "その他"];

const DocumentsSub = ({ employee }: { employee: any }) => {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [emps, setEmps] = useState<EmpOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogMsg, setDialogMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [docName, setDocName] = useState("");
  const [docCategory, setDocCategory] = useState("源泉徴収票");
  const [targetType, setTargetType] = useState<"all" | "individual">("all");
  const [targetEmpId, setTargetEmpId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!employee?.company_id) return;
    setLoading(true);
    const { data: empData } = await supabase.from("employees").select("id, employee_code, full_name, store_id, department, role, hire_date, paid_leave_grant_date, holiday_calendar").eq("company_id", employee.company_id).order("employee_code");
    const empList = (empData || []).filter((e: any) => !["W02","W49","W67"].includes(e.employee_code)).map((e: any) => ({ ...e, code: e.employee_code, name: e.full_name, store_name: "" }));
    setEmps(empList);
    const empMap: Record<string, { code: string; name: string }> = {};
    empList.forEach((e: EmpOption) => { empMap[e.id] = { code: e.code, name: e.name }; });
    const { data: docData } = await supabase.from("documents").select("*").eq("company_id", employee.company_id).order("upload_date", { ascending: false });
    const enriched = (docData || []).map((d: any) => ({ ...d, emp_name: d.employee_id ? (empMap[d.employee_id]?.name || "不明") : "全員", emp_code: d.employee_id ? (empMap[d.employee_id]?.code || "—") : "—" }));
    setDocs(enriched);
    setLoading(false);
  }, [employee?.company_id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleUpload = async () => {
    if (!docName.trim()) { setDialogMsg("書類名を入力してください"); return; }
    if (!file) { setDialogMsg("ファイルを選択してください"); return; }
    if (targetType === "individual" && !targetEmpId) { setDialogMsg("対象者を選択してください"); return; }
    setUploading(true);
    const ext = file.name.split(".").pop() || "pdf";
    const fileName = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = `documents/${fileName}`;
    const { error: upErr } = await supabase.storage.from("change-requests").upload(filePath, file);
    if (upErr) { setUploading(false); setDialogMsg("ファイルのアップロードに失敗しました: " + upErr.message); return; }
    const { data: urlData } = supabase.storage.from("change-requests").getPublicUrl(filePath);
    const fileUrl = urlData?.publicUrl || "";
    if (targetType === "all") {
      const inserts = emps.map(e => ({ company_id: employee.company_id, employee_id: e.id, document_name: docName, category: docCategory, file_url: fileUrl, upload_date: new Date().toISOString(), uploader: employee.full_name }));
      const { error } = await supabase.from("documents").insert(inserts);
      if (error) { setUploading(false); setDialogMsg("配布に失敗しました: " + error.message); return; }
    } else {
      const { error } = await supabase.from("documents").insert({ company_id: employee.company_id, employee_id: targetEmpId, document_name: docName, category: docCategory, file_url: fileUrl, upload_date: new Date().toISOString(), uploader: employee.full_name });
      if (error) { setUploading(false); setDialogMsg("配布に失敗しました: " + error.message); return; }
    }
    setUploading(false);
    setDialogMsg("配布しました");
    setShowForm(false); setDocName(""); setFile(null); setTargetEmpId(""); setTargetType("all");
    fetchData();
  };

  const fmtDate = (d: string) => { const dt = new Date(d); return `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,"0")}/${String(dt.getDate()).padStart(2,"0")}`; };
  const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, boxSizing: "border-box" };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: "10px 20px", borderRadius: 6, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{showForm ? "✕ フォームを閉じる" : "＋ 新規配布"}</button>
      </div>
      {showForm && (
        <div style={{ border: `1px solid ${T.primary}40`, borderRadius: 8, padding: 16, marginBottom: 20, backgroundColor: "#FAFCFF" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12 }}>書類配布</div>
          <div style={{ marginBottom: 10 }}><label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 3 }}>書類名</label><input type="text" value={docName} onChange={e => setDocName(e.target.value)} placeholder="例：2025年分 源泉徴収票" style={inputStyle} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div><label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 3 }}>カテゴリ</label><select value={docCategory} onChange={e => setDocCategory(e.target.value)} style={inputStyle}>{DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 3 }}>対象</label><select value={targetType} onChange={e => setTargetType(e.target.value as "all" | "individual")} style={inputStyle}><option value="all">全員</option><option value="individual">個人指定</option></select></div>
          </div>
          {targetType === "individual" && (<div style={{ marginBottom: 10 }}><label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 3 }}>対象者</label><select value={targetEmpId} onChange={e => setTargetEmpId(e.target.value)} style={inputStyle}><option value="">従業員を選択</option>{emps.map(e => <option key={e.id} value={e.id}>{e.code} {e.name}</option>)}</select></div>)}
          <div style={{ marginBottom: 12 }}><label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 3 }}>ファイル</label><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files?.[0] || null)} style={{ fontSize: 13, color: T.text }} /></div>
          <button onClick={handleUpload} disabled={uploading} style={{ padding: "10px 24px", borderRadius: 6, border: "none", backgroundColor: T.success, color: "#fff", fontSize: 13, fontWeight: 600, cursor: uploading ? "default" : "pointer", opacity: uploading ? 0.6 : 1 }}>{uploading ? "アップロード中..." : "配布する"}</button>
        </div>
      )}
      {loading ? (<div style={{ textAlign: "center", padding: "40px", color: T.textMuted, fontSize: 14 }}>読み込み中...</div>) : docs.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: T.textMuted }}><div style={{ fontSize: 24, marginBottom: 8 }}>📄</div><div style={{ fontSize: 14 }}>配布済みの書類はありません</div></div>
      ) : (
        <div style={{ borderRadius: 6, border: `1px solid ${T.border}`, overflow: "hidden" }}><div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 600 }}>
            <thead><tr style={{ backgroundColor: T.primary }}>{["書類名","カテゴリ","対象","配布日","確認",""].map(h => <th key={h} style={{ padding: "8px 6px", color: "#fff", fontWeight: 600, fontSize: 11, textAlign: "center", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                  <td style={{ padding: "8px 6px", fontWeight: 600, color: T.text }}>{d.document_name}</td>
                  <td style={{ padding: "8px 6px", textAlign: "center" }}><span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, backgroundColor: T.primary + "15", color: T.primary }}>{d.category}</span></td>
                  <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 11, color: T.textSec }}>{d.emp_name}{d.emp_code !== "—" ? ` (${d.emp_code})` : ""}</td>
                  <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 11, color: T.textMuted }}>{fmtDate(d.upload_date)}</td>
                  <td style={{ padding: "8px 6px", textAlign: "center" }}>{d.confirmed_at ? <span style={{ color: T.success, fontWeight: 600, fontSize: 11 }}>✓ 済</span> : <span style={{ color: T.textMuted, fontSize: 11 }}>未確認</span>}</td>
                  <td style={{ padding: "6px", textAlign: "center" }}><a href={d.file_url} target="_blank" rel="noopener noreferrer" style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.primary}`, backgroundColor: "#fff", color: T.primary, fontSize: 11, fontWeight: 600, textDecoration: "none", cursor: "pointer" }}>開く</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      {dialogMsg && <Dialog message={dialogMsg} onOk={() => setDialogMsg(null)} />}
    </div>
  );
};

export default function AdminTab({ employee }: { employee: any }) {
  const myCode = employee?.employee_code || "";
  const isOwner = OWNER_CODES.includes(myCode);
  const isSuper = SUPER_CODES.includes(myCode);
  const visibleTabs = ALL_SUB_TABS.filter(t => {
    if (t.visibleTo === "owner_only") return isOwner;
    if (t.visibleTo === "owner_or_kondo") return isOwner;
    if (t.visibleTo === "super_only") return isOwner || isSuper;
    return true;
  });
  const defaultTab = isOwner ? "notifications" : "individual";
  const [sub, setSub] = useState<SubTab>(defaultTab);
  return (
    <div style={{ padding: "16px 12px", maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: `1px solid ${T.border}`, overflowX: "auto" }}>
        {visibleTabs.map(t => (<button key={t.id} onClick={() => setSub(t.id)} style={{ padding: "10px 14px", border: "none", backgroundColor: "transparent", cursor: "pointer", fontSize: 13, fontWeight: sub === t.id ? 700 : 400, color: sub === t.id ? T.primary : T.textSec, borderBottom: sub === t.id ? `3px solid ${T.primary}` : "3px solid transparent", transition: "all 0.2s", whiteSpace: "nowrap" }}>{t.label}</button>))}
      </div>
      {sub === "notifications" && <NotificationsSub employee={employee} />}
      {sub === "paidleave" && <PaidLeaveSub employee={employee} />}
      {sub === "sharoushi" && <SharoushiSub employee={employee} />}
      {sub === "individual" && <IndividualSub employee={employee} />}
      {sub === "daily" && <DailySub employee={employee} />}
      {sub === "monthly" && <MonthlySub employee={employee} />}
      {sub === "requests" && <RequestsSub employee={employee} />}
      {sub === "documents" && <DocumentsSub employee={employee} />}
      {sub === "employee_manage" && <EmployeeManageSub employee={employee} />}
      {sub === "settings" && <SettingsSub employee={employee} />}
    </div>
  );
}
