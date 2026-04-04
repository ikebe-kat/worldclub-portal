import { supabase } from "@/lib/supabase";

const VAPID_PUBLIC_KEY = "BBIYaJqhRjCkTBbDL_90GDdJ_WTo7n4GDS9-7wOcTShpqjw5ym6rMt1rYMDCDilFidTHuv2y1WSBwiEIPZAq99Q";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/** Service Worker登録 + プッシュ購読 + Supabase保存 */
export async function registerAndSubscribe(employeeId: string): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.warn("Push notifications not supported");
      return false;
    }

    // Service Worker 登録
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    // 既存の購読があるか確認
    let subscription = await reg.pushManager.getSubscription();

    if (!subscription) {
      // 新規購読
      const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key.buffer as ArrayBuffer,
      });
    }

    // Supabaseに保存
    const subJson = subscription.toJSON();
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        employee_id: employeeId,
        endpoint: subJson.endpoint,
        p256dh: subJson.keys?.p256dh || "",
        auth: subJson.keys?.auth || "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,endpoint" }
    );

    if (error) {
      console.error("Failed to save push subscription:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Push subscription failed:", err);
    return false;
  }
}

/** 通知許可状態を取得 */
export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}
