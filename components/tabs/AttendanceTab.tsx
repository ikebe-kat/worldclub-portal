"use client";
import { useState, useMemo, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { T, DOW, stepMonth, fmtMin, displayReason, displayChipLabel, isKoukyuPart } from "@/lib/constants";
import { ReasonBadges } from "@/components/ui";
import { useSmoothSwipe } from "@/hooks/useSmoothSwipe";
import type { MonthlySummary } from "@/lib/types";
import Dialog from "@/components/ui/Dialog";

/* ── 小部品 ── */
const SC = ({ l, v, u, c }: { l: string; v: string | number; u?: string; c?: string }) => (
  <div style={{ backgroundColor: "#fff", padding: "12px 6px", borderRadius: "6px", border: `1px solid ${T.border}`, textAlign: "center" }}>
    <div style={{ fontSize: 10, color: T.textSec, marginBottom: 4 }}>{l}</div>
    <div style={{ fontSize: 20, fontWeight: 700, color: c ?? T.text, fontVariantNumeric: "tabular-nums" }}>
      {v}<span style={{ fontSize: 11, fontWeight: 400, marginLeft: 1 }}>{u}</span>
    </div>
  </div>
);
const Chip = ({ label, selected, color, onClick }: { label: string; selected: boolean; color: string; onClick: () => void }) => (
  <button onClick={onClick} style={{
    padding: "10px 4px", borderRadius: "6px", fontSize: 12, fontWeight: selected ? 600 : 400, cursor: "pointer",
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
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: "6px",
  border: `1px solid ${T.border}`, fontSize: 16, boxSizing: "border-box",
};

/* ── ローカル日付文字列 ── */
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ── 代休事由パーサー ── */
function parseDaikyu(reason: string): { type: "full" | "am" | "pm"; date: string } | null {
  const mFull = reason.match(/^代休(?:（(\d{4}\/\d{2}\/\d{2})分）)?$/);
  if (mFull) return { type: "full", date: mFull[1]?.replace(/\//g, "-") ?? "" };
  const mAm = reason.match(/^午前代休(?:（(\d{4}\/\d{2}\/\d{2})分）)?$/);
  if (mAm) return { type: "am", date: mAm[1]?.replace(/\//g, "-") ?? "" };
  const mPm = reason.match(/^午後代休(?:（(\d{4}\/\d{2}\/\d{2})分）)?$/);
  if (mPm) return { type: "pm", date: mPm[1]?.replace(/\//g, "-") ?? "" };
  return null;
}

/* ── ダイアログ状態の型 ── */
interface DialogState {
  message: string;
  mode: "alert" | "confirm";
  confirmLabel?: string;
  confirmColor?: string;
  onOk: () => void;
}

/* ══════════════════════════════════════ */
export default function AttendanceTab({ employee }: { employee: any }) {
  const now = new Date();
  const [yr, setYr] = useState(now.getFullYear());
  const [mo, setMo] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<any[]>([]);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [shiftConf, setShiftConf] = useState<{ confirmed_at: string } | null>(null);
  const [nextShiftConf, setNextShiftConf] = useState<{ confirmed_at: string } | null>(null);
  const [nextSubmission, setNextSubmission] = useState<{ submitted_at: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scheduledMin, setScheduledMin] = useState<number>(0);
  const [kibouQuota, setKibouQuota] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  /* レスポンシブ判定 */
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  /* モーダル基本 */
  const [modalDay, setModalDay] = useState<any | null>(null);
  const [selZenjitsu, setSelZenjitsu] = useState<string | null>(null);
  const [selGozen, setSelGozen] = useState<string | null>(null);
  const [selGogo, setSelGogo] = useState<string | null>(null);
  const [selKinmu, setSelKinmu] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  /* 出張ピッカー */
  const [shucchoOpen, setShucchoOpen] = useState(false);
  const [shucchoFrom, setShucchoFrom] = useState("");
  const [shucchoTo, setShucchoTo] = useState("");
  const [shucchoWhere, setShucchoWhere] = useState("");

  /* 代休ピッカー */
  const [daikyuMode, setDaikyuMode] = useState<"none" | "full" | "half">("none");
  const [daikyuHalf, setDaikyuHalf] = useState<"am" | "pm" | null>(null);
  const [daikyuDate, setDaikyuDate] = useState("");

  /* カスタムダイアログ */
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const showAlert = (message: string) => {
    setDialog({ message, mode: "alert", onOk: () => setDialog(null) });
  };
  const showConfirm = (message: string, onOk: () => void, confirmLabel = "OK", confirmColor: string = T.primary) => {
    setDialog({ message, mode: "confirm", confirmLabel, confirmColor, onOk: () => { setDialog(null); onOk(); } });
  };

  const go = useCallback((dir: 1 | -1) => {
    const [ny, nm] = stepMonth(yr, mo, dir);
    setYr(ny); setMo(nm);
  }, [yr, mo]);
  const swipeRef = useSmoothSwipe(go);

  /* ── データ取得 ── */
  const loadData = useCallback(async () => {
    if (!employee?.id) return;
    setLoading(true);
    const from = `${yr}-${String(mo).padStart(2, "0")}-01`;
    const toDate = new Date(yr, mo, 0);
    const to = `${yr}-${String(mo).padStart(2, "0")}-${String(toDate.getDate()).padStart(2, "0")}`;
    const yearMonth = `${yr}/${String(mo).padStart(2, "0")}`;

    const { data: attData } = await supabase
      .from("attendance_daily").select("attendance_date, punch_in, punch_out, reason, actual_hours, over_under")
      .eq("employee_id", employee.id).gte("attendance_date", from).lte("attendance_date", to).order("attendance_date");

    // leave_requests（申請中／差し戻し／承認待ち）を取得して出勤簿に反映
    // approved は確定ボタン押下までは「確定待ち」として表示
    const { data: lrData } = await supabase
      .from("leave_requests")
      .select("attendance_date, status, type, reject_reason")
      .eq("employee_id", employee.id)
      .in("type", ["shift_koukyuu", "yukyu"])
      .in("status", ["pending", "returned", "approved"])
      .gte("attendance_date", from)
      .lte("attendance_date", to);

    const merged = [...(attData ?? [])];
    (lrData ?? []).forEach((lr: any) => {
      const isYukyu = lr.type === "yukyu";
      let lrLabel: string | null = null;
      if (lr.status === "pending") {
        lrLabel = isYukyu ? "有給申請中" : "公休申請中";
      } else if (lr.status === "approved") {
        lrLabel = isYukyu ? "有給確定待ち" : "公休確定待ち";
      } else if (lr.status === "returned") {
        const reason = lr.reject_reason ? `（${lr.reject_reason}）` : "";
        lrLabel = isYukyu ? `有給差し戻し${reason}` : `公休差し戻し${reason}`;
      }
      if (!lrLabel) return;
      const existing = merged.find(m => m.attendance_date === lr.attendance_date);
      if (existing) {
        if (!existing.reason) existing.reason = lrLabel;
      } else {
        merged.push({ attendance_date: lr.attendance_date, punch_in: null, punch_out: null, reason: lrLabel, actual_hours: null, over_under: null });
      }
    });
    setRows(merged);

    // shift_confirmations（当月・翌月）
    const curMonth = `${yr}-${String(mo).padStart(2, "0")}`;
    const [nyr, nmo] = stepMonth(yr, mo, 1);
    const nextMonth = `${nyr}-${String(nmo).padStart(2, "0")}`;
    const { data: confs } = await supabase.from("shift_confirmations")
      .select("target_month, confirmed_at")
      .eq("company_id", employee.company_id)
      .in("target_month", [curMonth, nextMonth]);
    const cur = (confs || []).find((c: any) => c.target_month === curMonth);
    const nxt = (confs || []).find((c: any) => c.target_month === nextMonth);
    setShiftConf(cur ? { confirmed_at: cur.confirmed_at } : null);
    setNextShiftConf(nxt ? { confirmed_at: nxt.confirmed_at } : null);

    // shift_submissions（翌月分の提出有無）
    const { data: subData } = await supabase.from("shift_submissions")
      .select("submitted_at")
      .eq("employee_id", employee.id)
      .eq("target_month", nextMonth)
      .maybeSingle();
    setNextSubmission(subData ? { submitted_at: subData.submitted_at } : null);

    if (employee.holiday_calendar) {
      const { data: holData } = await supabase
        .from("holiday_calendars").select("holiday_date")
        .eq("company_id", employee.company_id).eq("calendar_type", employee.holiday_calendar)
        .gte("holiday_date", from).lte("holiday_date", to);
      setHolidays((holData ?? []).map(h => h.holiday_date));
    } else { setHolidays([]); }

    const { data: varData } = await supabase
      .from("variable_hours").select("scheduled_hours")
      .eq("company_id", employee.company_id).eq("year_month", yearMonth).limit(1).maybeSingle();
    setScheduledMin(varData?.scheduled_hours ? Math.round(Number(varData.scheduled_hours) * 60) : 0);

    if (employee.holiday_pattern) {
      const { data: kibouData } = await supabase
        .from("hope_holiday_quotas").select("quota")
        .eq("pattern_name", employee.holiday_pattern).eq("month", mo).limit(1).maybeSingle();
      setKibouQuota(kibouData?.quota ? Number(kibouData.quota) : 0);
    } else { setKibouQuota(0); }
    setLoading(false);
  }, [employee, yr, mo]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── 日付リスト ── */
  const allDays = useMemo(() => {
    const days = [];
    const daysInMonth = new Date(yr, mo, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(yr, mo - 1, d);
      const dateStr = `${yr}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const rec = rows.find(r => r.attendance_date === dateStr);
      days.push({
        day: d, dow: date.getDay(), dateStr,
        pi: rec?.punch_in?.slice(0, 5) ?? null, po: rec?.punch_out?.slice(0, 5) ?? null,
        reason: rec?.reason ?? null,
        wm: rec?.actual_hours ? Math.round(Number(rec.actual_hours) * 60) : 0,
        diff: rec?.over_under ? Math.round(Number(rec.over_under) * 60) : 0,
        off: holidays.includes(dateStr),
      });
    }
    return days;
  }, [yr, mo, rows, holidays]);

  /* ── サマリー ── */
  const sum = useMemo((): MonthlySummary => {
    const wd = allDays.filter(d => !d.off && d.pi).length;
    const hd = allDays.filter(d => d.off).length;
    const ab = allDays.filter(d => d.reason === "欠勤").length;
    const yu = allDays.reduce((s, d) => {
      if (!d.reason) return s;
      if (d.reason.includes("有給（全日）")) return s + 1;
      if (d.reason.includes("午前有給") || d.reason.includes("午後有給")) return s + 0.5;
      return s;
    }, 0);
    const ku = allDays.reduce((s, d) => {
      if (!d.reason) return s;
      if (d.reason.includes("希望休（全日）")) return s + 1;
      if (d.reason.includes("午前希望休") || d.reason.includes("午後希望休")) return s + 0.5;
      return s;
    }, 0);
    const tw = allDays.reduce((s, d) => s + d.wm, 0);
    return { wd, hd, ab, yu, kr: isKoukyuPart(employee?.employee_code || "") ? 999 : kibouQuota - ku, tw, sm: scheduledMin, df: tw - scheduledMin };
  }, [allDays, scheduledMin, kibouQuota]);

  /* ── 翌月シフト希望提出 ── */
  const today = new Date();
  const nextRealYear = today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear();
  const nextRealMonth = today.getMonth() === 11 ? 1 : today.getMonth() + 2;
  const nextRealMonthStr = `${nextRealYear}-${String(nextRealMonth).padStart(2, "0")}`;
  const submissionLocked = today.getDate() >= 26;
  const submitted = !!nextSubmission;

  const handleShiftSubmit = async () => {
    if (submitting || submitted || submissionLocked) return;
    setSubmitting(true);
    const { error } = await supabase.from("shift_submissions").insert({
      company_id: employee.company_id,
      employee_id: employee.id,
      target_month: nextRealMonthStr,
      submitted_at: new Date().toISOString(),
    });
    setSubmitting(false);
    if (error) { showAlert("提出に失敗しました: " + error.message); return; }
    setNextSubmission({ submitted_at: new Date().toISOString() });
  };

  /* ── 公休申請の締切判定 ── */
  const isKoukyuLocked = useCallback((dateStr: string): boolean => {
    if (!dateStr) return false;
    const [y, m] = dateStr.split("-").map(Number);
    const targetMonth = `${y}-${String(m).padStart(2, "0")}`;
    const today = new Date();
    const curRealMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const [ny, nm] = stepMonth(today.getFullYear(), today.getMonth() + 1, 1);
    const nextRealMonth = `${ny}-${String(nm).padStart(2, "0")}`;

    // 当該月が確定済み
    if (targetMonth === curRealMonth && shiftConf) return true;
    if (targetMonth === nextRealMonth && nextShiftConf) return true;

    // 25日以降は翌月分は締切
    if (targetMonth === nextRealMonth && today.getDate() >= 25) return true;

    return false;
  }, [shiftConf, nextShiftConf]);

  /* ── モーダル開く ── */
  const openModal = (day: any) => {
    setModalDay(day);
    setSelZenjitsu(null); setSelGozen(null); setSelGogo(null); setSelKinmu([]); setNote("");
    setShucchoOpen(false); setShucchoFrom(day.dateStr); setShucchoTo(day.dateStr); setShucchoWhere("");
    setDaikyuMode("none"); setDaikyuHalf(null); setDaikyuDate("");

    if (day.reason) {
      const parts = day.reason.split("+").map((s: string) => s.trim());
      const kinmuBuf: string[] = [];
      for (const p of parts) {
        if (p === "有給（全日）" || p === "希望休（全日）" || p === "公休（全日）") { setSelZenjitsu(p); continue; }
        if (p === "午前有給" || p === "午前希望休") { setSelGozen(p); continue; }
        if (p === "午後有給" || p === "午後希望休") { setSelGogo(p); continue; }
        const dk = parseDaikyu(p);
        if (dk) {
          if (dk.type === "full") { setDaikyuMode("full"); setDaikyuDate(dk.date); }
          else { setDaikyuMode("half"); setDaikyuHalf(dk.type); setDaikyuDate(dk.date); }
          continue;
        }
        if (p === "出張" || p.startsWith("出張（")) { setShucchoOpen(true); const wm = p.match(/出張（(.+)）/); if (wm) setShucchoWhere(wm[1]); kinmuBuf.push("出張"); continue; }
        kinmuBuf.push(p);
      }
      setSelKinmu(kinmuBuf);
    }
  };

  /* ── 排他制御 ── */
  const toggleZenjitsu = (v: string) => { if (selZenjitsu === v) { setSelZenjitsu(null); return; } setSelZenjitsu(v); setSelGozen(null); setSelGogo(null); setDaikyuMode("none"); setDaikyuHalf(null); setDaikyuDate(""); };
  const toggleGozen = (v: string) => { if (selGozen === v) { setSelGozen(null); return; } setSelGozen(v); setSelZenjitsu(null); };
  const toggleGogo = (v: string) => { if (selGogo === v) { setSelGogo(null); return; } setSelGogo(v); setSelZenjitsu(null); };
  const toggleKinmu = (v: string) => {
    if (v === "出張") { if (selKinmu.includes("出張")) { setSelKinmu(prev => prev.filter(x => x !== "出張")); setShucchoOpen(false); } else { setSelKinmu(prev => [...prev, "出張"]); setShucchoOpen(true); } return; }
    if (v === "代休") { if (daikyuMode === "full") { setDaikyuMode("none"); setDaikyuDate(""); } else { setDaikyuMode("full"); setDaikyuHalf(null); setSelZenjitsu(null); setSelGozen(null); setSelGogo(null); } return; }
    if (v === "半日代休") { if (daikyuMode === "half") { setDaikyuMode("none"); setDaikyuHalf(null); setDaikyuDate(""); } else { setDaikyuMode("half"); setDaikyuHalf(null); setSelZenjitsu(null); } return; }
    setSelKinmu(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  };

  /* ── プレビュー構築 ── */
  const previewReason = useMemo(() => {
    const parts: string[] = [];
    if (selZenjitsu) parts.push(selZenjitsu);
    if (selGozen) parts.push(selGozen);
    if (selGogo) parts.push(selGogo);
    if (daikyuMode === "full") { const ds = daikyuDate ? `（${daikyuDate.replace(/-/g, "/")}分）` : ""; parts.push(`代休${ds}`); }
    else if (daikyuMode === "half" && daikyuHalf) { const ds = daikyuDate ? `（${daikyuDate.replace(/-/g, "/")}分）` : ""; parts.push(`${daikyuHalf === "am" ? "午前" : "午後"}代休${ds}`); }
    for (const k of selKinmu) { if (k === "代休" || k === "半日代休") continue; if (k === "出張") { parts.push(shucchoWhere ? "出張（" + shucchoWhere + "）" : "出張"); continue; } parts.push(k); }
    return parts.length > 0 ? parts.join("+") : null;
  }, [selZenjitsu, selGozen, selGogo, selKinmu, daikyuMode, daikyuHalf, daikyuDate]);

  /* ── 出張バッチ登録（confirm後に呼ばれる） ── */
  const doShucchoBatch = async () => {
    const f = new Date(shucchoFrom), t = new Date(shucchoTo || shucchoFrom);
    const diffDays = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
    const whereText = shucchoWhere ? `行先：${shucchoWhere}` : null;
    const patternStart = employee.work_pattern_code?.split("-")[0] ?? "09:30";
    const patternEnd = employee.work_pattern_code?.split("-")[1] ?? "18:00";
    const formatTime = (t: string) => t.length === 4 ? t.slice(0, 2) + ":" + t.slice(2) : t;
    const pIn = formatTime(patternStart);
    const pOut = formatTime(patternEnd);
    const otherParts = (previewReason ?? "").split("+").filter(p => p.trim() !== "出張").map(p => p.trim()).filter(Boolean);
    const shucchoLabel = shucchoWhere ? "出張（" + shucchoWhere + "）" : "出張";
    const reasonForBatch = otherParts.length > 0 ? otherParts.join("+") + "+" + shucchoLabel : shucchoLabel;

    setSaving(true);
    const upserts = [];
    for (let i = 0; i < diffDays; i++) {
      const d = new Date(f); d.setDate(d.getDate() + i);
      const ds = toDateStr(d);
      upserts.push({
        employee_id: employee.id, company_id: employee.company_id,
        attendance_date: ds, day_of_week: DOW[d.getDay()],
        reason: reasonForBatch, punch_in: pIn, punch_out: pOut,
        employee_note: whereText, updated_at: new Date().toISOString(),
      });
    }
    const { error } = await supabase.from("attendance_daily").upsert(upserts, { onConflict: "employee_id,attendance_date" });
    setSaving(false);
    if (!error) { setModalDay(null); loadData(); }
    else { showAlert("登録に失敗しました: " + error.message); }
  };

  /* ── 事由登録 ── */
  const submitReason = async () => {
    if (!modalDay || !previewReason) return;

    if (selKinmu.includes("出張")) {
      if (!shucchoFrom) { showAlert("開始日を選択してください"); return; }
      const f = new Date(shucchoFrom), t = new Date(shucchoTo || shucchoFrom);
      if (f > t) { showAlert("日付が正しくありません"); return; }
      const diffDays = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
      if (diffDays > 14) { showAlert("一度に登録できるのは14日間までです"); return; }
      const confirmMsg = `出張${shucchoWhere ? `（${shucchoWhere}）` : ""}\n${shucchoFrom} 〜 ${shucchoTo || shucchoFrom}（${diffDays}日間）\n\n登録しますか？`;
      showConfirm(confirmMsg, doShucchoBatch, "登録");
      return;
    }

    if (daikyuMode === "half" && !daikyuHalf) { showAlert("午前か午後を選択してください"); return; }

    /* 有給残チェック */
    const yukyuDays = selZenjitsu === "有給（全日）" ? 1 : (selGozen === "午前有給" ? 0.5 : 0) + (selGogo === "午後有給" ? 0.5 : 0);
    if (yukyuDays > 0) {
      const { data: grants } = await supabase.from("paid_leave_grants").select("remaining_days").eq("employee_id", employee.id).gt("remaining_days", 0).order("expiry_date", { ascending: true });
      const totalRemaining = (grants || []).reduce((s: number, g: any) => s + Number(g.remaining_days), 0);
      if (totalRemaining < yukyuDays) { showAlert(`有給残が不足しています（残: ${totalRemaining}日）`); return; }
    }

    /* 希望休上限チェック */
    if (!isKoukyuPart(employee?.employee_code || "")) {
      const kibouDays = (selZenjitsu === "希望休（全日）" ? 1 : 0) + (selGozen === "午前希望休" ? 0.5 : 0) + (selGogo === "午後希望休" ? 0.5 : 0);
      if (kibouDays > 0 && kibouQuota > 0) {
        const usedKibou = allDays.reduce((s, d) => {
          if (!d.reason || d.dateStr === modalDay.dateStr) return s;
          if (d.reason.includes("希望休（全日）")) return s + 1;
          if (d.reason.includes("午前希望休") || d.reason.includes("午後希望休")) return s + 0.5;
          return s;
        }, 0);
        const remaining = kibouQuota - usedKibou;
        if (remaining < kibouDays) { showAlert(`希望休の上限に達しています（残: ${remaining}日 / 上限: ${kibouQuota}日）`); return; }
      }
    }

    setSaving(true);

    // ── 公休（全日）/ 有給（全日）は leave_requests へ pending 申請として保存 ──
    if (previewReason === "公休（全日）" || previewReason === "有給（全日）") {
      if (isKoukyuLocked(modalDay.dateStr)) {
        setSaving(false);
        showAlert("この月の申請は締切済みです");
        return;
      }
      const reqType = previewReason === "公休（全日）" ? "shift_koukyuu" : "yukyu";
      // 既存の申請があれば削除（再申請）
      await supabase.from("leave_requests")
        .delete()
        .eq("employee_id", employee.id)
        .eq("attendance_date", modalDay.dateStr)
        .eq("type", reqType);

      const { error: reqErr } = await supabase.from("leave_requests").insert({
        company_id: employee.company_id,
        store_id: employee.store_id,
        employee_id: employee.id,
        attendance_date: modalDay.dateStr,
        type: reqType,
        status: "pending",
        reason: previewReason,
        request_comment: note || null,
      });
      setSaving(false);
      if (reqErr) { showAlert("申請に失敗しました: " + reqErr.message); return; }
      setModalDay(null); loadData();
      return;
    }

    const { error } = await supabase.from("attendance_daily").upsert({
      employee_id: employee.id, company_id: employee.company_id,
      attendance_date: modalDay.dateStr, day_of_week: DOW[modalDay.dow],
      reason: previewReason, employee_note: note || null, updated_at: new Date().toISOString(),
    }, { onConflict: "employee_id,attendance_date" });
    setSaving(false);
    if (!error) {
      setModalDay(null); loadData();
      if (previewReason && (previewReason.includes("有給") || previewReason.includes("希望休") || previewReason.includes("代休") || previewReason.includes("出張"))) {
        const storeName = employee.store_name || "";
        fetch("https://pktqlbpdjemmomfanvgt.supabase.co/functions/v1/send-push", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "attendance_reason_set", payload: { company_id: employee.company_id, employee_id: employee.id, employee_name: employee.full_name, reason: previewReason, attendance_date: modalDay.dateStr, store_name: storeName } }),
        }).catch(() => {});
      }
    }
    else { showAlert("登録に失敗しました: " + error.message); }
  };

  /* ── 事由取消 ── */
  const cancelReason = () => {
    if (!modalDay) return;
    showConfirm("この日の事由を取り消しますか？", async () => {
      setSaving(true);
      const { error } = await supabase.from("attendance_daily")
        .update({ reason: null, employee_note: null, updated_at: new Date().toISOString() })
        .eq("employee_id", employee.id).eq("attendance_date", modalDay.dateStr);
      setSaving(false);
      if (!error) {
        setModalDay(null); loadData();
        if (modalDay.reason && (modalDay.reason.includes("有給") || modalDay.reason.includes("希望休") || modalDay.reason.includes("代休") || modalDay.reason.includes("出張"))) {
          const storeName = employee.store_name || "";
          fetch("https://pktqlbpdjemmomfanvgt.supabase.co/functions/v1/send-push", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "attendance_reason_cleared", payload: { company_id: employee.company_id, employee_id: employee.id, employee_name: employee.full_name, old_reason: modalDay.reason, attendance_date: modalDay.dateStr, store_name: storeName } }),
          }).catch(() => {});
        }
      }
      else { showAlert("取消に失敗しました: " + error.message); }
    }, "取消", "#DC2626");
  };

  /* ══════════ JSX ══════════ */
  return (
    <div style={{ padding: "16px 12px", maxWidth: 720, margin: "0 auto" }}>
      {/* 月ナビ */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => go(-1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: "6px", backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec }}>◀</button>
          <span style={{ fontSize: 15, fontWeight: 700, color: T.text, minWidth: 90, textAlign: "center" }}>{yr}年{mo}月</span>
          <button onClick={() => go(1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: "6px", backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec }}>▶</button>
        </div>
        {(() => {
          // 翌月の出勤簿を表示中のときだけボタンを出す
          if (yr !== nextRealYear || mo !== nextRealMonth) return null;
          const label =
            submitted ? `${nextRealMonth}月 提出済み ✓` :
            submissionLocked ? `${nextRealMonth}月 締切済み` :
            `${nextRealMonth}月のシフト希望を提出`;
          const disabled = submitted || submissionLocked || submitting;
          return (
            <button
              onClick={handleShiftSubmit}
              disabled={disabled}
              style={{
                padding: "8px 14px", borderRadius: 6, border: "none",
                backgroundColor: submitted ? T.primary : disabled ? T.border : T.primary,
                color: submitted ? "#fff" : disabled ? T.textMuted : "#fff",
                fontSize: 12, fontWeight: 700,
                cursor: disabled ? "default" : "pointer",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? "送信中..." : label}
            </button>
          );
        })()}
      </div>

      {/* シフト確定バナー */}
      {shiftConf && (() => {
        const d = new Date(shiftConf.confirmed_at);
        const txt = `シフトが確定しました ${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        return (
          <div style={{
            backgroundColor: T.primary, color: "#fff", padding: "10px 14px",
            borderRadius: 6, fontSize: 13, fontWeight: 600, marginBottom: 12,
            textAlign: "center",
          }}>
            ✓ {txt}
          </div>
        );
      })()}

      {/* サマリー */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6, marginBottom: 6 }}>
        <SC l="出勤日数" v={sum.wd} u="日" /><SC l="休日" v={sum.hd} u="日" />
        <SC l="欠勤" v={sum.ab} u="日" c={sum.ab > 0 ? T.danger : T.text} />
        <SC l="有給取得" v={sum.yu} u="日" c={T.yukyuBlue} />
        <SC l={isKoukyuPart(employee?.employee_code || "") ? "公休残" : "希望休残"} v={isKoukyuPart(employee?.employee_code || "") ? "∞" : sum.kr} u="日" c={!isKoukyuPart(employee?.employee_code || "") && sum.kr <= 0 ? T.danger : T.text} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 16 }}>
        <SC l="月間総労働" v={fmtMin(sum.tw)} u="h" />
        <SC l="変形月所定" v={fmtMin(sum.sm)} u="h" />
        <SC l="月次過不足" v={(sum.df >= 0 ? "+" : "") + fmtMin(sum.df)} u="h" c={sum.df < 0 ? T.danger : T.success} />
      </div>

      {/* テーブル */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textMuted, fontSize: 14 }}>読み込み中...</div>
      ) : (
        <div ref={swipeRef}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ backgroundColor: "#fff", borderBottom: `2px solid ${T.border}` }}>
                <th style={{ padding: "8px 4px", color: T.textSec, fontWeight: 600, whiteSpace: "nowrap", textAlign: "center" }}>日</th>
                <th style={{ padding: "8px 4px", color: T.textSec, fontWeight: 600, whiteSpace: "nowrap", textAlign: "center" }}>曜</th>
                <th style={{ padding: "8px 4px", color: T.textSec, fontWeight: 600, whiteSpace: "nowrap", textAlign: "left" }}>出勤</th>
                <th style={{ padding: "8px 4px", color: T.textSec, fontWeight: 600, whiteSpace: "nowrap", textAlign: "left" }}>退勤</th>
                <th style={{ padding: "8px 4px", color: T.textSec, fontWeight: 600, whiteSpace: "nowrap", textAlign: "left" }}>事由</th>
                {!isMobile && <th style={{ padding: "8px 4px", color: T.textSec, fontWeight: 600, whiteSpace: "nowrap", textAlign: "left" }}>実労働</th>}
                {!isMobile && <th style={{ padding: "8px 4px", color: T.textSec, fontWeight: 600, whiteSpace: "nowrap", textAlign: "left" }}>過不足</th>}
                <th style={{ padding: "8px 4px", color: T.textSec, fontWeight: 600, whiteSpace: "nowrap", textAlign: "center" }}></th>
              </tr>
            </thead>
            <tbody>
              {allDays.map(row => {
                const dc = row.dow === 0 ? T.holidayRed : row.dow === 6 ? T.yukyuBlue : T.text;
                return (
                  <tr key={row.day} style={{ backgroundColor: row.off ? "#FFF8F8" : "#fff", borderBottom: `1px solid ${T.borderLight}` }}>
                    <td style={{ padding: "7px 4px", textAlign: "center", fontWeight: 600, color: dc, width: 24 }}>{row.day}</td>
                    <td style={{ padding: "7px 4px", textAlign: "center", color: dc, width: 20 }}>{DOW[row.dow]}</td>
                    <td style={{ padding: "7px 4px", color: T.text, width: 44 }}>{row.pi ?? <span style={{ color: T.textPH }}>—</span>}</td>
                    <td style={{ padding: "7px 4px", color: T.text, width: 44 }}>{row.po ?? <span style={{ color: T.textPH }}>—</span>}</td>
                    <td style={{ padding: "7px 4px" }}><ReasonBadges reason={displayReason(row.reason, employee?.employee_code || "") ?? (row.off ? "休日" : null)} /></td>
                    {!isMobile && (
                      <td style={{ padding: "7px 4px", color: T.text, width: 56, whiteSpace: "nowrap" }}>{row.wm > 0 ? fmtMin(row.wm) : <span style={{ color: T.textPH }}>—</span>}</td>
                    )}
                    {!isMobile && (
                      <td style={{ padding: "7px 4px", width: 56, whiteSpace: "nowrap", color: row.diff < 0 ? T.danger : row.diff > 0 ? T.success : T.textMuted, fontWeight: row.diff !== 0 ? 600 : 400 }}>
                        {row.wm > 0 ? (row.diff >= 0 ? "+" : "") + fmtMin(row.diff) : "—"}
                      </td>
                    )}
                    <td style={{ padding: "7px 4px", width: 40 }}>
                      <button onClick={() => openModal(row)} style={{
                        padding: "4px 8px", borderRadius: "4px", border: `1px solid ${T.primary}`,
                        backgroundColor: "#fff", color: T.primary, fontSize: 11, fontWeight: 600,
                        cursor: "pointer", whiteSpace: "nowrap",
                      }}>申請</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════ モーダル ══════ */}
      {modalDay && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setModalDay(null)}>
          <div style={{ backgroundColor: "#fff", borderRadius: "12px 12px 0 0", padding: "20px 20px 28px", width: "100%", maxWidth: 480, maxHeight: "85vh", overflow: "auto", animation: "slideUp 0.3s ease" }}
            onClick={e => e.stopPropagation()}>

            <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border, margin: "0 auto 16px" }} />
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text, marginBottom: 4 }}>休暇・勤務申請</div>
            <div style={{ fontSize: 13, color: T.textSec, marginBottom: 16 }}>{yr}年{mo}月{modalDay.day}日（{DOW[modalDay.dow]}）</div>

            {/* プレビュー */}
            <div style={{ padding: "10px 14px", borderRadius: "6px", backgroundColor: previewReason ? "#ECFDF5" : T.bg, marginBottom: 20, minHeight: 40, display: "flex", alignItems: "center" }}>
              {previewReason ? <ReasonBadges reason={previewReason} /> : <span style={{ fontSize: 13, color: T.textMuted }}>事由を選択してください</span>}
            </div>

            <Dot color={T.holidayRed} label="休暇申請" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
              <Chip label="公休（全日）" selected={selZenjitsu === "公休（全日）"} color={T.primary} onClick={() => toggleZenjitsu("公休（全日）")} />
              <Chip label="有給（全日）" selected={selZenjitsu === "有給（全日）"} color={T.yukyuBlue} onClick={() => toggleZenjitsu("有給（全日）")} />
            </div>

            <Dot color={T.kinmuGreen} label="勤務申請" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
              {["出張", "遅刻", "早退", "欠勤"].map(k => (
                <Chip key={k} label={k}
                  selected={selKinmu.includes(k)}
                  color={T.kinmuGreen} onClick={() => toggleKinmu(k)} />
              ))}
            </div>

            {shucchoOpen && (
              <div style={{ padding: 14, borderRadius: "6px", border: `1px solid ${T.kinmuGreen}`, backgroundColor: "#F0FFF4", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.kinmuGreen, marginBottom: 10 }}>出張の詳細</div>
                <Field label="行先（任意）"><input type="text" value={shucchoWhere} onChange={e => setShucchoWhere(e.target.value)} placeholder="例：東京、大阪" style={inputStyle} /></Field>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Field label="開始日"><input type="date" value={shucchoFrom} onChange={e => setShucchoFrom(e.target.value)} style={inputStyle} /></Field>
                  <Field label="終了日"><input type="date" value={shucchoTo} onChange={e => setShucchoTo(e.target.value)} style={inputStyle} /></Field>
                </div>
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 4 }}>備考</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="例：熱があって遅刻しました"
                style={{ width: "100%", padding: "10px 12px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: 13, resize: "vertical", minHeight: 60, boxSizing: "border-box" }} />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setModalDay(null)} style={{ flex: 1, padding: "12px", borderRadius: "6px", border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.textSec, fontSize: 14, cursor: "pointer" }}>閉じる</button>
              {modalDay.reason && (
                <button onClick={cancelReason} disabled={saving} style={{ flex: 1, padding: "12px", borderRadius: "6px", border: `1px solid ${T.danger}`, backgroundColor: "#fff", color: T.danger, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{saving ? "..." : "取消"}</button>
              )}
              {(() => {
                const isShinsei = previewReason === "公休（全日）" || previewReason === "有給（全日）";
                const locked = isShinsei && modalDay && isKoukyuLocked(modalDay.dateStr);
                const disabled = saving || !previewReason || locked;
                const label = locked ? "締切済み" : saving ? (isShinsei ? "申請中..." : "登録中...") : (isShinsei ? "申請" : "登録");
                return (
                  <button onClick={submitReason} disabled={disabled} style={{ flex: 1, padding: "12px", borderRadius: "6px", border: "none", backgroundColor: disabled ? T.border : T.primary, color: disabled ? T.textMuted : "#fff", fontSize: 14, fontWeight: 600, cursor: disabled ? "default" : "pointer" }}>{label}</button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* カスタムダイアログ */}
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

      <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
    </div>
  );
}
