"use client";
// ═══════════════════════════════════════════
// components/tabs/DocumentsTab.tsx — 書類タブ（Supabase接続済み）
// ═══════════════════════════════════════════
import { useState, useEffect, useCallback, useRef } from "react";
import { T } from "@/lib/constants";
import { Badge } from "@/components/ui";
import { supabase } from "@/lib/supabase";

interface DocRecord {
  id: string;
  document_name: string;
  category: string | null;
  doc_type: string | null;
  file_url: string | null;
  content: string | null;
  upload_date: string | null;
  uploader: string | null;
  confirmed_at: string | null;
}

export default function DocumentsTab({ employee }: { employee: any }) {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<DocRecord | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const fetchDocs = useCallback(async () => {
    if (!employee?.id) return;
    setLoading(true);

    const { data } = await supabase
      .from("documents")
      .select("id, document_name, category, doc_type, file_url, content, upload_date, uploader, confirmed_at")
      .eq("company_id", employee.company_id)
      .or(`employee_id.eq.${employee.id},employee_id.is.null`)
      .order("upload_date", { ascending: false });

    setDocs(data || []);
    setLoading(false);
  }, [employee?.id, employee?.company_id]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const markConfirmed = async (doc: DocRecord) => {
    if (doc.confirmed_at) return;
    await supabase.from("documents").update({ confirmed_at: new Date().toISOString() }).eq("id", doc.id);
    setDocs((prev) => prev.map((d) => d.id === doc.id ? { ...d, confirmed_at: new Date().toISOString() } : d));
  };

  const handleClick = (doc: DocRecord) => {
    markConfirmed(doc);
    if (doc.doc_type === "payslip" && doc.content) {
      setPreview(doc);
    } else if (doc.file_url) {
      (async () => {
        try {
          const res = await fetch(doc.file_url!);
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = `${doc.document_name}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } catch {
          window.open(doc.file_url!, "_blank");
        }
      })();
    }
  };

  const handlePdfDownload = async () => {
    if (!preview?.content || !iframeRef.current) return;
    setPdfLoading(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");

      const iframeDoc = iframeRef.current.contentDocument;
      if (!iframeDoc?.body) { setPdfLoading(false); return; }

      const canvas = await html2canvas(iframeDoc.body, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#fff",
      });

      const imgW = 210;
      const imgH = (canvas.height * imgW) / canvas.width;
      const pdf = new jsPDF({ orientation: imgH > 297 ? "portrait" : "portrait", unit: "mm", format: "a4" });
      const pageH = 297;
      let yOff = 0;
      while (yOff < imgH) {
        if (yOff > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, -yOff, imgW, imgH);
        yOff += pageH;
      }

      const month = preview.document_name.replace("給与明細 ", "").trim();
      pdf.save(`給与明細_${month}.pdf`);
    } catch (e) {
      console.error("PDF生成失敗:", e);
    }
    setPdfLoading(false);
  };

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
              onClick={() => handleClick(d)}
              style={{
                backgroundColor: "#fff", borderRadius: "8px", padding: "14px",
                border: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12,
                transition: "all 0.15s", cursor: "pointer",
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: "6px", display: "flex",
                alignItems: "center", justifyContent: "center", flexShrink: 0,
                backgroundColor: d.doc_type === "payslip" ? "#DCFCE7" : d.doc_type === "pdf" ? "#FEE2E2" : "#DBEAFE",
                color: d.doc_type === "payslip" ? T.primary : d.doc_type === "pdf" ? T.danger : T.yukyuBlue,
                fontSize: 11, fontWeight: 700,
              }}>
                {d.doc_type === "payslip" ? "明細" : (d.doc_type || "PDF").toUpperCase()}
              </div>

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

              <div style={{
                padding: "8px 16px", borderRadius: "6px",
                backgroundColor: T.primary, color: "#fff", fontSize: 13, fontWeight: 600,
                flexShrink: 0,
              }}>
                {d.doc_type === "payslip" ? "表示" : "DL"}
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div
          onClick={() => setPreview(null)}
          style={{
            position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "#fff", borderRadius: 12, width: "100%", maxWidth: 820,
              maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden",
              boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{
              padding: "14px 20px", borderBottom: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: T.text }}>
                {preview.document_name}
              </div>
              <button
                onClick={handlePdfDownload}
                disabled={pdfLoading}
                style={{
                  padding: "8px 16px", borderRadius: 6, border: "none",
                  backgroundColor: T.primary, color: "#fff", fontSize: 13, fontWeight: 600,
                  cursor: pdfLoading ? "not-allowed" : "pointer", opacity: pdfLoading ? 0.6 : 1,
                }}
              >
                {pdfLoading ? "生成中..." : "PDF DL"}
              </button>
              <button
                onClick={() => setPreview(null)}
                style={{
                  padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`,
                  backgroundColor: "#fff", color: T.text, fontSize: 13, cursor: "pointer",
                }}
              >
                閉じる
              </button>
            </div>
            <iframe
              ref={iframeRef}
              srcDoc={preview.content || ""}
              style={{ flex: 1, border: "none", minHeight: 500 }}
              title="payslip-preview"
            />
          </div>
        </div>
      )}
    </div>
  );
}
