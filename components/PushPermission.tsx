"use client";
import { useState, useEffect } from "react";
import { T } from "@/lib/constants";
import { registerAndSubscribe, getNotificationPermission } from "@/lib/pushSubscription";

export default function PushPermission({ employeeId }: { employeeId: string }) {
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<"idle" | "requesting" | "done">("idle");

  useEffect(() => {
    const perm = getNotificationPermission();
    if (perm === "default") {
      // まだ許可も拒否もしてない → バナー表示
      setShow(true);
    } else if (perm === "granted") {
      // 既に許可済み → サイレントに購読登録（endpoint更新）
      registerAndSubscribe(employeeId);
    }
    // denied or unsupported → 何もしない
  }, [employeeId]);

  const handleAllow = async () => {
    setStatus("requesting");
    const ok = await registerAndSubscribe(employeeId);
    setStatus("done");
    setTimeout(() => setShow(false), 1000);
  };

  if (!show) return null;

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 900,
      padding: "16px 20px", backgroundColor: "#fff",
      borderTop: `1px solid ${T.border}`,
      boxShadow: "0 -2px 10px rgba(0,0,0,0.08)",
      animation: "slideUp 0.3s ease",
    }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 6 }}>
          🔔 通知を受け取りますか？
        </div>
        <div style={{ fontSize: 12, color: T.textSec, marginBottom: 12 }}>
          未打刻アラートやカレンダー予定の通知を受け取れます
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => setShow(false)}
            style={{
              flex: 1, padding: "10px", borderRadius: 6,
              border: `1px solid ${T.border}`, backgroundColor: "#fff",
              color: T.textSec, fontSize: 13, cursor: "pointer",
            }}
          >あとで</button>
          <button
            onClick={handleAllow}
            disabled={status !== "idle"}
            style={{
              flex: 1, padding: "10px", borderRadius: 6,
              border: "none", backgroundColor: T.primary,
              color: "#fff", fontSize: 13, fontWeight: 600,
              cursor: status === "idle" ? "pointer" : "default",
              opacity: status === "idle" ? 1 : 0.6,
            }}
          >{status === "requesting" ? "設定中..." : status === "done" ? "✓ 完了" : "許可する"}</button>
        </div>
      </div>
      <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
    </div>
  );
}
