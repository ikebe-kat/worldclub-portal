"use client";
// ═══════════════════════════════════════════
// ShiftSub.tsx — シフト管理（公休マトリクス）
// 管理者（WC001）と本部メンバーのみアクセス
// ═══════════════════════════════════════════
import { useState, useEffect, useCallback, useRef } from "react";
import { T, DOW, stepMonth } from "@/lib/constants";
import Dialog from "@/components/ui/Dialog";
import { supabase } from "@/lib/supabase";

const COMPANY_ID = "c2d368f0-aa9b-4f70-b082-43ec07723d6c";
const STORE_ID   = "06027f43-fa49-4b2e-8009-903456b0ce33";

const PUSH_URL = "https://pktqlbpdjemmomfanvgt.supabase.co/functions/v1/send-push";

/* ⑤ 表示対象：employee_code が "WC" で始まる従業員（本部メンバー W02/W49/W67 等は除外） */
const isVisibleCode = (code: string) => /^WC\d+$/.test(code || "");

/* ── 色定義 ── */
const C = {
  koukyuu:       "#1a4b24",   // 緑 = 公休（確定）
  pending:       "#EAB308",   // 黄 = 公休（申請中）
  yukyu:         "#1d4ed8",   // 濃青 = 有給（確定）
  yukyuPending:  "#93c5fd",   // 薄青 = 有給（申請中）
  returned:      "#EF4444",   // 赤 = 差し戻し
  workday:       "#fff",      // 白 = 出勤
  saturday:      "#EBF5FB",   // 土曜列背景
  sunday:        "#FDEDEC",   // 日曜列背景
} as const;

interface Emp {
  id: string;
  employee_code: string;
  full_name: string;
  employment_type: string;
}

interface LeaveReq {
  id: string;
  employee_id: string;
  attendance_date: string;
  type: string;
  status: string;
  reject_reason?: string | null;
}

type CellState =
  | "approved" | "pending" | "returned"
  | "yukyu" | "yukyu_pending" | "yukyu_returned"
  | "workday";

interface AttRow {
  employee_id: string;
  attendance_date: string;
  reason: string | null;
}

/* 苗字を取得 */
const surname = (name: string) => (name || "").split(/\s+/)[0] || name;

/* 日付を「M月D日」形式に変換 */
const formatJpDate = (iso: string): string => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`;
};

/* 月の日数 */
const daysInMonth = (yr: number, mo: number) => new Date(yr, mo, 0).getDate();

/* 日付文字列生成 */
const dateStr = (yr: number, mo: number, d: number) =>
  `${yr}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/* 曜日取得 (0=日〜6=土) */
const dowOf = (yr: number, mo: number, d: number) => new Date(yr, mo - 1, d).getDay();

