"use client";
// ═══════════════════════════════════════════
// ShiftViewSub.tsx — シフト表（閲覧専用）
//
// 出勤簿タブの新規サブタブ「シフト表」。全社員が全員分を閲覧可。
// 縦=社員（氏名）× 横=月度(21〜20)の日付 のマトリクス。
// 編集機能は一切なし。ShiftSub は流用しない（編集用で過剰・未提出者を
// 白に落とすゲートを引き継がないため）。
//
// セル判定:
//   公休 (reason ⊇ "公休（全日）")                    → 「〇」
//   有給・全日 (countPaidLeaveDays(reason) === 1.0)   → 「有」
//   有給・半日 (countPaidLeaveDays(reason) === 0.5)   → 「半有」
//   出勤 (actual_hours > 0 or punch_in あり)          → 空白
//   それ以外                                          → 空白
//
// 有給判定は lib/leaveDays.ts の countPaidLeaveDays を再利用（SQL/他画面と同一ルール）。
// 公休判定は lib/leaveDays.ts::isPublicHolidayReason（新規追加）を使う。
// 既存の attendance_daily を読むだけで、SQL 変更・新テーブルなし。
// ═══════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { T, DOW, stepMonth, currentPeriodMonth } from "@/lib/constants";
import { periodBounds, periodDateAt, periodLength, type PeriodYM } from "@/lib/shiftPeriod";
import { countPaidLeaveDays, isPublicHolidayReason } from "@/lib/leaveDays";
import { fetchEmploymentStatus } from "@/lib/employmentRpc";

const COMPANY_ID = "c2d368f0-aa9b-4f70-b082-43ec07723d6c";

/** 表示対象: WCの実働メンバー（本部 W02/W49/W67 は除外）。ShiftSub と同じ判定。 */
const isVisibleCode = (code: string) => /^WC\d+$/.test(code || "");

/** 苗字を取得（"山田 太郎" → "山田"） */
const surname = (name: string) => (name || "").split(/\s+/)[0] || name;

interface Emp {
  id: string;
  employee_code: string;
  full_name: string;
  employment_type: string;
}

interface AttRow {
  employee_id: string;
  attendance_date: string;
  reason: string | null;
  actual_hours: number | null;
  punch_in: string | null;
}

type Cell = "koukyu" | "yukyu_full" | "yukyu_half" | "workday" | "empty";

/** attendance_daily 1行からセル状態を決める。優先: 公休 → 有給(全日/半日) → 出勤 → 空 */
function getCell(row: AttRow | undefined): Cell {
  if (!row) return "empty";
  if (isPublicHolidayReason(row.reason)) return "koukyu";
  const y = countPaidLeaveDays(row.reason);
  if (y >= 1.0) return "yukyu_full";
  if (y > 0) return "yukyu_half";
  if ((row.actual_hours ?? 0) > 0 || row.punch_in) return "workday";
  return "empty";
}

/** セル色・文字（公休は白地＋緑〇の線描き。有給は塗りつぶしのまま） */
const CELL_STYLE: Record<Cell, { bg: string; fg: string; label: string; fontSize?: number; fontWeight?: number }> = {
  koukyu:     { bg: "#fff",    fg: "#1a4b24",   label: "〇",   fontSize: 14, fontWeight: 700 },
  yukyu_full: { bg: "#1d4ed8", fg: "#fff",      label: "有",   fontSize: 12, fontWeight: 700 },
  yukyu_half: { bg: "#93c5fd", fg: "#1e3a8a",   label: "半有", fontSize: 10, fontWeight: 700 },
  workday:    { bg: "#fff",    fg: T.textMuted, label: "" },
  empty:      { bg: "#fff",    fg: T.textMuted, label: "" },
};

/** 曜日別の背景色（土=薄青・日=薄赤、他=白）。workday/empty 用のオーバーレイ。 */
const dowBg = (dow: number): string | null =>
  dow === 0 ? "#FDEDEC" : dow === 6 ? "#EBF5FB" : null;

