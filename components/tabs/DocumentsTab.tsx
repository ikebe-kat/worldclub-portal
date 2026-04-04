"use client";
// ═══════════════════════════════════════════
// components/tabs/DocumentsTab.tsx — 書類タブ（Supabase接続済み）
// ═══════════════════════════════════════════
import { useState, useEffect, useCallback } from "react";
import { T } from "@/lib/constants";
import { Badge } from "@/components/ui";
import { supabase } from "@/lib/supabase";

interface DocRecord {
  id: string;
  document_name: string;
  category: string | null;
  doc_type: string | null;
  file_url: string | null;
  upload_date: string | null;
  uploader: string | null;
  confirmed_at: string | null;
}

export default function DocumentsTab({ employee }: { employee: any }) {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDocs = useCallback(async () => {
    if (!employee?.id) return;
    setLoading(true);

    // 自分宛の書類（employee_id = 自分 or employee_id = null で全員宛）
    const { data } = await supabase
      .from("documents")
      .select("id, document_name, category, doc_type, file_url, upload_date, uploader, confirmed_at")
      .eq("company_id", employee.company_id)
      .or(`employee_id.eq.${employee.id},employee_id.is.null`)
      .order("upload_date", { ascending: false });

    setDocs(data || []);
    setLoading(false);
  }, [employee?.id, employee?.company_id]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  // DLボタン押下 → ファイルURLを開く + confirmed_atを更新
  const handleDownload = async (doc: DocRecord) => {
    // confirmed_atが未設定なら更新（初回DLで確認済み）
    if (!doc.confirmed_at) {
      await supabase
        .from("documents")
        .update({ confirmed_at: new Date().toISOString() })
        .eq("id", doc.id);
    }

    // ファイルURLがあれば開く
    if (doc.file_url) {
      window.open(doc.file_url, "_blank");
    }

    // ローカル状態を更新
    setDocs((prev) =>
      prev.map((d) => d.id === doc.id ? { ...d, confirmed_at: d.confirmed_at || new Date().toISOString() } : d)
    );
  };

  // 日付フォーマット
  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    return d.slice(0, 10);
  };

  if (loading) {
    return <div style={{ padding: "40px 16px", textAlign: "center", color: T.textMuted, fontSize: 14 }}>読み込み中...</div>;
  }

  return (
    <div style={{ padding: "24px 12px", maxWidth: 560, margin: "0 auto" }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: T.text, marginBottom: 4 }}>書類</div>
      <div style={{ fontSize: 13, color: T.textSec, marginBottom: 20 }}>
        配布された書類をダウンロードできます。初回ダウンロード時に「確認済」となります。
      </div>

      {docs.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "48px 16px",
          backgroundColor: "#fff", borderRadius: "8px", border: `1px solid ${T.border}`,
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
          <div style={{ fontSize: 14, color: T.textMuted }}>配布された書類はありません</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {docs.map((d) => (
            <div
              key={d.id}
              style={{
                backgroundColor: "#fff", borderRadius: "8px", padding: "14px",
                border: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12,
                transition: "all 0.15s",
              }}
            >
              {/* ファイルタイプアイコン */}
              <div style={{
                width: 40, height: 40, borderRadius: "6px", display: "flex",
                alignItems: "center", justifyContent: "center", flexShrink: 0,
                backgroundColor: d.doc_type === "pdf" ? "#FEE2E2" : "#DBEAFE",
                color: d.doc_type === "pdf" ? T.danger : T.yukyuBlue,
                fontSize: 11, fontWeight: 700,
              }}>
                {(d.doc_type || "PDF").toUpperCase()}
              </div>

              {/* ファイル名 + バッジ */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: T.text,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {d.document_name}
                </div>
                <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                  {d.category && <Badge bg="#DBEAFE" color="#1D4ED8">{d.category}</Badge>}
                  {d.confirmed_at
                    ? <Badge bg="#DCFCE7" color="#166534">確認済</Badge>
                    : <Badge bg="#FEF9C3" color="#854D0E">未確認</Badge>
                  }
                  <span style={{ fontSize: 10, color: T.textPH }}>{fmtDate(d.upload_date)}</span>
                </div>
              </div>

              {/* DLボタン */}
              <button
                onClick={() => handleDownload(d)}
                style={{
                  padding: "8px 16px", borderRadius: "6px", border: "none",
                  backgroundColor: T.primary, color: "#fff", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", flexShrink: 0, transition: "all 0.15s",
                }}
              >
                DL
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}