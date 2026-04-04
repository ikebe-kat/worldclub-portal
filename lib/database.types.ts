// ═══════════════════════════════════════════
// lib/database.types.ts — Supabase テーブル型定義
// 主要テーブルのみ定義（全テーブルは supabase gen types で自動生成可能）
// ═══════════════════════════════════════════

export type Database = {
  public: {
    Tables: {
      employees: {
        Row: {
          id:                   string;
          company_id:           string;
          store_id:             string;
          employee_code:        string;
          name:                 string;
          name_kana:            string | null;
          email:                string | null;
          phone:                string | null;
          gender:               string | null;
          birthday:             string | null;   // DATE → string
          hire_date:            string;           // DATE → string
          leave_date:           string | null;
          employment_type:      string;
          department:           string | null;
          position:             string | null;
          grade:                string | null;
          work_pattern:         string | null;
          holiday_calendar:     string | null;
          kibou_pattern:        string | null;
          weekly_days:          number;
          punch_required:       boolean;
          is_admin:             boolean;
          admin_scope:          Record<string, unknown> | null;
          status:               string;
          pin_hash:             string | null;
          address:              string | null;
          zipcode:              string | null;
          bank_info:            Record<string, unknown> | null;
          emergency_contact:    string | null;
          emergency_relation:   string | null;
          pension_number:       string | null;
          employment_insurance: string | null;
          skills:               string | null;
          photo_url:            string | null;
          created_at:           string;
          updated_at:           string;
        };
        Insert: Partial<Database["public"]["Tables"]["employees"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["employees"]["Row"]>;
      };

      attendance_daily: {
        Row: {
          id:                     string;
          company_id:             string;
          employee_id:            string;
          store_id:               string;
          date:                   string;         // DATE → string "YYYY-MM-DD"
          day_of_week:            string | null;
          work_pattern:           string | null;
          reason:                 string | null;
          raw_punch_in:           string | null;  // TIME → "HH:MM:SS"
          raw_punch_out:          string | null;
          rounded_in:             string | null;  // 丸め後
          rounded_out:            string | null;
          break_minutes:          number;
          late_minutes:           number;
          early_leave_minutes:    number;
          actual_work_minutes:    number | null;
          scheduled_work_minutes: number | null;
          overtime_minutes:       number | null;
          diff_minutes:           number | null;
          employee_note:          string | null;
          admin_note:             string | null;
          created_at:             string;
          updated_at:             string;
        };
        Insert: Partial<Database["public"]["Tables"]["attendance_daily"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["attendance_daily"]["Row"]>;
      };

      paid_leave_balances: {
        Row: {
          id:             string;
          employee_id:    string;
          slot:           number;        // 1 or 2 (2スロット管理)
          grant_date:     string;
          expiry_date:    string;
          granted_days:   number;
          remaining_days: number;
          is_expired:     boolean;
          created_at:     string;
          updated_at:     string;
        };
        Insert: Partial<Database["public"]["Tables"]["paid_leave_balances"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["paid_leave_balances"]["Row"]>;
      };
    };
  };
};
