// ═══════════════════════════════════════════
// lib/shiftPeriod.ts — WC シフトの月度ロジック（1か所に集約）
//
// 月度 (yr, mo) = 前月21日 〜 当月20日（既存 periodRange と同じ定義）
//   例: 8月度 = 7/21 〜 8/20
// 提出締切 = (mo-2)月25日 末
//   例: 8月度の締切 = 6/25
// 「いまの提出対象月度」:
//   1. WC shift_confirmations の confirmed_at IS NOT NULL の最大 target_month があれば +1ヶ月
//   2. 無ければ（確定ゼロ）→ 今日基準で次の25日締切に対応する月度を返す
//        今日 ≤ 当月25日 → 当月+2 月度
//        今日 > 当月25日 → 翌月+2 月度
// ═══════════════════════════════════════════
import { supabase } from "@/lib/supabase";
import { periodRange } from "@/lib/constants";

export interface PeriodYM { yr: number; mo: number; }

export function parseTargetMonth(s: string): PeriodYM {
  const [y, m] = s.split("-").map(Number);
  return { yr: y, mo: m };
}

export function formatTargetMonth(p: PeriodYM): string {
  return `${p.yr}-${String(p.mo).padStart(2, "0")}`;
}

export function addMonths(p: PeriodYM, n: number): PeriodYM {
  let { yr, mo } = p;
  mo += n;
  while (mo > 12) { mo -= 12; yr += 1; }
  while (mo < 1) { mo += 12; yr -= 1; }
  return { yr, mo };
}

export function nextMonth(p: PeriodYM): PeriodYM { return addMonths(p, 1); }
export function prevMonth(p: PeriodYM): PeriodYM { return addMonths(p, -1); }

/** 月度 p の提出締切日時（(mo-2)月25日 23:59:59.999） */
export function submissionDeadline(p: PeriodYM): Date {
  const d = addMonths(p, -2);
  return new Date(d.yr, d.mo - 1, 25, 23, 59, 59, 999);
}

/** 今日が指定月度の締切を過ぎているか */
export function isSubmissionClosed(p: PeriodYM, today: Date = new Date()): boolean {
  return today.getTime() > submissionDeadline(p).getTime();
}

/** 確定ゼロ前提：今日基準の提出対象月度（≤25→当月+2、>25→翌月+2） */
export function dateBasedDefaultPeriod(today: Date = new Date()): PeriodYM {
  const base: PeriodYM = { yr: today.getFullYear(), mo: today.getMonth() + 1 };
  const adjusted = today.getDate() <= 25 ? base : addMonths(base, 1);
  return addMonths(adjusted, 2);
}

/**
 * 「いまの提出対象月度」を返す。
 *   1. WC shift_confirmations の confirmed_at IS NOT NULL の最大 target_month があれば +1
 *   2. 無ければ dateBasedDefaultPeriod
 */
export async function getCurrentSubmissionPeriod(
  companyId: string,
  today: Date = new Date(),
): Promise<PeriodYM> {
  const { data } = await supabase.from("shift_confirmations")
    .select("target_month")
    .eq("company_id", companyId)
    .not("confirmed_at", "is", null)
    .order("target_month", { ascending: false })
    .limit(1);
  if (data && data.length > 0) {
    return nextMonth(parseTargetMonth(data[0].target_month as string));
  }
  return dateBasedDefaultPeriod(today);
}

/** 任意の attendance_date ("YYYY-MM-DD") から、その日が属する月度の "YYYY-MM" */
export function periodOfDateStr(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  let yr = d.getFullYear();
  let mo = d.getMonth() + 1;
  if (d.getDate() >= 21) {
    mo += 1; if (mo > 12) { mo = 1; yr += 1; }
  }
  return `${yr}-${String(mo).padStart(2, "0")}`;
}

/** 月度の i番目（1始まり）の "YYYY-MM-DD" */
export function periodDateAt(p: PeriodYM, idx: number): string {
  const { start } = periodRange(p.yr, p.mo);
  const s = new Date(start + "T00:00:00");
  s.setDate(s.getDate() + (idx - 1));
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(s.getDate()).padStart(2, "0")}`;
}

/** 月度の総日数 */
export function periodLength(p: PeriodYM): number {
  const { start, end } = periodRange(p.yr, p.mo);
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

/** 月度の開始日・終了日（"YYYY-MM-DD"） */
export function periodBounds(p: PeriodYM): { start: string; end: string } {
  return periodRange(p.yr, p.mo);
}
