"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/constants";
import { GeoBackground } from "@/components/ui";
import { getPermLevel, canEditPunch } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import PunchTab      from "@/components/tabs/PunchTab";
import AttendanceTab from "@/components/tabs/AttendanceTab";
import CalendarTab   from "@/components/tabs/CalendarTab";
import RosterTab     from "@/components/tabs/RosterTab";
import DocumentsTab  from "@/components/tabs/DocumentsTab";
import AdminTab      from "@/components/tabs/AdminTab";
import PushPermission from "@/components/PushPermission";

type TabId = "punch" | "attendance" | "calendar" | "roster" | "documents" | "admin";

const BASE_TABS: { id: TabId; label: string }[] = [
  { id: "punch",      label: "打刻" },
  { id: "attendance", label: "出勤簿" },
  { id: "calendar",   label: "カレンダー" },
  { id: "roster",     label: "名簿" },
  { id: "documents",  label: "書類" },
];

const WcLogo = () => (
  <img src="/worldclub-logo.png" alt="WORLD CLUB" style={{ height: 32, borderRadius: 4 }} />
);

/* ── 赤バッジ ── */
const TabBadge = ({ count }: { count: number }) => {
  if (count <= 0) return null;
  return (
    <span style={{
      position: "absolute", top: 4, right: "50%", transform: "translateX(20px)",
      minWidth: 16, height: 16, borderRadius: 8, backgroundColor: "#EF4444",
      color: "#fff", fontSize: 10, fontWeight: 700, display: "flex",
      alignItems: "center", justifyContent: "center", padding: "0 4px",
      lineHeight: 1,
    }}>{count > 99 ? "99+" : count}</span>
  );
};

