import { getMessaging, getToken } from 'firebase/messaging';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { app, db } from './firebase';
import { getDeviceId } from './chantierEvents';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

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
