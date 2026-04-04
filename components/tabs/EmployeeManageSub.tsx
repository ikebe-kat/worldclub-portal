"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { T } from "@/lib/constants";
import Dialog from "@/components/ui/Dialog";
import { supabase } from "@/lib/supabase";
import NyushaSheetExport from "@/components/tabs/NyushaSheetExport";

/* ══════════════════════════════════════ */
/* ── 選択肢定義（ハンドオフv15準拠） ── */
/* ══════════════════════════════════════ */
const EMPLOYMENT_TYPES = ["代表取締役", "正社員", "パート", "特定技能", "技能実習"] as const;
const HOLIDAY_PATTERNS = ["正社員A","正社員B","正社員C","サービス正社員A","サービス正社員B","上限なし（パート）","経理（12月のみ3日）","人事（月3〜7日）","DX（月2～7日）","鈑金A","鈑金B","なし"] as const;
const HOLIDAY_CALENDARS = ["サービス","営業フロント","財務経理","人事総務","パート水曜定休","DX","インシュアランス部","鈑金塗装部","代表取締役"] as const;
const WORK_PATTERNS = ["09:30-18:00","09:30-17:30","09:30-17:00","10:00-17:30","09:30-16:30"] as const;
const ROLES = ["全店（代表）","全店（専務）","全店（人事）","全店（本部長）","八代店長","健軍店長","鈑金塗装部","一般"] as const;
const GENDERS = ["男性", "女性"] as const;
const BANK_TYPES = ["普通", "当座"] as const;
const DOC_CATEGORIES = ["履歴書", "免許証", "資格証明書", "契約書", "その他"] as const;

/* ── 型 ── */
interface EmpRow {
  id: string; company_id: string; store_id: string; employee_code: string;
  full_name: string; full_name_kana: string | null; email: string | null;
  phone: string | null; gender: string | null; birth_date: string | null;
  hire_date: string; employment_type: string; position: string | null;
  department: string | null; grade: string | null;
  weekly_work_days: number | null; weekly_work_hours: number | null;
  paid_leave_grant_date: string | null; work_pattern_code: string | null;
  holiday_pattern: string | null; holiday_calendar: string | null;
  role: string; requires_punch: boolean | null; is_active: boolean | null;
  postal_code: string | null; address: string | null;
  emergency_contact_name: string | null; emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  bank_name: string | null; bank_branch: string | null;
  bank_account_type: string | null; bank_account_number: string | null;
  bank_account_holder: string | null;
  basic_pension_number: string | null; employment_insurance_number: string | null;
  photo_url: string | null; resigned_at: string | null; pin: string | null;
  skills: string | null; my_number: string | null; store_name?: string;
}
interface DepRow { id: string; name: string; name_kana: string | null; birth_date: string | null; relationship: string | null; occupation: string | null; estimated_income: number | null; living_arrangement: string | null; insurance_card_requested: boolean; }
interface EmpDocRow { id: string; document_name: string; category: string; file_url: string; upload_date: string; uploader: string | null; memo: string | null; }

/* ── ユーティリティ ── */
function storeShort(name: string | null) {
  if (!name) return "—";
  if (name.includes("八代")) return "八代"; if (name.includes("健軍")) return "健軍";
  if (name.includes("大津") || name.includes("菊陽")) return "大津"; if (name.includes("本社")) return "本社";
  if (name.includes("経理") || name.includes("人事") || name.includes("DX")) return "業務部";
  if (name.includes("御領")) return "御領"; return name;
}

/* ── スタイル ── */
const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, boxSizing: "border-box", fontFamily: "inherit" };
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: "auto" as any };
const labelStyle: React.CSSProperties = { fontSize: 11, color: T.textSec, display: "block", marginBottom: 3 };
const sectionTitleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: T.primary, marginBottom: 10, marginTop: 16, paddingBottom: 6, borderBottom: `2px solid ${T.primary}20` };
const Field = ({ label, children, span }: { label: string; children: React.ReactNode; span?: number }) => (<div style={{ gridColumn: span ? `span ${span}` : undefined }}><label style={labelStyle}>{label}</label>{children}</div>);

