// ワールドクラブ 社内ポータル — Service Worker
const SW_VERSION = "w1";
const CACHE_NAME = "worldclub-portal-" + SW_VERSION;

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

// インストール: 即座にアクティブ化
self.addEventListener("install", () => self.skipWaiting());

// アクティブ化: 旧キャッシュ削除 + 全クライアント制御
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n.startsWith("worldclub-portal-") && n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// fetch: ナビゲーションリクエストは常にネットワーク優先
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});
