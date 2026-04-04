"use client";
// ═══════════════════════════════════════════
// components/ui/Dialog.tsx — 共通カスタムダイアログ
// alert / confirm の代替。ボトムシート風デザイン。
// ═══════════════════════════════════════════
import { T } from "@/lib/constants";

interface DialogProps {
  message: string;
  /** "alert" = OKボタンのみ / "confirm" = キャンセル+実行 */
  mode?: "alert" | "confirm";
  /** confirmモードの実行ボタンラベル（デフォルト: "OK"） */
  confirmLabel?: string;
  /** confirmモードの実行ボタン色（デフォルト: T.primary） */
  confirmColor?: string;
  onOk: () => void;
  onCancel?: () => void;
}

export default function Dialog({
  message,
  mode = "alert",
  confirmLabel = "OK",
  confirmColor = T.primary,
  onOk,
  onCancel,
}: DialogProps) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 2000, animation: "fadeIn 0.15s ease",
      }}
      onClick={() => mode === "alert" ? onOk() : onCancel?.()}
    >
      <div
        style={{
          backgroundColor: "#fff", borderRadius: "12px",
          padding: "24px 20px", width: "100%", maxWidth: 360,
          animation: "scaleIn 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* メッセージ */}
        <div style={{
          fontSize: 14, color: T.text, lineHeight: "22px",
          whiteSpace: "pre-wrap", marginBottom: 20, textAlign: "center",
        }}>
          {message}
        </div>

        {/* ボタン */}
        <div style={{ display: "flex", gap: 10 }}>
          {mode === "confirm" && (
            <button
              onClick={onCancel}
              style={{
                flex: 1, padding: "12px", borderRadius: "6px",
                border: `1px solid ${T.border}`, backgroundColor: "#fff",
                color: T.textSec, fontSize: 14, cursor: "pointer",
              }}
            >
              キャンセル
            </button>
          )}
          <button
            onClick={onOk}
            style={{
              flex: 1, padding: "12px", borderRadius: "6px", border: "none",
              backgroundColor: confirmColor, color: "#fff",
              fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            {mode === "alert" ? "OK" : confirmLabel}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes scaleIn { from { transform: scale(0.9); opacity: 0 } to { transform: scale(1); opacity: 1 } }
      `}</style>
    </div>
  );
}
