import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = "BBIYaJqhRjCkTBbDL_90GDdJ_WTo7n4GDS9-7wOcTShpqjw5ym6rMt1rYMDCDilFidTHuv2y1WSBwiEIPZAq99Q";
const VAPID_PRIVATE_KEY = "j1AwpozwrDRE3F9_duLST5ve6yfQ6-q_s6j0vBQBYak";
const VAPID_SUBJECT = "mailto:jinji@katworld-hd.com";

import webpush from "https://esm.sh/web-push@3.6.7";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/* ── ユーティリティ ── */
const lastName = (fullName: string, displayOverride?: string | null, allNames?: string[]) => {
  if (displayOverride) return displayOverride;
  const parts = (fullName || "").split(/\s+/);
  const surname = parts[0] || fullName;
  if (allNames) {
    const given = parts[1] || "";
    const unique = [...new Set(allNames)];
    if (given && unique.filter(n => (n || "").split(/\s+/)[0] === surname).length >= 2) {
      return surname + given.charAt(0);
    }
  }
  return surname;
};
const ALL_CALENDAR_CODES = ["002", "018", "067", "003", "009", "006", "049"];
const GYOMU_DEPTS = ["人事", "経理", "DX"];
const HAMAMURA_CODE = "095";
const WC_COMPANY_ID = "c2d368f0-aa9b-4f70-b082-43ec07723d6c";
const WC_NOTIFY_CODES_REASON = ["WC001", "W67", "W49"];

const calMap: Record<string, string> = {
  "all": "全店舗", "kengun": "健軍", "ozu": "大津", "yatsushiro": "八代", "gyomu": "業務部",
  "全店舗": "全店舗", "健軍": "健軍", "大津": "大津", "八代": "八代", "業務部": "業務部",
};

function resolveStoreShort(storeName: string): string {
  if (!storeName) return "—";
  if (storeName.includes("八代")) return "八代";
  if (storeName.includes("健軍")) return "健軍";
  if (storeName.includes("大津") || storeName.includes("菊陽")) return "大津";
  if (storeName.includes("本社")) return "本社";
  if (storeName.includes("経理") || storeName.includes("人事") || storeName.includes("DX")) return "業務部";
  if (storeName.includes("御領")) return "御領";
  return storeName;
}

/* 従業員のカレンダーグループを特定（departmentベース） */
function resolveCalendarGroup(empCode: string, department: string, storeName: string): string {
  if (empCode === "002") return "業務部";
  if (GYOMU_DEPTS.includes(department)) return "業務部";
  if (storeName.includes("八代")) return "八代";
  if (storeName.includes("健軍")) return "健軍";
  if (storeName.includes("大津") || storeName.includes("菊陽")) return "大津";
  return "業務部";
}

