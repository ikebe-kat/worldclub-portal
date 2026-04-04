// ═══════════════════════════════════════════
// lib/punchUtils.ts — 打刻ロジック
// 要件定義書 4-1 の時刻丸めルールを実装
// ═══════════════════════════════════════════
import { supabase } from "./supabase";

// ── 時刻丸め（要件定義書 4-1） ─────────────
/**
 * 出勤: 1分切り上げ
 * 例) 9:28:01〜9:28:59 → 9:29 / 9:28:00ちょうど → 9:28
 */
export function roundPunchIn(raw: Date): string {
  const d = new Date(raw);
  if (d.getSeconds() >= 1) {
    d.setSeconds(0);
    d.setMinutes(d.getMinutes() + 1);
  }
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 退勤: 1分切り捨て（秒を無視）
 * 例) 18:02:30 → 18:02
 */
export function roundPunchOut(raw: Date): string {
  return `${String(raw.getHours()).padStart(2, "0")}:${String(raw.getMinutes()).padStart(2, "0")}`;
}

/** 今日の日付を "YYYY-MM-DD" 形式で返す */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 曜日名（日〜土） */
const DOW_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

// ── 当日の打刻レコードを取得 ───────────────
export async function fetchTodayAttendance(employeeId: string) {
  const { data, error } = await supabase
    .from("attendance_daily")
    .select("id, raw_punch_in, raw_punch_out, rounded_in, rounded_out, reason")
    .eq("employee_id", employeeId)
    .eq("date", todayStr())
    .maybeSingle();  // なければnull（エラーにならない）

  if (error) throw error;
  return data;
}

// ── 出勤打刻 ──────────────────────────────
export async function punchIn(
  employeeId: string,
  companyId: string,
  storeId: string,
  workPattern: string | null
) {
  const now = new Date();
  const rawTime  = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
  const rounded  = roundPunchIn(now);
  const dateStr  = todayStr();
  const dayOfWeek = DOW_NAMES[now.getDay()];

  // 既存レコードがあればUPDATE、なければINSERT（upsert）
  const { data, error } = await supabase
    .from("attendance_daily")
    .upsert(
      {
        employee_id:  employeeId,
        company_id:   companyId,
        store_id:     storeId,
        date:         dateStr,
        day_of_week:  dayOfWeek,
        work_pattern: workPattern,
        raw_punch_in: rawTime,
        rounded_in:   rounded,
        break_minutes: 60,     // みなし60分（固定）
        updated_at:   new Date().toISOString(),
      },
      { onConflict: "employee_id,date" }  // UNIQUE制約のカラム
    )
    .select("id, rounded_in")
    .single();

  if (error) throw error;
  return { rounded };
}

// ── 退勤打刻 ──────────────────────────────
export async function punchOut(
  employeeId: string,
  companyId: string,
  storeId: string,
  workPattern: string | null
) {
  const now = new Date();
  const rawTime  = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
  const rounded  = roundPunchOut(now);
  const dateStr  = todayStr();

  // 当日レコードを取得（出勤時刻と所定時間が必要）
  const existing = await fetchTodayAttendance(employeeId);

  // 実労働時間・超過不足を計算（出勤記録がある場合のみ）
  let actualWorkMinutes: number | null = null;
  let diffMinutes: number | null = null;
  let scheduledMinutes: number | null = null;

  if (existing?.rounded_in && workPattern) {
    const [inH, inM] = existing.rounded_in.split(":").map(Number);
    const [outH, outM] = rounded.split(":").map(Number);
    actualWorkMinutes = (outH * 60 + outM) - (inH * 60 + inM) - 60; // -60=休憩

    // 所定労働時間をパターンから計算（例: "09:30-18:00" → 450分）
    const patternMatch = workPattern.match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
    if (patternMatch) {
      const [, sh, sm, eh, em] = patternMatch.map(Number);
      scheduledMinutes = (eh * 60 + em) - (sh * 60 + sm) - 60;
      diffMinutes = actualWorkMinutes - scheduledMinutes;
    }
  }

  const { error } = await supabase
    .from("attendance_daily")
    .upsert(
      {
        employee_id:            employeeId,
        company_id:             companyId,
        store_id:               storeId,
        date:                   dateStr,
        raw_punch_out:          rawTime,
        rounded_out:            rounded,
        actual_work_minutes:    actualWorkMinutes,
        scheduled_work_minutes: scheduledMinutes,
        diff_minutes:           diffMinutes,
        updated_at:             new Date().toISOString(),
      },
      { onConflict: "employee_id,date" }
    );

  if (error) throw error;
  return { rounded };
}
