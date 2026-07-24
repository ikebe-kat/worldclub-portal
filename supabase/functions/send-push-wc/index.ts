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
const ALL_CALENDAR_CODES = ["002", "018", "067", "003", "009", "006", "049", "070"];
const GYOMU_DEPTS = ["人事", "経理", "DX", "人事総務", "DX推進"];
const WC_NOTIFY_CODES = ["WC001", "W49", "W67"];

const calMap: Record<string, string> = {
  "all": "全店舗", "kengun": "健軍", "ozu": "大津", "yatsushiro": "八代", "gyomu": "業務部",
  "higashibypass": "東バイパス", "rentacar": "レンタカー",
  "全店舗": "全店舗", "健軍": "健軍", "大津": "大津", "八代": "八代", "業務部": "業務部",
};

function resolveStoreShort(storeName: string): string {
  if (!storeName) return "—";
  if (storeName.includes("八代")) return "八代";
  if (storeName.includes("健軍")) return "健軍";
  if (storeName.includes("大津") || storeName.includes("菊陽")) return "大津";
  if (storeName.includes("東バイパス")) return "東バイパス";
  if (storeName.includes("レンタカー")) return "レンタカー";
  if (storeName.includes("本社")) return "本社";
  if (storeName.includes("経理") || storeName.includes("人事") || storeName.includes("DX")) return "業務部";
  if (storeName.includes("御領")) return "御領";
  return storeName;
}

/* 従業員のカレンダーグループを特定（stores.calendar_group ベース） */
function resolveCalendarGroup(empCode: string, department: string, calGroup: string): string {
  if (empCode === "002") return "gyomu";
  if (GYOMU_DEPTS.some(d => (department || "").includes(d))) return "gyomu";
  return calGroup || "gyomu";
}

/* 複数カレンダーグループに所属する社員の全グループを返す */
const MULTI_CAL_GROUPS: Record<string, string[]> = {
  "070": ["gyomu", "ozu"],
  "095": ["gyomu", "kengun"],
};

function resolveCalendarGroups(empCode: string, department: string, calGroup: string): string[] {
  if (MULTI_CAL_GROUPS[empCode]) return MULTI_CAL_GROUPS[empCode];
  return [resolveCalendarGroup(empCode, department, calGroup)];
}