/* ══════════════════════════════════════ */
/* ── 編集モーダル（新規・編集兼用）  ── */
/* ══════════════════════════════════════ */
const EditForm = ({ emp, stores, isNew, onClose, onSaved, companyId }: { emp: Partial<EmpRow> | null; stores: { id: string; name: string }[]; isNew: boolean; onClose: () => void; onSaved: (msg: string) => void; companyId: string }) => {
  const initial: Record<string, any> = { store_id: "", employee_code: "", full_name: "", full_name_kana: "", email: "", phone: "", gender: "", birth_date: "", hire_date: new Date().toISOString().slice(0, 10), employment_type: "正社員", position: "", department: "", grade: "", weekly_work_days: 5, weekly_work_hours: 40, paid_leave_grant_date: "", work_pattern_code: "09:30-18:00", holiday_pattern: "正社員A", holiday_calendar: "営業フロント", role: "一般", requires_punch: true, postal_code: "", address: "", emergency_contact_name: "", emergency_contact_phone: "", emergency_contact_relation: "", bank_name: "", bank_branch: "", bank_account_type: "普通", bank_account_number: "", bank_account_holder: "", basic_pension_number: "", employment_insurance_number: "", pin: "1234", skills: "", my_number: "", insurance_card_requested: false };
  if (!isNew && emp) { Object.keys(initial).forEach(k => { const v = (emp as any)[k]; if (v != null) initial[k] = v; }); }
  const [form, setForm] = useState<Record<string, any>>(initial);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(emp?.photo_url || null);
  const set = (key: string, val: any) => setForm(prev => ({ ...prev, [key]: val }));
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; setPhotoFile(f); const reader = new FileReader(); reader.onload = () => setPhotoPreview(reader.result as string); reader.readAsDataURL(f); };

  const handleSave = async () => {
    if (!form.full_name?.trim()) { onSaved("氏名を入力してください"); return; }
    if (!form.employee_code?.trim()) { onSaved("社員コードを入力してください"); return; }
    if (!form.store_id) { onSaved("所属店舗を選択してください"); return; }
    if (!form.hire_date) { onSaved("入社日を入力してください"); return; }
    setSaving(true);
    let photoUrl = emp?.photo_url || null;
    if (photoFile) {
      const ext = photoFile.name.split(".").pop() || "jpg";
      const fileName = `emp_${form.employee_code}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("change-requests").upload(`employee-photos/${fileName}`, photoFile);
      if (upErr) { setSaving(false); onSaved("写真アップロード失敗: " + upErr.message); return; }
      const { data: urlData } = supabase.storage.from("change-requests").getPublicUrl(`employee-photos/${fileName}`);
      photoUrl = urlData?.publicUrl || null;
    }
    const payload: Record<string, any> = {
      company_id: companyId, store_id: form.store_id, employee_code: form.employee_code.trim(), full_name: form.full_name.trim(),
      full_name_kana: form.full_name_kana?.trim() || null, email: form.email?.trim() || null, phone: form.phone?.trim() || null,
      gender: form.gender || null, birth_date: form.birth_date || null, hire_date: form.hire_date, employment_type: form.employment_type,
      position: form.position?.trim() || null, department: form.department?.trim() || null, grade: form.grade?.trim() || null,
      weekly_work_days: form.weekly_work_days ? Number(form.weekly_work_days) : null, weekly_work_hours: form.weekly_work_hours ? Number(form.weekly_work_hours) : null,
      paid_leave_grant_date: form.paid_leave_grant_date || null, work_pattern_code: form.work_pattern_code || null,
      holiday_pattern: form.holiday_pattern || null, holiday_calendar: form.holiday_calendar || null, role: form.role, requires_punch: form.requires_punch,
      postal_code: form.postal_code?.trim() || null, address: form.address?.trim() || null,
      emergency_contact_name: form.emergency_contact_name?.trim() || null, emergency_contact_phone: form.emergency_contact_phone?.trim() || null, emergency_contact_relation: form.emergency_contact_relation?.trim() || null,
      bank_name: form.bank_name?.trim() || null, bank_branch: form.bank_branch?.trim() || null, bank_account_type: form.bank_account_type || null,
      bank_account_number: form.bank_account_number?.trim() || null, bank_account_holder: form.bank_account_holder?.trim() || null,
      basic_pension_number: form.basic_pension_number?.trim() || null, employment_insurance_number: form.employment_insurance_number?.trim() || null,
      pin: form.pin?.trim() || "1234", skills: form.skills?.trim() || null, my_number: form.my_number?.trim() || null, insurance_card_requested: form.insurance_card_requested || false, photo_url: photoUrl, updated_at: new Date().toISOString(),
    };
    if (isNew) { const { error } = await supabase.from("employees").insert(payload); setSaving(false); if (error) { onSaved("登録失敗: " + error.message); return; } onSaved("新規登録しました"); }
    else { const { error } = await supabase.from("employees").update(payload).eq("id", emp!.id); setSaving(false); if (error) { onSaved("更新失敗: " + error.message); return; } onSaved("更新しました"); }
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1100, animation: "fadeIn 0.15s ease" }} onClick={onClose}>
      <div style={{ backgroundColor: "#fff", borderRadius: "12px 12px 0 0", padding: "20px", width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", animation: "slideUp 0.3s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border, margin: "0 auto 12px" }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 16 }}>{isNew ? "新規従業員登録" : `${emp?.full_name} — 情報編集`}</div>
        {/* 写真 */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", backgroundColor: T.bg, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
            {photoPreview ? <img src={photoPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 24, color: T.textMuted }}>👤</span>}
          </div>
          <div><label style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${T.primary}`, backgroundColor: "#fff", color: T.primary, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-block" }}>写真を選択<input type="file" accept="image/*" onChange={handlePhotoChange} style={{ display: "none" }} /></label><div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>JPG/PNG推奨</div></div>
        </div>
        <div style={sectionTitleStyle}>基本情報</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="社員コード *"><input type="text" value={form.employee_code} onChange={e => set("employee_code", e.target.value)} placeholder="067" style={inputStyle} /></Field><Field label="所属店舗 *"><select value={form.store_id} onChange={e => set("store_id", e.target.value)} style={selectStyle}><option value="">選択してください</option>{stores.map(s => <option key={s.id} value={s.id}>{storeShort(s.name)}</option>)}</select></Field></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="氏名 *"><input type="text" value={form.full_name} onChange={e => set("full_name", e.target.value)} placeholder="池邉 遊貴" style={inputStyle} /></Field><Field label="フリガナ"><input type="text" value={form.full_name_kana} onChange={e => set("full_name_kana", e.target.value)} placeholder="イケベ ユキ" style={inputStyle} /></Field></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="性別"><select value={form.gender} onChange={e => set("gender", e.target.value)} style={selectStyle}><option value="">未設定</option>{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}</select></Field><Field label="生年月日"><input type="date" value={form.birth_date} onChange={e => set("birth_date", e.target.value)} style={inputStyle} /></Field></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="電話番号"><input type="tel" value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="090-1234-5678" style={inputStyle} /></Field><Field label="メール"><input type="email" value={form.email} onChange={e => set("email", e.target.value)} style={inputStyle} /></Field></div>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, marginBottom: 8 }}><Field label="郵便番号"><input type="text" value={form.postal_code} onChange={e => set("postal_code", e.target.value)} placeholder="860-0000" style={inputStyle} /></Field><Field label="住所"><input type="text" value={form.address} onChange={e => set("address", e.target.value)} placeholder="熊本県熊本市..." style={inputStyle} /></Field></div>
        <div style={sectionTitleStyle}>勤務設定</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="雇用区分 *"><select value={form.employment_type} onChange={e => set("employment_type", e.target.value)} style={selectStyle}>{EMPLOYMENT_TYPES.map(v => <option key={v} value={v}>{v}</option>)}</select></Field><Field label="管理者権限"><select value={form.role} onChange={e => set("role", e.target.value)} style={selectStyle}>{ROLES.map(v => <option key={v} value={v}>{v}</option>)}</select></Field></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="部署"><input type="text" value={form.department} onChange={e => set("department", e.target.value)} placeholder="営業部" style={inputStyle} /></Field><Field label="役職"><input type="text" value={form.position} onChange={e => set("position", e.target.value)} placeholder="店長" style={inputStyle} /></Field></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="等級"><input type="text" value={form.grade} onChange={e => set("grade", e.target.value)} style={inputStyle} /></Field><Field label="入社日 *"><input type="date" value={form.hire_date} onChange={e => set("hire_date", e.target.value)} style={inputStyle} /></Field></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="勤務パターン"><select value={form.work_pattern_code} onChange={e => set("work_pattern_code", e.target.value)} style={selectStyle}><option value="">未設定</option>{WORK_PATTERNS.map(v => <option key={v} value={v}>{v}</option>)}</select></Field><Field label="休日カレンダー"><select value={form.holiday_calendar} onChange={e => set("holiday_calendar", e.target.value)} style={selectStyle}><option value="">未設定</option>{HOLIDAY_CALENDARS.map(v => <option key={v} value={v}>{v}</option>)}</select></Field></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="希望休パターン"><select value={form.holiday_pattern} onChange={e => set("holiday_pattern", e.target.value)} style={selectStyle}><option value="">未設定</option>{HOLIDAY_PATTERNS.map(v => <option key={v} value={v}>{v}</option>)}</select></Field><Field label="有給発生日"><input type="date" value={form.paid_leave_grant_date} onChange={e => set("paid_leave_grant_date", e.target.value)} style={inputStyle} /></Field></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="週勤務日数"><input type="number" value={form.weekly_work_days} onChange={e => set("weekly_work_days", e.target.value)} min={1} max={7} style={inputStyle} /></Field><Field label="週勤務時間"><input type="number" value={form.weekly_work_hours} onChange={e => set("weekly_work_hours", e.target.value)} step={0.5} style={inputStyle} /></Field><Field label="打刻要否"><select value={form.requires_punch ? "true" : "false"} onChange={e => set("requires_punch", e.target.value === "true")} style={selectStyle}><option value="true">必要</option><option value="false">不要</option></select></Field></div>
        <div style={sectionTitleStyle}>保有資格</div>
        <Field label="保有資格（自由記入）"><textarea value={form.skills} onChange={e => set("skills", e.target.value)} placeholder="自動車整備士2級、損保募集人資格 など" rows={2} style={{ ...inputStyle, resize: "vertical" }} /></Field>
        <div style={sectionTitleStyle}>緊急連絡先</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="氏名"><input type="text" value={form.emergency_contact_name} onChange={e => set("emergency_contact_name", e.target.value)} style={inputStyle} /></Field><Field label="電話番号"><input type="tel" value={form.emergency_contact_phone} onChange={e => set("emergency_contact_phone", e.target.value)} style={inputStyle} /></Field><Field label="続柄"><input type="text" value={form.emergency_contact_relation} onChange={e => set("emergency_contact_relation", e.target.value)} placeholder="母" style={inputStyle} /></Field></div>
        <div style={sectionTitleStyle}>銀行口座</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="銀行名"><input type="text" value={form.bank_name} onChange={e => set("bank_name", e.target.value)} placeholder="肥後銀行" style={inputStyle} /></Field><Field label="支店名"><input type="text" value={form.bank_branch} onChange={e => set("bank_branch", e.target.value)} placeholder="大津支店" style={inputStyle} /></Field></div>
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="口座種別"><select value={form.bank_account_type} onChange={e => set("bank_account_type", e.target.value)} style={selectStyle}>{BANK_TYPES.map(v => <option key={v} value={v}>{v}</option>)}</select></Field><Field label="口座番号"><input type="text" value={form.bank_account_number} onChange={e => set("bank_account_number", e.target.value)} style={inputStyle} /></Field><Field label="口座名義"><input type="text" value={form.bank_account_holder} onChange={e => set("bank_account_holder", e.target.value)} placeholder="イケベ ユキ" style={inputStyle} /></Field></div>
        <div style={sectionTitleStyle}>社会保険</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="基礎年金番号"><input type="text" value={form.basic_pension_number} onChange={e => set("basic_pension_number", e.target.value)} style={inputStyle} /></Field><Field label="雇用保険番号"><input type="text" value={form.employment_insurance_number} onChange={e => set("employment_insurance_number", e.target.value)} style={inputStyle} /></Field><Field label="マイナンバー"><input type="text" value={form.my_number} onChange={e => set("my_number", e.target.value)} placeholder="12桁" maxLength={12} style={inputStyle} /></Field></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="資格確認書"><select value={form.insurance_card_requested ? "true" : "false"} onChange={e => set("insurance_card_requested", e.target.value === "true")} style={selectStyle}><option value="false">不要</option><option value="true">希望</option></select></Field><div /><div /></div>
        <div style={sectionTitleStyle}>認証</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}><Field label="PINコード"><input type="text" value={form.pin} onChange={e => set("pin", e.target.value)} placeholder="1234" maxLength={6} style={inputStyle} /></Field><div /></div>
        <div style={{ display: "flex", gap: 10, marginTop: 8, paddingBottom: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.textSec, fontSize: 14, cursor: "pointer" }}>キャンセル</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: "12px", borderRadius: 6, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 14, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "保存中..." : isNew ? "登録" : "更新"}</button>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════ */
/* ── 退職処理モーダル ── */
/* ══════════════════════════════════════ */
const ResignModal = ({ emp, onClose, onSaved }: { emp: EmpRow; onClose: () => void; onSaved: (msg: string) => void }) => {
  const [resignDate, setResignDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const handleResign = async () => {
    setSaving(true);
    const { error } = await supabase.from("employees").update({ is_active: false, resigned_at: resignDate, updated_at: new Date().toISOString() }).eq("id", emp.id);
    setSaving(false);
    if (error) { onSaved("退職処理に失敗しました: " + error.message); return; }
    onSaved(`${emp.full_name}さんの退職処理が完了しました`); onClose();
  };
  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200, animation: "fadeIn 0.15s ease" }} onClick={onClose}>
      <div style={{ backgroundColor: "#fff", borderRadius: 12, padding: 24, width: "100%", maxWidth: 380, animation: "slideUp 0.3s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.danger, marginBottom: 12 }}>退職処理</div>
        <div style={{ fontSize: 13, color: T.text, marginBottom: 16 }}><strong>{emp.full_name}</strong>（{emp.employee_code}）を退職処理します。</div>
        <div style={{ marginBottom: 16 }}><label style={labelStyle}>退職日</label><input type="date" value={resignDate} onChange={e => setResignDate(e.target.value)} style={inputStyle} /></div>
        <div style={{ fontSize: 11, color: T.warning, padding: "8px 10px", backgroundColor: "#FFFDE7", borderRadius: 6, marginBottom: 16 }}>⚠ 退職処理後はログインできなくなります。</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.textSec, fontSize: 14, cursor: "pointer" }}>キャンセル</button>
          <button onClick={handleResign} disabled={saving} style={{ flex: 1, padding: "12px", borderRadius: 6, border: "none", backgroundColor: T.danger, color: "#fff", fontSize: 14, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "処理中..." : "退職処理を実行"}</button>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════ */
/* ── 扶養家族パネル ── */
/* ══════════════════════════════════════ */
const DependentsPanel = ({ empId, companyId, onMsg }: { empId: string; companyId: string; onMsg: (m: string) => void }) => {
  const [deps, setDeps] = useState<DepRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editDep, setEditDep] = useState<DepRow | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("dependents").select("id, name, name_kana, birth_date, relationship, occupation, estimated_income, living_arrangement, insurance_card_requested, my_number").eq("employee_id", empId).order("created_at");
    setDeps(data || []); setLoading(false);
  }, [empId]);
  useEffect(() => { fetch(); }, [fetch]);

  const openNew = () => { setEditDep(null); setForm({ name: "", name_kana: "", birth_date: "", relationship: "", occupation: "", estimated_income: "", living_arrangement: "", insurance_card_requested: false, my_number: "" }); setShowForm(true); };
  const openEdit = (d: DepRow) => { setEditDep(d); setForm({ name: d.name, name_kana: d.name_kana || "", birth_date: d.birth_date || "", relationship: d.relationship || "", occupation: d.occupation || "", estimated_income: d.estimated_income ?? "", living_arrangement: d.living_arrangement || "", insurance_card_requested: d.insurance_card_requested, my_number: (d as any).my_number || "" }); setShowForm(true); };
  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (!form.name?.trim()) { onMsg("扶養者氏名を入力してください"); return; }
    const payload = { company_id: companyId, employee_id: empId, name: form.name.trim(), name_kana: form.name_kana?.trim() || null, birth_date: form.birth_date || null, relationship: form.relationship?.trim() || null, occupation: form.occupation?.trim() || null, estimated_income: form.estimated_income ? Number(form.estimated_income) : null, living_arrangement: form.living_arrangement?.trim() || null, insurance_card_requested: form.insurance_card_requested || false, my_number: form.my_number?.trim() || null, updated_at: new Date().toISOString() };
    if (editDep) { const { error } = await supabase.from("dependents").update(payload).eq("id", editDep.id); if (error) { onMsg("更新失敗"); return; } }
    else { const { error } = await supabase.from("dependents").insert(payload); if (error) { onMsg("登録失敗: " + error.message); return; } }
    setShowForm(false); fetch(); onMsg(editDep ? "更新しました" : "追加しました");
  };
  const handleDelete = async (d: DepRow) => { if (!confirm(`${d.name}を削除しますか？`)) return; await supabase.from("dependents").delete().eq("id", d.id); fetch(); onMsg("削除しました"); };

  if (loading) return <div style={{ padding: 20, textAlign: "center", color: T.textMuted, fontSize: 13 }}>読み込み中...</div>;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>扶養家族（{deps.length}名）</div>
        <button onClick={openNew} style={{ padding: "6px 14px", borderRadius: 6, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>＋ 追加</button>
      </div>
      {deps.length === 0 && !showForm && <div style={{ textAlign: "center", padding: "30px 20px", color: T.textMuted, fontSize: 13 }}>扶養家族の登録はありません</div>}
      {deps.map(d => (
        <div key={d.id} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 14, marginBottom: 8, backgroundColor: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div><span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{d.name}</span>{d.name_kana && <span style={{ fontSize: 11, color: T.textMuted, marginLeft: 6 }}>{d.name_kana}</span>}</div>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => openEdit(d)} style={{ padding: "4px 10px", borderRadius: 4, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>編集</button>
              <button onClick={() => handleDelete(d)} style={{ padding: "4px 8px", borderRadius: 4, border: `1px solid ${T.danger}`, backgroundColor: "#fff", color: T.danger, fontSize: 11, cursor: "pointer" }}>削除</button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 12, color: T.textSec }}>
            <div>続柄: {d.relationship || "—"}</div><div>生年月日: {d.birth_date || "—"}</div><div>職業: {d.occupation || "—"}</div>
            <div>年収見込: {d.estimated_income != null ? `${d.estimated_income}万円` : "—"}</div><div>居住: {d.living_arrangement || "—"}</div><div>資格確認書: {d.insurance_card_requested ? "希望" : "不要"}</div>
          </div>
        </div>
      ))}
      {showForm && (
        <div style={{ border: `1px solid ${T.primary}40`, borderRadius: 8, padding: 16, marginTop: 8, backgroundColor: "#FAFCFF" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10 }}>{editDep ? "扶養家族を編集" : "扶養家族を追加"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="氏名 *"><input type="text" value={form.name} onChange={e => set("name", e.target.value)} style={inputStyle} /></Field><Field label="フリガナ"><input type="text" value={form.name_kana} onChange={e => set("name_kana", e.target.value)} style={inputStyle} /></Field></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="生年月日"><input type="date" value={form.birth_date} onChange={e => set("birth_date", e.target.value)} style={inputStyle} /></Field><Field label="続柄"><input type="text" value={form.relationship} onChange={e => set("relationship", e.target.value)} placeholder="配偶者" style={inputStyle} /></Field><Field label="職業・学年"><input type="text" value={form.occupation} onChange={e => set("occupation", e.target.value)} placeholder="会社員" style={inputStyle} /></Field></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}><Field label="見込み年収（万円）"><input type="number" value={form.estimated_income} onChange={e => set("estimated_income", e.target.value)} style={inputStyle} /></Field><Field label="居住形態"><input type="text" value={form.living_arrangement} onChange={e => set("living_arrangement", e.target.value)} placeholder="同居" style={inputStyle} /></Field><Field label="資格確認書"><select value={form.insurance_card_requested ? "true" : "false"} onChange={e => set("insurance_card_requested", e.target.value === "true")} style={selectStyle}><option value="false">不要</option><option value="true">希望</option></select></Field></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginBottom: 10 }}><Field label="マイナンバー"><input type="text" value={form.my_number} onChange={e => set("my_number", e.target.value)} placeholder="12桁" maxLength={12} style={inputStyle} /></Field></div>
          <div style={{ display: "flex", gap: 8 }}><button onClick={() => setShowForm(false)} style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: "#fff", color: T.textSec, fontSize: 12, cursor: "pointer" }}>キャンセル</button><button onClick={handleSave} style={{ padding: "8px 16px", borderRadius: 6, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{editDep ? "更新" : "追加"}</button></div>
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════ */
/* ── 個人書類パネル ── */
/* ══════════════════════════════════════ */
const EmpDocsPanel = ({ empId, companyId, uploaderName, onMsg }: { empId: string; companyId: string; uploaderName: string; onMsg: (m: string) => void }) => {
  const [docs, setDocs] = useState<EmpDocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [docName, setDocName] = useState("");
  const [docCategory, setDocCategory] = useState<string>("その他");
  const [docMemo, setDocMemo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("employee_documents").select("id, document_name, category, file_url, upload_date, uploader, memo").eq("employee_id", empId).order("upload_date", { ascending: false });
    setDocs(data || []); setLoading(false);
  }, [empId]);
  useEffect(() => { fetch(); }, [fetch]);

  const handleUpload = async () => {
    if (!docName.trim()) { onMsg("書類名を入力してください"); return; }
    if (!file) { onMsg("ファイルを選択してください"); return; }
    setUploading(true);
    const ext = file.name.split(".").pop() || "pdf";
    const fileName = `empdoc_${empId.slice(0, 8)}_${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("change-requests").upload(`employee-documents/${fileName}`, file);
    if (upErr) { setUploading(false); onMsg("アップロード失敗: " + upErr.message); return; }
    const { data: urlData } = supabase.storage.from("change-requests").getPublicUrl(`employee-documents/${fileName}`);
    const { error } = await supabase.from("employee_documents").insert({ company_id: companyId, employee_id: empId, document_name: docName.trim(), category: docCategory, file_url: urlData?.publicUrl || "", uploader: uploaderName, memo: docMemo.trim() || null });
    setUploading(false);
    if (error) { onMsg("登録失敗: " + error.message); return; }
    setShowForm(false); setDocName(""); setFile(null); setDocMemo(""); fetch(); onMsg("書類を登録しました");
  };
  const handleDelete = async (d: EmpDocRow) => { if (!confirm(`「${d.document_name}」を削除しますか？`)) return; await supabase.from("employee_documents").delete().eq("id", d.id); fetch(); onMsg("削除しました"); };
  const fmtDate = (d: string) => { const dt = new Date(d); return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`; };

  if (loading) return <div style={{ padding: 20, textAlign: "center", color: T.textMuted, fontSize: 13 }}>読み込み中...</div>;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>個人書類（{docs.length}件）</div>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{showForm ? "✕ 閉じる" : "＋ アップロード"}</button>
      </div>
      {showForm && (
        <div style={{ border: `1px solid ${T.primary}40`, borderRadius: 8, padding: 16, marginBottom: 12, backgroundColor: "#FAFCFF" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}><Field label="書類名 *"><input type="text" value={docName} onChange={e => setDocName(e.target.value)} placeholder="運転免許証" style={inputStyle} /></Field><Field label="カテゴリ"><select value={docCategory} onChange={e => setDocCategory(e.target.value)} style={selectStyle}>{DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></Field></div>
          <div style={{ marginBottom: 8 }}><Field label="メモ"><input type="text" value={docMemo} onChange={e => setDocMemo(e.target.value)} placeholder="有効期限: 2028/01/15" style={inputStyle} /></Field></div>
          <div style={{ marginBottom: 10 }}><label style={labelStyle}>ファイル *</label><input type="file" ref={fileRef} accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files?.[0] || null)} style={{ fontSize: 13 }} /></div>
          <button onClick={handleUpload} disabled={uploading} style={{ padding: "8px 20px", borderRadius: 6, border: "none", backgroundColor: T.success, color: "#fff", fontSize: 12, fontWeight: 600, cursor: uploading ? "default" : "pointer", opacity: uploading ? 0.6 : 1 }}>{uploading ? "アップロード中..." : "登録"}</button>
        </div>
      )}
      {docs.length === 0 && !showForm && <div style={{ textAlign: "center", padding: "30px 20px", color: T.textMuted, fontSize: 13 }}>書類の登録はありません</div>}
      {docs.map(d => (
        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${T.borderLight}`, borderRadius: 6, marginBottom: 6, backgroundColor: "#fff" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{d.document_name}</div>
            <div style={{ fontSize: 11, color: T.textSec }}>{d.category} ・ {fmtDate(d.upload_date)}{d.memo && ` ・ ${d.memo}`}</div>
          </div>
          <a href={d.file_url} target="_blank" rel="noopener noreferrer" style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.primary}`, backgroundColor: "#fff", color: T.primary, fontSize: 11, fontWeight: 600, textDecoration: "none", cursor: "pointer" }}>開く</a>
          <button onClick={() => handleDelete(d)} style={{ padding: "4px 8px", borderRadius: 4, border: `1px solid ${T.danger}`, backgroundColor: "#fff", color: T.danger, fontSize: 11, cursor: "pointer" }}>削除</button>
        </div>
      ))}
    </div>
  );
};