export default function ShiftViewSub() {
  const _cp = currentPeriodMonth();
  const [period, setPeriod] = useState<PeriodYM>({ yr: _cp.yr, mo: _cp.mo });
  const [emps, setEmps] = useState<Emp[]>([]);
  const [atts, setAtts] = useState<AttRow[]>([]);
  const [loading, setLoading] = useState(true);

  const { start, end } = periodBounds(period);
  const days = periodLength(period);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: empRows }, { data: attRows }] = await Promise.all([
      supabase.from("employees")
        .select("id, employee_code, full_name, employment_type")
        .eq("company_id", COMPANY_ID)
        .or("is_active.is.null,is_active.eq.true")
        .order("employee_code"),
      supabase.from("attendance_daily")
        .select("employee_id, attendance_date, reason, actual_hours, punch_in")
        .eq("company_id", COMPANY_ID)
        .gte("attendance_date", start)
        .lte("attendance_date", end),
    ]);
    const statusMap = await fetchEmploymentStatus(COMPANY_ID, start, end, "attendance");
    const filtered = ((empRows || []) as Emp[])
      .filter(e => isVisibleCode(e.employee_code) && statusMap.get(e.id) !== "excluded");
    setEmps(filtered);
    setAtts((attRows || []) as AttRow[]);
    setLoading(false);
  }, [start, end]);

  useEffect(() => { load(); }, [load]);

  // (employee_id, date) → AttRow の索引
  const byEmpDate = useMemo(() => {
    const m = new Map<string, AttRow>();
    atts.forEach(a => m.set(`${a.employee_id}|${a.attendance_date}`, a));
    return m;
  }, [atts]);

  // 社員を「正社員 → パート → その他」の順で employee_code 昇順
  const sortedEmps = useMemo(() => {
    const rank = (t: string) => t === "正社員" ? 0 : t === "パート" ? 1 : 2;
    return [...emps].sort((a, b) => {
      const r = rank(a.employment_type) - rank(b.employment_type);
      if (r !== 0) return r;
      const na = parseInt((a.employee_code || "").replace(/^WC/, ""), 10) || 0;
      const nb = parseInt((b.employee_code || "").replace(/^WC/, ""), 10) || 0;
      return na - nb;
    });
  }, [emps]);
  const seishaCount = useMemo(() => sortedEmps.filter(e => e.employment_type === "正社員").length, [sortedEmps]);

  // 日付列のメタ（1..days）
  const cols = useMemo(() =>
    Array.from({ length: days }, (_, i) => {
      const idx = i + 1;
      const ds = periodDateAt(period, idx);
      const d = new Date(ds + "T00:00:00");
      return { idx, ds, day: d.getDate(), dow: d.getDay() };
    }),
    [period, days]
  );

  const stepMo = (dir: 1 | -1) => {
    const [ny, nm] = stepMonth(period.yr, period.mo, dir);
    setPeriod({ yr: ny, mo: nm });
  };

  // ── スタイル定数 ──
  const nameColBg = "#F9FAFB";
  const headBg    = "#1a4b24";
  const headFg    = "#fff";
  const headSatBg = "#EBF5FB";
  const headSunBg = "#FDEDEC";
  const headSatFg = "#2563EB";
  const headSunFg = "#DC2626";
  const border    = `1px solid ${T.border}`;
  const partBorder = `3px solid #1a4b24`;

  const thBase: React.CSSProperties = {
    padding: "4px 2px", fontSize: 11, fontWeight: 700,
    borderRight: border, borderBottom: `2px solid #374151`,
    textAlign: "center", verticalAlign: "middle",
  };
  const tdBase: React.CSSProperties = {
    padding: 0, minWidth: 30, height: 28,
    borderRight: border, borderBottom: border,
    textAlign: "center", verticalAlign: "middle",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div style={{ padding: "16px 12px" }}>
      {/* 月ナビ */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={() => stepMo(-1)} style={navBtn} aria-label="前の月度">◀</button>
        <span style={{ fontSize: 15, fontWeight: 700, minWidth: 110, textAlign: "center", color: T.text }}>
          {period.yr}年{period.mo}月度
        </span>
        <button onClick={() => stepMo(1)} style={navBtn} aria-label="次の月度">▶</button>
        <span style={{ fontSize: 11, color: T.textSec, marginLeft: 8 }}>{start} 〜 {end}</span>
      </div>

      {/* 凡例 */}
      <div style={{
        display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap",
        padding: "6px 10px", backgroundColor: "#fff", border,
      }}>
        <Legend bg={CELL_STYLE.koukyu.bg}     fg={CELL_STYLE.koukyu.fg}     label={CELL_STYLE.koukyu.label}     name="公休" outline />
        <Legend bg={CELL_STYLE.yukyu_full.bg} fg={CELL_STYLE.yukyu_full.fg} label={CELL_STYLE.yukyu_full.label} name="有給(全日)" />
        <Legend bg={CELL_STYLE.yukyu_half.bg} fg={CELL_STYLE.yukyu_half.fg} label={CELL_STYLE.yukyu_half.label} name="有給(半日)" />
        <Legend bg="#fff" fg={T.textMuted} label="" name="出勤 / データなし" outline />
      </div>

      {/* マトリクス */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textSec, fontSize: 13 }}>読み込み中...</div>
      ) : sortedEmps.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textMuted, fontSize: 13 }}>表示できる社員がいません。</div>
      ) : (
        <div style={{ overflow: "auto", WebkitOverflowScrolling: "touch", maxHeight: "calc(100vh - 220px)", border }}>
          <table style={{ borderCollapse: "collapse", fontSize: 11, backgroundColor: "#fff" }}>
            <thead>
              <tr>
                <th style={{
                  ...thBase,
                  position: "sticky", top: 0, left: 0, zIndex: 6,
                  backgroundColor: headBg, color: headFg, minWidth: 88,
                  boxShadow: "2px 0 4px rgba(0,0,0,0.08)",
                }}>
                  氏名
                </th>
                {cols.map(c => {
                  const isSun = c.dow === 0;
                  const isSat = c.dow === 6;
                  return (
                    <th key={c.idx} style={{
                      ...thBase,
                      position: "sticky", top: 0, zIndex: 5,
                      backgroundColor: isSun ? headSunBg : isSat ? headSatBg : headBg,
                      color: isSun ? headSunFg : isSat ? headSatFg : headFg,
                      minWidth: 30,
                    }}>
                      <div style={{ lineHeight: 1 }}>{c.day}</div>
                      <div style={{ fontSize: 10, fontWeight: 400, lineHeight: 1.2 }}>{DOW[c.dow]}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedEmps.map((emp, idx) => {
                const isPartBoundary = idx === seishaCount && seishaCount > 0;
                return (
                  <tr key={emp.id}>
                    <td style={{
                      ...tdBase,
                      position: "sticky", left: 0, zIndex: 3,
                      backgroundColor: nameColBg,
                      padding: "4px 8px", minWidth: 88, textAlign: "left",
                      borderTop: isPartBoundary ? partBorder : border,
                      boxShadow: "2px 0 4px rgba(0,0,0,0.06)",
                    }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{surname(emp.full_name)}</span>
                        <span style={{ fontSize: 10, color: T.textMuted }}>
                          {emp.employment_type === "正社員" ? "社" : emp.employment_type === "パート" ? "P" : ""}
                        </span>
                      </div>
                    </td>
                    {cols.map(c => {
                      const cell = getCell(byEmpDate.get(`${emp.id}|${c.ds}`));
                      const style = CELL_STYLE[cell];
                      // 公休/workday/empty は白ベースなので曜日背景色を適用（有給の塗りつぶし色は保持）
                      const bg = (cell === "workday" || cell === "empty" || cell === "koukyu") ? (dowBg(c.dow) ?? style.bg) : style.bg;
                      return (
                        <td key={c.idx} style={{
                          ...tdBase,
                          backgroundColor: bg,
                          color: style.fg,
                          fontSize: style.fontSize ?? 11,
                          fontWeight: style.fontWeight ?? 400,
                          borderTop: isPartBoundary ? partBorder : border,
                        }}>
                          {style.label}
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
    </div>
  );
}

/* ── ローカル部品 ── */
const navBtn: React.CSSProperties = {
  width: 32, height: 32, border: `1px solid ${T.border}`, borderRadius: 6,
  backgroundColor: "#fff", cursor: "pointer", fontSize: 13, color: T.textSec,
};

function Legend({ bg, fg, label, name, outline }: { bg: string; fg: string; label: string; name: string; outline?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <div style={{
        width: 22, height: 18, backgroundColor: bg, color: fg,
        border: outline ? `1px solid ${T.border}` : "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700,
      }}>{label}</div>
      <span style={{ fontSize: 11, color: T.textSec }}>{name}</span>
    </div>
  );
}
