"use client";
import { useState, useCallback } from "react";
import { T } from "@/lib/constants";
import Dialog from "@/components/ui/Dialog";
import { supabase } from "@/lib/supabase";

const REASON_MAP: Record<string, string> = {
  "希望休（全日）": "公休", "午前希望休": "公前", "午後希望休": "公後",
  "有給（全日）": "有休", "午前有給": "前休", "午後有給": "後休", "休日出勤": "休出",
};
function mapReason(r: string | null): string {
  if (!r) return "";
  const base = r.split("+")[0].trim().replace(/（.*$/, "").replace(/\(.*$/, "");
  return REASON_MAP[base] || base;
}
function fmMin(m: number): string {
  if (m === 0) return "";
  const neg = m < 0; const a = Math.abs(Math.round(m));
  return `${neg ? "-" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}
function fmDec(v: number): string {
  if (v === 0) return "";
  const neg = v < 0; const t = Math.abs(Math.round(v * 60));
  return `${neg ? "-" : ""}${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
function tzHHMM(raw: string | null): string {
  if (!raw) return "";
  const d = new Date(raw);
  const j = new Date(d.getTime() + 9 * 3600000);
  return `${j.getUTCHours()}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
}
function pad(s: string, w: number): string { return s.length >= w ? s : " ".repeat(w - s.length) + s; }
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

async function toCP932(text: string): Promise<Uint8Array> {
  const E = (await import("encoding-japanese")).default;
  return new Uint8Array(E.convert(E.stringToCode(text), { to: "SJIS", from: "UNICODE" }));
}
async function makeZip(files: { name: string; data: Uint8Array | Blob }[]): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const z = new JSZip();
  for (const f of files) z.file(f.name, f.data);
  return z.generateAsync({ type: "blob" });
}

interface EmpD { id: string; employee_code: string; full_name: string; employment_type: string; store_code: string; store_name: string; holiday_calendar: string | null; }
interface AttR {
  attendance_date: string; punch_in_raw: string | null; punch_out_raw: string | null;
  reason: string | null; late_minutes: number | null; early_leave_minutes: number | null;
  scheduled_hours: number | null; contract_hours: number | null;
  overtime_hours: number | null; over_under: number | null; is_holiday: boolean | null;
}

export default function SharoushiSub({ employee }: { employee: any }) {
  const now = new Date();
  const [selYear, setSelYear] = useState(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [dialogMsg, setDialogMsg] = useState<string | null>(null);
  const yearOpts: number[] = [];
  for (let y = 2025; y <= now.getFullYear(); y++) yearOpts.push(y);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      setProgress("従業員データ取得中...");
      const { data: empRaw, error: empErr } = await supabase.from("employees")
        .select("id, employee_code, full_name, employment_type, store_id, holiday_calendar")
        .eq("company_id", employee.company_id).eq("is_active", true).order("employee_code");
      if (empErr) throw empErr;
      if (!empRaw?.length) { setDialogMsg("従業員データがありません"); return; }

      const { data: stRaw } = await supabase.from("stores").select("id, store_code, store_name").eq("company_id", employee.company_id);
      const stMap = new Map((stRaw || []).map((s: any) => [s.id, { code: s.store_code || "000", name: s.store_name || "指定なし" }]));
      const emps: EmpD[] = empRaw.map((e: any) => { const st = stMap.get(e.store_id) || { code: "000", name: "指定なし" }; return { ...e, store_code: st.code, store_name: st.name }; });

      setProgress("勤怠データ取得中...");
      const ym = `${selYear}-${String(selMonth).padStart(2, "0")}`;
      const dim = new Date(selYear, selMonth, 0).getDate();
      const d1 = `${ym}-01`, dN = `${ym}-${String(dim).padStart(2, "0")}`;

      const { data: attRaw, error: attErr } = await supabase.from("attendance_daily")
        .select("employee_id, attendance_date, punch_in_raw, punch_out_raw, reason, late_minutes, early_leave_minutes, scheduled_hours, contract_hours, overtime_hours, over_under, is_holiday")
        .gte("attendance_date", d1).lte("attendance_date", dN);
      if (attErr) throw attErr;
      const attByEmp = new Map<string, Map<string, AttR>>();
      for (const r of (attRaw || [])) { if (!attByEmp.has(r.employee_id)) attByEmp.set(r.employee_id, new Map()); attByEmp.get(r.employee_id)!.set(r.attendance_date, r as AttR); }

      setProgress("有給データ取得中...");
      const { data: lvRaw } = await supabase.from("paid_leave_grants").select("employee_id, remaining_days").in("employee_id", emps.map(e => e.id)).gt("remaining_days", -100);
      const lvMap = new Map<string, number>();
      for (const l of (lvRaw || [])) lvMap.set(l.employee_id, (lvMap.get(l.employee_id) || 0) + l.remaining_days);

      const { data: holRaw } = await supabase.from("holiday_calendars").select("holiday_date, calendar_type").gte("holiday_date", d1).lte("holiday_date", dN);
      const holByType = new Map<string, Set<string>>();
      for (const h of (holRaw || [])) { if (!holByType.has(h.calendar_type)) holByType.set(h.calendar_type, new Set()); holByType.get(h.calendar_type)!.add(h.holiday_date); }

      const mm = String(selMonth).padStart(2, "0");
      const fDow = DOW[new Date(selYear, selMonth - 1, 1).getDay()];
      const lDow = DOW[new Date(selYear, selMonth, 0).getDay()];
      const hdr = `${selYear}年${mm}月[${selYear}年${mm}月01日(${fDow})～${selYear}年${mm}月${String(dim).padStart(2, "0")}日(${lDow})]`;

      /* ══ データ収集 ══ */
      setProgress("データ集計中...");
      // 個人表カラム（勤務区分削除済み）: 月/日, 曜, 事由, 出勤, 退勤, 遅刻, 早退, 私用外出, 残業, 休出, 所定勤務, 契約, 超過不足
      interface IPerson { emp: EmpD; rows: string[][]; totRow: string[]; cnt: number[]; kit: string[]; }
      const persons: IPerson[] = [];
      let iCsv = "";

      for (const emp of emps) {
        const ma = attByEmp.get(emp.id) || new Map<string, AttR>();
        const empHols = emp.holiday_calendar ? (holByType.get(emp.holiday_calendar) || new Set<string>()) : new Set<string>();

        iCsv += `【勤務個人表】\r\n${hdr}\r\n所属CD：${emp.store_code} ${emp.store_name}\r\n社員CD：${emp.employee_code.padStart(6, "0")} ${emp.full_name}\r\n`;
        iCsv += `月/日,曜,事由, 出勤, 退勤,    遅刻,    早退,私用外出,    残業,    休出,所定勤務,    契約,超過不足\r\n`;
        let sL = 0, sE = 0, sO = 0, sS = 0, sC = 0, sU = 0;
        let cW = 0, cR = 0, cI = 0, cO2 = 0, cOt = 0, cSc = 0, cS7 = 0;
        let cY = 0, cK = 0, cKk = 0, cD = 0, cF = 0, cB = 0, cSh = 0;
        const dRows: string[][] = [];
        for (let d = 1; d <= dim; d++) {
          const ds = `${ym}-${String(d).padStart(2, "0")}`;
          const dw = DOW[new Date(ds + "T00:00:00").getDay()];
          const a = ma.get(ds);
          const isHol = empHols.has(ds);
          let rs = "", pi = "", po = "", lt = "", et = "", ot = "", sc = "", ct = "", ou = "";
          if (a) {
            rs = mapReason(a.reason);
            pi = tzHHMM(a.punch_in_raw); po = tzHHMM(a.punch_out_raw);
            if (a.late_minutes && a.late_minutes > 0) { lt = fmMin(a.late_minutes); sL += a.late_minutes; }
            if (a.early_leave_minutes && a.early_leave_minutes > 0) { et = fmMin(a.early_leave_minutes); sE += a.early_leave_minutes; }
            if (a.overtime_hours && a.overtime_hours > 0) { ot = fmDec(a.overtime_hours); sO += a.overtime_hours; }
            if (a.scheduled_hours && a.scheduled_hours > 0) { sc = fmDec(a.scheduled_hours); sS += a.scheduled_hours; }
            if (a.contract_hours && a.contract_hours > 0) { ct = fmDec(a.contract_hours); sC += a.contract_hours; }
            if (a.over_under && a.over_under !== 0) { ou = fmMin(a.over_under); sU += a.over_under; }
            if (a.punch_in_raw) cI++;
            if (a.punch_out_raw) cO2++;
            if (a.overtime_hours && a.overtime_hours > 0) cOt++;
            if (a.scheduled_hours && a.scheduled_hours > 0) cSc++;
            if (a.scheduled_hours && a.scheduled_hours >= 7.5) cS7++;
            if (a.reason) {
              cR++;
              const r = a.reason;
              if (r.includes("有給")) cY += (r.includes("午前") || r.includes("午後")) ? 0.5 : 1;
              if (r.includes("希望休")) cK += (r.includes("午前") || r.includes("午後")) ? 0.5 : 1;
              if (r === "欠勤") cKk++;
              if (r.includes("出張") || r === "直行" || r === "直帰" || r === "直直") cSh++;
              if (r.includes("代休")) cD += (r.includes("午前") || r.includes("午後")) ? 0.5 : 1;
              if (r.includes("振替")) cF++;
              if (r === "病欠") cB++;
            }
            if (a.punch_in_raw || a.punch_out_raw || (a.reason && !a.is_holiday && a.scheduled_hours && a.scheduled_hours > 0)) cW++;
          }
          // 会社休日で事由がない日は「休日」
          if (isHol && !rs) rs = "休日";
          dRows.push([`${mm}/${String(d).padStart(2, "0")}`, dw, rs, pi, po, lt, et, "", ot, "", sc, ct, ou]);
          iCsv += [`${mm}/${String(d).padStart(2, "0")}`, dw, pad(rs, 4), pad(pi, 5), pad(po, 5), pad(lt, 8), pad(et, 8), pad("", 8), pad(ot, 8), pad("", 8), pad(sc, 8), pad(ct, 8), pad(ou, 8)].join(",") + "\r\n";
        }
        const totVals = ["", "", "", "", "", sL ? fmMin(sL) : "", sE ? fmMin(sE) : "", "", sO ? fmDec(sO) : "", "", sS ? fmDec(sS) : "", sC ? fmDec(sC) : "", sU ? fmMin(sU) : ""];
        iCsv += ["合計 ", "  ", "    ", "     ", "     ", pad(totVals[5], 8), pad(totVals[6], 8), pad("", 8), pad(totVals[8], 8), pad("", 8), pad(totVals[10], 8), pad(totVals[11], 8), pad(totVals[12], 8)].join(",") + "\r\n";
        const hols = empHols.size;
        const kitei = dim - hols;
        const yz = lvMap.get(emp.id) ?? 0;
        persons.push({
          emp, rows: dRows, totRow: totVals,
          cnt: [dim, cW, cR, cI, cO2, cOt, cSc, cS7],
          kit: [`${kitei}.0`, `${cW}.0`, cY > 0 ? `${cY}` : "", `${yz}`, cK > 0 ? `${cK}` : "", cKk > 0 ? `${cKk}` : "", cD > 0 ? `${cD}` : "", cF > 0 ? `${cF}` : "", cB > 0 ? `${cB}` : ""]
        });
      }

      /* ── 合計表CSV（出張追加、他休=希望休+公休集計）── */
      setProgress("勤務合計表CSV生成中...");
      let sCsv = `【勤務合計表】\r\n${hdr}\r\n所属CD：指定なし\r\n社員CD：指定なし\r\n`;
      sCsv += `社員CD,氏名        ,    勤務,勤務時間,    有休,    出張,    欠勤,    他休,    遅刻,    遅刻,    早退,    早退,私用外出,早出残業,普通残業,深夜残業,特別残業,法外普通,法外深夜,法内普通,法内深夜,超過不足\r\n`;
      interface SumR { code: string; name: string; w: number; sm: number; y: number; sh: number; k: number; oth: number; lc: number; lm: number; ec: number; em: number; om: number; um: number; }
      const sumRows: SumR[] = [];
      let gW = 0, gSc = 0, gY = 0, gSh = 0, gKk = 0, gOth = 0, gLc = 0, gLm = 0, gEc = 0, gEm = 0, gO = 0, gU = 0;

      for (const ip of persons) {
        const ma = attByEmp.get(ip.emp.id) || new Map<string, AttR>();
        let w = 0, sm = 0, y = 0, sh = 0, k = 0, oth = 0, lc = 0, lm = 0, ec = 0, em2 = 0, om = 0, um = 0;
        for (const [, a] of ma) {
          if (a.punch_in_raw || a.punch_out_raw || (a.reason && !a.is_holiday && a.scheduled_hours && a.scheduled_hours > 0)) w++;
          if (a.scheduled_hours) sm += Math.round(a.scheduled_hours * 60);
          if (a.reason) {
            const r = a.reason;
            if (r.includes("有給")) y += (r.includes("午前") || r.includes("午後")) ? 0.5 : 1;
            if (r.includes("出張") || r === "直行" || r === "直帰" || r === "直直") sh++;
            if (r === "欠勤") k++;
            if (r.includes("希望休")) oth += (r.includes("午前") || r.includes("午後")) ? 0.5 : 1;
          }
          if (a.late_minutes && a.late_minutes > 0) { lc++; lm += a.late_minutes; }
          if (a.early_leave_minutes && a.early_leave_minutes > 0) { ec++; em2 += a.early_leave_minutes; }
          if (a.overtime_hours) om += Math.round(a.overtime_hours * 60);
          if (a.over_under) um += a.over_under;
        }
        sumRows.push({ code: ip.emp.employee_code.padStart(6, "0"), name: ip.emp.full_name, w, sm, y, sh, k, oth, lc, lm, ec, em: em2, om, um });
        const nm = (ip.emp.full_name + "\u3000\u3000\u3000\u3000\u3000\u3000").slice(0, 12);
        sCsv += [ip.emp.employee_code.padStart(6, "0"), nm,
          pad(w > 0 ? `${w}.0` : "", 8), pad(sm > 0 ? fmMin(sm) : "", 8),
          pad(y > 0 ? `${y}` : "", 8), pad(sh > 0 ? `${sh}` : "", 8),
          pad(k > 0 ? `${k}` : "", 8), pad(oth > 0 ? `${oth}` : "", 8),
          pad(lc > 0 ? `${lc}.0` : "", 8), pad(lm > 0 ? fmMin(lm) : "", 8),
          pad(ec > 0 ? `${ec}.0` : "", 8), pad(em2 > 0 ? fmMin(em2) : "", 8),
          pad("", 8), pad("", 8), pad(om > 0 ? fmMin(om) : "", 8),
          pad("", 8), pad("", 8), pad("", 8), pad("", 8), pad("", 8), pad("", 8),
          pad(um !== 0 ? fmMin(um) : "", 8)].join(",") + "\r\n";
        gW += w; gSc += sm; gY += y; gSh += sh; gKk += k; gOth += oth; gLc += lc; gLm += lm; gEc += ec; gEm += em2; gO += om; gU += um;
      }
      sCsv += ["合計  ", "            ",
        pad(gW > 0 ? `${gW}.0` : "", 8), pad(gSc > 0 ? fmMin(gSc) : "", 8),
        pad(gY > 0 ? `${gY}` : "", 8), pad(gSh > 0 ? `${gSh}` : "", 8),
        pad(gKk > 0 ? `${gKk}` : "", 8), pad(gOth > 0 ? `${gOth}` : "", 8),
        pad(gLc > 0 ? `${gLc}.0` : "", 8), pad(gLm > 0 ? fmMin(gLm) : "", 8),
        pad(gEc > 0 ? `${gEc}.0` : "", 8), pad(gEm > 0 ? fmMin(gEm) : "", 8),
        pad("", 8), pad("", 8), pad(gO > 0 ? fmMin(gO) : "", 8),
        pad("", 8), pad("", 8), pad("", 8), pad("", 8), pad("", 8), pad("", 8),
        pad(gU !== 0 ? fmMin(gU) : "", 8)].join(",") + "\r\n";

      /* ══ 勤務個人表Excel ══ */
      setProgress("勤務個人表Excel生成中...");
      const ExcelJS = (await import("exceljs")).default;
      const iWb = new ExcelJS.Workbook();
      const hdrs = ["月/日", "曜", "事由", "出勤", "退勤", "遅刻", "早退", "私用外出", "残業", "休出", "所定勤務", "契約", "超過不足"];
      const kLbl = ["規定", "勤務", "有休", "有休残", "公休", "欠勤", "代休", "振替", "病欠"];
      const thinBorder: any = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      const hdrFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDDDDD" } };
      const boldFont: any = { bold: true, size: 9, name: "Yu Gothic" };
      const normFont: any = { size: 8, name: "Yu Gothic" };
      const smallFont: any = { size: 7, name: "Yu Gothic" };

      for (const ip of persons) {
        const shName = `${ip.emp.employee_code} ${ip.emp.full_name}`.slice(0, 31);
        const ws = iWb.addWorksheet(shName);
        ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
        let r = 1;
        ws.getCell(r, 1).value = hdr; ws.getCell(r, 1).font = normFont; r++;
        ws.getCell(r, 1).value = `所属CD：${ip.emp.store_code} ${ip.emp.store_name}`; ws.getCell(r, 1).font = normFont; r++;
        ws.getCell(r, 1).value = `社員CD：${ip.emp.employee_code.padStart(6, "0")} ${ip.emp.full_name}`; ws.getCell(r, 1).font = normFont; r++;
        for (let c = 0; c < hdrs.length; c++) {
          const cell = ws.getCell(r, c + 1);
          cell.value = hdrs[c]; cell.font = boldFont; cell.alignment = { horizontal: "center" }; cell.border = thinBorder; cell.fill = hdrFill;
        }
        r++;
        for (const row of ip.rows) {
          for (let c = 0; c < row.length; c++) {
            const cell = ws.getCell(r, c + 1);
            cell.value = row[c]; cell.font = normFont; cell.alignment = { horizontal: "center" }; cell.border = thinBorder;
          }
          r++;
        }
        const totCells = ["合計", "", "", "", "", ip.totRow[5], ip.totRow[6], "", ip.totRow[8], "", ip.totRow[10], ip.totRow[11], ip.totRow[12]];
        for (let c = 0; c < totCells.length; c++) {
          const cell = ws.getCell(r, c + 1);
          cell.value = totCells[c]; cell.font = boldFont; cell.alignment = { horizontal: "center" }; cell.border = thinBorder;
        }
        r++;
        ws.getCell(r, 1).value = `回数　${ip.cnt.join("　")}`; ws.getCell(r, 1).font = smallFont; r++;
        ws.getCell(r, 1).value = kLbl.map((l, k) => `${l} ${ip.kit[k] || ""}`).join("　"); ws.getCell(r, 1).font = smallFont; r++;
        const colWidths = [7, 3, 5, 6, 6, 6, 6, 7, 6, 5, 7, 6, 7];
        colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      }

      /* ══ 勤務合計表Excel（出張追加、他休集計）══ */
      setProgress("勤務合計表Excel生成中...");
      const sWb = new ExcelJS.Workbook();
      const sWs = sWb.addWorksheet("勤務合計表");
      sWs.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
      let sr = 1;
      sWs.getCell(sr, 1).value = hdr; sWs.getCell(sr, 1).font = normFont; sr++;
      sWs.getCell(sr, 1).value = "所属CD：指定なし"; sWs.getCell(sr, 1).font = normFont; sr++;
      sWs.getCell(sr, 1).value = "社員CD：指定なし"; sWs.getCell(sr, 1).font = normFont; sr++;
      const sHdrs = ["社員CD", "氏名", "勤務\n回", "勤務\n時間", "有休", "出張", "欠勤", "他休", "遅刻\n回", "遅刻\n時間", "早退\n回", "早退\n時間", "私用\n外出", "早出\n残業", "普通\n残業", "深夜\n残業", "特別\n残業", "法外\n普通", "法外\n深夜", "法内\n普通", "法内\n深夜", "超過\n不足"];
      for (let c = 0; c < sHdrs.length; c++) {
        const cell = sWs.getCell(sr, c + 1);
        cell.value = sHdrs[c]; cell.font = boldFont; cell.alignment = { horizontal: "center", wrapText: true }; cell.border = thinBorder; cell.fill = hdrFill;
      }
      sr++;
      for (const s of sumRows) {
        const vals = [s.code, s.name,
          s.w > 0 ? `${s.w}.0` : "", s.sm > 0 ? fmMin(s.sm) : "",
          s.y > 0 ? `${s.y}` : "", s.sh > 0 ? `${s.sh}` : "",
          s.k > 0 ? `${s.k}` : "", s.oth > 0 ? `${s.oth}` : "",
          s.lc > 0 ? `${s.lc}.0` : "", s.lm > 0 ? fmMin(s.lm) : "",
          s.ec > 0 ? `${s.ec}.0` : "", s.em > 0 ? fmMin(s.em) : "",
          "", "", s.om > 0 ? fmMin(s.om) : "",
          "", "", "", "", "", "",
          s.um !== 0 ? fmMin(s.um) : ""];
        for (let c = 0; c < vals.length; c++) {
          const cell = sWs.getCell(sr, c + 1);
          cell.value = vals[c]; cell.font = normFont; cell.alignment = { horizontal: c === 1 ? "left" : "center" }; cell.border = thinBorder;
        }
        sr++;
      }
      const gVals = ["合計", "",
        gW > 0 ? `${gW}.0` : "", gSc > 0 ? fmMin(gSc) : "",
        gY > 0 ? `${gY}` : "", gSh > 0 ? `${gSh}` : "",
        gKk > 0 ? `${gKk}` : "", gOth > 0 ? `${gOth}` : "",
        gLc > 0 ? `${gLc}.0` : "", gLm > 0 ? fmMin(gLm) : "",
        gEc > 0 ? `${gEc}.0` : "", gEm > 0 ? fmMin(gEm) : "",
        "", "", gO > 0 ? fmMin(gO) : "",
        "", "", "", "", "", "",
        gU !== 0 ? fmMin(gU) : ""];
      for (let c = 0; c < gVals.length; c++) {
        const cell = sWs.getCell(sr, c + 1);
        cell.value = gVals[c]; cell.font = boldFont; cell.alignment = { horizontal: "center" }; cell.border = thinBorder;
      }
      const sColWidths = [8, 12, 5, 7, 5, 5, 5, 5, 5, 6, 5, 6, 5, 5, 6, 5, 5, 5, 5, 5, 5, 6];
      sColWidths.forEach((w, i) => { sWs.getColumn(i + 1).width = w; });

      /* ══ ZIP ══ */
      setProgress("ZIPをまとめています...");
      const iBuf = await iWb.xlsx.writeBuffer();
      const sBuf = await sWb.xlsx.writeBuffer();
      const zipBlob = await makeZip([
        { name: "勤務個人表.csv", data: await toCP932(iCsv) },
        { name: "勤務合計表.csv", data: await toCP932(sCsv) },
        { name: "勤務個人表.xlsx", data: new Uint8Array(iBuf as ArrayBuffer) },
        { name: "勤務合計表.xlsx", data: new Uint8Array(sBuf as ArrayBuffer) },
      ]);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a"); a.href = url; a.download = `社労士出力_${selYear}年${String(selMonth).padStart(2, "0")}月.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      setDialogMsg("4ファイルのZIPをダウンロードしました");
    } catch (err: any) {
      console.error(err); setDialogMsg("エラー: " + (err?.message || String(err)));
    } finally { setLoading(false); setProgress(""); }
  }, [selYear, selMonth, employee]);

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 16 }}>社労士CSV/Excel出力</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <select value={selYear} onChange={e => setSelYear(Number(e.target.value))} style={{ padding: "9px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 14 }}>
          {yearOpts.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={selMonth} onChange={e => setSelMonth(Number(e.target.value))} style={{ padding: "9px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 14 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
        <button onClick={generate} disabled={loading} style={{ padding: "10px 24px", borderRadius: 6, border: "none", backgroundColor: loading ? T.textMuted : T.primary, color: "#fff", fontSize: 14, fontWeight: 600, cursor: loading ? "default" : "pointer" }}>
          {loading ? progress || "生成中..." : "4ファイル一括ダウンロード"}
        </button>
      </div>
      <div style={{ fontSize: 12, color: T.textSec, lineHeight: 1.8 }}>
        以下の4ファイルがZIPでダウンロードされます：<br />
        ・勤務個人表.csv（CP932）<br />
        ・勤務個人表.xlsx（1人1シート）<br />
        ・勤務合計表.csv（CP932）<br />
        ・勤務合計表.xlsx（全員一覧）
      </div>
      {dialogMsg && <Dialog message={dialogMsg} onOk={() => setDialogMsg(null)} />}
    </div>
  );
}