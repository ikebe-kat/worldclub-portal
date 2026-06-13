// ═══════════════════════════════════════════
// lib/permissions.ts — ワールドクラブ用 権限判定
// ═══════════════════════════════════════════

// ── ロール定義 ──────────────────────────
export type PermLevel = "super" | "admin" | "employee";

export function getPermLevel(role: string | null): PermLevel {
  if (!role) return "employee";
  if (role === "super") return "super";
  if (role === "admin") return "admin";
  // KAT互換（念のため）
  if (role.startsWith("全店")) return "super";
  if (role.includes("店長") || role.includes("経理") || role.includes("鈑金")) return "admin";
  return "employee";
}

// ══════════════════════════════════════════
// カレンダー権限
// ══════════════════════════════════════════

export const JIMU_CODES = ["W02", "W49", "W67"];

export function canViewJimuCalendar(employeeCode?: string | null): boolean {
  return !!employeeCode && JIMU_CODES.includes(employeeCode);
}

export function storeIdToCalGroup(_storeId: string | null, _department?: string | null): string {
  return "all";
}

export function canShowCalendarGroupSelect(_perm: PermLevel, employeeCode?: string): boolean {
  return canViewJimuCalendar(employeeCode);
}

export function getAllowedCalGroups(_perm: PermLevel, employeeCode?: string): string[] | null {
  if (canViewJimuCalendar(employeeCode)) return ["all", "jimu"];
  return ["all"];
}

export function getDefaultCalendarGroup(_perm: PermLevel, _storeId: string | null, _department?: string | null, _employeeCode?: string): string {
  return "all";
}

export function canChooseTargetCalendar(_perm: PermLevel, employeeCode?: string): boolean {
  return canViewJimuCalendar(employeeCode);
}

export function canDeleteEvent(
  perm: PermLevel,
  creatorEmployeeId: string,
  currentEmployeeId: string,
): boolean {
  if (creatorEmployeeId === currentEmployeeId) return true;
  return perm !== "employee";
}

// ══════════════════════════════════════════
// 名簿権限
// ══════════════════════════════════════════
// 詳細プロフィール（写真・生年月日・電話・メール等）を見れるのは
// 代表(W02) / 岩永(W49) / 池邉(W67) / 小川(WC001) の 4 名 + 本人のみ。
// それ以外（一般社員）は他人の詳細を一切見れない（モーダル自体を開かせない）。

export const ROSTER_DETAIL_VIEWER_CODES = ["W02", "W49", "W67", "WC001"];

export function canViewOthersProfile(viewerCode: string | null | undefined): boolean {
  return !!viewerCode && ROSTER_DETAIL_VIEWER_CODES.includes(viewerCode);
}

export type ProfileSection = "basic" | "detail" | "sensitive";

export function canSeeProfile(
  _viewerPerm: PermLevel,
  viewerCode: string,
  isSelf: boolean,
  _targetStoreId: string | null,
  section: ProfileSection,
): boolean {
  if (isSelf) return section !== "sensitive";
  if (canViewOthersProfile(viewerCode)) return section !== "sensitive";
  return false;
}

// ══════════════════════════════════════════
// 打刻修正権限
// ══════════════════════════════════════════

const PUNCH_EDIT_ALL: string[] = ["W02", "W49", "W67", "WC001"];

export function canEditPunch(
  editorCode: string,
  targetStoreId: string | null,
  targetDepartment: string | null,
): boolean {
  return PUNCH_EDIT_ALL.includes(editorCode);
}

// ══════════════════════════════════════════
// 休憩編集権限（WCパート）
// ══════════════════════════════════════════

export const BREAK_EDIT_CODES: string[] = ["W02", "W67", "WC001"];

export function canEditBreak(employeeCode: string | null | undefined): boolean {
  return !!employeeCode && BREAK_EDIT_CODES.includes(employeeCode);
}
