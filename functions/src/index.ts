import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

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
