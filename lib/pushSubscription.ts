const VAPID_PUBLIC_KEY = "BBIYaJqhRjCkTBbDL_90GDdJ_WTo7n4GDS9-7wOcTShpqjw5ym6rMt1rYMDCDilFidTHuv2y1WSBwiEIPZAq99Q";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function isIosNonPwa(): boolean {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isPwa = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
  return isIos && !isPwa;
}

async function callPushSubscribe(
  employeeId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
): Promise<{ success?: boolean; stale?: boolean; error?: string }> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const res = await fetch(`${base}/functions/v1/push-subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employee_id: employeeId, endpoint, p256dh, auth }),
  });
  return res.json();
}

async function freshSubscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key.buffer as ArrayBuffer,
  });
}

/** Service Worker登録 + プッシュ購読 + DB保存 */
export async function registerAndSubscribe(employeeId: string): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.warn("Push notifications not supported");
      return false;
    }

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await freshSubscribe(reg);
    }

    const subJson = subscription.toJSON();
    const result = await callPushSubscribe(
      employeeId,
      subJson.endpoint || "",
      subJson.keys?.p256dh || "",
      subJson.keys?.auth || "",
    );

    if (result.stale) {
      try { await subscription.unsubscribe(); } catch {}
      const newSub = await freshSubscribe(reg);
      const newJson = newSub.toJSON();
      const retry = await callPushSubscribe(
        employeeId,
        newJson.endpoint || "",
        newJson.keys?.p256dh || "",
        newJson.keys?.auth || "",
      );
      if (retry.error) {
        console.error("Push subscription retry failed:", retry.error);
        return false;
      }
      return true;
    }

    if (result.error) {
      console.error("Push subscription failed:", result.error);
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
