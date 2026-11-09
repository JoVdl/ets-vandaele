import { getMessaging, getToken } from 'firebase/messaging';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { app, db } from './firebase';
import { getDeviceId } from './chantierEvents';

const VAPID_KEY = 'BEYhiUnhu3XHw-AhHcQ9hCrFWiJo7DcZV7HCWuww6TGeTRjDO0XoC6GJ5Sq1VCHQq2DC1s94_QKub6V0TmaLgtI';

export async function registerFcmToken(): Promise<void> {
  if (!VAPID_KEY) return;
  if (!('serviceWorker' in navigator)) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const messaging = getMessaging(app);
    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return;
    const deviceId = getDeviceId();
    await setDoc(doc(db, 'fcmTokens', deviceId), {
      token,
      deviceId,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Permission denied, unsupported, or offline
  }
}