/* ══════════════════════════════════════ */
/* ── 従業員詳細モーダル ── */
/* ══════════════════════════════════════ */
const EmpDetailModal = ({ emp, companyId, uploaderName, onClose, onMsg }: { emp: EmpRow; companyId: string; uploaderName: string; onClose: () => void; onMsg: (m: string) => void }) => {
  const [tab, setTab] = useState<"dependents" | "documents" | "nyusha">("dependents");
  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1100, animation: "fadeIn 0.15s ease" }} onClick={onClose}>
      <div style={{ backgroundColor: "#fff", borderRadius: "12px 12px 0 0", padding: "20px", width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto", animation: "slideUp 0.3s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border, margin: "0 auto 12px" }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>{emp.full_name}（{emp.employee_code}）</div>
        <div style={{ fontSize: 12, color: T.textSec, marginBottom: 16 }}>{storeShort(emp.store_name || null)} ・ {emp.department || "—"}</div>
        <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: `1px solid ${T.border}` }}>
          {(["dependents", "documents", "nyusha"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 16px", border: "none", backgroundColor: "transparent", cursor: "pointer", fontSize: 13, fontWeight: tab === t ? 700 : 400, color: tab === t ? T.primary : T.textSec, borderBottom: tab === t ? `3px solid ${T.primary}` : "3px solid transparent" }}>{t === "dependents" ? "扶養家族" : t === "documents" ? "個人書類" : "入社シート"}</button>
          ))}
        </div>
        {tab === "dependents" && <DependentsPanel empId={emp.id} companyId={companyId} onMsg={onMsg} />}
        {tab === "documents" && <EmpDocsPanel empId={emp.id} companyId={companyId} uploaderName={uploaderName} onMsg={onMsg} />}
        {tab === "nyusha" && <NyushaSheetExport empId={emp.id} empCode={emp.employee_code} empName={emp.full_name} companyId={companyId} />}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════ */
