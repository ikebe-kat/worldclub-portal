"use client";
// ═══════════════════════════════════════════
// components/tabs/RosterTab.tsx — 名簿タブ
// プライバシー方針：閲覧者で出し分け
//   4名（W02/W49/W67/WC001）→ 元のフルUI（写真込みカード／写真入り詳細）
//   一般社員 → 「苗字 + 部署 + 社員コード」だけ、他人の詳細は開けない
//   一般社員向けクエリでは photo_url / birth_date 等の機微情報を取得しない
// ═══════════════════════════════════════════
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { T } from "@/lib/constants";
import { Avatar, Badge } from "@/components/ui";
import Dialog from "@/components/ui/Dialog";
import { supabase } from "@/lib/supabase";
import { canSeeProfile, canViewOthersProfile } from "@/lib/permissions";
import type { ProfileSection } from "@/lib/permissions";

// ── 一覧用レコード ──
//   一般社員向けは {id, employee_code, full_name, department} のみ。
//   4名閲覧者向けは追加で photo_url / position / store_short を含む（フルカード用）。
interface EmpListItem {
  id: string;
  employee_code: string;
  full_name: string;
  department: string | null;
  // 4名閲覧者向けの追加列（一般社員クエリでは undefined）
  photo_url?: string | null;
  position?: string | null;
  store_short?: string;
}

// ── プロフィールモーダル用 詳細レコード（権限がある時だけ取得） ──
interface EmpDetail {
  id: string;
  employee_code: string;
  full_name: string;
  full_name_kana: string | null;
  email: string | null;
  phone: string | null;
  gender: string | null;
  birth_date: string | null;
  hire_date: string | null;
  employment_type: string | null;
  position: string | null;
  department: string | null;
  grade: string | null;
  role: string | null;
  store_id: string | null;
  store_short: string;
  skills: string | null;
  photo_url: string | null;
}

// ── store_nameから短縮名を判定（詳細モーダル表示用） ──
function resolveStoreShort(storeName: string | null): string {
  if (!storeName) return "—";
  const n = storeName.toLowerCase();
  if (n.includes("八代")) return "八代";
  if (n.includes("健軍")) return "健軍";
  if (n.includes("大津") || n.includes("菊陽")) return "大津";
  if (n.includes("本社")) return "本社";
  if (n.includes("経理") || n.includes("人事") || n.includes("dx")) return "業務部";
  if (n.includes("御領")) return "御領";
  return storeName;
}

// ── 苗字抽出（空白で分割した先頭。空白なしならそのまま） ──
function lastNameOf(fullName: string): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || fullName;
}

// ── 情報行 ──────────────────────────────
const Info = ({ l, v }: { l: string; v?: string | null }) => (
  <div style={{ display: "flex", padding: "8px 0", borderBottom: `1px solid ${T.borderLight}` }}>
    <div style={{ width: 100, fontSize: 12, color: T.textMuted, flexShrink: 0 }}>{l}</div>
    <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>{v || "—"}</div>
  </div>
);

