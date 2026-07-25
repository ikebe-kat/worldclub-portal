"use client";
import { useState, useEffect } from "react";
import { T } from "@/lib/constants";
import { registerAndSubscribe, getNotificationPermission, isIosNonPwa } from "@/lib/pushSubscription";

export default function PushPermission({ employeeId }: { employeeId: string }) {
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<"idle" | "requesting" | "done" | "failed">("idle");
  const [iosMsg, setIosMsg] = useState(false);

  useEffect(() => {
    if (isIosNonPwa()) {
      setIosMsg(true);
      setShow(true);
      return;
    }
    const perm = getNotificationPermission();
    if (perm === "default") {
      setShow(true);
    } else if (perm === "granted") {
      registerAndSubscribe(employeeId);
    }
  }, [employeeId]);

  const handleAllow = async () => {
    setStatus("requesting");
    const ok = await registerAndSubscribe(employeeId);
    if (ok) {
      setStatus("done");
      setTimeout(() => setShow(false), 1000);
    } else {
      setStatus("failed");
    }
  };

  if (!show) return null;

  const bannerStyle: React.CSSProperties = {
    position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 900,
    padding: "16px 20px", backgroundColor: "#fff",
    borderTop: `1px solid ${T.border}`,
    boxShadow: "0 -2px 10px rgba(0,0,0,0.08)",
    animation: "slideUp 0.3s ease",
  };

  const closeBtnStyle: React.CSSProperties = {
    flex: 1, padding: "10px", borderRadius: 6,
    border: `1px solid ${T.border}`, backgroundColor: "#fff",
    color: T.textSec, fontSize: 13, cursor: "pointer",
  };

  if (iosMsg) {
    return (
      <div style={bannerStyle}>
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 6 }}>
            通知を受け取るには
          </div>
          <div style={{ fontSize: 12, color: T.textSec, marginBottom: 12 }}>
            ホーム画面に追加してからお使いください。Safari下部の共有ボタン →「ホーム画面に追加」
          </div>
          <button onClick={() => setShow(false)} style={{ ...closeBtnStyle, flex: undefined, width: "100%" }}>閉じる</button>
        </div>
        <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      </div>
    );
  }

  return (
    <div style={bannerStyle}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        {status === "failed" ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.danger, marginBottom: 6 }}>
              通知の登録に失敗しました
            </div>
            <div style={{ fontSize: 12, color: T.textSec, marginBottom: 12 }}>
              通信環境を確認して再度お試しください
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShow(false)} style={closeBtnStyle}>閉じる</button>
              <button onClick={() => { setStatus("idle"); handleAllow(); }} style={{
                flex: 1, padding: "10px", borderRadius: 6,
                border: "none", backgroundColor: T.primary,
                color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>再試行</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 6 }}>
              通知を受け取りますか？
            </div>
            <div style={{ fontSize: 12, color: T.textSec, marginBottom: 12 }}>
              未打刻アラートやカレンダー予定の通知を受け取れます
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShow(false)} style={closeBtnStyle}>あとで</button>
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
              >{status === "requesting" ? "設定中..." : status === "done" ? "完了" : "許可する"}</button>
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
    </div>
  );
}
