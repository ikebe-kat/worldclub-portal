"use client";
import { useState, useCallback } from "react";
import { T } from "@/lib/constants";
import { supabase } from "@/lib/supabase";

/* ══════════════════════════════════════ */
/* ── 入社チェックシート Excel出力    ── */
/* ══════════════════════════════════════ */

interface NyushaProps {
  empId: string;
  empCode: string;
  empName: string;
  companyId: string;
}

export default function NyushaSheetExport({ empId, empCode, empName, companyId }: NyushaProps) {
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setGenerating(true);
    setMsg(null);
    try {
      // 従業員データ取得
      const { data: emp } = await supabase.from("employees")
        .select("full_name, full_name_kana, birth_date, gender, postal_code, address, phone, hire_date, department, employment_type, weekly_work_hours, employment_insurance_number, my_number, bank_name, bank_branch, bank_account_number, bank_account_holder, insurance_card_requested")
        .eq("id", empId).maybeSingle();
      if (!emp) { setMsg("従業員データが取得できません"); setGenerating(false); return; }

      // 扶養家族データ取得
      const { data: deps } = await supabase.from("dependents")
        .select("name, name_kana, birth_date, gender, relationship, living_arrangement, estimated_income, occupation, my_number, insurance_card_requested")
        .eq("employee_id", empId).order("created_at");

      // ExcelJS動的import
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();

      // ═══ シート1: 入社チェック ═══
      const ws1 = wb.addWorksheet("入社チェック");
      ws1.columns = [
        { width: 5 },   // A: No
        { width: 20 },  // B: 項目
        { width: 54 },  // C: 内容
        { width: 8 },   // D: チェック
      ];

      const headerFont = { name: "游ゴシック", size: 11, bold: true };
      const normalFont = { name: "游ゴシック", size: 11 };
      const borderAll = { top: { style: "thin" as const }, bottom: { style: "thin" as const }, left: { style: "thin" as const }, right: { style: "thin" as const } };

      // タイトル行
      const hireDate = emp.hire_date ? new Date(emp.hire_date) : null;
      const hireDateStr = hireDate ? `${hireDate.getFullYear()}/${String(hireDate.getMonth() + 1).padStart(2, "0")}/${String(hireDate.getDate()).padStart(2, "0")}` : "";
      ws1.getCell("C1").value = hireDateStr;
      ws1.getCell("C1").font = normalFont;
      ws1.getCell("B2").value = "入社チェックシート";
      ws1.getCell("B2").font = { name: "游ゴシック", size: 14, bold: true };

      // ヘッダー行
      const hRow = ws1.getRow(3);
      ["No", "項目", "内容", "チェック"].forEach((v, i) => {
        const cell = hRow.getCell(i + 1);
        cell.value = v;
        cell.font = headerFont;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
        cell.border = borderAll;
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });

      // 生年月日フォーマット
      const birthDate = emp.birth_date ? new Date(emp.birth_date) : null;
      const birthStr = birthDate ? `${birthDate.getFullYear()}/${String(birthDate.getMonth() + 1).padStart(2, "0")}/${String(birthDate.getDate()).padStart(2, "0")}` : "";

      // 性別チェックボックス文字列
      const genderStr = emp.gender === "男性" ? "■男　・　□女" : emp.gender === "女性" ? "□男　・　■女" : "□男　・　□女";

      // 雇用区分
      const empTypeMap: Record<string, string> = {
        "正社員": "■正社員",
        "パート": "■パート",
        "代表取締役": "■代表取締役",
        "特定技能": "■特定技能",
        "技能実習": "■技能実習",
      };
      const empTypeStr = empTypeMap[emp.employment_type] || emp.employment_type;

      // 週所定労働時間
      const weeklyHours = emp.weekly_work_hours ? `${emp.weekly_work_hours}時間` : "";

      // 口座情報
      const bankParts: string[] = [];
      if (emp.bank_name) bankParts.push(emp.bank_name);
      if (emp.bank_branch) bankParts.push(emp.bank_branch);
      if (emp.bank_account_number) bankParts.push(`口座番号：${emp.bank_account_number}`);
      const bankStr = bankParts.length > 0 ? bankParts.join("　") : "";

      // 雇用保険番号
      const rawIns = emp.employment_insurance_number || "";
      const empInsStr = rawIns ? String(rawIns).replace(/\.0$/, "") : "(不明の場合は前職会社名：　　　　　　　　 　　　　　　　　　　)";

      // データ行
      const items: [number, string, string][] = [
        [1, "フリガナ", emp.full_name_kana || ""],
        [2, "氏名", emp.full_name || ""],
        [3, "生年月日", birthStr],
        [4, "性別", genderStr],
        [5, "住所　", emp.postal_code ? `〒${emp.postal_code}　${emp.address || ""}` : emp.address || "〒"],
        [6, "電話番号", emp.phone || ""],
        [7, "入社年月日", hireDateStr],
        [8, "職種", emp.department || ""],
        [9, "雇用区分", empTypeStr],
        [10, "1週間の所定労働時間", weeklyHours],
        [11, "雇用期間の定め", "□無　"],
        [12, "賃金", "（基本給・手当・交通費・残業見込含む）\n　　　　　　　　円"],
        [13, "雇用保険番号", empInsStr],
        [14, "マイナンバー", emp.my_number || ""],
        [15, "入社経路", "安定所紹介・自己就職・民間紹介・その他（　　　　　　　　　　　）"],
        [16, "給与振込口座", bankStr],
        [17, "所得税源泉徴収", "□甲　　・　　□乙（副業の場合）"],
        [18, "資格確認書発行", emp.insurance_card_requested ? "■希望　　・　　□不要" : "□希望　　・　　■不要"],
        [19, "社労士に送付", "□タイムカード\n□履歴書\n□雇用契約書または労働条件通知書\n□扶養控除申告書\n□在留カードコピー(外国人)\n□扶養家族の一覧（別紙）"],
      ];

      items.forEach(([no, label, content], i) => {
        const r = 4 + i;
        const row = ws1.getRow(r);
        row.getCell(1).value = no;
        row.getCell(1).font = normalFont;
        row.getCell(1).border = borderAll;
        row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

        row.getCell(2).value = label;
        row.getCell(2).font = normalFont;
        row.getCell(2).border = borderAll;
        row.getCell(2).alignment = { vertical: "middle" };

        row.getCell(3).value = content;
        row.getCell(3).font = normalFont;
        row.getCell(3).border = borderAll;
        row.getCell(3).alignment = { vertical: "middle", wrapText: true };

        row.getCell(4).value = "□";
        row.getCell(4).font = normalFont;
        row.getCell(4).border = borderAll;
        row.getCell(4).alignment = { horizontal: "center", vertical: "middle" };

        // 複数行の場合は行高さを調整
        if (content.includes("\n")) {
          const lines = content.split("\n").length;
          row.height = Math.max(20, lines * 16);
        }
      });

      // ═══ シート2: 被扶養者 ═══
      const ws2 = wb.addWorksheet("被扶養者");
      ws2.columns = [
        { width: 3 },   // A
        { width: 18 },  // B: 項目
        { width: 22 },  // C: 1人目
        { width: 22 },  // D: 2人目
        { width: 22 },  // E: 3人目
      ];

      ws2.getCell("B1").value = "被扶養者チェックシート";
      ws2.getCell("B1").font = { name: "游ゴシック", size: 14, bold: true };
      ws2.getCell("B2").value = "社会保険における扶養家族の情報を記入してください";
      ws2.getCell("B2").font = { name: "游ゴシック", size: 10, color: { argb: "FF6B7280" } };

      // 番号ヘッダー
      ws2.getCell("C3").value = "1"; ws2.getCell("D3").value = "2"; ws2.getCell("E3").value = "3";
      ["C3", "D3", "E3"].forEach(addr => {
        const c = ws2.getCell(addr);
        c.font = headerFont;
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
        c.border = borderAll;
        c.alignment = { horizontal: "center" };
      });

      const depLabels = ["氏名", "ふりがな", "生年月日", "性別", "続柄", "住居", "年収", "職業・学年", "マイナンバー", "資格確認書", "税法上扶養", "年金受給"];
      const depList = deps || [];

      depLabels.forEach((label, i) => {
        const r = 4 + i;
        const row = ws2.getRow(r);
        row.getCell(2).value = label;
        row.getCell(2).font = normalFont;
        row.getCell(2).border = borderAll;
        row.getCell(2).alignment = { vertical: "middle" };

        for (let d = 0; d < 3; d++) {
          const cell = row.getCell(3 + d);
          cell.border = borderAll;
          cell.font = normalFont;
          cell.alignment = { vertical: "middle" };

          const dep = depList[d];
          if (!dep) { cell.value = ""; continue; }

          switch (label) {
            case "氏名": cell.value = dep.name || ""; break;
            case "ふりがな": cell.value = dep.name_kana || ""; break;
            case "生年月日": {
              if (dep.birth_date) {
                const bd = new Date(dep.birth_date);
                cell.value = `${bd.getFullYear()}/${String(bd.getMonth() + 1).padStart(2, "0")}/${String(bd.getDate()).padStart(2, "0")}`;
              }
              break;
            }
            case "性別": {
              const g = dep.gender;
              cell.value = g === "女性" ? "■女" : g === "男性" ? "■男" : "□女";
              break;
            }
            case "続柄": cell.value = dep.relationship || ""; break;
            case "住居": {
              const la = dep.living_arrangement;
              cell.value = la === "同居" ? "■同居" : la === "別居" ? "■別居" : "□同居";
              break;
            }
            case "年収": cell.value = dep.estimated_income != null ? `${dep.estimated_income}万円` : ""; break;
            case "職業・学年": cell.value = dep.occupation || ""; break;
            case "マイナンバー": cell.value = dep.my_number || ""; break;
            case "資格確認書": cell.value = dep.insurance_card_requested ? "■希望" : "□不要"; break;
            case "税法上扶養": cell.value = "□対象"; break;
            case "年金受給": cell.value = "無"; break;
          }
        }
      });

      // 配偶者年収行
      ws2.getCell("B17").value = "配偶者の年収";
      ws2.getCell("B17").font = normalFont;
      ws2.getCell("B17").border = borderAll;

      // 注意書き
      ws2.getCell("B19").value = "※夫婦共同扶養の場合、本人より配偶者の年収が多い場合、原則として配偶者の扶養家族とみなされます。";
      ws2.getCell("B19").font = { name: "游ゴシック", size: 9, color: { argb: "FF6B7280" } };
      ws2.getCell("B20").value = "※マイナンバーがない場合は、住民票や所得証明などの添付書類が必要です。";
      ws2.getCell("B20").font = { name: "游ゴシック", size: 9, color: { argb: "FF6B7280" } };

      // ダウンロード
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `入社チェックシート_${empCode}_${empName.replace(/\s/g, "")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg("ダウンロードしました");
    } catch (err: any) {
      setMsg("エラー: " + err.message);
    }
    setGenerating(false);
  }, [empId, empCode, empName, companyId]);

  return (
    <div>
      <div style={{ textAlign: "center", padding: "20px 0" }}>
        <div style={{ fontSize: 13, color: T.textSec, marginBottom: 12 }}>
          従業員データと扶養家族データから入社チェックシートを自動生成します。
        </div>
        <button onClick={generate} disabled={generating} style={{
          padding: "14px 32px", borderRadius: 6, border: "none",
          backgroundColor: generating ? T.border : T.primary,
          color: generating ? T.textMuted : "#fff",
          fontSize: 14, fontWeight: 600, cursor: generating ? "default" : "pointer",
        }}>
          {generating ? "生成中..." : "入社チェックシートをダウンロード"}
        </button>
        {msg && <div style={{ marginTop: 12, fontSize: 13, color: msg.startsWith("エラー") ? T.danger : T.success }}>{msg}</div>}
      </div>
      <div style={{ fontSize: 11, color: T.textMuted, padding: "10px 14px", backgroundColor: T.bg, borderRadius: 6 }}>
        <div style={{ marginBottom: 4 }}>自動入力される項目:</div>
        <div>フリガナ、氏名、生年月日、性別、住所、電話番号、入社日、職種、雇用区分、週所定労働時間、雇用保険番号、マイナンバー、口座情報、扶養家族情報</div>
        <div style={{ marginTop: 4 }}>手入力が必要な項目:</div>
        <div>賃金、雇用期間の定め、入社経路、所得税源泉徴収、チェック欄</div>
      </div>
    </div>
  );
}