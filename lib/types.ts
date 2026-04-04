// ═══════════════════════════════════════════
// KAT WORLD 勤怠アプリ — 型定義
// ═══════════════════════════════════════════

/** 権限レベル */
export type Permission = "super" | "admin" | "employee";

/** 店舗 */
export type StoreId = "kengun" | "ozu" | "yatsushiro" | "gyomu";

/** 従業員 */
export interface Employee {
  id: number;
  cd: string;
  name: string;
  kana: string;
  store: StoreId;
  role: string;
  gender: string;
  birthday: string;
  hire: string;
  type: string;
  grade: string;
  email: string;
  phone: string;
  skills: string;
  perm: Permission;
}

/** 打刻状態 */
export type PunchState = "none" | "in" | "both";

/** 日次勤怠行 */
export interface AttendanceRow {
  day: number;
  dow: number;        // 0=日〜6=土
  pi: string | null;  // 出勤時刻 "HH:MM"
  po: string | null;  // 退勤時刻 "HH:MM"
  reason: string | null;
  wm: number;         // 実労働時間（分）
  diff: number;       // 超過不足（分）
  off: boolean;       // 公休フラグ
}

/** 月次サマリー */
export interface MonthlySummary {
  wd: number;   // 出勤日数
  hd: number;   // 休日日数
  ab: number;   // 欠勤日数
  yu: number;   // 有給取得日数
  kr: number;   // 希望休残
  tw: number;   // 月間総労働（分）
  sm: number;   // 変形月所定（分）
  df: number;   // 月次超過不足（分）
}

/** カレンダーイベント */
export interface CalEvent {
  id: number;
  title: string;
  start: number;   // 日
  end: number;     // 日
  color: string;
  creator: string;
  allDay: boolean;
  time?: string;
  repeat: "none" | "weekly" | "monthly";
}

/** 書類 */
export interface Document {
  id: number;
  name: string;
  cat: string;
  date: string;
  ok: boolean;     // 確認済みフラグ
}

/** プッシュメッセージ */
export interface ToastMsg {
  t: string;
  ok: boolean;
}