// ══════════════════════════════════════════
// PIN変更モーダル
// ══════════════════════════════════════════
interface PinModalProps {
  employeeId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const PinChangeModal = ({ employeeId, onClose, onSuccess }: PinModalProps) => {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (!currentPin) { setError("現在のPINを入力してください"); return; }
    if (!newPin) { setError("新しいPINを入力してください"); return; }
    if (newPin.length < 4 || newPin.length > 8 || !/^\d+$/.test(newPin)) {
      setError("PINは4〜8桁の数字で入力してください"); return;
    }
    if (newPin !== confirmPin) { setError("新しいPINが一致しません"); return; }

    // 現在のPIN確認
    const { data: emp } = await supabase
      .from("employee_pins").select("pin").eq("employee_id", employeeId).maybeSingle();
    if (!emp || emp.pin !== currentPin) { setError("現在のPINが正しくありません"); return; }

    setSaving(true);
    const { error: updateErr } = await supabase
      .from("employee_pins").update({ pin: newPin }).eq("employee_id", employeeId);
    setSaving(false);

    if (updateErr) { setError("更新に失敗しました"); return; }
    onSuccess();
  };

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1100, animation: "fadeIn 0.2s ease" }} onClick={onClose}>
      <div style={{ backgroundColor: "#fff", borderRadius: "12px 12px 0 0", padding: "24px 20px", width: "100%", maxWidth: 400, animation: "slideUp 0.3s ease" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border, margin: "0 auto 16px" }} />
        <div style={{ fontSize: 17, fontWeight: 700, color: T.primary, marginBottom: 20, textAlign: "center" }}>PIN変更</div>

        {error && <div style={{ padding: "10px 14px", borderRadius: 6, backgroundColor: "#FEF2F2", color: "#991B1B", fontSize: 13, marginBottom: 14 }}>{error}</div>}

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 4 }}>現在のPIN</label>
          <input type="password" inputMode="numeric" placeholder="現在のPIN" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)}
            style={{ width: "100%", padding: "11px 14px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 16, boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 4 }}>新しいPIN</label>
          <input type="password" inputMode="numeric" placeholder="4〜8桁の数字" value={newPin} onChange={(e) => setNewPin(e.target.value)}
            style={{ width: "100%", padding: "11px 14px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 16, boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 4 }}>新しいPIN（確認）</label>
          <input type="password" inputMode="numeric" placeholder="もう一度入力" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)}
            style={{ width: "100%", padding: "11px 14px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 16, boxSizing: "border-box" }} />
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.textSec, fontSize: 14, cursor: "pointer" }}>キャンセル</button>
          <button onClick={handleSubmit} disabled={saving} style={{ flex: 1, padding: "12px", borderRadius: 6, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 14, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "変更中..." : "変更する"}</button>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════
// 情報変更申請モーダル
// ══════════════════════════════════════════
const CHANGE_CATEGORIES = [
  { id: "住所変更", hint: "変更内容に新しい住所を番地・部屋番号まで記載して下さい" },
  { id: "口座変更", hint: "新しい口座の銀行名・支店名・口座番号が分かるキャッシュカードか通帳の写真を添付して下さい" },
  { id: "扶養追加", hint: "①追加したい方のお名前とフリガナ、生年月日、続柄を変更内容に記載して下さい\n②追加したい方の住民票の写メ（マイナンバー入り）を添付して下さい" },
  { id: "扶養削除", hint: "①削除されたい方のお名前とフリガナ、続柄を変更内容に記載して下さい\n②これまでの保険（社保・国保）の喪失日が分かる書類の写メを添付して下さい\n③削除される方の資格確認証（黄色のカード）がある方は、池邉までお持ちください" },
  { id: "その他", hint: "申請内容を記載して下さい" },
];

interface ChangeRequestModalProps {
  employeeId: string;
  companyId: string;
  employeeName: string;
  onClose: () => void;
  onSuccess: () => void;
}

const ChangeRequestModal = ({ employeeId, companyId, employeeName, onClose, onSuccess }: ChangeRequestModalProps) => {
  const [category, setCategory] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const hint = CHANGE_CATEGORIES.find((c) => c.id === category)?.hint || null;

  const handleSubmit = async () => {
    setError(null);
    if (!category) { setError("申請種別を選択してください"); return; }
    if (!detail.trim()) { setError("変更内容を入力してください"); return; }

    setSaving(true);
    let fileUrl: string | null = null;

    // ファイルアップロード
    if (file) {
      const ext = file.name.split(".").pop() || "file";
      const path = `${employeeId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("change-requests")
        .upload(path, file);
      if (upErr) { setError("ファイルのアップロードに失敗しました"); setSaving(false); return; }
      const { data: urlData } = supabase.storage.from("change-requests").getPublicUrl(path);
      fileUrl = urlData?.publicUrl || null;
    }

    // change_requestsに保存
    const { error: insertErr } = await supabase.from("change_requests").insert({
      company_id: companyId,
      employee_id: employeeId,
      category,
      detail: detail.trim(),
      file_url: fileUrl,
      status: "未処理",
    });
    setSaving(false);

    if (insertErr) { setError("申請の送信に失敗しました"); return; }
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-push`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ type: "wc_info_change_request", payload: { company_id: companyId, employee_name: employeeName, category } }),
      });
    } catch (_) {}
    onSuccess();
  };

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1100, animation: "fadeIn 0.2s ease" }} onClick={onClose}>
      <div style={{ backgroundColor: "#fff", borderRadius: "12px 12px 0 0", padding: "24px 20px", width: "100%", maxWidth: 440, maxHeight: "85vh", overflowY: "auto", animation: "slideUp 0.3s ease" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border, margin: "0 auto 16px" }} />
        <div style={{ fontSize: 17, fontWeight: 700, color: T.text, marginBottom: 4 }}>情報変更を申請</div>
        <div style={{ fontSize: 12, color: T.textSec, marginBottom: 14 }}>申請種別</div>

        {error && <div style={{ padding: "10px 14px", borderRadius: 6, backgroundColor: "#FEF2F2", color: "#991B1B", fontSize: 13, marginBottom: 14 }}>{error}</div>}

        {/* 種別チップ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          {CHANGE_CATEGORIES.slice(0, 4).map((c) => (
            <button key={c.id} onClick={() => setCategory(category === c.id ? null : c.id)}
              style={{
                padding: "12px 8px", borderRadius: 6, fontSize: 14, fontWeight: category === c.id ? 700 : 500, cursor: "pointer",
                border: category === c.id ? `2px solid ${T.gold}` : `1px solid ${T.border}`,
                backgroundColor: category === c.id ? T.goldLight : "#fff",
                color: T.text, transition: "all 0.15s",
              }}>{c.id}</button>
          ))}
        </div>
        <button onClick={() => setCategory(category === "その他" ? null : "その他")}
          style={{
            width: "100%", padding: "12px 8px", borderRadius: 6, fontSize: 14, fontWeight: category === "その他" ? 700 : 500, cursor: "pointer",
            border: category === "その他" ? `2px solid ${T.gold}` : `1px solid ${T.border}`,
            backgroundColor: category === "その他" ? T.goldLight : "#fff",
            color: T.text, marginBottom: 12, transition: "all 0.15s",
          }}>その他</button>

        {/* ヒントメッセージ */}
        {hint && (
          <div style={{ padding: "10px 14px", borderRadius: 6, backgroundColor: T.goldLight, fontSize: 12, color: "#92400E", marginBottom: 14, lineHeight: 1.6, whiteSpace: "pre-line" }}>
            {hint}
          </div>
        )}

        {/* 変更内容 */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 4 }}>変更内容</label>
          <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={4}
            style={{ width: "100%", padding: "11px 14px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 14, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
        </div>

        {/* ファイル添付 */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: T.textSec, display: "block", marginBottom: 4 }}>ファイル添付（任意）</label>
          <input type="file" ref={fileRef} onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ display: "none" }} />
          <button onClick={() => fileRef.current?.click()}
            style={{ width: "100%", padding: "11px 14px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff", fontSize: 13, color: file ? T.text : T.textPH, cursor: "pointer", textAlign: "left" }}>
            {file ? `📎 ${file.name}` : "📎 タップしてファイルを選択"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "13px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.text, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>キャンセル</button>
          <button onClick={handleSubmit} disabled={saving} style={{ flex: 1, padding: "13px", borderRadius: 6, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 14, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "送信中..." : "送信"}</button>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════
// プロフィールモーダル（権限がある時だけ表示される）
// ══════════════════════════════════════════
interface ProfileModalProps {
  emp: EmpDetail;
  viewerCode: string;
  isSelf: boolean;
  companyId: string;
  onClose: () => void;
  onRefresh: () => void;
}

const ProfileModal = ({ emp, viewerCode, isSelf, companyId, onClose, onRefresh }: ProfileModalProps) => {
  const [showPinModal, setShowPinModal] = useState(false);
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [editingSkills, setEditingSkills] = useState(false);
  const [skillsText, setSkillsText] = useState(emp.skills || "");
  const [skillsSaving, setSkillsSaving] = useState(false);
  const [skillsMsg, setSkillsMsg] = useState<string | null>(null);
  const [dialogMsg, setDialogMsg] = useState<string | null>(null);

  const can = (section: ProfileSection) =>
    canSeeProfile("employee", viewerCode, isSelf, emp.store_id, section);

  const birthdayDisplay = emp.birth_date || null;

  const tenureYears = emp.hire_date
    ? Math.floor((Date.now() - new Date(emp.hire_date).getTime()) / (365.25 * 86400000))
    : null;

  const handleSkillsSave = async () => {
    setSkillsSaving(true);
    const { error } = await supabase
      .from("employees").update({ skills: skillsText.trim() || null }).eq("id", emp.id);
    setSkillsSaving(false);
    if (error) { setSkillsMsg("保存に失敗しました"); return; }
    setEditingSkills(false);
    setDialogMsg("保有資格を保存しました");
    onRefresh();
  };

  return (
    <>
      <div
        style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, animation: "fadeIn 0.2s ease", overflow: "auto", padding: "20px 0",
        }}
        onClick={onClose}
      >
        <div
          style={{
            backgroundColor: "#fff", borderRadius: "12px",
            width: "100%", maxWidth: 480, maxHeight: "70vh", overflowY: "auto",
            animation: "slideUp 0.3s ease", margin: "auto",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ヘッダー */}
          <div style={{
            background: `linear-gradient(135deg, #1a4b24, #2d7a3a)`,
            padding: "24px 20px 18px", color: "#fff",
            borderRadius: "12px 12px 0 0", position: "relative",
          }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)", margin: "0 auto 12px" }} />
            <button onClick={onClose}
              style={{ position: "absolute", top: 12, right: 12, width: 28, height: 28, border: "none", backgroundColor: "rgba(255,255,255,0.2)", borderRadius: "50%", color: "#fff", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              ×
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {emp.photo_url
                ? <img src={emp.photo_url} alt="" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", border: "3px solid rgba(255,255,255,0.3)" }} />
                : <Avatar name={emp.full_name} size={64} style={{ border: "3px solid rgba(255,255,255,0.3)" }} />}
              <div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{emp.full_name}</div>
                {can("detail") && <div style={{ fontSize: 12, opacity: 0.8 }}>{emp.full_name_kana || ""}</div>}
                <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
                  {can("detail") ? `${emp.store_short} ・ ${emp.department || "—"} ・ ${emp.position || "—"}` : (emp.department || "—")}
                </div>
              </div>
            </div>
          </div>

          <div style={{ padding: "16px 20px 24px" }}>
            {/* マイページ: アクションボタン */}
            {isSelf && (
              <div style={{ marginBottom: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={() => setShowChangeModal(true)}
                  style={{ padding: "12px", borderRadius: "6px", border: `1px solid ${T.primary}`, backgroundColor: "#fff", color: T.primary, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  情報変更を申請する
                </button>
                <button onClick={() => setShowPinModal(true)}
                  style={{ padding: "12px", borderRadius: "6px", border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.textSec, fontSize: 14, cursor: "pointer" }}>
                  PIN変更
                </button>
              </div>
            )}

            {/* 基本情報 */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <div style={{ width: 3, height: 13, backgroundColor: T.primary, borderRadius: 2 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>基本情報</span>
            </div>
            {can("detail") && <Info l="社員番号" v={emp.employee_code} />}
            {can("detail") && <Info l="店舗" v={emp.store_short} />}
            <Info l="担当業務" v={emp.department} />
            {can("detail") && <Info l="役職" v={emp.position} />}
            <Info l="生年月日" v={birthdayDisplay} />

            {/* 詳細情報 */}
            {can("detail") && (
              <>
                <Info l="等級" v={emp.grade} />
                <Info l="雇用区分" v={emp.employment_type} />

                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18, marginBottom: 6 }}>
                  <div style={{ width: 3, height: 13, backgroundColor: "#00A37B", borderRadius: 2 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>詳細情報</span>
                </div>
                <Info l="性別" v={emp.gender} />
                <Info l="入社日" v={emp.hire_date} />
                {tenureYears !== null && <Info l="勤続年数" v={`${tenureYears}年`} />}
                <Info l="電話番号" v={emp.phone} />
                <Info l="メール" v={emp.email} />

                {/* 保有資格 */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18, marginBottom: 6 }}>
                  <div style={{ width: 3, height: 13, backgroundColor: "#EE7959", borderRadius: 2 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>保有資格</span>
                </div>

                {skillsMsg && <div style={{ padding: "8px 12px", borderRadius: 6, backgroundColor: "#ECFDF5", color: "#065F46", fontSize: 12, marginBottom: 8 }}>{skillsMsg}</div>}

                {editingSkills ? (
                  <div>
                    <textarea value={skillsText} onChange={(e) => setSkillsText(e.target.value)} rows={3}
                      placeholder="例：普通自動車免許, 損害保険募集人"
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", marginBottom: 8 }} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => { setEditingSkills(false); setSkillsText(emp.skills || ""); }}
                        style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.textSec, fontSize: 12, cursor: "pointer" }}>キャンセル</button>
                      <button onClick={handleSkillsSave} disabled={skillsSaving}
                        style={{ padding: "8px 16px", borderRadius: 6, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: skillsSaving ? "default" : "pointer", opacity: skillsSaving ? 0.6 : 1 }}>{skillsSaving ? "保存中..." : "保存"}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: emp.skills ? T.text : T.textMuted, padding: "6px 0", fontStyle: emp.skills ? "normal" : "italic", whiteSpace: "pre-line" }}>
                      {emp.skills || "未登録"}
                    </div>
                    {isSelf && (
                      <button onClick={() => setEditingSkills(true)}
                        style={{ fontSize: 12, color: T.primary, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        ✏️ 編集
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <style>{`
          @keyframes slideUp { from { transform: translateY(30px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
          @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        `}</style>
      </div>

      {/* PIN変更モーダル */}
      {showPinModal && (
        <PinChangeModal
          employeeId={emp.id}
          onClose={() => setShowPinModal(false)}
          onSuccess={() => { setShowPinModal(false); setDialogMsg("PINを変更しました"); }}
        />
      )}

      {/* 情報変更申請モーダル */}
      {showChangeModal && (
        <ChangeRequestModal
          employeeId={emp.id}
          companyId={companyId}
          employeeName={emp.full_name}
          onClose={() => setShowChangeModal(false)}
          onSuccess={() => { setShowChangeModal(false); setDialogMsg("申請を送信しました"); }}
        />
      )}

      {/* 成功ダイアログ */}
      {dialogMsg && (
        <Dialog message={dialogMsg} onOk={() => setDialogMsg(null)} />
      )}
    </>
  );
};

// ══════════════════════════════════════════
// メインコンポーネント
// ══════════════════════════════════════════
export default function RosterTab({ employee }: { employee: any }) {
  const [q, setQ] = useState("");
  const [selE, setSelE] = useState<EmpDetail | null>(null);
  const [allEmps, setAllEmps] = useState<EmpListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const myCode: string = employee?.employee_code || "";
  const canViewOthers = canViewOthersProfile(myCode);

  // ── 一覧用：閲覧者で取得列を分岐 ──
  //   4名: フルカード用に photo_url / position / store_id（→store_short） も取得
  //   一般: id/employee_code/full_name/department のみ（photo_url・birth_date は取らない）
  const fetchList = useCallback(async () => {
    if (!employee?.company_id) return;
    setLoading(true);
    if (canViewOthers) {
      const { data: storesData } = await supabase
        .from("stores").select("id, store_name").eq("company_id", employee.company_id);
      const storeNameMap: Record<string, string> = {};
      (storesData || []).forEach((s: any) => { storeNameMap[s.id] = s.store_name || ""; });
      const { data: empData } = await supabase
        .from("employees")
        .select("id, employee_code, full_name, department, position, store_id, photo_url")
        .eq("company_id", employee.company_id)
        .eq("is_active", true)
        .order("employee_code");
      const mapped: EmpListItem[] = (empData || []).map((e: any) => {
        const isHQ = ["W02","W49","W67"].includes(e.employee_code);
        const storeName = storeNameMap[e.store_id] || "";
        return {
          id: e.id,
          employee_code: e.employee_code,
          full_name: e.full_name,
          department: e.department,
          position: e.position,
          photo_url: e.photo_url,
          store_short: isHQ ? "本部" : resolveStoreShort(storeName),
        };
      });
      setAllEmps(mapped);
    } else {
      const { data: empData } = await supabase
        .from("employees")
        .select("id, employee_code, full_name, department")
        .eq("company_id", employee.company_id)
        .eq("is_active", true)
        .order("employee_code");
      setAllEmps((empData || []) as EmpListItem[]);
    }
    setLoading(false);
  }, [employee?.company_id, canViewOthers]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── プロフィールを開く（権限がある時だけ詳細を別取得） ──
  const openProfile = async (targetId: string) => {
    const isSelf = targetId === employee?.id;
    if (!isSelf && !canViewOthers) return; // 一般社員が他人をタップ → 何も開かない

    const { data: detailRow } = await supabase
      .from("employees")
      .select("id, employee_code, full_name, full_name_kana, email, phone, gender, birth_date, hire_date, employment_type, position, department, grade, role, store_id, skills, photo_url, stores(store_name)")
      .eq("id", targetId)
      .eq("company_id", employee.company_id)
      .maybeSingle();
    if (!detailRow) return;

    const storeName: string = (detailRow as any).stores?.store_name || "";
    const isHQ = ["W02", "W49", "W67"].includes(detailRow.employee_code);
    const detail: EmpDetail = {
      id: detailRow.id,
      employee_code: detailRow.employee_code,
      full_name: detailRow.full_name,
      full_name_kana: detailRow.full_name_kana,
      email: detailRow.email,
      phone: detailRow.phone,
      gender: detailRow.gender,
      birth_date: detailRow.birth_date,
      hire_date: detailRow.hire_date,
      employment_type: detailRow.employment_type,
      position: detailRow.position,
      department: detailRow.department,
      grade: detailRow.grade,
      role: detailRow.role,
      store_id: detailRow.store_id,
      store_short: isHQ ? "本部" : resolveStoreShort(storeName),
      skills: detailRow.skills,
      photo_url: (detailRow as any).photo_url ?? null,
    };
    setSelE(detail);
  };

  const filtered = useMemo(() =>
    allEmps.filter((e) => {
      if (e.id === employee?.id) return false;
      if (q && !e.full_name.includes(q)) return false;
      return true;
    }),
  [allEmps, q, employee?.id]);

  if (loading) {
    return <div style={{ padding: "40px 16px", textAlign: "center", color: T.textMuted, fontSize: 14 }}>読み込み中...</div>;
  }

  const myDeptDisplay: string = employee?.department || "—";
  const myStoreShort: string = employee
    ? (["W02","W49","W67"].includes(employee.employee_code)
        ? "本部"
        : resolveStoreShort(employee.store_name || ""))
    : "—";
  const myPositionDisplay: string = employee?.position || "—";

  return (
    <div style={{ padding: "24px 12px", maxWidth: 840, margin: "0 auto" }}>
      {employee && (
        <div
          onClick={() => openProfile(employee.id)}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "14px 16px", backgroundColor: T.goldLight,
            border: `2px solid ${T.gold}`, borderRadius: "8px",
            marginBottom: 16, cursor: "pointer", transition: "box-shadow 0.2s",
          }}
        >
          <Avatar name={employee.full_name} size={48} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{employee.full_name}</div>
            <div style={{ fontSize: 12, color: T.textSec }}>
              {canViewOthers
                ? `${myStoreShort} ・ ${myDeptDisplay} ・ ${myPositionDisplay}`
                : myDeptDisplay}
            </div>
          </div>
          <Badge bg={T.gold} color="#78350F">マイページ</Badge>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input type="text" placeholder="名前で検索..." value={q} onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, padding: "9px 12px", borderRadius: "6px", border: `1px solid ${T.border}`, fontSize: 13 }} />
      </div>
      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>{filtered.length}名</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
        {filtered.map((e) => {
          if (canViewOthers) {
            // 4名閲覧者向け：元のフルカード（写真／氏名フル／店舗／部署／役職／社員コード）
            return (
              <div
                key={e.id}
                onClick={() => openProfile(e.id)}
                style={{
                  backgroundColor: "#fff", borderRadius: "8px",
                  padding: "16px 10px", border: `1px solid ${T.border}`,
                  cursor: "pointer", textAlign: "center", transition: "all 0.2s",
                }}
                onMouseEnter={(ev) => { ev.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.07)"; ev.currentTarget.style.borderColor = T.gold; }}
                onMouseLeave={(ev) => { ev.currentTarget.style.boxShadow = "none"; ev.currentTarget.style.borderColor = T.border; }}
              >
                {e.photo_url
                  ? <img src={e.photo_url} alt="" style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", margin: "0 auto 8px", display: "block" }} />
                  : <Avatar name={e.full_name} size={52} style={{ margin: "0 auto 8px" }} />}
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.full_name}</div>
                <div style={{ fontSize: 11, color: T.primary, fontWeight: 600, marginTop: 2 }}>{e.store_short || "—"}</div>
                <div style={{ fontSize: 11, color: T.textSec }}>{e.department || "—"}</div>
                <div style={{ fontSize: 11, color: T.textSec }}>{e.position || "—"}</div>
                <div style={{ fontSize: 10, color: T.textPH, marginTop: 2 }}>{e.employee_code}</div>
              </div>
            );
          }
          // 一般社員向け：苗字＋部署＋社員コードのみ。タップ不可。
          return (
            <div
              key={e.id}
              style={{
                backgroundColor: "#fff", borderRadius: "8px",
                padding: "16px 10px", border: `1px solid ${T.border}`,
                cursor: "default", textAlign: "center", transition: "all 0.2s",
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 6 }}>{lastNameOf(e.full_name)}</div>
              <div style={{ fontSize: 12, color: T.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.department || "—"}</div>
              <div style={{ fontSize: 10, color: T.textPH, marginTop: 4 }}>{e.employee_code}</div>
            </div>
          );
        })}
      </div>

      {selE && (
        <ProfileModal
          emp={selE}
          viewerCode={myCode}
          isSelf={selE.id === employee?.id}
          companyId={employee?.company_id || ""}
          onClose={() => setSelE(null)}
          onRefresh={() => { if (selE) openProfile(selE.id); }}
        />
      )}
    </div>
  );
}
