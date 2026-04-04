// ═══════════════════════════════════════════
// lib/permissions.ts — 全タブ共通の権限判定
// ═══════════════════════════════════════════

// ── ロール定義 ──────────────────────────
export type PermLevel = "super" | "admin" | "employee";

/**
 * employees.role（日本語）からロールレベルを判定
 * - "全店（代表）" / "全店（専務）" / "全店（人事）" / "全店（本部長）" → super
 * - "健軍店長" / "八代店長" / "経理" / "鈑金塗装" → admin
 * - その他 → employee
 */
export function getPermLevel(role: string | null): PermLevel {
  if (!role) return "employee";
  if (role.startsWith("全店")) return "super";
  if (role.includes("店長") || role.includes("経理") || role.includes("鈑金")) return "admin";
  return "employee";
}

// ══════════════════════════════════════════
// カレンダー権限
// ══════════════════════════════════════════

// ── store_id(UUID先頭8文字) → カレンダーグループ ──
const STORE_TO_CAL_GROUP: Record<string, string> = {
  "f933a681": "yatsushiro",
  "9ed83ee0": "kengun",
  "19a54657": "ozu",
  "54b1bebb": "gyomu",
  "68746fa3": "gyomu",
  "eedb5c24": "gyomu",
  "52b33086": "gyomu",
  "db99ae65": "gyomu",
};

// ── 業務部判定（カレンダーグループ） ──
const GYOMU_DEPTS = ["人事", "経理", "DX", "人事総務", "DX推進"];

export function storeIdToCalGroup(storeId: string | null, department?: string | null): string {
  if (department && GYOMU_DEPTS.some((d) => department.includes(d))) return "gyomu";
  if (!storeId) return "all";
  const prefix = storeId.slice(0, 8);
  return STORE_TO_CAL_GROUP[prefix] || "gyomu";
}

// ── 特定社員のカレンダー特殊権限 ──
const SPECIAL_CAL_ACCESS: Record<string, string[]> = {
  "049": ["all", "kengun", "ozu", "yatsushiro", "gyomu"],  // 岩永 → 全カレンダー
  "094": ["gyomu", "ozu"],     // 鳥巣 → 業務部+大津
  "095": ["gyomu", "kengun"],  // 浜村 → 業務部+健軍
};

export function canShowCalendarGroupSelect(perm: PermLevel, employeeCode?: string): boolean {
  if (perm !== "employee") return true;
  if (employeeCode && SPECIAL_CAL_ACCESS[employeeCode]) return true;
  return false;
}

export function getAllowedCalGroups(perm: PermLevel, employeeCode?: string): string[] | null {
  if (perm !== "employee") return null;
  if (employeeCode && SPECIAL_CAL_ACCESS[employeeCode]) return SPECIAL_CAL_ACCESS[employeeCode];
  return null;
}

export function getDefaultCalendarGroup(perm: PermLevel, storeId: string | null, department?: string | null, employeeCode?: string): string {
  if (perm !== "employee") return "all";
  if (employeeCode && SPECIAL_CAL_ACCESS[employeeCode]) return SPECIAL_CAL_ACCESS[employeeCode][0];
  return storeIdToCalGroup(storeId, department);
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

interface RosterScope {
  type: "all" | "store_detail" | "basic_only";
  stores?: string[];
  noDependents?: boolean;
}

const ROSTER_SCOPES: Record<string, RosterScope> = {
  "003": { type: "all", noDependents: true },                                // 近藤 → 全店舗detail、扶養書類以外
  "006": { type: "store_detail", stores: ["9ed83ee0"], noDependents: true },  // 山口 → 健軍のみdetail
  "009": { type: "store_detail", stores: ["f933a681"], noDependents: true },  // 吉田 → 八代のみdetail
  "049": { type: "basic_only" },                                               // 岩永 → KATは基本のみ
};

export function canSeeProfile(
  viewerPerm: PermLevel,
  viewerCode: string,
  isSelf: boolean,
  targetStoreId: string | null,
  section: ProfileSection,
): boolean {
  if (isSelf) return section !== "sensitive";
  if (viewerPerm === "super") return true;

  const scope = ROSTER_SCOPES[viewerCode];
  if (scope) {
    if (scope.type === "basic_only") return section === "basic";
    if (section === "sensitive") return false;
    if (scope.type === "all") return true;
    if (scope.type === "store_detail" && targetStoreId) {
      const prefix = targetStoreId.slice(0, 8);
      if (scope.stores?.includes(prefix)) return true;
    }
    return section === "basic";
  }

  return section === "basic";
}

// ══════════════════════════════════════════
// 打刻修正権限（管理者画面で今後使用）
// ══════════════════════════════════════════

interface PunchEditScope {
  type: "all" | "stores" | "department" | "none";
  stores?: string[];
  department?: string;
}

const PUNCH_EDIT_SCOPES: Record<string, PunchEditScope> = {
  "002": { type: "all" },                                          // 代表
  "018": { type: "all" },                                          // 専務
  "067": { type: "all" },                                          // 池邉
  "003": { type: "all" },                                          // 近藤
  "006": { type: "stores", stores: ["9ed83ee0"] },                 // 山口 → 健軍
  "009": { type: "stores", stores: ["f933a681"] },                 // 吉田 → 八代
  "069": { type: "department", department: "鈑金塗装" },         // 中野 → 鈑金塗装部
};

export function canEditPunch(
  editorCode: string,
  targetStoreId: string | null,
  targetDepartment: string | null,
): boolean {
  const scope = PUNCH_EDIT_SCOPES[editorCode];
  if (!scope) return false;
  if (scope.type === "all") return true;
  if (scope.type === "stores" && targetStoreId) {
    const prefix = targetStoreId.slice(0, 8);
    return scope.stores?.includes(prefix) || false;
  }
  if (scope.type === "department" && targetDepartment) {
    return targetDepartment.includes(scope.department || "");
  }
  return false;
}
