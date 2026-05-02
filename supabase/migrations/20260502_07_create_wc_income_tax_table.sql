-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: 源泉徴収税額表（月額表・甲欄）
-- docs/tax-table.js から抽出。範囲は [bracket_min, bracket_max)。
-- 740,000円超は最終行 + (超過額 × 0.2042) で算出（関数側で処理）。
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.wc_income_tax_table (
  bracket_min  integer PRIMARY KEY,
  bracket_max  integer NOT NULL,
  d0 integer NOT NULL DEFAULT 0,  -- 扶養0人
  d1 integer NOT NULL DEFAULT 0,
  d2 integer NOT NULL DEFAULT 0,
  d3 integer NOT NULL DEFAULT 0,
  d4 integer NOT NULL DEFAULT 0,
  d5 integer NOT NULL DEFAULT 0,
  d6 integer NOT NULL DEFAULT 0,
  d7 integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.wc_income_tax_table IS '源泉徴収税額表（月額・甲欄）。範囲 [bracket_min, bracket_max) で扶養人数0〜7に対応';

-- RLS 無効化（wc_payroll_function が SECURITY DEFINER で参照するが念のため）
ALTER TABLE public.wc_income_tax_table DISABLE ROW LEVEL SECURITY;