export default function ShiftSub({ employee }: { employee: any }) {
  const now = new Date();
  const [yr, setYr] = useState(now.getFullYear());
  const [mo, setMo] = useState(now.getMonth() + 1);
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [leaveReqs, setLeaveReqs] = useState<LeaveReq[]>([]);
  const [attData, setAttData] = useState<AttRow[]>([]);
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set());
  const [resubmittedIds, setResubmittedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"shift" | "yukyu">("shift");
  const [yukyuReqs, setYukyuReqs] = useState<any[]>([]);
  const [yukyuReturnInput, setYukyuReturnInput] = useState<{ id: string; reason: string } | null>(null);
  const [shiftConfirmedAt, setShiftConfirmedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [dialog, setDialog] = useState<{ message: string; mode: "alert" | "confirm"; confirmLabel?: string; confirmColor?: string; onOk: () => void } | null>(null);

  const days = daysInMonth(yr, mo);

  /* ── データ取得 ── */
  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    const monthStart = dateStr(yr, mo, 1);
    const monthEnd = dateStr(yr, mo, days);

    // 従業員一覧（is_active=true または NULL）
    const { data: emps } = await supabase.from("employees")
      .select("id, employee_code, full_name, employment_type")
      .eq("company_id", COMPANY_ID)
      .or("is_active.is.null,is_active.eq.true")
      .order("employee_code");

    // leave_requests（当月：公休＋有給）
    const { data: reqs } = await supabase.from("leave_requests")
      .select("id, employee_id, attendance_date, type, status, reject_reason")
      .eq("company_id", COMPANY_ID)
      .in("type", ["shift_koukyuu", "yukyu"])
      .gte("attendance_date", monthStart)
      .lte("attendance_date", monthEnd);

    // ④ attendance_daily（当月：有給・公休確認用）
    const { data: att } = await supabase.from("attendance_daily")
      .select("employee_id, attendance_date, reason")
      .eq("company_id", COMPANY_ID)
      .gte("attendance_date", monthStart)
      .lte("attendance_date", monthEnd)
      .not("reason", "is", null);

    // ⑤ WCxxx のみフィルタ（本部メンバー除外）
    const filteredEmps = (emps || []).filter(e => isVisibleCode(e.employee_code));

    // shift_submissions（当月分の提出有無）
    const targetMonth = `${yr}-${String(mo).padStart(2, "0")}`;
    const { data: subs } = await supabase.from("shift_submissions")
      .select("employee_id, created_at, submitted_at")
      .eq("company_id", COMPANY_ID)
      .eq("target_month", targetMonth);
    const submitted = new Set<string>((subs || []).map((s: any) => s.employee_id));
    const resubmitted = new Set<string>(
      (subs || [])
        .filter((s: any) => s.created_at && s.submitted_at && new Date(s.submitted_at).getTime() > new Date(s.created_at).getTime() + 1000)
        .map((s: any) => s.employee_id)
    );

    // shift_confirmations（当月確定状態）
    const { data: confRow } = await supabase.from("shift_confirmations")
      .select("confirmed_at, revision")
      .eq("company_id", COMPANY_ID)
      .eq("target_month", targetMonth)
      .maybeSingle();
    let confirmedAt: string | null = confRow?.confirmed_at ?? null;

    setEmployees(filteredEmps);
    setLeaveReqs(reqs || []);
    setAttData(att || []);
    setSubmittedIds(submitted);
    setResubmittedIds(resubmitted);
    setShiftConfirmedAt(confirmedAt);

    // 有給申請（pending）：今日の月＋確定済みの翌月以降
    const _today = new Date();
    const todayYr = _today.getFullYear();
    const todayMo = _today.getMonth() + 1;
    const todayMonthStr = `${todayYr}-${String(todayMo).padStart(2, "0")}`;
    const todayMonthStart = dateStr(todayYr, todayMo, 1);

    // 確定済みの月一覧（今日の月より未来）
    const { data: futureConfs } = await supabase.from("shift_confirmations")
      .select("target_month")
      .eq("company_id", COMPANY_ID)
      .not("confirmed_at", "is", null)
      .gt("target_month", todayMonthStr);
    const targetMonthSet = new Set<string>([
      todayMonthStr,
      ...((futureConfs || []).map((c: any) => c.target_month) as string[]),
    ]);

    // 候補月の中で最も未来の月末まで取得
    let maxYr = todayYr, maxMo = todayMo;
    for (const ms of targetMonthSet) {
      const [y, m] = ms.split("-").map(Number);
      if (y > maxYr || (y === maxYr && m > maxMo)) { maxYr = y; maxMo = m; }
    }
    const maxMonthEnd = dateStr(maxYr, maxMo, daysInMonth(maxYr, maxMo));

    const { data: yReqsRaw } = await supabase.from("leave_requests")
      .select("id, employee_id, attendance_date, type, status, reject_reason, request_comment, created_at")
      .eq("company_id", COMPANY_ID)
      .in("type", ["yukyu", "shift_koukyuu"])
      .gte("attendance_date", todayMonthStart)
      .lte("attendance_date", maxMonthEnd)
      .in("status", ["pending"])
      .order("attendance_date");

    const yReqs = (yReqsRaw || []).filter((r: any) => {
      const ms = r.attendance_date.slice(0, 7);
      return targetMonthSet.has(ms);
    });
    setYukyuReqs(yReqs);

    setLoading(false);
  }, [yr, mo, days, employee?.id]);

  useEffect(() => { loadData(true); }, [loadData]);

  /* ── shift_submissions のリアルタイム購読（提出/再提出を即時反映） ── */
  useEffect(() => {
    const targetMonth = `${yr}-${String(mo).padStart(2, "0")}`;
    const channel = supabase
      .channel(`shift_submissions_${targetMonth}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shift_submissions",
          filter: `company_id=eq.${COMPANY_ID}`,
        },
        () => { loadData(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [yr, mo, loadData]);

  /* ── 月切替 ── */
  const stepMo = (dir: 1 | -1) => {
    const [ny, nm] = stepMonth(yr, mo, dir);
    setYr(ny); setMo(nm);
  };

  /* ── 提出チェックを免除する従業員ID集合（WC001=小川は直接編集可） ── */
  const exemptIds = new Set(employees.filter(e => e.employee_code === "WC001").map(e => e.id));

  /* ── セル状態判定（共通） ── */
  const computeCellState = (empId: string, day: number): CellState => {
    const ds = dateStr(yr, mo, day);
    const yukyuReq = leaveReqs.find(r => r.employee_id === empId && r.attendance_date === ds && r.type === "yukyu");
    if (yukyuReq) {
      if (yukyuReq.status === "approved") return "yukyu";
      if (yukyuReq.status === "pending")  return "yukyu_pending";
      if (yukyuReq.status === "returned") return "yukyu_returned";
    }
    const koukyuReq = leaveReqs.find(r => r.employee_id === empId && r.attendance_date === ds && r.type === "shift_koukyuu");
    if (koukyuReq) {
      if (koukyuReq.status === "approved") return "approved";
      if (koukyuReq.status === "pending")  return "pending";
      if (koukyuReq.status === "returned") return "returned";
    }
    const att = attData.find(a => a.employee_id === empId && a.attendance_date === ds);
    if (att?.reason?.includes("有給")) return "yukyu";
    if (att?.reason === "公休" || att?.reason === "公休（全日）") return "approved";
    return "workday";
  };

  /* ── 確定処理用：提出チェックなし ── */
  const getCellStateRaw = (empId: string, day: number): CellState => computeCellState(empId, day);

  /* ── 表示用：未提出者は空白 ── */
  const getCellState = (empId: string, day: number): CellState => {
    if (!submittedIds.has(empId) && !exemptIds.has(empId)) return "workday";
    return computeCellState(empId, day);
  };

  /* ── セルの背景色 ── */
  const cellBg = (state: string) => {
    switch (state) {
      case "approved":       return C.koukyuu;
      case "pending":        return C.pending;
      case "returned":       return C.returned;
      case "yukyu":          return C.yukyu;
      case "yukyu_pending":  return C.yukyuPending;
      case "yukyu_returned": return C.returned;
      default:               return C.workday;
    }
  };

  /* ── セルの文字色 ── */
  const cellFg = (state: string) => {
    if (state === "workday") return T.textMuted;
    return "#fff";
  };

  /* ── セルラベル ── */
  const cellLabel = (state: string) => {
    switch (state) {
      case "approved":       return "公休";
      case "pending":        return "申請";
      case "returned":       return "差戻";
      case "yukyu":          return "有給";
      case "yukyu_pending":  return "有申";
      case "yukyu_returned": return "差戻";
      default:               return "";
    }
  };

  /* ── 未承認件数 ── */
  const pendingCount = leaveReqs.filter(r => r.status === "pending").length;

  /* ── ⑦ セルタップ処理（空きセル→直接公休insert） ── */
  const tappingRef = useRef<Set<string>>(new Set());
  const handleCellTap = async (emp: Emp, day: number) => {
    // 未提出者は操作不可（ただしWC001は例外）
    if (!submittedIds.has(emp.id) && !exemptIds.has(emp.id)) return;

    const tapKey = `${emp.id}_${day}`;
    if (tappingRef.current.has(tapKey)) return;
    tappingRef.current.add(tapKey);
    try {
      await handleCellTapInner(emp, day);
    } finally {
      tappingRef.current.delete(tapKey);
    }
  };

  const handleCellTapInner = async (emp: Emp, day: number) => {

    const ds = dateStr(yr, mo, day);
    const state = getCellState(emp.id, day);

    // 有給確定済みは変更不可
    if (state === "yukyu") return;

    // 申請中（公休 or 有給）→ 承認/差し戻しダイアログ
    if (state === "pending" || state === "yukyu_pending") {
      handlePendingTap(emp, day, state === "yukyu_pending" ? "yukyu" : "shift_koukyuu");
      return;
    }

    // 差し戻し（赤）タップ → leave_requests を削除して空白に戻す
    if (state === "returned" || state === "yukyu_returned") {
      const reqType = state === "yukyu_returned" ? "yukyu" : "shift_koukyuu";
      const req = leaveReqs.find(r => r.employee_id === emp.id && r.attendance_date === ds && r.type === reqType && r.status === "returned");
      if (req) {
        setLeaveReqs(prev => prev.filter(r => r.id !== req.id));
        supabase.from("leave_requests").delete().eq("id", req.id).then(({ error }) => {
          if (error) { console.error(error); loadData(); }
        });
      }
      return;
    }

    if (state === "approved") {
      // 確定公休→管理者がOFFにする（leave_requestsから削除）
      const req = leaveReqs.find(r => r.employee_id === emp.id && r.attendance_date === ds && r.type === "shift_koukyuu");
      if (req) {
        setLeaveReqs(prev => prev.filter(r => r.id !== req.id));
        supabase.from("leave_requests").delete().eq("id", req.id).then(({ error }) => {
          if (error) { console.error(error); loadData(); }
        });
      }
      return;
    }

    // workday→公休ON（管理者直接設定 → approved で insert、即緑）
    // 楽観的更新：即座にローカル state にも反映
    const tempId = `temp-${Date.now()}`;
    setLeaveReqs(prev => [
      ...prev.filter(r => !(r.employee_id === emp.id && r.attendance_date === ds && r.type === "shift_koukyuu")),
      { id: tempId, employee_id: emp.id, attendance_date: ds, type: "shift_koukyuu", status: "approved", reject_reason: null },
    ]);

    // 既存の approved レコードのみ削除（pending/returned は保持）
    await supabase.from("leave_requests")
      .delete()
      .eq("employee_id", emp.id)
      .eq("attendance_date", ds)
      .eq("type", "shift_koukyuu")
      .eq("status", "approved");

    const { data, error } = await supabase.from("leave_requests").insert({
      company_id: COMPANY_ID,
      store_id: STORE_ID,
      employee_id: emp.id,
      attendance_date: ds,
      type: "shift_koukyuu",
      status: "approved",
      reason: "公休（全日）",
      approved_by: employee.id,
      approver_id: employee.id,
      approved_at: new Date().toISOString(),
    }).select().single();

    if (error) {
      console.error("[ShiftSub] leave_requests insert error:", error);
      setLeaveReqs(prev => prev.filter(r => r.id !== tempId));
      setDialog({
        message: `公休登録に失敗しました\n${error.message}`,
        mode: "alert",
        onOk: () => setDialog(null),
      });
      return;
    }
    // tempId を本物のレコードに差し替え
    setLeaveReqs(prev => prev.map(r => r.id === tempId ? (data as any) : r));
  };

  /* ── 申請の承認/差し戻しダイアログ ── */
  const [pendingDialog, setPendingDialog] = useState<{ emp: Emp; day: number; reqId: string; reqType: string } | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState("");

  const handlePendingTap = (emp: Emp, day: number, reqType: string) => {
    const ds = dateStr(yr, mo, day);
    const req = leaveReqs.find(r => r.employee_id === emp.id && r.attendance_date === ds && r.status === "pending" && r.type === reqType);
    if (req) {
      setRejectReasonInput("");
      setPendingDialog({ emp, day, reqId: req.id, reqType });
    }
  };

  const approvePending = async () => {
    if (!pendingDialog) return;
    const reqId = pendingDialog.reqId;
    setLeaveReqs(prev => prev.map(r => r.id === reqId ? { ...r, status: "approved", reject_reason: null } : r));
    setPendingDialog(null);
    supabase.from("leave_requests").update({
      status: "approved",
      reject_reason: null,
      approved_by: employee.id,
      approver_id: employee.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", reqId).then(({ error }) => {
      if (error) { console.error(error); loadData(); }
    });
  };

  const returnPending = async () => {
    if (!pendingDialog) return;
    if (!rejectReasonInput.trim()) {
      setDialog({ message: "差し戻し理由を入力してください", mode: "alert", onOk: () => setDialog(null) });
      return;
    }
    const reqId = pendingDialog.reqId;
    const reasonText = rejectReasonInput.trim();
    const prevLeaveReqs = leaveReqs;
    setLeaveReqs(prev => prev.map(r => r.id === reqId ? { ...r, status: "returned", reject_reason: reasonText } : r));

    const { error: updErr } = await supabase.from("leave_requests").update({
      status: "returned",
      reject_reason: reasonText,
      updated_at: new Date().toISOString(),
    }).eq("id", reqId);

    if (updErr) {
      console.error("[ShiftSub] returnPending update error:", updErr);
      setLeaveReqs(prevLeaveReqs); // ロールバック
      setDialog({
        message: `差し戻しに失敗しました\n${updErr.message}`,
        mode: "alert",
        onOk: () => { setDialog(null); loadData(); },
      });
      setPendingDialog(null);
      return;
    }

    // シフト差し戻し通知
    const ds = dateStr(yr, mo, pendingDialog.day);
    fetch(PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "shift_returned",
        payload: {
          company_id: COMPANY_ID,
          employee_id: pendingDialog.emp.id,
          attendance_date: ds,
          leave_type: pendingDialog.reqType,
          reject_reason: reasonText,
        },
      }),
    }).catch(() => {});

    setPendingDialog(null);
  };

  /* ── トースト表示 ── */
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ── 下書き保存（セルタップ時に既にDB保存済み） ── */
  const handleDraftSave = () => {
    setDialog({
      message: "編集内容はすでに保存されています。",
      mode: "alert",
      onOk: () => setDialog(null),
    });
  };

  /* ── 修正ボタン処理（確定解除） ── */
  const handleUnconfirm = async () => {
    setDialog({
      message: `${yr}年${mo}月のシフト確定を解除しますか？\n確定済みの公休・有給を申請に戻します。`,
      mode: "confirm",
      confirmLabel: "修正する",
      confirmColor: C.returned,
      onOk: async () => {
        setDialog(null);
        setConfirming(true);

        const monthStart = dateStr(yr, mo, 1);
        const monthEnd = dateStr(yr, mo, days);

        // attendance_daily から当月の公休/有給を取得
        const { data: rows } = await supabase.from("attendance_daily")
          .select("id, employee_id, attendance_date, reason")
          .eq("company_id", COMPANY_ID)
          .gte("attendance_date", monthStart)
          .lte("attendance_date", monthEnd)
          .or("reason.eq.公休（全日）,reason.like.%有給%");

        for (const row of rows || []) {
          const reasonStr = row.reason as string;
          const reqType = reasonStr.includes("有給") ? "yukyu" : "shift_koukyuu";
          // 既存の leave_requests レコードを削除して再 insert
          await supabase.from("leave_requests")
            .delete()
            .eq("employee_id", row.employee_id)
            .eq("attendance_date", row.attendance_date)
            .eq("type", reqType);
          await supabase.from("leave_requests").insert({
            company_id: COMPANY_ID,
            store_id: STORE_ID,
            employee_id: row.employee_id,
            attendance_date: row.attendance_date,
            type: reqType,
            status: "approved",
            reason: reasonStr,
            approved_by: employee.id,
            approver_id: employee.id,
            approved_at: new Date().toISOString(),
          });
          // attendance_daily の reason をクリア
          await supabase.from("attendance_daily")
            .update({ reason: null, updated_at: new Date().toISOString() })
            .eq("id", row.id);
        }

        // shift_confirmations を削除（confirmed_at が NOT NULL 制約のケースに対応）
        const targetMonth = `${yr}-${String(mo).padStart(2, "0")}`;
        const { error: delErr } = await supabase.from("shift_confirmations")
          .delete()
          .eq("company_id", COMPANY_ID)
          .eq("target_month", targetMonth);
        if (delErr) console.error("[ShiftSub] unconfirm delete error:", delErr);

        setShiftConfirmedAt(null);
        setConfirming(false);
        await loadData();
      },
    });
  };

  /* ── 確定ボタン処理 ── */
  const handleConfirm = async () => {
    // 提出済み従業員に未承認(pending)が残っていたら確定不可
    const hasPending = leaveReqs.some(r =>
      r.status === "pending" &&
      (submittedIds.has(r.employee_id) || exemptIds.has(r.employee_id))
    );
    if (hasPending) {
      setDialog({
        message: "未承認の申請があります。\n全て承認または差し戻しをしてから確定してください。",
        mode: "alert",
        onOk: () => setDialog(null),
      });
      return;
    }
    setDialog({
      message: `${yr}年${mo}月のシフトを確定しますか？\n確定済み公休をattendance_dailyに一括登録します。`,
      mode: "confirm",
      confirmLabel: "確定",
      confirmColor: C.koukyuu,
      onOk: async () => {
        setDialog(null);
        setConfirming(true);

        // 提出フィルタを無視して全従業員の approved/yukyu を attendance_daily に転記
        const upserts: any[] = [];
        for (const emp of employees) {
          for (let d = 1; d <= days; d++) {
            const state = getCellStateRaw(emp.id, d);
            if (state !== "approved" && state !== "yukyu") continue;
            const ds = dateStr(yr, mo, d);
            const dow = DOW[dowOf(yr, mo, d)];
            upserts.push({
              company_id: COMPANY_ID,
              employee_id: emp.id,
              attendance_date: ds,
              day_of_week: dow,
              reason: state === "yukyu" ? "有給（全日）" : "公休（全日）",
              updated_at: new Date().toISOString(),
            });
          }
        }

        if (upserts.length > 0) {
          for (let i = 0; i < upserts.length; i += 50) {
            const batch = upserts.slice(i, i + 50);
            await supabase.from("attendance_daily")
              .upsert(batch, { onConflict: "employee_id,attendance_date" });
          }
        }

        // 確定済みの leave_requests（approved）は不要なので当月分を削除
        const _monthStart = dateStr(yr, mo, 1);
        const _monthEnd = dateStr(yr, mo, days);
        await supabase.from("leave_requests")
          .delete()
          .eq("company_id", COMPANY_ID)
          .in("type", ["shift_koukyuu", "yukyu"])
          .eq("status", "approved")
          .gte("attendance_date", _monthStart)
          .lte("attendance_date", _monthEnd);

        // shift_confirmations: 既存があれば revision+1 で UPDATE、なければ revision=0 で INSERT
        const targetMonth = `${yr}-${String(mo).padStart(2, "0")}`;
        const { data: existConf } = await supabase.from("shift_confirmations")
          .select("id, revision")
          .eq("company_id", COMPANY_ID)
          .eq("target_month", targetMonth)
          .maybeSingle();

        let confErr: any = null;
        if (existConf) {
          const { error } = await supabase.from("shift_confirmations")
            .update({
              confirmed_by: employee.id,
              confirmed_at: new Date().toISOString(),
              revision: (existConf.revision ?? 0) + 1,
            })
            .eq("id", existConf.id);
          confErr = error;
        } else {
          const { error } = await supabase.from("shift_confirmations").insert({
            company_id: COMPANY_ID,
            confirmed_by: employee.id,
            target_month: targetMonth,
            confirmed_at: new Date().toISOString(),
            revision: 0,
          });
          confErr = error;
        }

        setConfirming(false);
        if (confErr) {
          setDialog({ message: `確定記録の保存に失敗\n${confErr.message}`, mode: "alert", onOk: () => { setDialog(null); loadData(); } });
        } else {
          // シフト確定通知（全従業員）
          fetch(PUSH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "shift_confirmed",
              payload: {
                company_id: COMPANY_ID,
                target_month: targetMonth,
              },
            }),
          }).catch(() => {});
          setDialog({ message: `${upserts.length}件の公休を登録し、シフトを確定しました。`, mode: "alert", onOk: () => { setDialog(null); loadData(); } });
        }
      },
    });
  };

  /* ── 従業員を正社員→パートの順に並べる ── */
  const sortedEmps = [...employees].sort((a, b) => {
    const aCode = parseInt(a.employee_code.replace("WC", ""), 10);
    const bCode = parseInt(b.employee_code.replace("WC", ""), 10);
    return aCode - bCode;
  });

  // 正社員/パート区切り用
  const seishaCount = sortedEmps.filter(e => e.employment_type === "正社員").length;

  /* ── レンダリング ── */
  const tableRef = useRef<HTMLDivElement>(null);

  /* ── 有給申請：承認/差し戻し ── */
  const empNameById = (id: string) => {
    const e = employees.find(x => x.id === id);
    return e ? surname(e.full_name) : "—";
  };

  const approveYukyu = async (req: any) => {
    const dow = DOW[new Date(req.attendance_date + "T00:00:00").getDay()];
    const reasonLabel = req.type === "yukyu" ? "有給（全日）" : "公休（全日）";
    const { error: upErr } = await supabase.from("attendance_daily").upsert({
      company_id: COMPANY_ID,
      employee_id: req.employee_id,
      attendance_date: req.attendance_date,
      day_of_week: dow,
      reason: reasonLabel,
      updated_at: new Date().toISOString(),
    }, { onConflict: "employee_id,attendance_date" });
    if (upErr) {
      setDialog({ message: `承認に失敗\n${upErr.message}`, mode: "alert", onOk: () => setDialog(null) });
      return;
    }
    await supabase.from("leave_requests").update({
      status: "approved",
      approved_by: employee.id,
      approver_id: employee.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", req.id);
    const isYukyu = req.type === "yukyu";
    const kindLabel = isYukyu ? "有給" : "公休";
    fetch(PUSH_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "request_processed",
        payload: {
          employee_id: req.employee_id,
          title: `${kindLabel}申請 承認`,
          body: `${formatJpDate(req.attendance_date)}の${kindLabel}申請が承認されました`,
        },
      }),
    }).catch(() => {});
    loadData();
  };

  const rejectYukyu = async () => {
    if (!yukyuReturnInput) return;
    if (!yukyuReturnInput.reason.trim()) {
      setDialog({ message: "差し戻し理由を入力してください", mode: "alert", onOk: () => setDialog(null) });
      return;
    }
    const req = yukyuReqs.find(r => r.id === yukyuReturnInput.id);
    const { error } = await supabase.from("leave_requests").update({
      status: "returned",
      reject_reason: yukyuReturnInput.reason.trim(),
      updated_at: new Date().toISOString(),
    }).eq("id", yukyuReturnInput.id);
    if (error) {
      setDialog({ message: `差し戻しに失敗\n${error.message}`, mode: "alert", onOk: () => setDialog(null) });
      return;
    }
    if (req) {
      fetch(PUSH_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "shift_returned",
          payload: {
            company_id: COMPANY_ID,
            employee_id: req.employee_id,
            attendance_date: req.attendance_date,
            leave_type: req.type,
            reject_reason: yukyuReturnInput.reason.trim(),
          },
        }),
      }).catch(() => {});
    }
    setYukyuReturnInput(null);
    loadData();
  };

  const isOgawa = employee?.employee_code === "WC001";
  const YUKYU_VIEWERS = ["WC001", "W02", "W49", "W67"];
  const canViewYukyu = YUKYU_VIEWERS.includes(employee?.employee_code || "");

  return (
    <div>
      {/* ── サブタブ ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: `1px solid ${T.border}` }}>
        {[
          { key: "shift", label: "シフト管理" },
          ...(canViewYukyu ? [{ key: "yukyu", label: `有給申請${yukyuReqs.length > 0 ? `(${yukyuReqs.length})` : ""}` }] : []),
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as any)}
            style={{
              padding: "8px 16px", border: "none", cursor: "pointer",
              backgroundColor: "transparent",
              borderBottom: activeTab === t.key ? `2px solid ${C.koukyuu}` : "2px solid transparent",
              color: activeTab === t.key ? C.koukyuu : T.textSec,
              fontSize: 13, fontWeight: 700,
            }}
          >{t.label}</button>
        ))}
      </div>

      {activeTab === "yukyu" && canViewYukyu ? (
        <div>
          <div style={{ fontSize: 12, color: T.textSec, marginBottom: 10 }}>
            シフト確定後の急遽申請
          </div>
          {yukyuReqs.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: T.textMuted }}>申請はありません</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {yukyuReqs.map(req => (
                <div key={req.id} style={{
                  padding: 12, border: `1px solid ${T.border}`, borderRadius: 6,
                  backgroundColor: "#fff", display: "flex", alignItems: "center", gap: 12,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
                      {empNameById(req.employee_id)}　{req.attendance_date}
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                        color: "#fff",
                        backgroundColor: req.type === "yukyu" ? C.yukyu : C.koukyuu,
                      }}>
                        {req.type === "yukyu" ? "有給" : "公休"}
                      </span>
                    </div>
                    {req.request_comment && (
                      <div style={{ fontSize: 11, color: T.textSec, marginTop: 4 }}>{req.request_comment}</div>
                    )}
                  </div>
                  {isOgawa && (
                    <>
                      <button
                        onClick={() => setYukyuReturnInput({ id: req.id, reason: "" })}
                        style={{
                          padding: "6px 12px", borderRadius: 4,
                          border: `1px solid ${C.returned}`, backgroundColor: "#fff",
                          color: C.returned, fontSize: 12, fontWeight: 700, cursor: "pointer",
                        }}
                      >差し戻し</button>
                      <button
                        onClick={() => approveYukyu(req)}
                        style={{
                          padding: "6px 12px", borderRadius: 4, border: "none",
                          backgroundColor: C.yukyu, color: "#fff",
                          fontSize: 12, fontWeight: 700, cursor: "pointer",
                        }}
                      >承認</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {yukyuReturnInput && (
            <div
              style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}
              onClick={() => setYukyuReturnInput(null)}
            >
              <div
                style={{ backgroundColor: "#fff", borderRadius: 8, padding: "24px 20px", width: "100%", maxWidth: 320 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ fontSize: 14, color: T.text, textAlign: "center", marginBottom: 14 }}>
                  差し戻し理由を入力
                </div>
                <textarea
                  value={yukyuReturnInput.reason}
                  onChange={(e) => setYukyuReturnInput({ ...yukyuReturnInput, reason: e.target.value })}
                  placeholder="差し戻し理由"
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: 4,
                    border: `1px solid ${T.border}`, fontSize: 13,
                    resize: "vertical", minHeight: 56, marginBottom: 14,
                    boxSizing: "border-box", fontFamily: "inherit",
                  }}
                />
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setYukyuReturnInput(null)} style={{
                    flex: 1, padding: 12, borderRadius: 4,
                    border: `1px solid ${T.border}`, backgroundColor: "#fff",
                    color: T.textSec, fontSize: 14, fontWeight: 600, cursor: "pointer",
                  }}>キャンセル</button>
                  <button onClick={rejectYukyu} style={{
                    flex: 1, padding: 12, borderRadius: 4, border: "none",
                    backgroundColor: C.returned, color: "#fff",
                    fontSize: 14, fontWeight: 600, cursor: "pointer",
                  }}>差し戻し</button>
                </div>
              </div>
            </div>
          )}

          {dialog && (
            <Dialog
              message={dialog.message}
              mode={dialog.mode}
              confirmLabel={dialog.confirmLabel}
              confirmColor={dialog.confirmColor}
              onOk={dialog.onOk}
              onCancel={() => setDialog(null)}
            />
          )}
        </div>
      ) : (
      <>
      {/* ── ヘッダー：月選択 + 未承認バッジ + 確定ボタン ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 12, flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => stepMo(-1)} style={navBtn}>&lt;</button>
          <span style={{ fontSize: 16, fontWeight: 700, color: T.text, minWidth: 120, textAlign: "center" }}>
            {yr}年{mo}月
          </span>
          <button onClick={() => stepMo(1)} style={navBtn}>&gt;</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {pendingCount > 0 && (
            <span style={{
              backgroundColor: C.pending, color: "#fff", borderRadius: 12,
              padding: "3px 10px", fontSize: 12, fontWeight: 700,
            }}>
              未承認 {pendingCount}件
            </span>
          )}
          <button
            onClick={handleDraftSave}
            disabled={confirming}
            style={{
              padding: "8px 16px", borderRadius: 4,
              border: `1px solid ${C.koukyuu}`, backgroundColor: "#fff",
              color: C.koukyuu, fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >
            下書き保存
          </button>
          {shiftConfirmedAt ? (
            <button
              onClick={handleUnconfirm}
              disabled={confirming}
              style={{
                padding: "8px 20px", borderRadius: 4, border: "none",
                backgroundColor: C.returned, color: "#fff",
                fontSize: 13, fontWeight: 700, cursor: confirming ? "not-allowed" : "pointer",
                opacity: confirming ? 0.6 : 1,
              }}
            >
              {confirming ? "処理中..." : "修正する"}
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={confirming}
              style={{
                padding: "8px 20px", borderRadius: 4, border: "none",
                backgroundColor: C.koukyuu, color: "#fff",
                fontSize: 13, fontWeight: 700, cursor: confirming ? "not-allowed" : "pointer",
                opacity: confirming ? 0.6 : 1,
              }}
            >
              {confirming ? "処理中..." : "確定"}
            </button>
          )}
        </div>
      </div>

      {/* ── 凡例 ── */}
      <div style={{
        display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap",
        padding: "8px 12px", backgroundColor: "#fff", borderRadius: 0,
        border: `1px solid ${T.border}`,
      }}>
        {[
          { color: C.koukyuu, label: "公休（確定）" },
          { color: C.pending, label: "公休（申請中）" },
          { color: C.yukyu, label: "有給（確定）" },
          { color: C.yukyuPending, label: "有給（申請中）" },
          { color: C.returned, label: "差し戻し" },
          { color: "#E5E7EB", label: "出勤", textColor: T.textMuted },
        ].map((item) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{
              width: 16, height: 16, borderRadius: 0,
              backgroundColor: item.color,
              border: item.color === "#E5E7EB" ? `1px solid ${T.border}` : "none",
            }} />
            <span style={{ fontSize: 11, color: T.textSec }}>{item.label}</span>
          </div>
        ))}
      </div>

      {/* ── シフト表 ── */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textSec }}>読み込み中...</div>
      ) : (
        <div ref={tableRef} style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{
            borderCollapse: "collapse", fontSize: 11, minWidth: "100%",
            backgroundColor: "#fff",
          }}>
            <thead>
              <tr>
                <th style={{
                  ...thStyle, position: "sticky", left: 0, zIndex: 10,
                  backgroundColor: C.koukyuu, color: "#fff", minWidth: 60,
                }}>
                  名前
                </th>
                {Array.from({ length: days }, (_, i) => {
                  const d = i + 1;
                  const dow = dowOf(yr, mo, d);
                  const isSun = dow === 0;
                  const isSat = dow === 6;
                  return (
                    <th key={d} style={{
                      ...thStyle,
                      backgroundColor: isSun ? C.sunday : isSat ? C.saturday : C.koukyuu,
                      color: isSun ? "#DC2626" : isSat ? "#2563EB" : "#fff",
                      minWidth: 50,
                    }}>
                      <div style={{ lineHeight: 1 }}>{d}</div>
                      <div style={{ fontSize: 10, fontWeight: 400, lineHeight: 1 }}>{DOW[dow]}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedEmps.map((emp, idx) => {
                const isPartBorder = idx === seishaCount && seishaCount > 0;
                return (
                  <tr key={emp.id} style={{
                    borderTop: isPartBorder ? `3px solid ${C.koukyuu}` : undefined,
                  }}>
                    <td style={{
                      ...tdNameStyle, position: "sticky", left: 0, zIndex: 5,
                      backgroundColor: "#fff",
                      borderTop: isPartBorder ? `3px solid ${C.koukyuu}` : `1px solid ${T.border}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 16, fontWeight: 600, color: T.text, lineHeight: 1 }}>
                          {surname(emp.full_name)}
                        </span>
                        <span style={{ display: "flex", flexDirection: "column", gap: 1, lineHeight: 1 }}>
                          <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1 }}>
                            {emp.employment_type === "正社員" ? "社" : "P"}
                          </span>
                          <span style={{
                            fontSize: 11, fontWeight: 600, lineHeight: 1,
                            color: resubmittedIds.has(emp.id) ? "#F97316" : submittedIds.has(emp.id) ? C.koukyuu : T.textMuted,
                          }}>
                            {resubmittedIds.has(emp.id) ? "再" : submittedIds.has(emp.id) ? "済" : "未"}
                          </span>
                        </span>
                      </div>
                    </td>
                    {Array.from({ length: days }, (_, i) => {
                      const d = i + 1;
                      const state = getCellState(emp.id, d);
                      const dow = dowOf(yr, mo, d);
                      const isSun = dow === 0;
                      const isSat = dow === 6;

                      let bg: string = cellBg(state);
                      if (state === "workday") {
                        bg = isSun ? C.sunday : isSat ? C.saturday : "#fff";
                      }

                      return (
                        <td
                          key={d}
                          onClick={() => handleCellTap(emp, d)}
                          style={{
                            ...tdCellStyle,
                            backgroundColor: bg,
                            color: cellFg(state),
                            cursor: state === "yukyu" ? "default" : "pointer",
                            borderTop: isPartBorder ? `3px solid ${C.koukyuu}` : `1px solid ${T.border}`,
                          }}
                        >
                          {cellLabel(state)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 使い方ガイド ── */}
      <div style={{
        marginTop: 16, padding: "12px 14px", backgroundColor: T.primaryLight,
        borderRadius: 0, border: `1px solid ${T.border}`,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.koukyuu, marginBottom: 6 }}>
          使い方
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: T.textSec, lineHeight: "20px" }}>
          <li>空きセルをタップ → 公休ON（緑）、もう一回タップでOFF</li>
          <li>黄色（申請中）セルをタップ → 承認 or 差し戻しを選択</li>
          <li>差し戻しすると本人にプッシュ通知が届きます</li>
          <li>「確定」ボタンで緑（確定公休）をattendance_dailyに一括登録</li>
          <li>青（有給）セルは変更できません</li>
        </ul>
      </div>

      {/* ── 申請承認/差し戻しダイアログ ── */}
      {pendingDialog && (
        <div
          style={{
            position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 2000,
          }}
          onClick={() => setPendingDialog(null)}
        >
          <div
            style={{
              backgroundColor: "#fff", borderRadius: 8,
              padding: "24px 20px", width: "100%", maxWidth: 320,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, color: T.text, textAlign: "center", marginBottom: 14, lineHeight: "22px" }}>
              {surname(pendingDialog.emp.full_name)}の{mo}/{pendingDialog.day}の{pendingDialog.reqType === "yukyu" ? "有給申請" : "公休申請"}
            </div>
            <textarea
              value={rejectReasonInput}
              onChange={(e) => setRejectReasonInput(e.target.value)}
              placeholder="差し戻し理由（差し戻す場合は必須）"
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 4,
                border: `1px solid ${T.border}`, fontSize: 13,
                resize: "vertical", minHeight: 56, marginBottom: 14,
                boxSizing: "border-box", fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={returnPending}
                style={{
                  flex: 1, padding: 12, borderRadius: 4,
                  border: `1px solid ${C.returned}`, backgroundColor: "#fff",
                  color: C.returned, fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >
                差し戻し
              </button>
              <button
                onClick={approvePending}
                style={{
                  flex: 1, padding: 12, borderRadius: 4, border: "none",
                  backgroundColor: C.koukyuu, color: "#fff",
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >
                承認
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── トースト ── */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
          backgroundColor: C.koukyuu, color: "#fff", padding: "10px 24px",
          borderRadius: 4, fontSize: 13, fontWeight: 600,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)", zIndex: 3000,
        }}>
          {toast}
        </div>
      )}

      {/* ── 汎用ダイアログ ── */}
      {dialog && (
        <Dialog
          message={dialog.message}
          mode={dialog.mode}
          confirmLabel={dialog.confirmLabel}
          confirmColor={dialog.confirmColor}
          onOk={dialog.onOk}
          onCancel={() => setDialog(null)}
        />
      )}
      </>
      )}
    </div>
  );
}

/* ── スタイル定数 ── */
const navBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: "50%", border: `1px solid ${T.border}`,
  backgroundColor: "#fff", cursor: "pointer", fontSize: 14,
  display: "flex", alignItems: "center", justifyContent: "center",
  color: T.text, fontWeight: 700,
};

const thStyle: React.CSSProperties = {
  padding: "2px 1px", textAlign: "center", fontSize: 13, fontWeight: 600,
  borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap", lineHeight: 1,
};

const tdNameStyle: React.CSSProperties = {
  padding: "3px 8px", borderRight: `1px solid ${T.border}`,
  borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap", lineHeight: 1,
};

const tdCellStyle: React.CSSProperties = {
  padding: "1px 1px", textAlign: "center", fontSize: 11, fontWeight: 700,
  borderRight: `1px solid ${T.borderLight}`, borderBottom: `1px solid ${T.border}`,
  minWidth: 50, userSelect: "none", lineHeight: 1,
};