/* ── メインコンポーネント ── */
/* ══════════════════════════════════════ */
export default function EmployeeManageSub({ employee }: { employee: any }) {
  const [emps, setEmps] = useState<EmpRow[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState("all");
  const [editEmp, setEditEmp] = useState<EmpRow | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [resignEmp, setResignEmp] = useState<EmpRow | null>(null);
  const [detailEmp, setDetailEmp] = useState<EmpRow | null>(null);
  const [dialogMsg, setDialogMsg] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!employee?.company_id) return;
    setLoading(true);
    const { data: sd } = await supabase.from("stores").select("id, store_name").eq("company_id", employee.company_id);
    const storeList = (sd || []).map((s: any) => ({ id: s.id, name: s.store_name || "" }));
    setStores(storeList);
    const storeMap: Record<string, string> = {};
    storeList.forEach((s: { id: string; name: string }) => { storeMap[s.id] = s.name; });
    const { data: ed } = await supabase.from("employees")
      .select("id, company_id, store_id, employee_code, full_name, full_name_kana, email, phone, gender, birth_date, hire_date, employment_type, position, department, grade, weekly_work_days, weekly_work_hours, paid_leave_grant_date, work_pattern_code, holiday_pattern, holiday_calendar, role, requires_punch, is_active, postal_code, address, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, bank_name, bank_branch, bank_account_type, bank_account_number, bank_account_holder, basic_pension_number, employment_insurance_number, photo_url, resigned_at, pin, skills, my_number, insurance_card_requested")
      .eq("company_id", employee.company_id).order("employee_code");
    setEmps((ed || []).map((e: any) => ({ ...e, store_name: storeMap[e.store_id] || "" })));
    setLoading(false);
  }, [employee?.company_id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let list = emps;
    if (!showInactive) list = list.filter(e => e.is_active !== false); else list = list.filter(e => e.is_active === false);
    list = list.filter(e => !["W02","W49","W67"].includes(e.employee_code));
    if (storeFilter !== "all") list = list.filter(e => e.store_id === storeFilter);
    if (search) { const q = search.toLowerCase(); list = list.filter(e => e.full_name.toLowerCase().includes(q) || e.employee_code.includes(q) || (e.full_name_kana || "").toLowerCase().includes(q)); }
    return list;
  }, [emps, showInactive, storeFilter, search]);

  const activeCount = emps.filter(e => e.is_active !== false).length;
  const inactiveCount = emps.filter(e => e.is_active === false).length;
  const handleSaved = (msg: string) => { setDialogMsg(msg); fetchData(); };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => { setIsNew(true); setEditEmp({} as any); }} style={{ padding: "9px 16px", borderRadius: 6, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 新規登録</button>
        <input type="text" placeholder="名前/CD/カナで検索" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, padding: "9px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, minWidth: 140 }} />
        <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} style={{ padding: "9px 12px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12, color: T.textSec }}><option value="all">全店舗</option>{stores.map(s => <option key={s.id} value={s.id}>{storeShort(s.name)}</option>)}</select>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setShowInactive(false)} style={{ padding: "8px 12px", borderRadius: 6, fontSize: 12, fontWeight: !showInactive ? 700 : 400, cursor: "pointer", border: !showInactive ? `2px solid ${T.primary}` : `1px solid ${T.border}`, backgroundColor: !showInactive ? T.primary + "15" : "#fff", color: !showInactive ? T.primary : T.textSec }}>在籍 ({activeCount})</button>
          <button onClick={() => setShowInactive(true)} style={{ padding: "8px 12px", borderRadius: 6, fontSize: 12, fontWeight: showInactive ? 700 : 400, cursor: "pointer", border: showInactive ? `2px solid ${T.danger}` : `1px solid ${T.border}`, backgroundColor: showInactive ? T.danger + "15" : "#fff", color: showInactive ? T.danger : T.textSec }}>退職 ({inactiveCount})</button>
        </div>
      </div>
      {loading ? <div style={{ textAlign: "center", padding: "40px", color: T.textMuted, fontSize: 14 }}>読み込み中...</div>
      : filtered.length === 0 ? <div style={{ textAlign: "center", padding: "60px 20px", color: T.textMuted }}><div style={{ fontSize: 24, marginBottom: 8 }}>👤</div><div style={{ fontSize: 14 }}>{showInactive ? "退職者はいません" : "該当する従業員はいません"}</div></div>
      : (
        <div style={{ borderRadius: 6, border: `1px solid ${T.border}`, overflow: "hidden" }}><div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 860 }}>
            <thead><tr style={{ backgroundColor: T.primary }}>{["CD","氏名","店舗","雇用区分","部署","権限","勤務","カレンダー","希望休","入社日","",""].map(h => <th key={h} style={{ padding: "8px 6px", color: "#fff", fontWeight: 600, fontSize: 11, textAlign: "center", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>{filtered.map(emp => (
              <tr key={emp.id} style={{ borderBottom: `1px solid ${T.borderLight}`, backgroundColor: emp.is_active === false ? "#FFF5F5" : "#fff" }}>
                <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 11, color: T.textMuted, fontVariantNumeric: "tabular-nums" }}>{emp.employee_code}</td>
                <td style={{ padding: "8px 6px", fontWeight: 600, color: T.text, whiteSpace: "nowrap" }}><div style={{ display: "flex", alignItems: "center", gap: 6 }}>{emp.photo_url ? <img src={emp.photo_url} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} /> : <div style={{ width: 24, height: 24, borderRadius: "50%", backgroundColor: T.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: T.textMuted, flexShrink: 0 }}>👤</div>}{emp.full_name}</div></td>
                <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 11, color: T.textSec }}>{storeShort(emp.store_name || null)}</td>
                <td style={{ padding: "8px 6px", textAlign: "center" }}><span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, backgroundColor: emp.employment_type === "正社員" ? T.primary + "15" : emp.employment_type === "パート" ? T.kibouYellow + "20" : T.kinmuGreen + "15", color: emp.employment_type === "正社員" ? T.primary : emp.employment_type === "パート" ? T.warning : T.kinmuGreen }}>{emp.employment_type}</span></td>
                <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 11, color: T.textSec }}>{emp.department || "—"}</td>
                <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: emp.role !== "一般" ? T.primary : T.textMuted }}>{emp.role === "一般" ? "—" : emp.role}</td>
                <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 11, color: T.textSec, fontVariantNumeric: "tabular-nums" }}>{emp.work_pattern_code || "—"}</td>
                <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: T.textSec }}>{emp.holiday_calendar || "—"}</td>
                <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: T.textSec }}>{emp.holiday_pattern || "—"}</td>
                <td style={{ padding: "8px 6px", textAlign: "center", fontSize: 11, color: T.textMuted }}>{emp.hire_date}</td>
                <td style={{ padding: "6px", textAlign: "center" }}><button onClick={() => setDetailEmp(emp)} style={{ padding: "5px 8px", borderRadius: 4, border: `1px solid ${T.gold}`, backgroundColor: T.goldLight, color: "#78350F", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>詳細</button></td>
                <td style={{ padding: "6px", textAlign: "center", whiteSpace: "nowrap" }}>
                  <button onClick={() => { setIsNew(false); setEditEmp(emp); }} style={{ padding: "5px 10px", borderRadius: 4, border: "none", backgroundColor: T.primary, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", marginRight: 4 }}>編集</button>
                  {emp.is_active !== false && <button onClick={() => setResignEmp(emp)} style={{ padding: "5px 8px", borderRadius: 4, border: `1px solid ${T.danger}`, backgroundColor: "#fff", color: T.danger, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>退職</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div></div>
      )}
      {editEmp && <EditForm emp={isNew ? null : editEmp} stores={stores} isNew={isNew} onClose={() => { setEditEmp(null); setIsNew(false); }} onSaved={handleSaved} companyId={employee.company_id} />}
      {resignEmp && <ResignModal emp={resignEmp} onClose={() => setResignEmp(null)} onSaved={handleSaved} />}
      {detailEmp && <EmpDetailModal emp={detailEmp} companyId={employee.company_id} uploaderName={employee.full_name || ""} onClose={() => setDetailEmp(null)} onMsg={setDialogMsg} />}
      {dialogMsg && <Dialog message={dialogMsg} onOk={() => setDialogMsg(null)} />}
      <style>{`@keyframes slideUp{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
    </div>
  );
}