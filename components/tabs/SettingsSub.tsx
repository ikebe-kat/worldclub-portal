"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { T } from "@/lib/constants";
import { supabase } from "@/lib/supabase";
import Dialog from "@/components/ui/Dialog";

const DOW = ["日","月","火","水","木","金","土"];

const CALENDAR_TYPES = [
  "営業フロント", "サービス", "鈑金塗装部", "インシュアランス部",
  "人事総務", "財務経理", "DX", "代表取締役", "パート水曜定休",
];

/* ══════════════════════════════════════ */
/* ── 休日カレンダー設定 ── */
/* ══════════════════════════════════════ */
const HolidayCalendarSection = ({ employee }: { employee: any }) => {
  const [calType, setCalType] = useState(CALENDAR_TYPES[0]);
  const [yr, setYr] = useState(new Date().getFullYear());
  const [mo, setMo] = useState(new Date().getMonth() + 1);
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dlg, setDlg] = useState<string | null>(null);

  const fetchHolidays = useCallback(async () => {
    if (!employee?.company_id) return;
    setLoading(true);
    const startDate = `${yr}-${String(mo).padStart(2, "0")}-01`;
    const endDay = new Date(yr, mo, 0).getDate();
    const endDate = `${yr}-${String(mo).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
    const { data } = await supabase
      .from("holiday_calendars")
      .select("holiday_date")
      .eq("company_id", employee.company_id)
      .eq("calendar_type", calType)
      .gte("holiday_date", startDate)
      .lte("holiday_date", endDate);
    const set = new Set<string>();
    (data || []).forEach((r: any) => set.add(r.holiday_date));
    setHolidays(set);
    setLoading(false);
  }, [yr, mo, calType, employee?.company_id]);

  useEffect(() => { fetchHolidays(); }, [fetchHolidays]);

  const daysInMonth = new Date(yr, mo, 0).getDate();
  const firstDow = new Date(yr, mo - 1, 1).getDay();

  const cells = useMemo(() => {
    const arr: { day: number; cur: boolean }[] = [];
    const prevDays = new Date(yr, mo - 1, 0).getDate();
    for (let i = firstDow - 1; i >= 0; i--) arr.push({ day: prevDays - i, cur: false });
    for (let d = 1; d <= daysInMonth; d++) arr.push({ day: d, cur: true });
    while (arr.length < 42) arr.push({ day: arr.length - firstDow - daysInMonth + 1, cur: false });
    return arr;
  }, [yr, mo, daysInMonth, firstDow]);

  const toggleDay = async (day: number) => {
    if (saving) return;
    const dateStr = `${yr}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    setSaving(true);
    if (holidays.has(dateStr)) {
      const { error } = await supabase
        .from("holiday_calendars")
        .delete()
        .eq("company_id", employee.company_id)
        .eq("calendar_type", calType)
        .eq("holiday_date", dateStr);
      if (error) { setDlg("削除に失敗: " + error.message); setSaving(false); return; }
      setHolidays(prev => { const next = new Set(prev); next.delete(dateStr); return next; });
    } else {
      const { error } = await supabase
        .from("holiday_calendars")
        .insert({ company_id: employee.company_id, calendar_type: calType, holiday_date: dateStr });
      if (error) { setDlg("追加に失敗: " + error.message); setSaving(false); return; }
      setHolidays(prev => { const next = new Set(prev); next.add(dateStr); return next; });
    }
    setSaving(false);
  };

  const goMonth = (dir: number) => {
    let ny = yr, nm = mo + dir;
    if (nm > 12) { nm = 1; ny++; } else if (nm < 1) { nm = 12; ny--; }
    setYr(ny); setMo(nm);
  };

  const holidayCount = holidays.size;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={calType}
          onChange={(e) => setCalType(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, color: T.text }}
        >
          {CALENDAR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={() => goMonth(-1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: 6, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>◀</button>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.text, minWidth: 90, textAlign: "center" }}>{yr}年{mo}月</span>
        <button onClick={() => goMonth(1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: 6, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>▶</button>
        <span style={{ fontSize: 12, color: T.textSec, marginLeft: "auto" }}>
          休日: <strong style={{ color: T.holidayRed }}>{holidayCount}</strong>日
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "30px", color: T.textMuted, fontSize: 13 }}>読み込み中...</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 2 }}>
            {DOW.map((d, i) => (
              <div key={d} style={{ textAlign: "center", padding: "6px 0", fontSize: 11, fontWeight: 600, color: i === 0 ? T.holidayRed : i === 6 ? "#3B82F6" : T.textSec }}>{d}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {cells.map((c, idx) => {
              const dow = idx % 7;
              const dateStr = c.cur ? `${yr}-${String(mo).padStart(2, "0")}-${String(c.day).padStart(2, "0")}` : "";
              const isHol = c.cur && holidays.has(dateStr);
              return (
                <div
                  key={idx}
                  onClick={() => c.cur && toggleDay(c.day)}
                  style={{
                    minHeight: 44,
                    padding: "6px 4px",
                    textAlign: "center",
                    cursor: c.cur ? "pointer" : "default",
                    backgroundColor: isHol ? "#FEE2E2" : "#fff",
                    border: isHol ? `2px solid ${T.holidayRed}` : `1px solid ${T.border}`,
                    borderRadius: 4,
                    opacity: c.cur ? 1 : 0.2,
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{
                    fontSize: 14, fontWeight: 600,
                    color: !c.cur ? T.textMuted : isHol ? T.holidayRed : dow === 0 ? T.holidayRed : dow === 6 ? "#3B82F6" : T.text,
                  }}>{c.day}</div>
                  {isHol && <div style={{ fontSize: 9, color: T.holidayRed, marginTop: 2 }}>休</div>}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 8, textAlign: "center" }}>日付をタップして休日ON/OFF</div>
        </>
      )}
      {dlg && <Dialog message={dlg} onOk={() => setDlg(null)} />}
    </div>
  );
};

/* ══════════════════════════════════════ */
/* ── 変形労働時間設定 ── */
/* ══════════════════════════════════════ */
const VariableHoursSection = ({ employee }: { employee: any }) => {
  const [yr, setYr] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<{ yearMonth: string; month: number; hours: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dlg, setDlg] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!employee?.company_id) return;
    setLoading(true);
    const monthRows: { yearMonth: string; month: number; hours: string }[] = [];
    for (let m = 1; m <= 12; m++) {
      monthRows.push({ yearMonth: `${yr}/${String(m).padStart(2, "0")}`, month: m, hours: "" });
    }

    const { data } = await supabase
      .from("variable_hours_settings")
      .select("year_month, scheduled_hours")
      .eq("company_id", employee.company_id)
      .like("year_month", `${yr}/%`);

    const dataMap: Record<string, string> = {};
    (data || []).forEach((r: any) => { dataMap[r.year_month] = String(r.scheduled_hours); });

    monthRows.forEach((r) => {
      if (dataMap[r.yearMonth]) r.hours = dataMap[r.yearMonth];
    });

    // variable_hours_settingsが空なら旧テーブルも見る
    if (!data || data.length === 0) {
      const { data: oldData } = await supabase
        .from("variable_hours")
        .select("year_month, scheduled_hours")
        .eq("company_id", employee.company_id)
        .like("year_month", `${yr}/%`);
      (oldData || []).forEach((r: any) => {
        const found = monthRows.find(mr => mr.yearMonth === r.year_month);
        if (found && !found.hours) found.hours = String(r.scheduled_hours);
      });
    }

    setRows(monthRows);
    setLoading(false);
  }, [yr, employee?.company_id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateHours = (month: number, val: string) => {
    setRows(prev => prev.map(r => r.month === month ? { ...r, hours: val } : r));
  };

  const handleSave = async () => {
    setSaving(true);
    const upserts = rows
      .filter(r => r.hours !== "")
      .map(r => ({
        company_id: employee.company_id,
        calendar_type: "default",
        year_month: r.yearMonth,
        scheduled_hours: parseFloat(r.hours) || 0,
        updated_at: new Date().toISOString(),
      }));

    if (upserts.length === 0) { setDlg("保存する値がありません"); setSaving(false); return; }

    const { error } = await supabase
      .from("variable_hours_settings")
      .upsert(upserts, { onConflict: "company_id,calendar_type,year_month" });

    setSaving(false);
    if (error) { setDlg("保存に失敗しました: " + error.message); return; }
    setDlg("保存しました");
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <button onClick={() => setYr(yr - 1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: 6, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>◀</button>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.text, minWidth: 60, textAlign: "center" }}>{yr}年</span>
        <button onClick={() => setYr(yr + 1)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: 6, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>▶</button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "30px", color: T.textMuted, fontSize: 13 }}>読み込み中...</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
            {rows.map((r) => (
              <div key={r.month} style={{ padding: "10px 12px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.textSec, marginBottom: 4 }}>{r.month}月</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="number"
                    step="0.25"
                    placeholder="0"
                    value={r.hours}
                    onChange={(e) => updateHours(r.month, e.target.value)}
                    style={{ width: "100%", padding: "7px 8px", borderRadius: 4, border: `1px solid ${T.border}`, fontSize: 15, fontWeight: 600, textAlign: "right", boxSizing: "border-box", fontVariantNumeric: "tabular-nums" }}
                  />
                  <span style={{ fontSize: 12, color: T.textSec, flexShrink: 0 }}>h</span>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "12px 32px", borderRadius: 6, border: "none",
              backgroundColor: saving ? T.textMuted : T.primary,
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: saving ? "default" : "pointer",
            }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </>
      )}
      {dlg && <Dialog message={dlg} onOk={() => setDlg(null)} />}
    </div>
  );
};

/* ══════════════════════════════════════ */
/* ── メインコンポーネント ── */
/* ══════════════════════════════════════ */
export default function SettingsSub({ employee }: { employee: any }) {
  const [section, setSection] = useState<"holiday" | "variable">("holiday");

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <button
          onClick={() => setSection("holiday")}
          style={{
            padding: "8px 16px", borderRadius: 20, fontSize: 12, fontWeight: section === "holiday" ? 700 : 400,
            cursor: "pointer", border: section === "holiday" ? `2px solid ${T.primary}` : `1px solid ${T.border}`,
            backgroundColor: section === "holiday" ? T.primary + "15" : "#fff",
            color: section === "holiday" ? T.primary : T.textSec,
          }}
        >休日カレンダー</button>
        <button
          onClick={() => setSection("variable")}
          style={{
            padding: "8px 16px", borderRadius: 20, fontSize: 12, fontWeight: section === "variable" ? 700 : 400,
            cursor: "pointer", border: section === "variable" ? `2px solid ${T.primary}` : `1px solid ${T.border}`,
            backgroundColor: section === "variable" ? T.primary + "15" : "#fff",
            color: section === "variable" ? T.primary : T.textSec,
          }}
        >変形労働時間</button>
      </div>
      {section === "holiday" && <HolidayCalendarSection employee={employee} />}
      {section === "variable" && <VariableHoursSection employee={employee} />}
    </div>
  );
}