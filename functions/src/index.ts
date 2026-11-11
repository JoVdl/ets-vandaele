import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';

// ── Reolink camera snapshot proxy ───────────────────────────────────────────
const REOLINK_EMAIL    = defineSecret('REOLINK_EMAIL');
const REOLINK_PASSWORD = defineSecret('REOLINK_PASSWORD');
const REOLINK_CAM_USER = defineSecret('REOLINK_CAM_USER');
const REOLINK_CAM_PASS = defineSecret('REOLINK_CAM_PASS');

const CAMERA_UID  = '95270000SOYFJBFR';
const CORS_ORIGIN = 'https://jovdl.github.io';

interface ReolinkDevice {
  uid: string;
  name?: string;
  publicIp?: string;
  localIp?: string;
  httpPort?: number;
  online?: boolean;
}

export const cameraSnapshot = onRequest(
  {
    region: 'europe-west1',
    secrets: [REOLINK_EMAIL, REOLINK_PASSWORD, REOLINK_CAM_USER, REOLINK_CAM_PASS],
    cors: [CORS_ORIGIN],
    timeoutSeconds: 20,
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    try {
      // 1. Login to Reolink cloud
      const loginResp = await fetch('https://api.reolink.com/api/Login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: { userName: REOLINK_EMAIL.value(), password: REOLINK_PASSWORD.value() } }),
        signal: AbortSignal.timeout(8000),
      });
      const loginJson = await loginResp.json() as { code: number; data?: { token: string } };
      if (loginJson.code !== 0 || !loginJson.data?.token) {
        res.status(503).json({ error: 'Reolink login failed', code: loginJson.code });
        return;
      }
      const token = loginJson.data.token;

      // 2. Get device list to find camera's current IP
      const devResp = await fetch(`https://api.reolink.com/api/GetDevList?token=${token}`, {
        signal: AbortSignal.timeout(8000),
      });
      const devJson = await devResp.json() as { code: number; data?: { devices?: ReolinkDevice[] } };

      const cam = devJson.data?.devices?.find(d => d.uid === CAMERA_UID);
      if (!cam) {
        res.status(503).json({ error: 'Camera not found in Reolink account', uid: CAMERA_UID });
        return;
      }
      if (cam.online === false) {
        res.status(503).json({ error: 'camera_offline' });
        return;
      }

      const camIp   = cam.publicIp;
      const camPort = cam.httpPort ?? 80;
      if (!camIp) {
        res.status(503).json({ error: 'Camera IP unavailable from cloud' });
        return;
      }

      // 3. Fetch JPEG snapshot directly from camera HTTP API
      const rand    = Math.random().toString(36).substring(2, 10);
      const snapUrl = `http://${camIp}:${camPort}/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=${rand}` +
        `&user=${encodeURIComponent(REOLINK_CAM_USER.value())}` +
        `&password=${encodeURIComponent(REOLINK_CAM_PASS.value())}`;

      const snapResp = await fetch(snapUrl, { signal: AbortSignal.timeout(8000) });
      if (!snapResp.ok) {
        res.status(503).json({ error: `Camera HTTP ${snapResp.status}` });
        return;
      }

      const imgBuf = await snapResp.arrayBuffer();
      res.setHeader('Content-Type', snapResp.headers.get('content-type') ?? 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.send(Buffer.from(imgBuf));
    } catch (err) {
      res.status(503).json({ error: String(err) });
    }
  },
);

admin.initializeApp();

export const onChantierEvent = onDocumentCreated(
  { document: 'chantierEvents/{docId}', region: 'europe-west1' },
  async event => {
    const ev = event.data?.data();
    if (!ev) return;

    // Collect FCM tokens of all OTHER devices
    const tokensSnap = await admin.firestore().collection('fcmTokens').get();
    const tokenDocs: Array<{ id: string; token: string }> = [];
    for (const d of tokensSnap.docs) {
      const data = d.data();
      if (data['deviceId'] === ev['deviceId']) continue;
      if (data['token']) tokenDocs.push({ id: d.id, token: data['token'] as string });
    }
    if (!tokenDocs.length) return;

    // Build notification text
    const who: string =
      ev['operateur'] === 'patron'
        ? 'Patron'
        : (ev['salarieNom'] as string | undefined) ?? 'Salarié';

    let title = '';
    let body  = '';

    switch (ev['type'] as string) {
      case 'session_start':
        title = '▶️ Session démarrée';
        body  = `${ev['chantierNom']} — ${who}`;
        break;
      case 'session_pause':
        title = '⏸️ Session en pause';
        body  = `${ev['chantierNom']} — ${who}`;
        break;
      case 'session_resume':
        title = '▶️ Session reprise';
        body  = `${ev['chantierNom']} — ${who}`;
        break;
      case 'session_end': {
        const m = ev['dureeSessionMin'] as number | undefined;
        const dur = m != null
          ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
          : null;
        title = '🏁 Session terminée';
        body  = dur
          ? `${ev['chantierNom']} — ${dur} (${who})`
          : `${ev['chantierNom']} — ${who}`;
        break;
      }
      case 'incident': {
        const label   = ev['incidentLabel'] as string | undefined;
        const dureeMin = ev['incidentDureeMin'] as number | undefined;
        title = `⚠️ Incident — ${ev['chantierNom']}`;
        body  = label
          ? `${label}${dureeMin != null ? ` · ${dureeMin} min` : ''} (${who})`
          : who;
        break;
      }
      default:
        return;
    }

    const tokens = tokenDocs.map(d => d.token);
    const message: admin.messaging.MulticastMessage = {
      notification: { title, body },
      webpush: {
        notification: {
          icon: 'https://jovdl.github.io/ets-vandaele/favicon.svg',
          tag:      'ets-chantier',
          renotify: true,
        },
        fcmOptions: { link: 'https://jovdl.github.io/ets-vandaele/#suivi' },
      },
      tokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // Clean up stale tokens
    const toDelete: string[] = [];
    response.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code ?? '';
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          toDelete.push(tokenDocs[i].id);
        }
      }
    });
    if (toDelete.length) {
      const batch = admin.firestore().batch();
      for (const id of toDelete) {
        batch.delete(admin.firestore().doc(`fcmTokens/${id}`));
      }
      await batch.commit();
    }
  }
);
