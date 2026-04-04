'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

const COMPANY_ID = "c2d368f0-aa9b-4f70-b082-43ec07723d6c";

export default function LoginPage() {
  const router = useRouter()
  const [employeeCode, setEmployeeCode] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // ポータルからの自動ログイン
    const portalToken = params.get("portal_token");
    if (portalToken) {
      (async () => {
        const { data } = await supabase
          .from('employees')
          .select('id, employee_code, full_name, full_name_kana, department, position, store_id, company_id, pin, holiday_calendar, holiday_pattern, work_pattern_code, requires_punch, role, portal_group_id, stores(store_name)')
          .eq('portal_group_id', portalToken)
          .eq('company_id', COMPANY_ID)
          .maybeSingle();
        if (data) {
          const empData = { ...data, store_name: (data as any).stores?.store_name || "" };
          delete (empData as any).stores;
          localStorage.setItem('employee', JSON.stringify(empData));
          router.push('/home');
        }
      })();
      return;
    }
    if (params.get("logout") === "true") { localStorage.removeItem("employee"); window.history.replaceState({}, "", "/"); return; }
    const stored = localStorage.getItem('employee')
    if (stored) { router.push('/home') }
  }, [])

  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setError('')
    setLoading(true)
    const code = employeeCode.toUpperCase().startsWith("WC")
      ? employeeCode.toUpperCase()
      : "WC" + employeeCode.padStart(3, '0');

    const { data, error: dbError } = await supabase
      .from('employees')
      .select('id, employee_code, full_name, full_name_kana, department, position, store_id, company_id, pin, holiday_calendar, holiday_pattern, work_pattern_code, requires_punch, role, portal_group_id, stores(store_name)')
      .eq('employee_code', code)
      .eq('company_id', COMPANY_ID)
      .maybeSingle()

    setLoading(false)

    if (dbError || !data) {
      setError('社員CDが見つかりません')
      return
    }

    if (data.pin !== pin) {
      setError('PINが正しくありません')
      return
    }

    const empData = { ...data, store_name: (data as any).stores?.store_name || "" }; delete (empData as any).stores; localStorage.setItem('employee', JSON.stringify(empData))
    router.push('/home')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded shadow-sm border border-gray-100 p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/worldclub-logo.png" alt="WORLD CLUB" className="h-20 mx-auto mb-4" style={{ borderRadius: 8 }} />
          <p className="text-gray-400 text-xs tracking-widest">勤怠管理</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-gray-500 text-xs mb-1 block">社員CD</label>
            <input
              type="text"
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              placeholder="例: 1 または WC001"
              className="w-full border border-gray-200 rounded px-4 py-3 text-gray-800 placeholder-gray-300 focus:outline-none focus:border-green-700 text-lg"
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
          </div>
          <div>
            <label className="text-gray-500 text-xs mb-1 block">PIN</label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="****"
              className="w-full border border-gray-200 rounded px-4 py-3 text-gray-800 placeholder-gray-300 focus:outline-none focus:border-green-700 text-lg"
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
          </div>

          {error && <p className="text-pink-500 text-sm text-center">{error}</p>}

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full text-white font-bold py-3.5 rounded text-base shadow-sm transition-all active:scale-95 mt-2"
            style={{ backgroundColor: "#1a4b24" }}
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </div>
      </div>
      <p className="text-gray-300 text-xs mt-6">© 株式会社ワールドクラブ</p>
    </div>
  )
}
