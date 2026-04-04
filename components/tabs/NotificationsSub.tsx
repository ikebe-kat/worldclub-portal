"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { T } from "@/lib/constants";
import { supabase } from "@/lib/supabase";

interface Notification {
  id: string;
  category: string;
  title: string;
  detail: string | null;
  related_employee_id: string | null;
  is_read: boolean;
  created_at: string;
}

const CATEGORY_META: Record<string, { icon: string; color: string; label: string }> = {
  paid_leave_grant:   { icon: "🎉", color: "#059669", label: "有給付与" },
  paid_leave_expire:  { icon: "⏰", color: "#DC2626", label: "有給消滅" },
  paid_leave_denied:  { icon: "⚠️", color: "#D97706", label: "未付与" },
  yearly_5days_alert: { icon: "📊", color: "#7C3AED", label: "年5日チェック" },
  new_employee_setup: { icon: "👤", color: "#2563EB", label: "新規セットアップ" },
};

const FILTERS = [
  { label: "全件", value: "all" },
  { label: "有給付与", value: "paid_leave_grant" },
  { label: "有給消滅", value: "paid_leave_expire" },
  { label: "年5日", value: "yearly_5days_alert" },
  { label: "未読のみ", value: "unread" },
];

export default function NotificationsSub({ employee }: { employee: any }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const fetchNotifications = useCallback(async () => {
    if (!employee?.company_id) return;
    setLoading(true);
    const { data } = await supabase
      .from("admin_notifications")
      .select("*")
      .eq("company_id", employee.company_id)
      .order("created_at", { ascending: false })
      .limit(200);
    setItems(data || []);
    setLoading(false);
  }, [employee?.company_id]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  /* Realtime購読 */
  useEffect(() => {
    if (!employee?.company_id) return;
    const ch = supabase
      .channel("admin-notif")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_notifications" }, () => {
        fetchNotifications();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [employee?.company_id, fetchNotifications]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "unread") return items.filter(n => !n.is_read);
    return items.filter(n => n.category === filter);
  }, [items, filter]);

  const unreadCount = useMemo(() => items.filter(n => !n.is_read).length, [items]);

  const markRead = async (id: string) => {
    await supabase.from("admin_notifications").update({ is_read: true }).eq("id", id);
    setItems(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const markAllRead = async () => {
    const unreadIds = items.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from("admin_notifications").update({ is_read: true }).in("id", unreadIds);
    setItems(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const fmtDate = (d: string) => {
    const dt = new Date(d);
    const now = new Date();
    const diff = now.getTime() - dt.getTime();
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分前`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}時間前`;
    return `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,"0")}/${String(dt.getDate()).padStart(2,"0")} ${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}`;
  };

  return (
    <div>
      {/* ヘッダー */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: T.textSec }}>
          未読 <strong style={{ color: unreadCount > 0 ? T.danger : T.textMuted }}>{unreadCount}件</strong>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead} style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.textSec, fontSize: 12, cursor: "pointer" }}>
            すべて既読にする
          </button>
        )}
      </div>

      {/* フィルタ */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {FILTERS.map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)} style={{
            padding: "7px 12px", borderRadius: 20, fontSize: 12, fontWeight: filter === f.value ? 700 : 400,
            cursor: "pointer", border: filter === f.value ? `2px solid ${T.primary}` : `1px solid ${T.border}`,
            backgroundColor: filter === f.value ? T.primary + "15" : "#fff",
            color: filter === f.value ? T.primary : T.textSec,
          }}>{f.label}</button>
        ))}
      </div>

      {/* リスト */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: T.textMuted, fontSize: 14 }}>読み込み中...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: T.textMuted }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🔔</div>
          <div style={{ fontSize: 14 }}>お知らせはありません</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(n => {
            const meta = CATEGORY_META[n.category] || { icon: "📌", color: T.textSec, label: n.category };
            return (
              <div
                key={n.id}
                onClick={() => { if (!n.is_read) markRead(n.id); }}
                style={{
                  padding: "12px 14px", borderRadius: 8, cursor: n.is_read ? "default" : "pointer",
                  border: `1px solid ${n.is_read ? T.border : meta.color + "40"}`,
                  backgroundColor: n.is_read ? "#fff" : meta.color + "08",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 16 }}>{meta.icon}</span>
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, backgroundColor: meta.color + "15", color: meta.color }}>{meta.label}</span>
                    {!n.is_read && <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: T.danger, display: "inline-block" }} />}
                  </div>
                  <span style={{ fontSize: 11, color: T.textMuted }}>{fmtDate(n.created_at)}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: n.detail ? 4 : 0 }}>{n.title}</div>
                {n.detail && <div style={{ fontSize: 12, color: T.textSec, lineHeight: 1.5 }}>{n.detail}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
