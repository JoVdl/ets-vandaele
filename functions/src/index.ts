import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const GMAIL_USER = defineSecret('CAMERA_EMAIL');
const GMAIL_PASS = defineSecret('CAMERA_EMAIL_APP_PASSWORD');

const CORS_ORIGIN = 'https://jovdl.github.io';
const STORAGE_PATH = 'camera/latest.jpg';
const CACHE_MAX_AGE_S = 300; // 5 min: reuse stored image before hitting IMAP again

admin.initializeApp();

// ── Fetch latest Reolink alert email from Gmail via IMAP ─────────────────────
async function fetchFromGmail(user: string, pass: string): Promise<Buffer | null> {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  try {
    await client.mailboxOpen('INBOX');

    // Search last 24 h, pick the most recent 5 messages
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rawUids = await client.search({ since });
    const uids = Array.isArray(rawUids) ? rawUids : [];
    if (!uids.length) return null;

    for (const uid of [...uids].reverse().slice(0, 5)) {
      const msg = await client.fetchOne(String(uid), { source: true });
      if (!msg || !msg.source) continue;
      const parsed = await simpleParser(msg.source as Buffer);
      const att = parsed.attachments?.find(a => a.contentType.startsWith('image/'));
      if (att) return att.content;
    }
    return null;
  } finally {
    await client.logout().catch(() => undefined);
  }
}

// ── Serve camera snapshot ────────────────────────────────────────────────────
// Flow:
//   1. Firebase Storage cache < 5 min old → return immediately
//   2. Otherwise → connect Gmail IMAP, extract JPEG from latest alert email
//   3. Store to Storage (cache) and return
export const cameraSnapshot = onRequest(
  {
    region: 'europe-west1',
    secrets: [GMAIL_USER, GMAIL_PASS],
    cors: [CORS_ORIGIN],
    timeoutSeconds: 30,
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const bucket = admin.storage().bucket();
    const file   = bucket.file(STORAGE_PATH);

    // Helper: stream Storage file to response
    const sendFromStorage = async (ageSec: number, source: string) => {
      const [buffer] = await file.download();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.setHeader('X-Image-Age-S', String(ageSec));
      res.setHeader('X-Source', source);
      res.send(buffer);
    };

    try {
      // 1. Check Storage cache
      const [exists] = await file.exists();
      if (exists) {
        const [meta] = await file.getMetadata();
        const ageSec = Math.round((Date.now() - new Date(meta.updated as string).getTime()) / 1000);
        if (ageSec < CACHE_MAX_AGE_S) {
          await sendFromStorage(ageSec, 'cache');
          return;
        }
      }

      // 2. Fetch from Gmail IMAP
      let jpegBuf: Buffer | null = null;
      try {
        jpegBuf = await fetchFromGmail(GMAIL_USER.value(), GMAIL_PASS.value());
      } catch (imapErr) {
        // IMAP failed — if we have a stale cached image, return it with a warning
        if (exists) {
          const [meta] = await file.getMetadata();
          const ageSec = Math.round((Date.now() - new Date(meta.updated as string).getTime()) / 1000);
          await sendFromStorage(ageSec, 'cache-stale');
          return;
        }
        res.status(503).json({ error: `Gmail IMAP: ${String(imapErr)}` });
        return;
      }

      if (!jpegBuf) {
        // No recent email found — serve stale cache or error
        if (exists) {
          const [meta] = await file.getMetadata();
          const ageSec = Math.round((Date.now() - new Date(meta.updated as string).getTime()) / 1000);
          await sendFromStorage(ageSec, 'cache-stale');
          return;
        }
        res.status(503).json({
          error: 'Aucune image — configurez les alertes email de la caméra avec SMTP Gmail',
        });
        return;
      }

      // 3. Store to Firebase Storage as cache
      await file.save(jpegBuf, {
        metadata: { contentType: 'image/jpeg', cacheControl: 'no-cache' },
        resumable: false,
      });

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.setHeader('X-Image-Age-S', '0');
      res.setHeader('X-Source', 'gmail-fresh');
      res.send(jpegBuf);
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
