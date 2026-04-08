"use client";
// ═══════════════════════════════════════════
// components/tabs/CalendarTab.tsx — カレンダータブ（Supabase接続済み）
// レスポンシブ対応版: PC=セル110px+右パネル320px / スマホ=右スライドインパネル65%幅
// ═══════════════════════════════════════════
import { useState, useMemo, useCallback, useEffect } from "react";
import { T, DOW, PALETTE, CAL_GROUPS, stepMonth, displayReason, calendarDisplayName } from "@/lib/constants";
import { useSmoothSwipe } from "@/hooks/useSmoothSwipe";
import { supabase } from "@/lib/supabase";
import { getPermLevel, canShowCalendarGroupSelect, getDefaultCalendarGroup, canChooseTargetCalendar, canDeleteEvent, storeIdToCalGroup, getAllowedCalGroups, canViewJimuCalendar } from "@/lib/permissions";
import Dialog from "@/components/ui/Dialog";

// ── 型定義 ──────────────────────────────
interface CustomEvent {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  is_all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  color: string;
  target_calendar: string;
  repeat_type: string;
  creator_employee_id: string;
  creator_code: string | null;
  creator_name: string | null;
}

interface AttendanceEvent {
  employee_id: string;
  full_name: string;
  attendance_date: string;
  reason: string;
  calGroup: string;
  emp_code: string;
}

// ── ユーティリティ ──────────────────────────
function toLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function expandRepeats(ev: CustomEvent, yr: number, mo: number): { startDay: number; endDay: number }[] {
  const monthStart = new Date(yr, mo - 1, 1);
  const monthEnd = new Date(yr, mo, 0);
  const daysInMonth = monthEnd.getDate();
  const hits: { startDay: number; endDay: number }[] = [];

  if (ev.repeat_type === "none" || !ev.repeat_type) {
    const evStart = new Date(ev.start_date + "T00:00:00");
    const evEnd = new Date(ev.end_date + "T00:00:00");
    if (evEnd < monthStart || evStart > monthEnd) return [];
    const sd = evStart < monthStart ? 1 : evStart.getDate();
    const ed = evEnd > monthEnd ? daysInMonth : evEnd.getDate();
    hits.push({ startDay: sd, endDay: ed });
  } else if (ev.repeat_type === "monthly") {
    const origStart = new Date(ev.start_date + "T00:00:00");
    const origEnd = new Date(ev.end_date + "T00:00:00");
    const span = Math.round((origEnd.getTime() - origStart.getTime()) / 86400000);
    const sd = Math.min(origStart.getDate(), daysInMonth);
    const ed = Math.min(sd + span, daysInMonth);
    hits.push({ startDay: sd, endDay: ed });
  } else if (ev.repeat_type === "weekly") {
    const origDow = new Date(ev.start_date + "T00:00:00").getDay();
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(yr, mo - 1, d).getDay() === origDow) {
        hits.push({ startDay: d, endDay: d });
      }
    }
  }
  return hits;
}

// ── バッジコンポーネント ──────────────────────
const Badge = ({ children, bg, color: c = "#fff", style: s }: {
  children: React.ReactNode; bg: string; color?: string; style?: React.CSSProperties;
}) => (
  <span style={{
    display: "inline-block", padding: "2px 8px", borderRadius: "3px",
    fontSize: 11, fontWeight: 600, lineHeight: "16px",
    color: c, backgroundColor: bg, whiteSpace: "nowrap", ...s,
  }}>{children}</span>
);

const ReasonBadges = ({ reason }: { reason: string }) => {
  const parts = reason.split("+").map((p) => p.trim());
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
      {parts.map((t, i) => {
        let bg: string = T.textMuted;
        let c = "#fff";
        if (t.includes("有給")) bg = T.yukyuBlue;
        else if (t.includes("希望休")) { bg = T.kibouYellow; c = "#78350F"; }
        else if (["出張", "休日出勤", "代休"].some((k) => t.includes(k))) bg = T.kinmuGreen;
        else if (t === "欠勤") bg = "#6B7280";
        return <Badge key={i} bg={bg} color={c}>{t}</Badge>;
      })}
    </div>
  );
};

