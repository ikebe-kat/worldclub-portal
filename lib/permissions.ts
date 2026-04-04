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

const GYOMU_DEPTS = ["人事", "経理", "人事総務", "経理財務"];

export function storeIdToCalGroup(storeId: string | null, department?: string | null): string {
  return "all";
}

export function canShowCalendarGroupSelect(perm: PermLevel, employeeCode?: string): boolean {
  return perm !== "employee";
}

export function getAllowedCalGroups(perm: PermLevel, employeeCode?: string): string[] | null {
  if (perm !== "employee") return null;
  return null;
}

export function getDefaultCalendarGroup(perm: PermLevel, storeId: string | null, department?: string | null, employeeCode?: string): string {
  return "all";
}

export function canChooseTargetCalendar(perm: PermLevel): boolean {
  return perm !== "employee";
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

export type ProfileSection = "basic" | "detail" | "sensitive";

export function canSeeProfile(
  viewerPerm: PermLevel,
  viewerCode: string,
  isSelf: boolean,
  targetStoreId: string | null,
  section: ProfileSection,
): boolean {
  if (isSelf) return section !== "sensitive";
  if (viewerPerm === "super") return true;
  if (viewerPerm === "admin") {
    return section !== "sensitive";
  }
  return section === "basic";
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
