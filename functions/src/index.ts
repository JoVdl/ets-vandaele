import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const CORS_ORIGIN = 'https://jovdl.github.io';
const STORAGE_PATH = 'camera/latest.jpg';

admin.initializeApp();

// ── Receive snapshot pushed by the camera ───────────────────────────────────
// The Reolink camera is configured to POST a JPEG to this endpoint.
// No auth token used: the Cloud Run URL itself is unguessable.
// Add a ?token= check here once you set up an env var if you want extra security.
export const receiveCameraSnapshot = onRequest(
  {
    region: 'europe-west1',
    cors: false,
    timeoutSeconds: 30,
    maxInstances: 2,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    // rawBody is set by the Cloud Functions framework before any body parsing
    const imgData: Buffer = (req as unknown as { rawBody: Buffer }).rawBody;
    if (!imgData || imgData.length < 100) {
      res.status(400).json({ error: 'Empty or malformed body' });
      return;
    }

    try {
      const bucket = admin.storage().bucket();
      await bucket.file(STORAGE_PATH).save(imgData, {
        metadata: {
          contentType: 'image/jpeg',
          cacheControl: 'no-cache',
        },
        resumable: false,
      });
      res.json({ ok: true, bytes: imgData.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

// ── Serve latest snapshot from Firebase Storage ──────────────────────────────
export const cameraSnapshot = onRequest(
  {
    region: 'europe-west1',
    cors: [CORS_ORIGIN],
    timeoutSeconds: 10,
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    try {
      const bucket = admin.storage().bucket();
      const file   = bucket.file(STORAGE_PATH);

      const [exists] = await file.exists();
      if (!exists) {
        res.status(503).json({ error: 'Aucune image — caméra pas encore configurée pour pousser des snapshots' });
        return;
      }

      const [meta] = await file.getMetadata();
      const updatedAt = new Date(meta.updated as string);
      const ageSec    = Math.round((Date.now() - updatedAt.getTime()) / 1000);

      // Refuse images older than 2 hours (camera probably offline)
      if (ageSec > 7200) {
        res.status(503).json({ error: `Image trop ancienne (${Math.round(ageSec / 60)} min) — caméra hors ligne ?` });
        return;
      }

      const [buffer] = await file.download();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.setHeader('X-Image-Age-S', String(ageSec));
      res.send(buffer);
    } catch (err) {
      res.status(503).json({ error: String(err) });
    }
  },
);

// ── Push notification on chantier events ────────────────────────────────────
export const onChantierEvent = onDocumentCreated(
  { document: 'chantierEvents/{docId}', region: 'europe-west1' },
  async event => {
    const ev = event.data?.data();
    if (!ev) return;

    const tokensSnap = await admin.firestore().collection('fcmTokens').get();
    const tokenDocs: Array<{ id: string; token: string }> = [];
    for (const d of tokensSnap.docs) {
      const data = d.data();
      if (data['deviceId'] === ev['deviceId']) continue;
      if (data['token']) tokenDocs.push({ id: d.id, token: data['token'] as string });
    }
    if (!tokenDocs.length) return;

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
        const label    = ev['incidentLabel'] as string | undefined;
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

    const tokens  = tokenDocs.map(d => d.token);
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
  },
);