// ── 予定追加モーダル（ボトムシート） ──────────
interface AddModalProps {
  employee: any;
  perm: "super" | "admin" | "employee";
  empCode: string;
  myCalGroup: string;
  allowedGroups: string[] | null;
  onClose: () => void;
  onSaved: () => void;
  defaultDate?: string;
  defaultTargetCal?: string;
  editEvent?: CustomEvent | null;
}

const AddEventModal = ({ employee, perm, empCode, myCalGroup, allowedGroups, onClose, onSaved, defaultDate, defaultTargetCal, editEvent }: AddModalProps) => {
  const todayStr = toLocalDate(new Date());
  const isEdit = !!editEvent;
  const [title, setTitle] = useState(isEdit ? editEvent!.title : "");
  const [isAllDay, setIsAllDay] = useState(isEdit ? editEvent!.is_all_day : true);
  const [startDate, setStartDate] = useState(isEdit ? editEvent!.start_date : (defaultDate || todayStr));
  const [endDate, setEndDate] = useState(isEdit ? editEvent!.end_date : (defaultDate || todayStr));
  const [startTime, setStartTime] = useState(isEdit && editEvent!.start_time ? editEvent!.start_time.slice(0, 5) : "09:30");
  const [endTime, setEndTime] = useState(isEdit && editEvent!.end_time ? editEvent!.end_time.slice(0, 5) : "18:00");
  const [repeatType, setRepeatType] = useState(isEdit ? (editEvent!.repeat_type || "none") : "none");
  const [targetCalendar, setTargetCalendar] = useState(
    isEdit ? editEvent!.target_calendar : (defaultTargetCal && defaultTargetCal !== "all" ? defaultTargetCal : myCalGroup)
  );
  const [selectedColor, setSelectedColor] = useState<string>(isEdit ? editEvent!.color : PALETTE[0].h);
  const [saving, setSaving] = useState(false);
  const [dlg, setDlg] = useState<string | null>(null);

  const repeatMap: Record<string, string> = { "なし": "none", "毎週": "weekly", "毎月": "monthly" };
  const repeatLabels = ["なし", "毎週", "毎月"];
  const calMap: Record<string, string> = {};
  CAL_GROUPS.forEach((g) => { calMap[g.label] = g.id; });

  const handleStartTimeChange = (newTime: string) => {
    setStartTime(newTime);
    const [h, m] = newTime.split(":").map(Number);
    const endH = h + 1;
    if (endH < 24) {
      setEndTime(`${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    } else {
      setEndTime("23:45");
    }
  };

  const handleSave = async () => {
    if (!title.trim()) { setDlg("予定名を入力してください"); return; }
    if (!startDate) { setDlg("開始日を選択してください"); return; }
    setSaving(true);
    if (isEdit) {
      const { error } = await supabase.from("custom_events").update({
        title: title.trim(),
        start_date: startDate,
        end_date: endDate || startDate,
        is_all_day: isAllDay,
        start_time: isAllDay ? null : startTime,
        end_time: isAllDay ? null : endTime,
        color: selectedColor,
        target_calendar: targetCalendar,
        repeat_type: repeatType,
      }).eq("id", editEvent!.id);
      setSaving(false);
      if (error) { setDlg("更新に失敗しました: " + error.message); return; }
    } else {
      const { error } = await supabase.from("custom_events").insert({
        company_id: employee.company_id,
        creator_employee_id: employee.id,
        creator_code: employee.employee_code,
        creator_name: employee.full_name,
        title: title.trim(),
        start_date: startDate,
        end_date: endDate || startDate,
        is_all_day: isAllDay,
        start_time: isAllDay ? null : startTime,
        end_time: isAllDay ? null : endTime,
        color: selectedColor,
        target_calendar: targetCalendar,
        repeat_type: repeatType,
      });
      setSaving(false);
      if (error) { setDlg("登録に失敗しました: " + error.message); return; }
    }
    onSaved();
    onClose();
  };

  const timeOptions = useMemo(() => {
    const opts: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        opts.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
    return opts;
  }, []);

  return (
    <div
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000, animation: "fadeIn 0.2s ease" }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: "#fff", borderRadius: "12px 12px 0 0", padding: "24px 20px", width: "100%", maxWidth: 440, maxHeight: "85vh", overflowY: "auto", animation: "slideUp 0.3s ease" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border, margin: "0 auto 16px" }} />
        <div style={{ fontSize: 17, fontWeight: 700, color: T.text, marginBottom: 20 }}>{isEdit ? "予定を編集" : "予定を追加"}</div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 4 }}>予定名</label>
          <input type="text" placeholder="例：月次ミーティング" value={title} onChange={(e) => setTitle(e.target.value)}
            style={{ width: "100%", padding: "11px 14px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: 16, boxSizing: "border-box" }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 14, color: T.text }}>終日</span>
          <div onClick={() => setIsAllDay(!isAllDay)}
            style={{ width: 46, height: 26, borderRadius: 13, backgroundColor: isAllDay ? T.kinmuGreen : T.border, padding: 2, cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", backgroundColor: "#fff", position: "absolute", top: 2, left: isAllDay ? "auto" : 2, right: isAllDay ? 2 : "auto", boxShadow: "0 1px 3px rgba(0,0,0,0.15)", transition: "all 0.2s" }} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 4 }}>開始日</label>
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (!endDate || e.target.value > endDate) setEndDate(e.target.value); }}
              style={{ width: "100%", padding: "9px 10px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: 13, boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 4 }}>終了日</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              style={{ width: "100%", padding: "9px 10px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: 13, boxSizing: "border-box" }} />
          </div>
        </div>

        {!isAllDay && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 4 }}>開始時刻</label>
              <select value={startTime} onChange={(e) => handleStartTimeChange(e.target.value)}
                style={{ width: "100%", padding: "9px 10px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: 13 }}>
                {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 4 }}>終了時刻</label>
              <select value={endTime} onChange={(e) => setEndTime(e.target.value)}
                style={{ width: "100%", padding: "9px 10px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: 13 }}>
                {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 4 }}>繰り返し</label>
            <select value={repeatLabels.find((l) => repeatMap[l] === repeatType) || "なし"}
              onChange={(e) => setRepeatType(repeatMap[e.target.value] || "none")}
              style={{ width: "100%", padding: "9px 10px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: 13 }}>
              {repeatLabels.map((v) => <option key={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 4 }}>対象</label>
            {canChooseTargetCalendar(perm, empCode) ? (
              <select value={CAL_GROUPS.find((g) => g.id === targetCalendar)?.label || "全店舗"}
                onChange={(e) => setTargetCalendar(calMap[e.target.value] || "all")}
                style={{ width: "100%", padding: "9px 10px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: 13 }}>
                {CAL_GROUPS.map((g) => <option key={g.id}>{g.label}</option>)}
              </select>
            ) : allowedGroups ? (
              <select value={CAL_GROUPS.find((g) => g.id === targetCalendar)?.label || ""}
                onChange={(e) => setTargetCalendar(calMap[e.target.value] || myCalGroup)}
                style={{ width: "100%", padding: "9px 10px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: 13 }}>
                {CAL_GROUPS.filter((g) => allowedGroups.includes(g.id)).map((g) => <option key={g.id}>{g.label}</option>)}
              </select>
            ) : (
              <div style={{ padding: "9px 10px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: 13, color: T.textSec, backgroundColor: T.bg }}>
                {CAL_GROUPS.find((g) => g.id === myCalGroup)?.label || "自店舗"}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 8 }}>色</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {PALETTE.map((c) => (
              <div key={c.h} title={c.n} onClick={() => setSelectedColor(c.h)}
                style={{ width: 30, height: 30, borderRadius: "50%", backgroundColor: c.h, cursor: "pointer", border: selectedColor === c.h ? `3px solid ${T.text}` : "3px solid transparent", transition: "border 0.15s" }} />
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: "6px", border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.textSec, fontSize: 14, cursor: "pointer" }}>閉じる</button>
          <button onClick={handleSave} disabled={saving}
            style={{ flex: 1, padding: "12px", borderRadius: "6px", border: "none", backgroundColor: saving ? T.textMuted : T.primary, color: "#fff", fontSize: 14, fontWeight: 600, cursor: saving ? "default" : "pointer" }}>
            {saving ? (isEdit ? "更新中..." : "登録中...") : (isEdit ? "更新" : "登録")}
          </button>
        </div>
      </div>
      {dlg && <Dialog message={dlg} onOk={() => setDlg(null)} />}
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
    </div>
  );
};

// ── メインコンポーネント ──────────────────────
export default function CalendarTab({ employee }: { employee: any }) {
  const now = new Date();
  const [yr, setYr] = useState(now.getFullYear());
  const [mo, setMo] = useState(now.getMonth() + 1);
  const [group, setGroup] = useState("all"); // 初期値はuseEffectで上書き
  const [selDay, setSelDay] = useState<number | null>(null);
  const [modal, setModal] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomEvent | null>(null);

  // 権限判定
  const perm = getPermLevel(employee?.role || null);
  const empCode = employee?.employee_code || "";
  const myCalGroup = storeIdToCalGroup(employee?.store_id || null, employee?.department || null);
  const showGroupSelect = canShowCalendarGroupSelect(perm, empCode);
  const allowedGroups = getAllowedCalGroups(perm, empCode);

  // 初回にデフォルトグループをセット
  useEffect(() => {
    setGroup(getDefaultCalendarGroup(perm, employee?.store_id || null, employee?.department || null, empCode));
  }, [perm, employee?.store_id, employee?.department, empCode]);

  // レスポンシブ判定（640px以下をモバイルとする）
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Supabaseデータ
  const [customEvents, setCustomEvents] = useState<CustomEvent[]>([]);
  const [attEvents, setAttEvents] = useState<AttendanceEvent[]>([]);
  const [loading, setLoading] = useState(false);

  // ── データ取得 ──────────────────────────
  const fetchData = useCallback(async () => {
    if (!employee?.company_id) return;
    setLoading(true);

    const monthStart = `${yr}-${String(mo).padStart(2, "0")}-01`;
    const daysInMonth = new Date(yr, mo, 0).getDate();
    const monthEnd = `${yr}-${String(mo).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

    const { data: evData } = await supabase
      .from("custom_events")
      .select("id, title, start_date, end_date, is_all_day, start_time, end_time, color, target_calendar, repeat_type, creator_employee_id, creator_code, creator_name")
      .eq("company_id", employee.company_id)
      .or(`and(start_date.lte.${monthEnd},end_date.gte.${monthStart}),repeat_type.neq.none`);

    setCustomEvents(evData || []);

    const { data: attData } = await supabase
      .from("attendance_daily")
      .select("employee_id, attendance_date, reason, employees!inner(full_name, employee_code, store_id, department)")
      .eq("company_id", employee.company_id)
      .gte("attendance_date", monthStart)
      .lte("attendance_date", monthEnd)
      .not("reason", "is", null)
      .neq("reason", "");

    const mapped: AttendanceEvent[] = (attData || [])
      .filter((row: any) => row.reason && row.reason !== "公休" && row.reason !== "休職" && (row.employees as any)?.employee_code !== "002")
      .map((row: any) => ({
        employee_id: row.employee_id,
        full_name: (row.employees as any)?.full_name || "不明",
        emp_code: (row.employees as any)?.employee_code || "",
        attendance_date: row.attendance_date,
        reason: row.reason,
        calGroup: storeIdToCalGroup((row.employees as any)?.store_id || null, (row.employees as any)?.department || null),
      }));

    setAttEvents(mapped);
    setLoading(false);
  }, [yr, mo, employee?.company_id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── 月送り ──────────────────────────────
  const go = useCallback((dir: 1 | -1) => {
    const [ny, nm] = stepMonth(yr, mo, dir);
    setYr(ny); setMo(nm); setSelDay(null);
  }, [yr, mo]);

  const swipeRef = useSmoothSwipe(go);

  // ── カレンダーグリッド生成 ──────────────────
  const cells = useMemo(() => {
    const firstDow = new Date(yr, mo - 1, 1).getDay();
    const daysInMonth = new Date(yr, mo, 0).getDate();
    const prevMonthDays = new Date(yr, mo - 1, 0).getDate();
    const arr: { day: number; cur: boolean }[] = [];
    for (let i = firstDow - 1; i >= 0; i--) arr.push({ day: prevMonthDays - i, cur: false });
    for (let d = 1; d <= daysInMonth; d++) arr.push({ day: d, cur: true });
    while (arr.length < 42) arr.push({ day: arr.length - firstDow - daysInMonth + 1, cur: false });
    return arr;
  }, [yr, mo]);

  // ── 日ごとのイベント取得 ──────────────────────
  const isJimu = canViewJimuCalendar(empCode);
  const getEventsForDay = useCallback((day: number) => {
    const results: (CustomEvent & { _startDay: number; _endDay: number })[] = [];
    for (const ev of customEvents) {
      // 業務部イベントは W02/W49/W67 のみ閲覧可
      if (ev.target_calendar === "jimu" && !isJimu) continue;
      if (group !== "all" && ev.target_calendar !== "all" && ev.target_calendar !== group) continue;
      const spans = expandRepeats(ev, yr, mo);
      for (const span of spans) {
        if (day >= span.startDay && day <= span.endDay) {
          results.push({ ...ev, _startDay: span.startDay, _endDay: span.endDay });
          break;
        }
      }
    }
    return results;
  }, [customEvents, yr, mo, group, isJimu]);

  const getAttForDay = useCallback((day: number) => {
    const dateStr = `${yr}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return attEvents.filter((a) => {
      if (a.attendance_date !== dateStr) return false;
      if (group === "all") return true;
      return a.calGroup === group;
    });
  }, [attEvents, yr, mo, group]);

  // ── 選択日 ──────────────────────────────
  const selCustom = useMemo(() => selDay ? getEventsForDay(selDay) : [], [selDay, getEventsForDay]);
  const selAtt = useMemo(() => selDay ? getAttForDay(selDay) : [], [selDay, getAttForDay]);
  const selTotal = selCustom.length + selAtt.length;

  // ── 削除処理 ──────────────────────────
  const [calDialog, setCalDialog] = useState<{ message: string; mode: "alert" | "confirm"; onOk: () => void } | null>(null);

  const handleDelete = (eventId: string) => {
    setCalDialog({
      message: "この予定を削除しますか？",
      mode: "confirm",
      onOk: async () => {
        setCalDialog(null);
        const { error } = await supabase.from("custom_events").delete().eq("id", eventId);
        if (error) { setCalDialog({ message: "削除に失敗しました: " + error.message, mode: "alert", onOk: () => setCalDialog(null) }); return; }
        fetchData();
      },
    });
  };

  const canDelete = (creatorId: string) => {
    return canDeleteEvent(perm, creatorId, employee.id);
  };

  // ── 今日判定 ──────────────────────────
  const today = new Date();
  const isToday = (d: number) => today.getFullYear() === yr && today.getMonth() + 1 === mo && today.getDate() === d;

  // ── バッジ表示数 ──────────────────────────
  const maxBadges = 4;

  // ── 詳細パネル内容（PC右サイド / スマホ右スライドイン共用） ──
  const DetailContent = () => {
    if (!selDay) return null;
    return (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
            {mo}月{selDay}日（{DOW[new Date(yr, mo - 1, selDay).getDay()]}）
            <span style={{ fontSize: 12, color: T.textSec, fontWeight: 400, marginLeft: 6 }}>{selTotal}件</span>
          </div>
          <button onClick={() => setModal(true)} style={{ width: 26, height: 26, border: "none", backgroundColor: T.primary, borderRadius: "50%", color: "#fff", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button><button onClick={() => setSelDay(null)} style={{ width: 26, height: 26, border: "none", backgroundColor: T.bg, borderRadius: "50%", color: T.textSec, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginLeft: 4 }}>×</button>
        </div>

        {selAtt.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6, fontWeight: 600 }}>勤怠</div>
            {selAtt.map((a, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${T.borderLight}` }}>
                <span style={{ fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{calendarDisplayName(a.full_name, a.emp_code)}</span>
                <ReasonBadges reason={displayReason(a.reason, (a as any).emp_code || "") || a.reason} />
              </div>
            ))}
          </div>
        )}

        {selCustom.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6, fontWeight: 600 }}>カスタム予定</div>
            {selCustom.map((e) => (
              <div key={e.id} onClick={() => { if (canDelete(e.creator_employee_id)) { setEditTarget(e); setModal(true); } }} style={{ padding: "7px 0", borderBottom: `1px solid ${T.borderLight}`, cursor: canDelete(e.creator_employee_id) ? "pointer" : "default", WebkitTapHighlightColor: "transparent", touchAction: "manipulation" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: e.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>{e.title}</span>
                  {e.repeat_type !== "none" && (
                    <Badge bg="#EDE9FE" color="#7C3AED" style={{ fontSize: 9, padding: "1px 6px" }}>
                      {e.repeat_type === "weekly" ? "毎週" : "毎月"}
                    </Badge>
                  )}
                </div>
                <div style={{ fontSize: 11, color: T.textMuted, marginLeft: 14 }}>
                  {e.is_all_day ? "終日" : `${e.start_time?.slice(0, 5) || ""} 〜 ${e.end_time?.slice(0, 5) || ""}`}
                  {" ・ "}{e.creator_name || "不明"}
                </div>
                {canDelete(e.creator_employee_id) && (
                  <button onClick={(ev) => { ev.stopPropagation(); handleDelete(e.id); }}
                    style={{ fontSize: 11, color: T.danger, background: "none", border: "none", cursor: "pointer", padding: "4px 0 0 14px" }}>
                    削除
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {selTotal === 0 && (
          <div style={{ fontSize: 13, color: T.textMuted, textAlign: "center", padding: "20px 0" }}>予定はありません</div>
        )}
      </>
    );
  };

  // ── レンダリング ──────────────────────────
  return (
    <div style={{ padding: isMobile ? "8px 4px" : "12px 16px" }}>
      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8, padding: isMobile ? "0 4px" : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => go(-1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: "6px", backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>◀</button>
          <span style={{ fontSize: 15, fontWeight: 700, color: T.text, minWidth: 90, textAlign: "center" }}>{yr}年{mo}月</span>
          <button onClick={() => go(1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: "6px", backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>▶</button>
          {showGroupSelect && (
            <select value={group} onChange={(e) => setGroup(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: 12, color: T.textSec }}>
              {allowedGroups
                ? CAL_GROUPS.filter((g) => allowedGroups.includes(g.id)).map((g) => (
                    <option key={g.id} value={g.id}>{g.label}</option>
                  ))
                : CAL_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)
              }
            </select>
          )}
        </div>
        <button onClick={() => setModal(true)}
          style={{ width: 38, height: 38, borderRadius: "50%", border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 22, fontWeight: 300, cursor: "pointer", boxShadow: "0 2px 10px rgba(0,175,204,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          +
        </button>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: "8px 0", fontSize: 12, color: T.textMuted }}>読み込み中...</div>
      )}

      {/* PC: カレンダー + 右パネル横並び / スマホ: カレンダーのみ（パネルは右スライドイン） */}
      <div style={{
        display: isMobile ? "block" : "flex",
        gap: 16,
      }}>
        {/* カレンダーグリッド */}
        <div ref={swipeRef} style={{ flex: "1 1 0%", minWidth: 0, willChange: "transform" }}>
          {/* 曜日ヘッダー */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 2 }}>
            {DOW.map((d, i) => (
              <div key={d} style={{ textAlign: "center", padding: "6px 0", fontSize: 11, fontWeight: 600, color: i === 0 ? T.holidayRed : i === 6 ? T.yukyuBlue : T.textSec }}>{d}</div>
            ))}
          </div>

          {/* 日付グリッド */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {cells.map((c, idx) => {
              const dow = idx % 7;
              const ev = c.cur ? getEventsForDay(c.day) : [];
              const at = c.cur ? getAttForDay(c.day) : [];
              const isSel = selDay === c.day && c.cur;
              const isTod = c.cur && isToday(c.day);
              const totalItems = at.length + ev.length;

              return (
                <div key={idx}
                  onClick={() => c.cur && setSelDay(selDay === c.day ? null : c.day)}
                  style={{
                    minHeight: isMobile ? 70 : 120, minWidth: 0,
                    padding: isMobile ? "4px 2px" : "4px",
                    cursor: c.cur ? "pointer" : "default",
                    backgroundColor: isSel ? T.primaryLight : "#fff",
                    border: isTod ? `2px solid ${T.primary}` : isSel ? `2px solid ${T.primary}` : `1px solid ${T.border}`,
                    borderRadius: "4px",
                    opacity: c.cur ? 1 : 0.25,
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  {/* 日付番号 */}
                  <div style={{
                    fontSize: isMobile ? 12 : 14,
                    fontWeight: 700,
                    marginBottom: 6,
                    color: !c.cur ? T.textMuted : dow === 0 ? T.holidayRed : dow === 6 ? T.yukyuBlue : T.text,
                  }}>{c.day}</div>

                  {/* バッジエリア */}
                  {c.cur && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      {/* 勤怠バッジ */}
                      {at.slice(0, maxBadges).map((a, j) => {
                        const isYukyu = a.reason.includes("有給");
                        const displayR = displayReason(a.reason, a.emp_code || "") || a.reason;
                        const isKibou = displayR.includes("希望休") || displayR.includes("公休");
                        return (
                          <div key={`a${j}`} style={{
                            fontSize: isMobile ? 10 : 13,
                            padding: isMobile ? "2px 3px" : "3px 4px",
                            borderRadius: "3px",
                            lineHeight: isMobile ? "14px" : "18px",
                            backgroundColor: isYukyu ? "#DBEAFE" : isKibou ? "#FEF9C3" : "#DCFCE7",
                            color: isYukyu ? T.yukyuBlue : isKibou ? T.warning : T.kinmuGreen,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>{calendarDisplayName(a.full_name, a.emp_code)}{isMobile ? "" : "　" + displayR.replace(/（.*?）/g, "")}</div>
                        );
                      })}
                      {/* カスタム予定バッジ（残り枠） */}
                      {ev.slice(0, Math.max(0, maxBadges - at.length)).map((e, j) => (
                        <div key={`e${j}`} style={{
                          fontSize: isMobile ? 10 : 13,
                          padding: isMobile ? "2px 3px" : "3px 4px",
                          borderRadius: "3px",
                          lineHeight: isMobile ? "14px" : "18px",
                          backgroundColor: e.color, color: "#fff",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{e.title}</div>
                      ))}
                      {/* 超過分 */}
                      {totalItems > maxBadges && (
                        <div style={{ fontSize: 9, color: T.textMuted, lineHeight: "12px" }}>+他{totalItems - maxBadges}件</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ textAlign: "center", marginTop: 6, fontSize: 11, color: T.textPH }}>← スワイプで月送り →</div>
        </div>

        {/* PC: 詳細パネル右サイド sticky */}
        {selDay && !isMobile && (
          <div style={{ flex: "0 0 320px", minWidth: 0, alignSelf: "flex-start", position: "sticky", top: 100 }}>
            <div style={{ backgroundColor: "#fff", borderRadius: "6px", border: `1px solid ${T.border}`, padding: "14px" }}>
              <DetailContent />
            </div>
          </div>
        )}
      </div>

      {/* スマホ: 右からスライドインする詳細パネル */}
      {selDay && isMobile && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 900,
            backgroundColor: "rgba(0,0,0,0.3)",
            animation: "calFadeIn 0.2s ease",
          }}
          onClick={() => setSelDay(null)}
        >
          <div
            style={{
              position: "absolute", top: 100, right: 0, bottom: 0,
              width: "65%",
              backgroundColor: "#fff",
              boxShadow: "-4px 0 20px rgba(0,0,0,0.15)",
              padding: "20px 16px",
              overflowY: "auto",
              animation: "calSlideIn 0.25s ease",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <DetailContent />
          </div>
        </div>
      )}

      {/* 予定追加モーダル */}
      {modal && (
        <AddEventModal
          employee={employee}
          perm={perm}
          empCode={empCode}
          myCalGroup={myCalGroup}
          allowedGroups={allowedGroups}
          onClose={() => { setModal(false); setEditTarget(null); }}
          onSaved={fetchData}
          defaultDate={selDay ? `${yr}-${String(mo).padStart(2, "0")}-${String(selDay).padStart(2, "0")}` : undefined}
          defaultTargetCal={group}
          editEvent={editTarget}
        />
      )}

      {/* カスタムダイアログ */}
      {calDialog && (
        <Dialog
          message={calDialog.message}
          mode={calDialog.mode}
          confirmLabel={calDialog.mode === "confirm" ? "削除" : "OK"}
          confirmColor={calDialog.mode === "confirm" ? T.danger : T.primary}
          onOk={calDialog.onOk}
          onCancel={() => setCalDialog(null)}
        />
      )}

      <style>{`
        @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes calFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes calSlideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>
    </div>
  );
}
