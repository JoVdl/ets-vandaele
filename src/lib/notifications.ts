const PERM_KEY = 'ets_notif_enabled';

export function notificationsEnabled(): boolean {
  return localStorage.getItem(PERM_KEY) === '1';
}

export function setNotificationsEnabled(v: boolean) {
  localStorage.setItem(PERM_KEY, v ? '1' : '0');
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
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (!notificationsEnabled()) return;
  try {
    new Notification(title, {
      body,
      icon: '/cen-logo.png',
      tag: 'ets-chantier',
      silent: false,
    });
  } catch {
    // Notification API may throw in certain browser/OS combos
  }
}
