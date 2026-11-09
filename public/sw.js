// Service Worker — ETS Vandaele
// Firebase Messaging for background push notifications (iOS PWA + Android)

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDt4gTL-KqWyBPC2777wH4s-t6cAmGoEwY',
  authDomain: 'ets-vandaele.firebaseapp.com',
  projectId: 'ets-vandaele',
  storageBucket: 'ets-vandaele.firebasestorage.app',
  messagingSenderId: '1027752944412',
  appId: '1:1027752944412:web:8242cf5452db79bac810d9',
});

const messaging = firebase.messaging();

// Called when app is in background — Firebase intercepts the push and passes it here
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title ?? 'ETS Vandaele';
  const body  = payload.notification?.body  ?? '';
  self.registration.showNotification(title, {
    body,
    icon: '/ets-vandaele/favicon.svg',
    tag:  'ets-chantier',
  });
});

self.addEventListener('install',   () => self.skipWaiting());
self.addEventListener('activate',  e  => e.waitUntil(self.clients.claim()));

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
