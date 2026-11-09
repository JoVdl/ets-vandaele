// Service Worker — ETS Vandaele
// Minimal SW to enable PWA install + Notification API on iOS

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Handle push events (for future FCM integration)
self.addEventListener('push', e => {
  if (!e.data) return;
  try {
    const { title, body, icon } = e.data.json();
    e.waitUntil(
      self.registration.showNotification(title, { body, icon: icon ?? '/favicon.svg' })
    );
  } catch {}
});

// Clicking a notification opens / focuses the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.startsWith(self.registration.scope));
      if (existing) return existing.focus();
      return self.clients.openWindow(self.registration.scope);
    })
  );
});