/* 通知を受け取るかどうか判定 */
function matchCalendar(empCode: string, calGroup: string, department: string, targetCal: string): boolean {
  if (ALL_CALENDAR_CODES.includes(empCode)) return true;
  if (targetCal === "全店舗" || targetCal === "all") return true;
  const myGroups = resolveCalendarGroups(empCode, department, calGroup);
  return myGroups.includes(targetCal);
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

// 3社共通の DB関数 fn_leave_days_in_period(target='attendance') に一本化。
// 指定日1日分の休職(attendance除外)従業員IDセットを返す。
async function getOnLeaveSet(sb: any, companyId: string, targetDate: string): Promise<Set<string>> {
  const { data } = await sb.rpc("fn_leave_days_in_period", {
    p_company_id: companyId,
    p_period_start: targetDate,
    p_period_end: targetDate,
    p_target: "attendance",
  });
  return new Set<string>((data || []).map((r: any) => r.employee_id));
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
        .or("is_active.is.null,is_active.eq.true")
        .is("resigned_at", null);
      const { data: stores } = await sb.from("stores")
        .select("id, store_name, calendar_group")
        .eq("company_id", companyId);
      const storeMap: Record<string, string> = {};
      const calGroupMap: Record<string, string> = {};
      (stores || []).forEach((s: any) => {
        storeMap[s.id] = s.store_name || "";
        calGroupMap[s.id] = s.calendar_group || "";
      });
      return { allEmps: allEmps || [], storeMap, calGroupMap };
    }

    async function getStoreHistory(empIds: string[]) {
      if (empIds.length === 0) return {};
      const { data } = await sb.from("employee_store_history")
        .select("employee_id, store_id, start_date, created_at")
        .in("employee_id", empIds)
        .order("start_date", { ascending: false })
        .order("created_at", { ascending: false });
      const map: Record<string, { store_id: string; start_date: string; created_at: string }[]> = {};
      for (const h of (data || [])) {
        if (!map[h.employee_id]) map[h.employee_id] = [];
        map[h.employee_id].push({ store_id: h.store_id, start_date: h.start_date, created_at: h.created_at });
      }
      return map;
    }

    // fn_resolve_store_at_date と同一定義。変更時は storeResolve.ts・storeHistory.ts・DB関数も同時に更新すること。
    function resolveStoreAtDate(
      history: { store_id: string; start_date: string; created_at?: string }[],
      currentStoreId: string,
      date: string,
    ): string {
      let best: { store_id: string; start_date: string; created_at?: string } | null = null;
      for (const h of (history || [])) {
        if (h.start_date > date) continue;
        if (!best || h.start_date > best.start_date ||
            (h.start_date === best.start_date && (h.created_at ?? "") > (best.created_at ?? ""))) {
          best = h;
        }
      }
      return best?.store_id ?? currentStoreId;
    }

    // ============================
    // 2. 予定登録/編集/削除時（即時通知）
    // ============================
    if (type === "calendar_event") {
      const { action, event } = payload;
      const creatorName = event.creator_name || "不明";
      const creatorEmpId = event.creator_employee_id || null;
      const isJimu = event.target_calendar === "jimu";
      const calLabel = isJimu ? "業務部" : (calMap[event.target_calendar] || event.target_calendar);
      const actionText = action === "updated" ? "編集" : action === "deleted" ? "削除" : "登録";
      const title = `${creatorName}が予定を${actionText}しました`;
      const timeStr = event.start_time ? ` ${event.start_time.slice(0, 5)}` : "";

      const { allEmps, calGroupMap } = await getEmpsAndStores(event.company_id);
      const allNames = allEmps.map((e: any) => e.full_name);
      const creatorEmp = creatorEmpId ? allEmps.find((e: any) => e.id === creatorEmpId) : null;
      const body = `${calLabel}：${lastName(creatorName, creatorEmp?.calendar_display_name, allNames)}　${event.title} ${shortDate(event.start_date)}${timeStr}`;

      if (isJimu) {
        for (const emp of allEmps) {
          if (!["W02", "W49", "W67"].includes(emp.employee_code)) continue;
          if (creatorEmpId && emp.id === creatorEmpId) continue;
          targets.push({ employee_id: emp.id, title, body, tag: "calendar", url: "/home" });
        }
      } else {
        for (const emp of allEmps) {
          if (creatorEmpId && emp.id === creatorEmpId) continue;
          const cg = calGroupMap[emp.store_id] || "";
          if (matchCalendar(emp.employee_code, cg, emp.department || "", event.target_calendar)) {
            targets.push({ employee_id: emp.id, title, body, tag: "calendar", url: "/home" });
          }
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
      const { employee_id, category, status, title: pTitle, body: pBody } = payload;
      targets.push({
        employee_id,
        title: pTitle || `申請が${status}されました`,
        body: pBody || category,
        tag: "request",
        url: "/home",
      });
    }

    // ============================
    // 9. 勤怠事由登録時（即時通知）
    // ============================
    if (type === "attendance_reason_set") {
      const { company_id, employee_id, employee_name, reason, attendance_date } = payload;
      const { allEmps, storeMap, calGroupMap } = await getEmpsAndStores(company_id);
      const histMap = await getStoreHistory(allEmps.map((e: any) => e.id));

      const empObj = allEmps.find((e: any) => e.id === employee_id);
      const senderHist = histMap[employee_id] || [];
      const senderResolvedStore = resolveStoreAtDate(senderHist, empObj?.store_id || "", attendance_date);
      const storeShort = resolveStoreShort(storeMap[senderResolvedStore] || "");
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
      const allNames = allEmps.map((e: any) => e.full_name);
      const body = `${storeShort}：${lastName(employee_name, empObj?.calendar_display_name, allNames)}　${bodyDate}`;

      const empCalGroup = calGroupMap[senderResolvedStore] || "";
      const empDept = empObj?.department || "";
      const empCode = empObj?.employee_code || "";
      const targetCals = resolveCalendarGroups(empCode, empDept, empCalGroup);

      const seen = new Set<string>();
      for (const targetCal of targetCals) {
        for (const emp of allEmps) {
          if (seen.has(emp.id)) continue;
          const rcvHist = histMap[emp.id] || [];
          const rcvStore = resolveStoreAtDate(rcvHist, emp.store_id, attendance_date);
          const cg = calGroupMap[rcvStore] || "";
          if (matchCalendar(emp.employee_code, cg, emp.department || "", targetCal)) {
            seen.add(emp.id);
            targets.push({ employee_id: emp.id, title, body, tag: `attendance-reason-${employee_id}-${attendance_date}`, url: "/home" });
          }
        }
      }
    }

    // ============================
    // 10. 勤怠事由削除時（即時通知）
    // ============================
    if (type === "attendance_reason_cleared") {
      const { company_id, employee_id, employee_name, old_reason, attendance_date } = payload;
      const { allEmps, storeMap, calGroupMap } = await getEmpsAndStores(company_id);
      const histMap = await getStoreHistory(allEmps.map((e: any) => e.id));

      const empObj = allEmps.find((e: any) => e.id === employee_id);
      const senderHist = histMap[employee_id] || [];
      const senderResolvedStore = resolveStoreAtDate(senderHist, empObj?.store_id || "", attendance_date);
      const storeShort = resolveStoreShort(storeMap[senderResolvedStore] || "");
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
      const allNames = allEmps.map((e: any) => e.full_name);
      const body = `${storeShort}：${lastName(employee_name, empObj?.calendar_display_name, allNames)}　${dateShort}`;

      const empCalGroup = calGroupMap[senderResolvedStore] || "";
      const empDept = empObj?.department || "";
      const empCode = empObj?.employee_code || "";
      const targetCals = resolveCalendarGroups(empCode, empDept, empCalGroup);

      const seen = new Set<string>();
      for (const targetCal of targetCals) {
        for (const emp of allEmps) {
          if (seen.has(emp.id)) continue;
          const rcvHist = histMap[emp.id] || [];
          const rcvStore = resolveStoreAtDate(rcvHist, emp.store_id, attendance_date);
          const cg = calGroupMap[rcvStore] || "";
          if (matchCalendar(emp.employee_code, cg, emp.department || "", targetCal)) {
            seen.add(emp.id);
            targets.push({ employee_id: emp.id, title, body, tag: `attendance-reason-${employee_id}-${attendance_date}`, url: "/home" });
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

      const allNames = allEmps.map((e: any) => e.full_name);
      const unpunched: { id: string; code: string; name: string; storeName: string; department: string; calDisplayName: string | null }[] = [];
      const dateShort = shortDate(target_date);

      const onLeaveSet = await getOnLeaveSet(sb, company_id, target_date);

      for (const emp of allEmps) {
        if (emp.employment_type?.includes("パート")) continue;
        if (emp.employee_code === "002") continue;
        if (onLeaveSet.has(emp.id)) continue;

        const att = attMap[emp.id];
        if (att?.is_holiday) continue;
        const empCal = empCalMap[emp.id];
        if (empCal && holidayCalSet.has(empCal)) continue;

        if (att?.reason) {
          const rs = att.reason;
          const isFullDayOff = rs === "有給（全日）" || rs === "希望休（全日）" || rs === "指定休" || rs === "欠勤" || rs === "休日" || rs === "公休" || rs === "休職" || (rs.includes("代休") && !rs.includes("午前") && !rs.includes("午後"));
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
        { code: "099", filter: (u) => u.department === "レンタカー部門" },
        { code: "043", filter: (u) => u.storeName.includes("東バイパス") },
        { code: "095", filter: (u) => u.storeName.includes("健軍") || GYOMU_DEPTS.some(d => (u.department || "").includes(d)) },
        { code: "070", filter: () => true },
        { code: "067", filter: () => true },
      ];

      for (const mgr of managers) {
        const mgrEmp = allEmps.find((e: any) => e.employee_code === mgr.code);
        if (!mgrEmp) continue;
        const mgrUnpunched = unpunched.filter(mgr.filter);
        if (mgrUnpunched.length === 0) continue;

        const names = mgrUnpunched.slice(0, 5).map(u => lastName(u.name, u.calDisplayName, allNames)).join("、");
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

      const { data: events, error: eventsErr } = await sb.from("custom_events")
        .select("title, start_date, end_date, target_calendar")
        .eq("company_id", company_id)
        .lte("start_date", target_date)
        .gte("end_date", target_date);

      const { data: attData, error: attErr } = await sb.from("attendance_daily")
        .select("employee_id, reason")
        .eq("attendance_date", target_date)
        .not("reason", "is", null);

      const { allEmps, storeMap, calGroupMap } = await getEmpsAndStores(company_id);
      const histMap = await getStoreHistory(allEmps.map((e: any) => e.id));

      const mcOnLeaveSet = await getOnLeaveSet(sb, company_id, target_date);

      const allNames = allEmps.map((e: any) => e.full_name);
      const empMap: Record<string, { name: string; store_id: string; department: string; code: string; calDisplayName: string | null }> = {};
      allEmps.forEach((e: any) => {
        empMap[e.id] = { name: e.full_name, store_id: e.store_id || "", department: e.department || "", code: e.employee_code, calDisplayName: e.calendar_display_name || null };
      });

      const leaveItems: { label: string; targetCal: string }[] = [];
      for (const att of (attData || [])) {
        if (mcOnLeaveSet.has(att.employee_id)) continue; // 休職者は事由ラベルを出さない
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

        const empHist = histMap[att.employee_id] || [];
        const resolvedStore = resolveStoreAtDate(empHist, emp.store_id, target_date);
        const resolvedCg = calGroupMap[resolvedStore] || "";
        const tc = resolveCalendarGroup(emp.code, emp.department, resolvedCg);
        leaveItems.push({ label, targetCal: tc });
      }

      const empItems: Record<string, string[]> = {};

      for (const evt of (events || [])) {
        for (const emp of allEmps) {
          const rcvHist = histMap[emp.id] || [];
          const rcvStore = resolveStoreAtDate(rcvHist, emp.store_id, target_date);
          const cg = calGroupMap[rcvStore] || "";
          if (matchCalendar(emp.employee_code, cg, emp.department || "", evt.target_calendar)) {
            if (!empItems[emp.id]) empItems[emp.id] = [];
            empItems[emp.id].push(evt.title);
          }
        }
      }

      for (const li of leaveItems) {
        for (const emp of allEmps) {
          const rcvHist = histMap[emp.id] || [];
          const rcvStore = resolveStoreAtDate(rcvHist, emp.store_id, target_date);
          const cg = calGroupMap[rcvStore] || "";
          if (matchCalendar(emp.employee_code, cg, emp.department || "", li.targetCal)) {
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

      const { allEmps, calGroupMap } = await getEmpsAndStores(company_id);

      for (const evt of events) {
        const calLabel = calMap[evt.target_calendar] || evt.target_calendar;
        const dow = ["日","月","火","水","木","金","土"][new Date(evt.start_date).getDay()];
        const d = new Date(evt.start_date);
        const dateDisplay = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日(${dow})`;

        const title = "予定の10分前です";
        const body = `${calLabel}：${evt.title}\n${dateDisplay} ${evt.start_time?.slice(0,5)}`;

        for (const emp of allEmps) {
          const cg = calGroupMap[emp.store_id] || "";
          if (matchCalendar(emp.employee_code, cg, emp.department || "", evt.target_calendar)) {
            targets.push({ employee_id: emp.id, title, body, tag: "event-reminder", url: "/home" });
          }
        }
      }
    }

    // ============================
    // シフト差し戻し通知（公休/有給）
    // ============================
    if (type === "shift_returned") {
      const { employee_id, target_month, attendance_date, leave_type, reject_reason } = payload;
      let title = "シフト差し戻し";
      let body = "";
      if (attendance_date && (leave_type === "yukyu" || leave_type === "shift_koukyuu")) {
        const isYukyu = leave_type === "yukyu";
        title = isYukyu ? "有給申請 差し戻し" : "公休申請 差し戻し";
        const reasonText = reject_reason ? `（${reject_reason}）` : "";
        const dm = String(attendance_date).match(/^(\d{4})-(\d{2})-(\d{2})/);
        const dateLabel = dm ? `${parseInt(dm[2], 10)}月${parseInt(dm[3], 10)}日` : attendance_date;
        body = `${dateLabel}の${isYukyu ? "有給" : "公休"}申請が差し戻されました${reasonText}`;
      } else if (target_month) {
        const mo = parseInt(target_month.split("-")[1], 10);
        body = `${mo}月のシフトが差し戻されました`;
      }
      targets.push({
        employee_id,
        title,
        body,
        tag: "shift-returned",
        url: "/home",
      });
    }

    // ============================
    // シフト確定通知（WC管理者3名のみ）
    // ============================
    if (type === "shift_confirmed") {
      const { company_id, target_month } = payload;
      const mo = parseInt(target_month.split("-")[1], 10);
      const { allEmps } = await getEmpsAndStores(company_id);
      for (const code of WC_NOTIFY_CODES) {
        const emp = allEmps.find((e: any) => e.employee_code === code);
        if (emp) {
          targets.push({
            employee_id: emp.id,
            title: "シフト確定",
            body: `${mo}月のシフトが確定しました`,
            tag: "shift-confirmed",
            url: "/home",
          });
        }
      }
    }

    // ============================
    // シフト提出通知（管理者宛）
    // ============================
    if (type === "shift_submitted") {
      const { employee_id, employee_name, target_month } = payload;
      const mo = parseInt(target_month.split("-")[1], 10);
      targets.push({
        employee_id,
        title: "シフト提出",
        body: `${employee_name}さんが${mo}月のシフトを提出しました`,
        tag: "shift-submitted",
        url: "/home",
      });
    }

    // ============================
    // シフト提出リマインド（毎月23日・25日 10:00 JST（pg_cron jobid 14/15））
    // ============================
    if (type === "shift_reminder") {
      const { company_id, target_month, is_deadline } = payload;
      if (!target_month || typeof target_month !== "string" || !target_month.includes("-")) {
        // target_month が未指定・不正な場合は何もせず抜ける
      } else {
        const mo = parseInt(target_month.split("-")[1], 10);

        const { data: psRows } = await sb.from("wc_payroll_settings")
          .select("employee_id")
          .eq("company_id", company_id)
          .eq("is_active", true)
          .eq("hide_from_shift_view", false);
        const payrollEmpIds = new Set<string>((psRows || []).map((r: any) => r.employee_id).filter(Boolean));

        const { data: allEmps } = await sb.from("employees")
          .select("id, employee_code")
          .eq("company_id", company_id)
          .or("is_active.is.null,is_active.eq.true");

        const candidates = (allEmps || []).filter((e: any) =>
          payrollEmpIds.has(e.id) && e.employee_code !== "WC001"
        );
        const candidateIds = candidates.map((e: any) => e.id);

        const { data: subs } = await sb.from("shift_submissions")
          .select("employee_id")
          .eq("company_id", company_id)
          .eq("target_month", target_month)
          .in("employee_id", candidateIds);
        const submittedSet = new Set<string>((subs || []).map((s: any) => s.employee_id));

        const title = is_deadline ? "本日シフト締切" : "シフト提出リマインド";
        const body = is_deadline
          ? `${mo}月度の希望シフトが未提出です。本日が締切です。`
          : `${mo}月度の希望シフトが未提出です。25日までに提出してください。`;

        for (const emp of candidates) {
          if (submittedSet.has(emp.id)) continue;
          targets.push({
            employee_id: emp.id,
            title,
            body,
            tag: "shift-reminder",
            url: "/home",
          });
        }
      }
    }

    // ============================
    // 業務部ハブ通知（即時通知）
    // ============================
    if (type === "biz_hub_notify") {
      const { target_employee_ids, title: bTitle, body: bBody } = payload;
      for (const eid of (target_employee_ids || [])) {
        targets.push({
          employee_id: eid,
          title: bTitle || "業務部",
          body: bBody || "",
          tag: "biz-hub",
          url: "/home",
        });
      }
    }

    // ============================
    // お知らせ通知（即時 — NotificationManageSubから呼び出し）
    // ============================
    if (type === "notification") {
      const { employee_ids, title: nTitle, body: nBody, click_action } = payload;
      for (const eid of (employee_ids || [])) {
        targets.push({
          employee_id: eid,
          title: nTitle || "新しいお知らせ",
          body: nBody || "",
          tag: "notification",
          url: click_action || "/home?tab=mypage&sub=notifications",
        });
      }
    }

    // ============================
    // お知らせリマインド（pg_cronバッチ — 期限3日前/当日）
    // ============================
    if (type === "notification_reminder") {
      const { employee_ids, title: rTitle, body: rBody, click_action } = payload;
      if (employee_ids && employee_ids.length > 0) {
        for (const eid of employee_ids) {
          targets.push({
            employee_id: eid,
            title: rTitle || "【リマインド】未提出のお知らせがあります",
            body: rBody || "提出期限が近づいています",
            tag: "notification-reminder",
            url: click_action || "/home?tab=mypage&sub=notifications",
          });
        }
      }
    }

    // ============================
    // WC: 申請通知（有給・遅刻・早退・欠勤 → WC001/W67/W49）
    // ============================
    if (type === "wc_leave_request") {
      const { company_id, employee_name, reason, attendance_date } = payload;
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
    // WC: 情報変更申請通知 → W67（池邉）のみ
    // ============================
    if (type === "wc_info_change_request") {
      const { company_id, employee_name, category } = payload;
      const { allEmps } = await getEmpsAndStores(company_id);
      const allNamesIc = allEmps.map((e: any) => e.full_name);
      const icEmp = allEmps.find((e: any) => e.full_name === employee_name);
      const emp = allEmps.find((e: any) => e.employee_code === "W67");
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

    // ============================
    // 送信直前: 退職者を除外（全タイプ共通の最終防衛線）
    // ============================
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

    // ============================
    // 通知送信（Promise.allSettledで並列送信）
    // ============================
    let sent = 0;
    let failed = 0;

    const sendJobs: Promise<any>[] = [];
    for (const t of targets) {
      const { data: subs } = await sb.from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("employee_id", t.employee_id);

      for (const sub of (subs || [])) {
        sendJobs.push(
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: t.title, body: t.body, tag: t.tag, url: t.url })
          ).catch(async (err: any) => {
            if (err.statusCode === 410) {
              await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
            }
            throw err;
          })
        );
      }
    }

    const results = await Promise.allSettled(sendJobs);
    for (const r of results) {
      if (r.status === "fulfilled") sent++;
      else failed++;
    }

    return new Response(JSON.stringify({ sent, failed, targets: targets.length, type }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