export default function HomePage() {
  const router = useRouter();
  const [employee, setEmployee] = useState<any>(null);
  const [tab, setTab] = useState<TabId>("punch");

  /* バッジ件数 */
  const [attendanceBadge, setAttendanceBadge] = useState(0);
  const [docsBadge, setDocsBadge] = useState(0);
  const [adminBadge, setAdminBadge] = useState(0);

  useEffect(() => {
    const stored = localStorage.getItem("employee");
    if (!stored) {
      router.push("/");
      return;
    }
    const emp = JSON.parse(stored);
    setEmployee(emp);
  }, []);

  /* ── バッジ件数取得 ── */
  const fetchBadges = useCallback(async () => {
    if (!employee?.id) return;
    const now = new Date();
    const yr = now.getFullYear();
    const mo = now.getMonth() + 1;
    const monthStart = `${yr}-${String(mo).padStart(2,"0")}-01`;
    const startDate = monthStart < "2026-04-01" ? "2026-04-01" : monthStart;
    const today = `${yr}-${String(mo).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;

    /* 出勤簿バッジ: 自分の当月の勤怠異常 */
    const { data: myAtt } = await supabase.from("attendance_daily")
      .select("attendance_date, punch_in, punch_out, reason, late_minutes, early_leave_minutes, is_holiday")
      .eq("employee_id", employee.id)
      .gte("attendance_date", startDate).lte("attendance_date", today);

    let myIssues = 0;
    (myAtt || []).forEach((r: any) => {
      if (r.is_holiday || r.reason === "公休") return;
      if (r.reason?.includes("有給") || r.reason?.includes("希望休") || r.reason?.includes("代休") || r.reason === "欠勤") return;
      if (!r.punch_in && !r.punch_out && !r.reason) { myIssues++; return; }
      if (r.punch_in && !r.punch_out && r.attendance_date !== today) { myIssues++; return; }
    });
    setAttendanceBadge(myIssues);

    /* 書類バッジ */
    const { count: unconfirmedDocs } = await supabase.from("documents")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", employee.id).is("confirmed_at", null);
    setDocsBadge(unconfirmedDocs || 0);

    /* 管理バッジ */
    const perm = getPermLevel(employee.role || null);
    if (perm === "super" || perm === "admin") {
      const { data: allEmps } = await supabase.from("employees")
        .select("id, store_id, department").eq("company_id", employee.company_id);

      const myCode = employee.employee_code || "";
      const targetIds = (allEmps || [])
        .filter((e: any) => perm === "super" || canEditPunch(myCode, e.store_id, e.department))
        .map((e: any) => e.id);

      if (targetIds.length > 0) {
        const { data: teamAtt } = await supabase.from("attendance_daily")
          .select("attendance_date, punch_in, punch_out, reason, late_minutes, early_leave_minutes, is_holiday")
          .in("employee_id", targetIds)
          .gte("attendance_date", startDate).lte("attendance_date", today);

        let teamIssues = 0;
        (teamAtt || []).forEach((r: any) => {
          if (r.is_holiday || r.reason === "公休") return;
          if (r.reason?.includes("有給") || r.reason?.includes("希望休") || r.reason?.includes("代休") || r.reason === "欠勤") return;
          if (!r.punch_in && !r.punch_out && !r.reason) { teamIssues++; return; }
          if (r.punch_in && !r.punch_out && r.attendance_date !== today) { teamIssues++; return; }
        });

        if (employee.employee_code === "W67") {
          const { count: pendingReqs } = await supabase.from("change_requests")
            .select("id", { count: "exact", head: true })
            .eq("company_id", employee.company_id).eq("status", "未処理");
          teamIssues += (pendingReqs || 0);
        }

        setAdminBadge(teamIssues);
      }
    }
  }, [employee]);

  useEffect(() => { if (employee) fetchBadges(); }, [employee, fetchBadges]);

  useEffect(() => {
    if (!employee?.id) return;
    const channel = supabase.channel("badge-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_daily" }, () => fetchBadges())
      .on("postgres_changes", { event: "*", schema: "public", table: "change_requests" }, () => fetchBadges())
      .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, () => fetchBadges())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [employee, fetchBadges]);

  const handleLogout = () => {
    localStorage.removeItem("employee");
    const emp = employee;
    if (emp?.portal_group_id) {
      window.location.href = "https://kat-kintai-app.vercel.app/?logout=true";
    } else {
      router.push("/");
    }
  };

  if (!employee) return null;

  const perm = getPermLevel(employee.role || null);

  let TABS: { id: TabId; label: string }[];
  if (perm === "super" && employee.employee_code !== "W67" && employee.employee_code !== "WC001") {
    TABS = [
      { id: "calendar", label: "カレンダー" },
      { id: "roster",   label: "名簿" },
      { id: "admin",    label: "管理" },
    ];
  } else if (perm === "super" || perm === "admin") {
    TABS = [...BASE_TABS, { id: "admin", label: "管理" }];
  } else {
    TABS = BASE_TABS;
  }

  const getBadge = (tabId: TabId) => {
    if (tabId === "attendance") return attendanceBadge;
    if (tabId === "documents") return docsBadge;
    if (tabId === "admin") return adminBadge;
    return 0;
  };

  return (
    <div style={{
      fontFamily: "'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif",
      backgroundColor: T.bg, minHeight: "100vh", position: "relative",
    }}>
      <GeoBackground />

      <header style={{
        backgroundColor: "#fff", padding: "10px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${T.border}`,
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <WcLogo />
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: "1px" }}>WORLD CLUB</span>
          <span style={{ fontSize: 12, color: T.textMuted, marginLeft: 2 }}>社内ポータル</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{employee.full_name}</span>
          {employee.portal_group_id && <button onClick={() => { window.location.href = "https://kat-kintai-app.vercel.app/portal"; }} style={{ padding: "4px 12px", borderRadius: "4px", border: "1px solid #1a4b24", backgroundColor: "#fff", color: "#1a4b24", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>会社切替</button>}
          <button
            onClick={handleLogout}
            style={{
              padding: "4px 12px", borderRadius: "4px",
              border: `1px solid ${T.border}`, backgroundColor: "#fff",
              color: T.textSec, fontSize: 11, cursor: "pointer",
            }}
          >
            ログアウト
          </button>
        </div>
      </header>

      <nav style={{
        display: "flex", backgroundColor: "#fff",
        borderBottom: `1px solid ${T.border}`,
        position: "sticky", top: 46, zIndex: 99,
      }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); localStorage.setItem("currentTab", t.id); }}
            style={{
              flex: 1, padding: "12px 0", border: "none", backgroundColor: "transparent",
              cursor: "pointer", fontSize: 13, position: "relative",
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? T.primary : T.textSec,
              borderBottom: tab === t.id ? `3px solid ${T.primary}` : "3px solid transparent",
              transition: "all 0.2s",
            }}
          >
            {t.label}
            <TabBadge count={getBadge(t.id)} />
          </button>
        ))}
      </nav>

      <main style={{ position: "relative", zIndex: 1 }}>
        {tab === "punch"      && <PunchTab employee={employee} />}
        {tab === "attendance" && <AttendanceTab employee={employee} />}
        {tab === "calendar"   && <CalendarTab employee={employee} />}
        {tab === "roster"     && <RosterTab employee={employee} />}
        {tab === "documents"  && <DocumentsTab employee={employee} />}
        {tab === "admin"      && <AdminTab employee={employee} />}
      </main>

      <PushPermission employeeId={employee.id} />
    </div>
  );
}
