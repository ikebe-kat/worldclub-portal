// ═══════════════════════════════════════════
// lib/leaveDays.ts — 有給日数の唯一の集計ロジック
//
// WCの有給reason表記は3種のみ (2026-07-21 DB確認済):
//   「有給（全日）」    → 1.0日
//   「午前有給」        → 0.5日
//   「午後有給」        → 0.5日
//
// reasonは "午前有給+出張" のような複合文字列にもなり得るため
// LIKE '%…%' 相当の部分一致で判定する。SQL側 (wc_fn_calculate_monthly_payroll)
// の CASE も同じルール。
// ═══════════════════════════════════════════

/** reason 1件から有給日数を算出（全日=1.0 / 午前・午後=0.5 / それ以外=0） */
export function countPaidLeaveDays(reason: string | null | undefined): number {
  if (!reason) return 0;
  if (reason.includes("有給（全日）")) return 1.0;
  if (reason.includes("午前有給") || reason.includes("午後有給")) return 0.5;
  return 0;
}

/** reasonの配列（またはreason列を持つオブジェクト配列）から合計有給日数を算出 */
export function sumPaidLeaveDays(
  items: Array<{ reason?: string | null } | string | null | undefined>,
): number {
  let total = 0;
  for (const it of items) {
    const r = typeof it === "string" || it == null ? it : it.reason;
    total += countPaidLeaveDays(r);
  }
  return total;
}
