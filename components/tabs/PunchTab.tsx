'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { T, DOW } from '@/lib/constants'
import { ReasonBadges } from '@/components/ui'
import Dialog from '@/components/ui/Dialog'

// ─── 型 ──────────────────────────────────────────────────────────────────────

type PunchStatus = 'unset' | 'in' | 'both'

interface TodayRecord {
  id: string | null
  punch_in: string | null
  punch_out: string | null
  reason: string | null
}

interface DialogState {
  message: string
  mode: 'alert' | 'confirm'
  confirmLabel?: string
  confirmColor?: string
  onOk: () => void
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function toHHMMSS(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function toLocalISO(date: Date): string {
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`
}

function roundPunchIn(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes()
  if (h < 9 || (h === 9 && m < 30)) return '09:30'
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function roundPunchOut(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function getPunchStatus(record: TodayRecord | null): PunchStatus {
  if (!record) return 'unset'
  if (record.punch_in && record.punch_out) return 'both'
  if (record.punch_in) return 'in'
  return 'unset'
}

function parseDaikyu(reason: string): { type: 'full' | 'am' | 'pm'; date: string } | null {
  const mFull = reason.match(/^代休(?:（(\d{4}\/\d{2}\/\d{2})分）)?$/)
  if (mFull) return { type: 'full', date: mFull[1]?.replace(/\//g, '-') ?? '' }
  const mAm = reason.match(/^午前代休(?:（(\d{4}\/\d{2}\/\d{2})分）)?$/)
  if (mAm) return { type: 'am', date: mAm[1]?.replace(/\//g, '-') ?? '' }
  const mPm = reason.match(/^午後代休(?:（(\d{4}\/\d{2}\/\d{2})分）)?$/)
  if (mPm) return { type: 'pm', date: mPm[1]?.replace(/\//g, '-') ?? '' }
  return null
}

// ─── 小部品 ─────────────────────────────────────────────────────────────────

function Badge({ children, bg = T.primary, color = '#fff' }: { children: React.ReactNode; bg?: string; color?: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: '3px',
      fontSize: 11, fontWeight: 600, lineHeight: '18px',
      color, backgroundColor: bg, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: T.textSec }}>{label}</span>
    </div>
  )
}

const Chip = ({ label, selected, color, onClick }: { label: string; selected: boolean; color: string; onClick: () => void }) => (
  <button onClick={onClick} style={{
    padding: '10px 4px', borderRadius: '6px', fontSize: 12, fontWeight: selected ? 600 : 400, cursor: 'pointer',
    border: selected ? `2px solid ${color}` : `1px solid ${T.border}`,
    backgroundColor: selected ? color + '18' : '#fff',
    color: selected ? color : T.text, transition: 'all 0.15s', whiteSpace: 'nowrap',
  }}>{label}</button>
)

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: 10 }}>
    <label style={{ fontSize: 11, color: T.textSec, display: 'block', marginBottom: 3 }}>{label}</label>
    {children}
  </div>
)

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: '6px',
  border: `1px solid ${T.border}`, fontSize: 16, boxSizing: 'border-box',
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function PunchTab({ employee }: { employee: any }) {
  const [todayRecord, setTodayRecord] = useState<TodayRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [punching, setPunching] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [now, setNow] = useState(new Date())

  /* モーダル */
  const [modalOpen, setModalOpen] = useState(false)
  const [selZenjitsu, setSelZenjitsu] = useState<string | null>(null)
  const [selGozen, setSelGozen] = useState<string | null>(null)
  const [selGogo, setSelGogo] = useState<string | null>(null)
  const [selKinmu, setSelKinmu] = useState<string[]>([])
  const [memoNote, setMemoNote] = useState('')
  const [saving, setSaving] = useState(false)

  /* 出張ピッカー */
  const [shucchoOpen, setShucchoOpen] = useState(false)
  const [shucchoFrom, setShucchoFrom] = useState('')
  const [shucchoTo, setShucchoTo] = useState('')
  const [shucchoWhere, setShucchoWhere] = useState('')

  /* 代休ピッカー */
  const [daikyuMode, setDaikyuMode] = useState<'none' | 'full' | 'half'>('none')
  const [daikyuHalf, setDaikyuHalf] = useState<'am' | 'pm' | null>(null)
  const [daikyuDate, setDaikyuDate] = useState('')

  /* カスタムダイアログ */
  const [dialog, setDialog] = useState<DialogState | null>(null)

  const showAlert = (msg: string) => {
    setDialog({ message: msg, mode: 'alert', onOk: () => setDialog(null) })
  }
  const showConfirm = (msg: string, onOk: () => void, confirmLabel = 'OK', confirmColor: string = T.primary) => {
    setDialog({ message: msg, mode: 'confirm', confirmLabel, confirmColor, onOk: () => { setDialog(null); onOk() } })
  }

  // 毎秒更新
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (employee?.id) fetchTodayRecord(employee.id)
  }, [employee])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 3000)
    return () => clearTimeout(t)
  }, [message])

  // ─── 今日のレコード取得 ───────────────────────────────────────────────────

  const fetchTodayRecord = async (employeeId: string) => {
    setLoading(true)
    const today = toDateStr(new Date())

    const { data, error } = await supabase
      .from('attendance_daily')
      .select('id, punch_in, punch_out, reason')
      .eq('employee_id', employeeId)
      .eq('attendance_date', today)
      .maybeSingle()

    setLoading(false)

    if (error) {
      console.error('attendance_daily fetch error:', error)
      setTodayRecord(null)
      return
    }

    setTodayRecord(
      data
        ? {
            id: data.id,
            punch_in: data.punch_in ? data.punch_in.slice(0, 5) : null,
            punch_out: data.punch_out ? data.punch_out.slice(0, 5) : null,
            reason: data.reason ?? null,
          }
        : null
    )
  }

  // ─── 打刻処理 ─────────────────────────────────────────────────────────────

  const handlePunch = async (type: 'in' | 'out') => {
    if (!employee) return
    setPunching(true)
    setMessage(null)

    const d = new Date()
    const today = toDateStr(d)
    const rawTimestamp = toLocalISO(d)
    const rounded = type === 'in' ? roundPunchIn(d) : roundPunchOut(d)

    try {
      if (type === 'in') {
        if (todayRecord?.id) {
          const { error } = await supabase
            .from('attendance_daily')
            .update({ punch_in_raw: rawTimestamp, punch_in: rounded, updated_at: new Date().toISOString() })
            .eq('id', todayRecord.id)
          if (error) throw error
        } else {
          const { data: rec, error } = await supabase
            .from('attendance_daily')
            .insert({
              employee_id: employee.id,
              company_id: employee.company_id,
              attendance_date: today,
              day_of_week: DOW[d.getDay()],
              work_pattern_code: employee.work_pattern_code,
              punch_in_raw: rawTimestamp,
              punch_in: rounded,
              break_minutes: 60,
            })
            .select('id, punch_in, punch_out, reason')
            .maybeSingle()
          if (error) throw error
          if (!rec) throw new Error('insert succeeded but no data returned')
          setTodayRecord({ id: rec.id, punch_in: rounded, punch_out: null, reason: null })
          setMessage({ text: `出勤打刻しました　${rounded}`, ok: true })
          setPunching(false)
          return
        }
      } else {
        if (todayRecord?.id) {
          const { error } = await supabase
            .from('attendance_daily')
            .update({ punch_out_raw: rawTimestamp, punch_out: rounded, updated_at: new Date().toISOString() })
            .eq('id', todayRecord.id)
          if (error) throw error
        } else {
          const { data: rec, error } = await supabase
            .from('attendance_daily')
            .insert({
              employee_id: employee.id,
              company_id: employee.company_id,
              attendance_date: today,
              day_of_week: DOW[d.getDay()],
              work_pattern_code: employee.work_pattern_code,
              punch_out_raw: rawTimestamp,
              punch_out: rounded,
              break_minutes: 60,
            })
            .select('id, punch_in, punch_out, reason')
            .maybeSingle()
          if (error) throw error
          if (!rec) throw new Error('insert succeeded but no data returned')
          setTodayRecord({ id: rec.id, punch_in: null, punch_out: rounded, reason: null })
          setMessage({ text: `退勤打刻しました　${rounded}`, ok: true })
          setPunching(false)
          return
        }
      }
      await fetchTodayRecord(employee.id)
      setMessage({ text: type === 'in' ? `出勤打刻しました　${rounded}` : `退勤打刻しました　${rounded}`, ok: true })
    } catch (err) {
      console.error('Punch error:', err)
      setMessage({ text: '打刻に失敗しました。再度お試しください。', ok: false })
    } finally {
      setPunching(false)
    }
  }

  // ─── モーダル開く ─────────────────────────────────────────────────────────

  const openModal = (initialChip?: string) => {
    const todayStr = toDateStr(new Date())
    setSelZenjitsu(null); setSelGozen(null); setSelGogo(null); setSelKinmu([]); setMemoNote('')
    setShucchoOpen(false); setShucchoFrom(todayStr); setShucchoTo(todayStr); setShucchoWhere('')
    setDaikyuMode('none'); setDaikyuHalf(null); setDaikyuDate('')

    // 既存の事由がある場合は復元
    if (todayRecord?.reason) {
      const parts = todayRecord.reason.split('+').map((s: string) => s.trim())
      const kinmuBuf: string[] = []
      for (const p of parts) {
        if (p === '有給（全日）' || p === '希望休（全日）') { setSelZenjitsu(p); continue }
        if (p === '午前有給' || p === '午前希望休') { setSelGozen(p); continue }
        if (p === '午後有給' || p === '午後希望休') { setSelGogo(p); continue }
        const dk = parseDaikyu(p)
        if (dk) {
          if (dk.type === 'full') { setDaikyuMode('full'); setDaikyuDate(dk.date) }
          else { setDaikyuMode('half'); setDaikyuHalf(dk.type); setDaikyuDate(dk.date) }
          continue
        }
        if (p === '出張' || p.startsWith('出張（')) { setShucchoOpen(true); const wm = p.match(/出張（(.+)）/); if (wm) setShucchoWhere(wm[1]); kinmuBuf.push('出張'); continue }
        kinmuBuf.push(p)
      }
      setSelKinmu(kinmuBuf)
    } else if (initialChip) {
      // 押されたチップを初期選択
      const kyukaAll = ['有給（全日）', '希望休（全日）']
      const gozenList = ['午前有給', '午前希望休']
      const gogoList = ['午後有給', '午後希望休']
      if (kyukaAll.includes(initialChip)) setSelZenjitsu(initialChip)
      else if (gozenList.includes(initialChip)) setSelGozen(initialChip)
      else if (gogoList.includes(initialChip)) setSelGogo(initialChip)
      else if (initialChip === '出張') { setSelKinmu(['出張']); setShucchoOpen(true) }
      else if (initialChip === '代休') { setDaikyuMode('full') }
      else setSelKinmu([initialChip])
    }

    setModalOpen(true)
  }

  // ─── 排他制御 ─────────────────────────────────────────────────────────────

  const toggleZenjitsu = (v: string) => { if (selZenjitsu === v) { setSelZenjitsu(null); return } setSelZenjitsu(v); setSelGozen(null); setSelGogo(null); setDaikyuMode('none'); setDaikyuHalf(null); setDaikyuDate('') }
  const toggleGozen = (v: string) => { if (selGozen === v) { setSelGozen(null); return } setSelGozen(v); setSelZenjitsu(null) }
  const toggleGogo = (v: string) => { if (selGogo === v) { setSelGogo(null); return } setSelGogo(v); setSelZenjitsu(null) }
  const toggleKinmu = (v: string) => {
    if (v === '出張') { if (selKinmu.includes('出張')) { setSelKinmu(prev => prev.filter(x => x !== '出張')); setShucchoOpen(false) } else { setSelKinmu(prev => [...prev, '出張']); setShucchoOpen(true) } return }
    if (v === '代休') { if (daikyuMode === 'full') { setDaikyuMode('none'); setDaikyuDate('') } else { setDaikyuMode('full'); setDaikyuHalf(null); setSelZenjitsu(null); setSelGozen(null); setSelGogo(null) } return }
    if (v === '半日代休') { if (daikyuMode === 'half') { setDaikyuMode('none'); setDaikyuHalf(null); setDaikyuDate('') } else { setDaikyuMode('half'); setDaikyuHalf(null); setSelZenjitsu(null) } return }
    setSelKinmu(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }

  // ─── プレビュー構築 ─────────────────────────────────────────────────────

  const previewReason = useMemo(() => {
    const parts: string[] = []
    if (selZenjitsu) parts.push(selZenjitsu)
    if (selGozen) parts.push(selGozen)
    if (selGogo) parts.push(selGogo)
    if (daikyuMode === 'full') { const ds = daikyuDate ? `（${daikyuDate.replace(/-/g, '/')}分）` : ''; parts.push(`代休${ds}`) }
    else if (daikyuMode === 'half' && daikyuHalf) { const ds = daikyuDate ? `（${daikyuDate.replace(/-/g, '/')}分）` : ''; parts.push(`${daikyuHalf === 'am' ? '午前' : '午後'}代休${ds}`) }
    for (const k of selKinmu) { if (k === '代休' || k === '半日代休') continue; if (k === '出張') { parts.push(shucchoWhere ? '出張（' + shucchoWhere + '）' : '出張'); continue } parts.push(k) }
    return parts.length > 0 ? parts.join('+') : null
  }, [selZenjitsu, selGozen, selGogo, selKinmu, daikyuMode, daikyuHalf, daikyuDate, shucchoWhere])

  // ─── 出張バッチ登録 ─────────────────────────────────────────────────────

  const doShucchoBatch = async () => {
    const f = new Date(shucchoFrom), t = new Date(shucchoTo || shucchoFrom)
    const diffDays = Math.round((t.getTime() - f.getTime()) / 86400000) + 1
    const whereText = shucchoWhere ? `行先：${shucchoWhere}` : null
    const patternStart = employee.work_pattern_code?.split('-')[0] ?? '09:30'
    const patternEnd = employee.work_pattern_code?.split('-')[1] ?? '18:00'
    const formatTime = (t: string) => t.length === 4 ? t.slice(0, 2) + ':' + t.slice(2) : t
    const pIn = formatTime(patternStart)
    const pOut = formatTime(patternEnd)
    const otherParts = (previewReason ?? '').split('+').filter(p => p.trim() !== '出張').map(p => p.trim()).filter(Boolean)
    const shucchoLabel = shucchoWhere ? '出張（' + shucchoWhere + '）' : '出張'
    const reasonForBatch = otherParts.length > 0 ? otherParts.join('+') + '+' + shucchoLabel : shucchoLabel

    setSaving(true)
    const upserts = []
    for (let i = 0; i < diffDays; i++) {
      const d = new Date(f); d.setDate(d.getDate() + i)
      const ds = toDateStr(d)
      upserts.push({
        employee_id: employee.id, company_id: employee.company_id,
        attendance_date: ds, day_of_week: DOW[d.getDay()],
        reason: reasonForBatch, punch_in: pIn, punch_out: pOut,
        employee_note: whereText, updated_at: new Date().toISOString(),
      })
    }
    const { error } = await supabase.from('attendance_daily').upsert(upserts, { onConflict: 'employee_id,attendance_date' })
    setSaving(false)
    if (!error) { setModalOpen(false); fetchTodayRecord(employee.id); setMessage({ text: '出張を登録しました', ok: true }) }
    else { showAlert('登録に失敗しました: ' + error.message) }
  }

  // ─── 事由登録 ─────────────────────────────────────────────────────────────

  const submitReason = async () => {
    if (!previewReason) return

    if (selKinmu.includes('出張')) {
      if (!shucchoFrom) { showAlert('開始日を選択してください'); return }
      const f = new Date(shucchoFrom), t = new Date(shucchoTo || shucchoFrom)
      if (f > t) { showAlert('日付が正しくありません'); return }
      const diffDays = Math.round((t.getTime() - f.getTime()) / 86400000) + 1
      if (diffDays > 14) { showAlert('一度に登録できるのは14日間までです'); return }
      const confirmMsg = `出張${shucchoWhere ? `（${shucchoWhere}）` : ''}\n${shucchoFrom} 〜 ${shucchoTo || shucchoFrom}（${diffDays}日間）\n\n登録しますか？`
      showConfirm(confirmMsg, doShucchoBatch, '登録')
      return
    }

    if (daikyuMode === 'half' && !daikyuHalf) { showAlert('午前か午後を選択してください'); return }

    const todayStr = toDateStr(new Date())
    const todayDate = new Date()

    setSaving(true)
    const { error } = await supabase.from('attendance_daily').upsert({
      employee_id: employee.id, company_id: employee.company_id,
      attendance_date: todayStr, day_of_week: DOW[todayDate.getDay()],
      reason: previewReason, employee_note: memoNote || null, updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id,attendance_date' })
    setSaving(false)
    if (!error) { setModalOpen(false); fetchTodayRecord(employee.id); setMessage({ text: '申請を登録しました', ok: true }) }
    else { showAlert('登録に失敗しました: ' + error.message) }
  }

  // ─── 事由取消 ─────────────────────────────────────────────────────────────

  const cancelReason = () => {
    showConfirm('今日の事由を取り消しますか？', async () => {
      const todayStr = toDateStr(new Date())
      setSaving(true)
      const { error } = await supabase.from('attendance_daily')
        .update({ reason: null, employee_note: null, updated_at: new Date().toISOString() })
        .eq('employee_id', employee.id).eq('attendance_date', todayStr)
      setSaving(false)
      if (!error) { setModalOpen(false); fetchTodayRecord(employee.id); setMessage({ text: '事由を取り消しました', ok: true }) }
      else { showAlert('取消に失敗しました: ' + error.message) }
    }, '取消', '#DC2626')
  }

  // ─── ローディング ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: `4px solid ${T.primary}`, borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
        <p style={{ fontSize: 13, color: T.textMuted }}>読み込み中...</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  const status = getPunchStatus(todayRecord)
  const todayDate = new Date()
  const todayStr = toDateStr(todayDate)

  // ─── UI ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '28px 16px', maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>

      {/* 日付 */}
      <div style={{ fontSize: 14, color: T.textSec, marginBottom: 4 }}>
        {now.getFullYear()}/{String(now.getMonth() + 1).padStart(2, '0')}/{String(now.getDate()).padStart(2, '0')}（{DOW[now.getDay()]}）
      </div>

      {/* 時刻 */}
      <div style={{ fontSize: 52, fontWeight: 700, color: T.text, fontVariantNumeric: 'tabular-nums', letterSpacing: '-2px', marginBottom: 8 }}>
        {toHHMMSS(now)}
      </div>

      {/* ステータスバッジ */}
      <div style={{ marginBottom: 24 }}>
        {status === 'unset' && <Badge bg={T.primary}>未打刻</Badge>}
        {status === 'in' && <Badge bg="#16A34A">出勤済 {todayRecord?.punch_in}</Badge>}
        {status === 'both' && <Badge bg={T.primary}>出勤 {todayRecord?.punch_in}　退勤 {todayRecord?.punch_out}</Badge>}
      </div>

      {/* 今日の事由があればバッジ表示 */}
      {todayRecord?.reason && (
        <div style={{ marginBottom: 16 }}>
          <ReasonBadges reason={todayRecord.reason} />
        </div>
      )}

      {/* 結果メッセージ */}
      {message && (
        <div style={{
          padding: '12px 16px', borderRadius: '4px', marginBottom: 16,
          backgroundColor: message.ok ? '#ECFDF5' : '#FEF2F2',
          color: message.ok ? '#065F46' : '#991B1B',
          fontSize: 14, fontWeight: 500, transition: 'all 0.3s',
        }}>
          {message.text}
        </div>
      )}

      {/* 打刻ボタン */}
      <div style={{ display: 'flex', gap: 12, maxWidth: 340, margin: '0 auto 28px' }}>
        <button
          onClick={() => handlePunch('in')}
          disabled={status !== 'unset' || punching}
          style={{
            flex: 1, padding: '26px 0',
            border: status === 'unset' ? 'none' : `2px solid ${T.border}`,
            borderRadius: '6px',
            cursor: status === 'unset' ? 'pointer' : 'default',
            backgroundColor: status === 'unset' ? T.primary : T.bg,
            color: status === 'unset' ? '#fff' : T.textMuted,
            fontSize: 20, fontWeight: 700,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            transition: 'all 0.2s',
          }}
        >
          <span style={{ fontSize: 14 }}>▲</span>{punching ? '...' : '出勤'}
        </button>
        <button
          onClick={() => handlePunch('out')}
          disabled={status !== 'in' || punching}
          style={{
            flex: 1, padding: '26px 0',
            borderRadius: '6px',
            border: `2px solid ${status === 'in' ? T.primary : T.border}`,
            cursor: status === 'in' ? 'pointer' : 'default',
            backgroundColor: '#fff',
            color: status === 'in' ? T.text : T.textMuted,
            fontSize: 20, fontWeight: 700,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            transition: 'all 0.2s',
          }}
        >
          <span style={{ fontSize: 14 }}>▼</span>{punching ? '...' : '退勤'}
        </button>
      </div>

      {/* 休暇申請 */}
      <div style={{ maxWidth: 440, margin: '0 auto', textAlign: 'left' }}>
        <Dot color="#EF4444" label="休暇申請" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 24 }}>
          {['有給（全日）', '午前有給', '午後有給', '希望休（全日）', '午前希望休', '午後希望休'].map(l => (
            <button key={l} onClick={() => openModal(l)} style={{
              padding: '13px 6px', borderRadius: '6px',
              border: `1px solid ${T.border}`, backgroundColor: '#fff',
              color: T.text, fontSize: 12, fontWeight: 500,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>{l}</button>
          ))}
        </div>

        <Dot color="#22C55E" label="勤務申請" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {['出張', '休日出勤', '代休', '遅刻', '早退', '欠勤'].map(l => (
            <button key={l} onClick={() => openModal(l)} style={{
              padding: '13px 6px', borderRadius: '6px',
              border: `1px solid ${T.border}`, backgroundColor: '#fff',
              color: T.text, fontSize: 12, fontWeight: 500,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>{l}</button>
          ))}
        </div>
      </div>

      {/* ══════ モーダル ══════ */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setModalOpen(false)}>
          <div style={{ backgroundColor: '#fff', borderRadius: '12px 12px 0 0', padding: '20px 20px 28px', width: '100%', maxWidth: 480, maxHeight: '85vh', overflow: 'auto', animation: 'slideUp 0.3s ease', textAlign: 'left' }}
            onClick={e => e.stopPropagation()}>

            <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text, marginBottom: 4 }}>休暇・勤務申請</div>
            <div style={{ fontSize: 13, color: T.textSec, marginBottom: 16 }}>
              {todayDate.getFullYear()}年{todayDate.getMonth() + 1}月{todayDate.getDate()}日（{DOW[todayDate.getDay()]}）
            </div>

            {/* プレビュー */}
            <div style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: previewReason ? '#ECFDF5' : T.bg, marginBottom: 20, minHeight: 40, display: 'flex', alignItems: 'center' }}>
              {previewReason ? <ReasonBadges reason={previewReason} /> : <span style={{ fontSize: 13, color: T.textMuted }}>事由を選択してください</span>}
            </div>

            <Dot color={T.holidayRed} label="休暇申請" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <Chip label="有給（全日）" selected={selZenjitsu === '有給（全日）'} color={T.yukyuBlue} onClick={() => toggleZenjitsu('有給（全日）')} />
              <Chip label="希望休（全日）" selected={selZenjitsu === '希望休（全日）'} color={T.kibouYellow} onClick={() => toggleZenjitsu('希望休（全日）')} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <Chip label="午前有給" selected={selGozen === '午前有給'} color={T.yukyuBlue} onClick={() => toggleGozen('午前有給')} />
              <Chip label="午前希望休" selected={selGozen === '午前希望休'} color={T.kibouYellow} onClick={() => toggleGozen('午前希望休')} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
              <Chip label="午後有給" selected={selGogo === '午後有給'} color={T.yukyuBlue} onClick={() => toggleGogo('午後有給')} />
              <Chip label="午後希望休" selected={selGogo === '午後希望休'} color={T.kibouYellow} onClick={() => toggleGogo('午後希望休')} />
            </div>

            <Dot color={T.kinmuGreen} label="勤務申請" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
              {['出張', '休日出勤', '代休', '半日代休', '遅刻', '早退', '欠勤'].map(k => (
                <Chip key={k} label={k}
                  selected={k === '代休' ? daikyuMode === 'full' : k === '半日代休' ? daikyuMode === 'half' : selKinmu.includes(k)}
                  color={T.kinmuGreen} onClick={() => toggleKinmu(k)} />
              ))}
            </div>

            {shucchoOpen && (
              <div style={{ padding: 14, borderRadius: '6px', border: `1px solid ${T.kinmuGreen}`, backgroundColor: '#F0FFF4', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.kinmuGreen, marginBottom: 10 }}>出張の詳細</div>
                <Field label="行先（任意）"><input type="text" value={shucchoWhere} onChange={e => setShucchoWhere(e.target.value)} placeholder="例：東京、大阪" style={inputStyle} /></Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Field label="開始日"><input type="date" value={shucchoFrom} onChange={e => setShucchoFrom(e.target.value)} style={inputStyle} /></Field>
                  <Field label="終了日"><input type="date" value={shucchoTo} onChange={e => setShucchoTo(e.target.value)} style={inputStyle} /></Field>
                </div>
              </div>
            )}

            {daikyuMode === 'full' && (
              <div style={{ padding: 14, borderRadius: '6px', border: `1px solid ${T.kinmuGreen}`, backgroundColor: '#F0FFF4', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.kinmuGreen, marginBottom: 10 }}>代休の対象日（休日出勤した日）</div>
                <Field label="対象日"><input type="date" value={daikyuDate} onChange={e => setDaikyuDate(e.target.value)} style={inputStyle} /></Field>
              </div>
            )}

            {daikyuMode === 'half' && (
              <div style={{ padding: 14, borderRadius: '6px', border: `1px solid ${T.kinmuGreen}`, backgroundColor: '#F0FFF4', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.kinmuGreen, marginBottom: 10 }}>半日代休の詳細</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <Chip label="午前代休" selected={daikyuHalf === 'am'} color={T.kinmuGreen} onClick={() => setDaikyuHalf(daikyuHalf === 'am' ? null : 'am')} />
                  <Chip label="午後代休" selected={daikyuHalf === 'pm'} color={T.kinmuGreen} onClick={() => setDaikyuHalf(daikyuHalf === 'pm' ? null : 'pm')} />
                </div>
                <Field label="対象日（休日出勤した日）"><input type="date" value={daikyuDate} onChange={e => setDaikyuDate(e.target.value)} style={inputStyle} /></Field>
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: T.textSec, display: 'block', marginBottom: 4 }}>備考</label>
              <textarea value={memoNote} onChange={e => setMemoNote(e.target.value)} placeholder="例：熱があって遅刻しました"
                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: `1px solid ${T.border}`, fontSize: 13, resize: 'vertical', minHeight: 60, boxSizing: 'border-box' }} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setModalOpen(false)} style={{ flex: 1, padding: '12px', borderRadius: '6px', border: `1px solid ${T.border}`, backgroundColor: '#fff', color: T.textSec, fontSize: 14, cursor: 'pointer' }}>閉じる</button>
              {todayRecord?.reason && (
                <button onClick={cancelReason} disabled={saving} style={{ flex: 1, padding: '12px', borderRadius: '6px', border: `1px solid ${T.danger}`, backgroundColor: '#fff', color: T.danger, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{saving ? '...' : '取消'}</button>
              )}
              <button onClick={submitReason} disabled={saving || !previewReason} style={{ flex: 1, padding: '12px', borderRadius: '6px', border: 'none', backgroundColor: previewReason ? T.primary : T.border, color: previewReason ? '#fff' : T.textMuted, fontSize: 14, fontWeight: 600, cursor: previewReason ? 'pointer' : 'default' }}>{saving ? '登録中...' : '登録'}</button>
            </div>
          </div>
        </div>
      )}

      {/* カスタムダイアログ */}
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

      <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
    </div>
  )
}