/* 通知を受け取るかどうか判定 */
function matchCalendar(empCode: string, storeName: string, department: string, targetCal: string): boolean {
  if (ALL_CALENDAR_CODES.includes(empCode)) return true;
  if (empCode === HAMAMURA_CODE) return targetCal === "業務部" || targetCal === "健軍" || targetCal === "全店舗" || targetCal === "all";
  if (targetCal === "全店舗" || targetCal === "all") return true;
  const myGroup = resolveCalendarGroup(empCode, department, storeName);
  return myGroup === targetCal;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const dow = ["日","月","火","水","木","金","土"][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日(${dow})`;
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth()+1}/${d.getDate()}`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const { type, payload } = await req.json();
    const sb = createClient(supabaseUrl, supabaseKey);

    let targets: { employee_id: string; title: string; body: string; tag: string; url: string }[] = [];

    // 共通: 従業員・店舗取得ヘルパー
    async function getEmpsAndStores(companyId: string) {
      const { data: allEmps } = await sb.from("employees")
        .select("id, employee_code, full_name, store_id, department, employment_type, holiday_calendar, calendar_display_name")
        .eq("company_id", companyId)
        .eq("is_active", true);
      const { data: stores } = await sb.from("stores")
        .select("id, store_name")
        .eq("company_id", companyId);
      const storeMap: Record<string, string> = {};
      (stores || []).forEach((s: any) => { storeMap[s.id] = s.store_name || ""; });
      return { allEmps: allEmps || [], storeMap };
    }

    // ============================
    // 2. 予定登録時（即時通知）
    // ============================
    if (type === "calendar_event") {
      const { action, event } = payload;
      const creatorName = event.creator_name || "不明";
      const calLabel = calMap[event.target_calendar] || event.target_calendar;
      const isCreate = action === "created";
      const title = isCreate
        ? `${creatorName}が予定を登録しました`
        : `${creatorName}が予定を削除しました`;

      const { allEmps, storeMap } = await getEmpsAndStores(event.company_id);
      const allNames = allEmps.map((e: any) => e.full_name);
      const creatorEmp = allEmps.find((e: any) => e.full_name === creatorName);
      const body = `${calLabel}：${lastName(creatorName, creatorEmp?.calendar_display_name, allNames)}　${event.title} ${shortDate(event.start_date)}`;

      for (const emp of allEmps) {
        const storeName = storeMap[emp.store_id] || "";
        if (matchCalendar(emp.employee_code, storeName, emp.department || "", event.target_calendar)) {
          targets.push({ employee_id: emp.id, title, body, tag: "calendar", url: "/home" });
        }
      }
    }

    // ============================
    // 6. 書類配布（即時通知）
    // ============================
    if (type === "document_delivered") {
      const { employee_id, document_name } = payload;
      targets.push({
        employee_id,
        title: "書類が届きました",
        body: document_name,
        tag: "document",
        url: "/home",
      });
    }

    // ============================
    // 7. 申請承認/却下（即時通知）
    // ============================
    if (type === "request_processed") {
      const { employee_id, category, status } = payload;
      targets.push({
        employee_id,
        title: `申請が${status}されました`,
        body: category,
        tag: "request",
        url: "/home",
      });
    }

    // ============================
    // 9. 勤怠事由登録時（即時通知）
    // ============================
    if (type === "attendance_reason_set") {
      const { company_id, employee_id, employee_name, reason, attendance_date } = payload;
      const { allEmps: _emps1, storeMap: _sm1 } = await getEmpsAndStores(company_id);
      const _emp1 = _emps1.find((e: any) => e.id === employee_id);
      const storeShort = resolveStoreShort(_emp1 ? (_sm1[_emp1.store_id] || "") : "");
      const dateShort = shortDate(attendance_date);

      let reasonLabel = "";
      if (reason.includes("出張")) {
        const wm = reason.match(/出張（(.+)）/);
        reasonLabel = wm ? `出張（${wm[1]}）` : "出張";
      } else if (reason.includes("有給（全日）")) reasonLabel = "有給";
      else if (reason.includes("午前有給")) reasonLabel = "有給（午前）";
      else if (reason.includes("午後有給")) reasonLabel = "有給（午後）";
      else if (reason.includes("希望休（全日）")) reasonLabel = "希望休";
      else if (reason.includes("午前希望休")) reasonLabel = "希望休（午前）";
      else if (reason.includes("午後希望休")) reasonLabel = "希望休（午後）";
      else if (reason.match(/^代休/) && !reason.includes("午前") && !reason.includes("午後")) reasonLabel = "代休";
      else if (reason.includes("午前代休")) reasonLabel = "代休（午前）";
      else if (reason.includes("午後代休")) reasonLabel = "代休（午後）";
      else return new Response(JSON.stringify({ sent: 0, reason: "not a notifiable reason" }));

      const title = `${employee_name}が${reasonLabel}を登録しました`;

      let bodyDate = dateShort;
      if (payload.end_date && payload.end_date !== attendance_date) {
        bodyDate = `${dateShort}～${shortDate(payload.end_date)}`;
      }
      const allNames1 = _emps1.map((e: any) => e.full_name);
      const body = `${storeShort}：${lastName(employee_name, _emp1?.calendar_display_name, allNames1)}　${bodyDate}`;

      const { allEmps, storeMap } = await getEmpsAndStores(company_id);

      if (company_id === WC_COMPANY_ID) {
        targets.push({ employee_id, title, body, tag: "attendance-reason", url: "/home" });
        for (const code of WC_NOTIFY_CODES_REASON) {
          const mgr = allEmps.find((e: any) => e.employee_code === code && e.id !== employee_id);
          if (mgr) targets.push({ employee_id: mgr.id, title, body, tag: "attendance-reason", url: "/home" });
        }
      } else {
        const empObj = allEmps.find((e: any) => e.id === employee_id);
        const empStoreName = empObj ? (storeMap[empObj.store_id] || "") : "";
        const empDept = empObj?.department || "";
        const empCode = empObj?.employee_code || "";
        const targetCal = resolveCalendarGroup(empCode, empDept, empStoreName);

        for (const emp of allEmps) {
          const sn = storeMap[emp.store_id] || "";
          if (matchCalendar(emp.employee_code, sn, emp.department || "", targetCal)) {
            targets.push({ employee_id: emp.id, title, body, tag: "attendance-reason", url: "/home" });
          }
        }
      }
    }

    // ============================
    // 10. 勤怠事由削除時（即時通知）
    // ============================
    if (type === "attendance_reason_cleared") {
      const { company_id, employee_id, employee_name, old_reason, attendance_date } = payload;
      const { allEmps: _emps2, storeMap: _sm2 } = await getEmpsAndStores(company_id);
      const _emp2 = _emps2.find((e: any) => e.id === employee_id);
      const storeShort = resolveStoreShort(_emp2 ? (_sm2[_emp2.store_id] || "") : "");
      const dateShort = shortDate(attendance_date);

      let reasonLabel = "";
      if (old_reason.includes("出張")) reasonLabel = "出張";
      else if (old_reason.includes("有給（全日）")) reasonLabel = "有給";
      else if (old_reason.includes("午前有給")) reasonLabel = "有給（午前）";
      else if (old_reason.includes("午後有給")) reasonLabel = "有給（午後）";
      else if (old_reason.includes("希望休（全日）")) reasonLabel = "希望休";
      else if (old_reason.includes("午前希望休")) reasonLabel = "希望休（午前）";
      else if (old_reason.includes("午後希望休")) reasonLabel = "希望休（午後）";
      else if (old_reason.match(/^代休/) && !old_reason.includes("午前") && !old_reason.includes("午後")) reasonLabel = "代休";
      else if (old_reason.includes("午前代休")) reasonLabel = "代休（午前）";
      else if (old_reason.includes("午後代休")) reasonLabel = "代休（午後）";
      else return new Response(JSON.stringify({ sent: 0, reason: "not a notifiable reason" }));

      const title = `${employee_name}が${reasonLabel}を取り消しました`;
      const allNames2 = _emps2.map((e: any) => e.full_name);
      const body = `${storeShort}：${lastName(employee_name, _emp2?.calendar_display_name, allNames2)}　${dateShort}`;

      const { allEmps, storeMap } = await getEmpsAndStores(company_id);

      if (company_id === WC_COMPANY_ID) {
        targets.push({ employee_id, title, body, tag: "attendance-reason", url: "/home" });
        for (const code of WC_NOTIFY_CODES_REASON) {
          const mgr = allEmps.find((e: any) => e.employee_code === code && e.id !== employee_id);
          if (mgr) targets.push({ employee_id: mgr.id, title, body, tag: "attendance-reason", url: "/home" });
        }
      } else {
        const empObj = allEmps.find((e: any) => e.id === employee_id);
        const empStoreName = empObj ? (storeMap[empObj.store_id] || "") : "";
        const empDept = empObj?.department || "";
        const empCode = empObj?.employee_code || "";
        const targetCal = resolveCalendarGroup(empCode, empDept, empStoreName);

        for (const emp of allEmps) {
          const sn = storeMap[emp.store_id] || "";
          if (matchCalendar(emp.employee_code, sn, emp.department || "", targetCal)) {
            targets.push({ employee_id: emp.id, title, body, tag: "attendance-reason", url: "/home" });
          }
        }
      }
    }

    // ============================
    // 5. 打刻アラート（バッチ: 毎朝9:10）
    // ============================
    if (type === "attendance_alert") {
      const { company_id, target_date } = payload;

      const { allEmps, storeMap } = await getEmpsAndStores(company_id);

      const empIds = allEmps.map((e: any) => e.id);
      const { data: attData } = await sb.from("attendance_daily")
        .select("employee_id, punch_in, punch_out, reason, is_holiday")
        .eq("attendance_date", target_date)
        .in("employee_id", empIds);

      const attMap: Record<string, any> = {};
      (attData || []).forEach((r: any) => { attMap[r.employee_id] = r; });

      const empCalMap: Record<string, string> = {};
      allEmps.forEach((e: any) => { if (e.holiday_calendar) empCalMap[e.id] = e.holiday_calendar; });
      const calTypes = [...new Set(Object.values(empCalMap))];
      const holidayCalSet = new Set<string>();
      if (calTypes.length > 0) {
        const { data: hcData } = await sb.from("holiday_calendars")
          .select("calendar_type")
          .eq("holiday_date", target_date)
          .in("calendar_type", calTypes);
        (hcData || []).forEach((h: any) => { holidayCalSet.add(h.calendar_type); });
      }

      const unpunched: { id: string; code: string; name: string; storeName: string; department: string; calDisplayName?: string | null }[] = [];
      const dateShort = shortDate(target_date);

      for (const emp of allEmps) {
        if (emp.employment_type?.includes("パート")) continue;
        if (emp.employee_code === "002") continue;

        const att = attMap[emp.id];
        if (att?.is_holiday) continue;
        const empCal = empCalMap[emp.id];
        if (empCal && holidayCalSet.has(empCal)) continue;

        if (att?.reason) {
          const rs = att.reason;
          const isFullDayOff = rs === "有給（全日）" || rs === "希望休（全日）" || rs === "欠勤" || rs === "休日" || rs === "公休" || rs === "休職" || (rs.includes("代休") && !rs.includes("午前") && !rs.includes("午後"));
          if (isFullDayOff) continue;
        }

        const noPunchIn = !att || !att.punch_in;
        const noPunchOut = !att || !att.punch_out;

        if (noPunchIn || noPunchOut) {
          unpunched.push({
            id: emp.id,
            code: emp.employee_code,
            name: emp.full_name,
            storeName: storeMap[emp.store_id] || "",
            department: emp.department || "",
            calDisplayName: emp.calendar_display_name || null,
          });
        }
      }

      for (const u of unpunched) {
        targets.push({
          employee_id: u.id,
          title: "打刻漏れがあります",
          body: `${dateShort}の出退勤が未登録です`,
          tag: "attendance-alert",
          url: "/home",
        });
      }

      const managers: { code: string; filter: (u: any) => boolean }[] = [
        { code: "009", filter: (u) => u.storeName.includes("八代") },
        { code: "006", filter: (u) => u.storeName.includes("健軍") },
        { code: "003", filter: (u) => u.storeName.includes("大津") || u.storeName.includes("菊陽") || u.department === "営業部" },
        { code: "069", filter: (u) => u.department === "鈑金塗装部" },
        { code: "067", filter: () => true },
      ];

      for (const mgr of managers) {
        const mgrEmp = allEmps.find((e: any) => e.employee_code === mgr.code);
        if (!mgrEmp) continue;
        const mgrUnpunched = unpunched.filter(mgr.filter);
        if (mgrUnpunched.length === 0) continue;

        const allNamesAlert = allEmps.map((e: any) => e.full_name);
        const names = mgrUnpunched.slice(0, 5).map(u => lastName(u.name, u.calDisplayName, allNamesAlert)).join("、");
        const suffix = mgrUnpunched.length > 5 ? `、他${mgrUnpunched.length - 5}名` : "";

        targets.push({
          employee_id: mgrEmp.id,
          title: `未打刻 ${mgrUnpunched.length}名（${dateShort}）`,
          body: `${names}${suffix}`,
          tag: "attendance-alert-mgr",
          url: "/home",
        });
      }
    }

    // ============================
    // 1. 朝のカレンダー通知（バッチ: 毎朝9:00）
    // ============================
    if (type === "morning_calendar") {
      const { company_id, target_date } = payload;

      const { data: events } = await sb.from("custom_events")
        .select("title, start_date, end_date, target_calendar")
        .eq("company_id", company_id)
        .lte("start_date", target_date)
        .gte("end_date", target_date);

      const { data: attData } = await sb.from("attendance_daily")
        .select("employee_id, reason")
        .eq("attendance_date", target_date)
        .not("reason", "is", null);

      const { allEmps, storeMap } = await getEmpsAndStores(company_id);

      const allNames = allEmps.map((e: any) => e.full_name);
      const empMap: Record<string, { name: string; storeName: string; department: string; code: string; calDisplayName?: string | null }> = {};
      allEmps.forEach((e: any) => {
        empMap[e.id] = { name: e.full_name, storeName: storeMap[e.store_id] || "", department: e.department || "", code: e.employee_code, calDisplayName: e.calendar_display_name || null };
      });

      const leaveItems: { label: string; targetCal: string }[] = [];
      for (const att of (attData || [])) {
        const emp = empMap[att.employee_id];
        if (!emp) continue;
        const r = att.reason;
        const dn = lastName(emp.name, emp.calDisplayName, allNames);
        let label = "";
        if (r.includes("有給（全日）")) label = `${dn}:有給`;
        else if (r.includes("午前有給")) label = `${dn}:午前有給`;
        else if (r.includes("午後有給")) label = `${dn}:午後有給`;
        else if (r.includes("希望休（全日）")) label = `${dn}:希望休`;
        else if (r.includes("午前希望休")) label = `${dn}:午前希望休`;
        else if (r.includes("午後希望休")) label = `${dn}:午後希望休`;
        else if (r.includes("代休")) label = `${dn}:代休`;
        else if (r.includes("出張")) label = `${dn}:出張`;
        else if (r === "休職") label = `${dn}:休職`;
        else continue;

        const tc = resolveCalendarGroup(emp.code, emp.department, emp.storeName);
        leaveItems.push({ label, targetCal: tc });
      }

      const empItems: Record<string, string[]> = {};

      for (const evt of (events || [])) {
        for (const emp of allEmps) {
          const sn = storeMap[emp.store_id] || "";
          if (matchCalendar(emp.employee_code, sn, emp.department || "", evt.target_calendar)) {
            if (!empItems[emp.id]) empItems[emp.id] = [];
            empItems[emp.id].push(evt.title);
          }
        }
      }

      for (const li of leaveItems) {
        for (const emp of allEmps) {
          const sn = storeMap[emp.store_id] || "";
          if (matchCalendar(emp.employee_code, sn, emp.department || "", li.targetCal)) {
            if (!empItems[emp.id]) empItems[emp.id] = [];
            if (!empItems[emp.id].includes(li.label)) empItems[emp.id].push(li.label);
          }
        }
      }

      for (const emp of allEmps) {
        const items = empItems[emp.id] || [];
        if (items.length === 0) {
          targets.push({
            employee_id: emp.id,
            title: "本日の予定はありません",
            body: "",
            tag: "morning-calendar",
            url: "/home",
          });
        } else {
          const display = items.length <= 3
            ? items.map(i => `・${i}`).join("\n")
            : items.slice(0, 3).map(i => `・${i}`).join("\n") + `、他${items.length - 3}件`;
          targets.push({
            employee_id: emp.id,
            title: `今日の予定は${items.length}件です。`,
            body: display,
            tag: "morning-calendar",
            url: "/home",
          });
        }
      }
    }

    // ============================
    // 4. 予定10分前アラート（バッチ）
    // ============================
    if (type === "event_reminder") {
      const { company_id, target_date, target_time } = payload;

      const targetDate = target_date;
      const targetTime = target_time + ":00";

      const { data: events } = await sb.from("custom_events")
        .select("title, start_date, start_time, target_calendar")
        .eq("company_id", company_id)
        .eq("start_date", targetDate)
        .eq("start_time", targetTime);

      if (!events || events.length === 0) {
        return new Response(JSON.stringify({ sent: 0 }));
      }

      const { allEmps, storeMap } = await getEmpsAndStores(company_id);

      for (const evt of events) {
        const calLabel = calMap[evt.target_calendar] || evt.target_calendar;
        const dow = ["日","月","火","水","木","金","土"][new Date(evt.start_date).getDay()];
        const d = new Date(evt.start_date);
        const dateDisplay = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日(${dow})`;

        const title = "予定の10分前です";
        const body = `${calLabel}：${evt.title}\n${dateDisplay} ${evt.start_time?.slice(0,5)}`;

        for (const emp of allEmps) {
          const sn = storeMap[emp.store_id] || "";
          if (matchCalendar(emp.employee_code, sn, emp.department || "", evt.target_calendar)) {
            targets.push({ employee_id: emp.id, title, body, tag: "event-reminder", url: "/home" });
          }
        }
      }
    }

    // ============================
    // WC: 申請通知（有給・遅刻・早退・欠勤 → WC001/W67/W49）
    // ============================
    if (type === "wc_leave_request") {
      const { company_id, employee_name, reason, attendance_date } = payload;
      const WC_NOTIFY_CODES = ["WC001", "W67", "W49"];
      const { allEmps } = await getEmpsAndStores(company_id);
      const allNamesWc = allEmps.map((e: any) => e.full_name);
      const reqEmp = allEmps.find((e: any) => e.full_name === employee_name);
      const dateShort = shortDate(attendance_date);
      let reasonLabel = reason;
      if (reason === "有給（全日）") reasonLabel = "有給（全日）";

      for (const code of WC_NOTIFY_CODES) {
        const emp = allEmps.find((e: any) => e.employee_code === code);
        if (emp) {
          targets.push({
            employee_id: emp.id,
            title: `${lastName(employee_name, reqEmp?.calendar_display_name, allNamesWc)}が${reasonLabel}を申請`,
            body: dateShort,
            tag: "wc-leave-request",
            url: "/home",
          });
        }
      }
    }

    // ============================
    // WC: 申請承認/却下通知 → 該当従業員
    // ============================
    if (type === "wc_request_processed") {
      const { employee_id, category, status } = payload;
      const label = status === "承認" ? "承認されました" : "却下されました";
      targets.push({
        employee_id,
        title: `${category}が${label}`,
        body: status === "却下" ? "詳細はポータルで確認してください" : "",
        tag: "wc-request-processed",
        url: "/home",
      });
    }

    // ============================
    // WC: 情報変更申請通知 → W67のみ
    // ============================
    if (type === "wc_info_change_request") {
      const { company_id, employee_name, category } = payload;
      const { allEmps } = await getEmpsAndStores(company_id);
      const allNamesIc = allEmps.map((e: any) => e.full_name);
      const icEmp = allEmps.find((e: any) => e.full_name === employee_name);
      const W67_CODES = ["W67"];
      for (const code of W67_CODES) {
        const emp = allEmps.find((e: any) => e.employee_code === code);
        if (emp) {
          targets.push({
            employee_id: emp.id,
            title: `${lastName(employee_name, icEmp?.calendar_display_name, allNamesIc)}が情報変更を申請`,
            body: category || "情報変更申請",
            tag: "wc-info-change",
            url: "/home",
          });
        }
      }
    }

    // ============================
    // WC: シフト差し戻し通知 → 該当従業員
    // ============================
    if (type === "shift_returned") {
      const { employee_id, attendance_date, leave_type } = payload;
      const kindLabel = leave_type === "yukyu" ? "有給" : "公休";
      targets.push({
        employee_id,
        title: `${kindLabel}希望が差し戻されました`,
        body: `${shortDate(attendance_date)}の${kindLabel}希望が差し戻されました`,
        tag: "shift-returned",
        url: "/home",
      });
    }

    // ============================
    // WC: シフト確定通知 → 全従業員
    // ============================
    if (type === "shift_confirmed") {
      const { company_id, target_month } = payload;
      const { allEmps } = await getEmpsAndStores(company_id);
      const WC_NOTIFY_CODES = ["W02", "W49", "W67"];
      for (const emp of allEmps) {
        if (WC_NOTIFY_CODES.includes(emp.employee_code)) continue;
        targets.push({
          employee_id: emp.id,
          title: `${target_month}のシフトが確定しました`,
          body: "出勤簿タブで確認してください",
          tag: "shift-confirmed",
          url: "/home",
        });
      }
    }

    // ============================
    // WC: シフト提出リマインダー（pg_cron: 毎月23日・25日）
    // ============================
    if (type === "shift_reminder") {
      const companyId = payload.company_id;

      // ── 対象月度を動的に算出（getCurrentSubmissionPeriod相当） ──
      let targetMonth: string | null = null;
      const { data: confs } = await sb.from("shift_confirmations")
        .select("target_month")
        .eq("company_id", companyId)
        .not("confirmed_at", "is", null)
        .order("target_month", { ascending: false })
        .limit(1);
      if (confs && confs.length > 0) {
        const [cy, cm] = (confs[0].target_month as string).split("-").map(Number);
        const nm = cm + 1 > 12 ? 1 : cm + 1;
        const ny = cm + 1 > 12 ? cy + 1 : cy;
        targetMonth = `${ny}-${String(nm).padStart(2, "0")}`;
      } else {
        const { data: subMin } = await sb.from("shift_submissions")
          .select("target_month")
          .eq("company_id", companyId)
          .order("target_month", { ascending: true })
          .limit(1);
        if (subMin && subMin.length > 0) {
          targetMonth = subMin[0].target_month as string;
        } else {
          const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
          const base = { yr: nowJst.getUTCFullYear(), mo: nowJst.getUTCMonth() + 1 };
          const adj = nowJst.getUTCDate() <= 25 ? base : { yr: base.mo === 12 ? base.yr + 1 : base.yr, mo: base.mo === 12 ? 1 : base.mo + 1 };
          const fm = adj.mo + 2 > 12 ? { yr: adj.yr + (adj.mo + 2 > 24 ? 2 : 1), mo: (adj.mo + 2 - 1) % 12 + 1 } : { yr: adj.yr, mo: adj.mo + 2 };
          targetMonth = `${fm.yr}-${String(fm.mo).padStart(2, "0")}`;
        }
      }

      // ── 未提出者を抽出 ──
      const { data: allWcEmps } = await sb.from("employees")
        .select("id, employee_code, full_name")
        .eq("company_id", companyId)
        .or("is_active.is.null,is_active.eq.true")
        .order("employee_code");
      const wcEmps = (allWcEmps || []).filter((e: any) =>
        /^WC\d+$/.test(e.employee_code) && e.employee_code !== "WC001"
      );
      const { data: submitted } = await sb.from("shift_submissions")
        .select("employee_id")
        .eq("company_id", companyId)
        .eq("target_month", targetMonth);
      const submittedSet = new Set((submitted || []).map((s: any) => s.employee_id));
      const unsubmitted = wcEmps.filter((e: any) => !submittedSet.has(e.id));

      // ── 文面を出し分け ──
      const nowJst2 = new Date(Date.now() + 9 * 3600 * 1000);
      const jstDay = nowJst2.getUTCDate();
      const jstMonth = nowJst2.getUTCMonth() + 1;
      const moNum = parseInt(targetMonth.split("-")[1], 10);
      const isDeadline = jstDay === 25;
      const title = isDeadline ? "本日シフト締切" : "シフト未提出です";
      const body = isDeadline
        ? `${moNum}月度の希望シフトが未提出です。本日(${jstMonth}/25)が締切です。提出してください。`
        : `${moNum}月度の希望シフトが未提出です。${jstMonth}月25日までに提出してください。`;

      for (const emp of unsubmitted) {
        targets.push({
          employee_id: emp.id,
          title,
          body,
          tag: "shift-reminder",
          url: "/home",
        });
      }
    }

    // ============================
    // 送信直前: 退職者を除外（全タイプ共通の最終防衛線）
    if (targets.length > 0) {
      const empIds = [...new Set(targets.map(t => t.employee_id))];
      const { data: activeEmps } = await sb.from("employees")
        .select("id")
        .in("id", empIds)
        .or("is_active.is.null,is_active.eq.true")
        .is("resigned_at", null);
      const activeSet = new Set((activeEmps || []).map(e => e.id));
      targets = targets.filter(t => activeSet.has(t.employee_id));
    }

    // 通知送信
    // ============================
    let sent = 0;
    let failed = 0;

    for (const t of targets) {
      const { data: subs } = await sb.from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("employee_id", t.employee_id);

      for (const sub of (subs || [])) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: t.title, body: t.body, tag: t.tag, url: t.url })
          );
          sent++;
        } catch (err: any) {
          if (err.statusCode === 410) {
            await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          }
          failed++;
        }
      }
    }

    return new Response(JSON.stringify({ sent, failed, targets: targets.length }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});