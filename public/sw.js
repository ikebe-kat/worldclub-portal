// ワールドクラブ 社内ポータル — Service Worker
const CACHE_NAME = "worldclub-portal-v1";

// プッシュ通知受信
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body || "",
    icon: "/worldclub-logo.png",
    badge: "/worldclub-logo.png",
    tag: data.tag || "worldclub-notification",
    data: { url: data.url || "/" },
    vibrate: [200, 100, 200],
  };
  event.waitUntil(
    self.registration.showNotification(data.title || "ワールドクラブ", options)
  );
});

// 通知クリック → アプリを開く
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((cls) => {
      for (const c of cls) {
        if (c.url.includes(self.location.origin) && "focus" in c) return c.focus();
      }
      return clients.openWindow(url);
    })
  );
});

// インストール
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
