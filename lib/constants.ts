// ═══════════════════════════════════════════
// ワールドクラブ 勤怠アプリ — 共通定数・テーマ
// ═══════════════════════════════════════════

/** カラーテーマ */
export const T = {
  primary:      "#1a4b24",
  primaryLight: "#e8f5e9",
  text:         "#1A1A1A",
  textSec:      "#6B7280",
  textMuted:    "#9CA3AF",
  textPH:       "#C4C9D0",
  bg:           "#F5F7FA",
  border:       "#E8ECF0",
  borderLight:  "#F0F2F5",
  yukyuBlue:    "#3B82F6",
  kibouYellow:  "#EAB308",
  kinmuGreen:   "#22C55E",
  holidayRed:   "#EF4444",
  gold:         "#E6CB30",
  goldLight:    "#FFFDE7",
  success:      "#16A34A",
  danger:       "#DC2626",
  warning:      "#CA8A04",
} as const;

/** カレンダー予定カラーパレット（TimeTree準拠10色） */
export const PALETTE = [
  { n: "エメラルド", h: "#2dc653" },
  { n: "サイアン",   h: "#17a2b8" },
  { n: "スカイブルー", h: "#0d8bf2" },
  { n: "バイオレット", h: "#8b5cf6" },
  { n: "ローズ",     h: "#ec4899" },
  { n: "コーラル",   h: "#f472b6" },
  { n: "レッド",     h: "#ef4444" },
  { n: "オレンジ",   h: "#f59e0b" },
  { n: "ブラウン",   h: "#d4a574" },
  { n: "ブラック",   h: "#374151" },
] as const;

/** 曜日 */
export const DOW = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** カレンダーグループ（通知送り分け単位） */
export const CAL_GROUPS = [
  { id: "all",  label: "全体" },
  { id: "jimu", label: "業務部" },
] as const;

export type CalGroupId = (typeof CAL_GROUPS)[number]["id"];

/** 店舗IDからラベルを返すユーティリティ */
export const storeLabel = (id: string): string =>
  CAL_GROUPS.find((g) => g.id === id)?.label ?? id;

/** 分 → "H:MM" 形式 */
export const fmtMin = (m: number): string =>
  `${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, "0")}`;

/** 月を±1ステップ */
export const stepMonth = (
  yr: number,
  mo: number,
  dir: 1 | -1
): [number, number] => {
  let ny = yr;
  let nm = mo + dir;
  if (nm > 12) { nm = 1; ny++; }
  else if (nm < 1) { nm = 12; ny--; }
  return [ny, nm];
};

/** カレンダー用の短縮表示名（同姓自動判定 + DB上書き） */
export function calendarDisplayName(fullName: string, displayOverride?: string | null, allFullNames?: string[]): string {
  if (displayOverride) return displayOverride;
  const parts = (fullName || "").split(/\s+/);
  const surname = parts[0] || fullName;
  const given = parts[1] || "";
  if (allFullNames && given) {
    const unique = [...new Set(allFullNames)];
    if (unique.filter(n => (n || "").split(/\s+/)[0] === surname).length >= 2) {
      return surname + given.charAt(0);
    }
  }
  return surname;
}

/** 締め日20日: mo月度 = 前月21日〜当月20日 */
export const CUTOFF_DAY = 20;

export function periodRange(yr: number, mo: number): { start: string; end: string } {
  const py = mo === 1 ? yr - 1 : yr;
  const pm = mo === 1 ? 12 : mo - 1;
  return {
    start: `${py}-${String(pm).padStart(2, "0")}-21`,
    end:   `${yr}-${String(mo).padStart(2, "0")}-${CUTOFF_DAY}`,
  };
}

export function currentPeriodMonth(): { yr: number; mo: number } {
  const now = new Date();
  let mo = now.getMonth() + 1;
  let yr = now.getFullYear();
  if (now.getDate() >= 21) { mo++; if (mo > 12) { mo = 1; yr++; } }
  return { yr, mo };
}

export function periodDays(yr: number, mo: number): string[] {
  const { start, end } = periodRange(yr, mo);
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const days: string[] = [];
  const d = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  while (d <= last) {
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/** import互換用（ワールドクラブでは使用しない） */
export const KOUKYU_PART_CODES: readonly string[] = [];
export const isKoukyuPart = (_empCode: string): boolean => false;
export const displayReason = (reason: string | null, _empCode: string): string | null => reason;
export const displayChipLabel = (label: string, _empCode: string): string => label;
