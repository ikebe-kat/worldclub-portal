// lib/auth.ts
// セッション管理ユーティリティ
// ※ null返却時に throw しない設計。呼び出し側で null チェックすること。

import { supabase } from '@/lib/supabase'
import type { Session, User } from '@supabase/supabase-js'

/**
 * 現在のセッションを取得する。
 * 未ログインの場合は null を返す（例外を投げない）。
 */
export async function getSession(): Promise<Session | null> {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      console.warn('getSession error:', error.message)
      return null
    }
    return data?.session ?? null
  } catch (err) {
    console.warn('getSession unexpected error:', err)
    return null
  }
}

/**
 * 現在のユーザーを取得する。
 * 未ログインの場合は null を返す。
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession()
  return session?.user ?? null
}

/**
 * ログアウト
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

/**
 * セッションがなければ /login にリダイレクト（クライアントサイド用）
 * returns true: ログイン済み / false: リダイレクト実行
 */
export async function requireAuth(): Promise<boolean> {
  const session = await getSession()
  if (!session) {
    window.location.href = '/login'
    return false
  }
  return true
}