const PERM_KEY = 'ets_notif_enabled';

export function notificationsEnabled(): boolean {
  return localStorage.getItem(PERM_KEY) === '1';
}

export function setNotificationsEnabled(v: boolean) {
  localStorage.setItem(PERM_KEY, v ? '1' : '0');
}

export function notificationApiAvailable(): boolean {
  return 'Notification' in window || 'serviceWorker' in navigator;
}

export async function requestAndEnable(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted') {
    setNotificationsEnabled(true);
    return 'granted';
  }
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    setNotificationsEnabled(true);
    return 'granted';
  }
  return 'denied';
}

export function showNotification(title: string, body: string): void {
  if (Notification.permission !== 'granted') return;
  if (!notificationsEnabled()) return;
  const opts: NotificationOptions = { body, icon: '/ets-vandaele/favicon.svg', tag: 'ets-chantier', silent: false };
  // Prefer service worker notification (required for iOS PWA)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, opts))
      .catch(() => {
        try { new Notification(title, opts); } catch {}
      });
  } else {
    try { new Notification(title, opts); } catch {}
  }
}
