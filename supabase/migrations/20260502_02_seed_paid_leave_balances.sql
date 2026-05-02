-- ═══════════════════════════════════════════════════════════════
-- worldclub-portal: 2026年度 有給残高 初期投入
-- employees.full_name は触らず、employee_code でJOINして引く。
-- 池邉が手元のSQL Editorで実行する前提。
-- ═══════════════════════════════════════════════════════════════

WITH wc AS (SELECT 'c2d368f0-aa9b-4f70-b082-43ec07723d6c'::uuid AS cid)
INSERT INTO public.paid_leave_balances
  (company_id, employee_id, fiscal_year, carry_over, granted, consumed)
SELECT
  wc.cid, e.id, 2026, v.carry_over, v.granted, v.consumed
FROM wc
CROSS JOIN (VALUES
  ('WC001', 0, 20, 4),   -- 小川靖志
  ('WC002', 0, 20, 3),   -- 岩澤歩
  ('WC003', 3, 20, 1),   -- 寺井恵美
  ('WC004', 2, 20, 6),   -- 小森達也
  ('WC005', 0, 10, 2),   -- 小澤直美
  ('WC008', 0, 10, 0),   -- 島寄裕子
  ('WC010', 0, 20, 2),   -- 南亜矢子
  ('WC011', 0, 10, 0),   -- 新田真由美
  ('WC014', 0, 10, 0)    -- 小寺慎一
) AS v(emp_code, carry_over, granted, consumed)
JOIN public.employees e
  ON e.employee_code = v.emp_code AND e.company_id = wc.cid
ON CONFLICT (company_id, employee_id, fiscal_year)
DO UPDATE SET
  carry_over = EXCLUDED.carry_over,
  granted    = EXCLUDED.granted,
  consumed   = EXCLUDED.consumed,
  updated_at = now();
