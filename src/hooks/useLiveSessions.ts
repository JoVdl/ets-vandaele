import { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { SuiviIncident } from '../types/suivi';

const COL = 'suivi_live';

export interface LiveSession {
  sessionId:      string;
  operateur:      'patron' | 'salarie';
  chantierId:     string;
  chantierNom:    string;
  lat:            number;
  lng:            number;
  accuracy:       number | null;
  speedKmh:       number;
  areaM:          number;
  distM:          number;
  rendementM2h:   number;
  progressPct:    number | null;
  dureeMinutes:   number;
  // Dragage extras
  volumeM3?:      number;
  debitM3h?:      number;
  paused?:        boolean;
  recentTrack?:   { lat: number; lng: number }[];
  incidents?:     SuiviIncident[];
  dateDebut?:     string; // ISO — session start time
  lastUpdate:     string; // ISO
}

/** Push live metrics to Firestore (called every 30s during an active session). */
export async function pushLiveSession(sessionId: string, data: Omit<LiveSession, 'sessionId' | 'lastUpdate'>): Promise<void> {
  await setDoc(doc(db, COL, sessionId), {
    ...data,
    lastUpdate: Timestamp.now(),
  }).catch(() => { /* offline — ignore */ });
}

/** Remove the live session document when session ends. */
export async function clearLiveSession(sessionId: string): Promise<void> {
  await deleteDoc(doc(db, COL, sessionId)).catch(() => {});
}

/** Subscribe to all active live sessions (patron view). Read-only: never writes to Firestore. */
export function useLiveSessions() {
  const [docs, setDocs] = useState<LiveSession[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const subscribe = () => onSnapshot(collection(db, COL), snap => {
      setDocs(
        snap.docs.map(d => {
          const raw = d.data() as Record<string, unknown>;
          const ts = raw.lastUpdate as Timestamp | undefined;
          return {
            ...raw,
            sessionId: d.id,
            lastUpdate: ts ? ts.toDate().toISOString() : new Date(0).toISOString(),
          } as LiveSession;
        })
      );
      setNow(Date.now());
    }, () => {});

    let unsub = subscribe();

    const resubscribe = () => {
      unsub();
      unsub = subscribe();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') resubscribe();
    };

    // Recalcule la fraîcheur toutes les 15 s, même sans nouvel envoi du salarié
    const tick = setInterval(() => setNow(Date.now()), 15 * 1000);
    // Re-souscrit périodiquement (les connexions WS peuvent se figer)
    const refresh = setInterval(resubscribe, 3 * 60 * 1000);

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', resubscribe);
    return () => {
      unsub();
      clearInterval(tick);
      clearInterval(refresh);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', resubscribe);
    };
  }, []);

  const liveSessions = useMemo(() => {
    const cutoff = now - 10 * 60 * 1000; // ignore stale (> 10 min)
    return docs.filter(s => new Date(s.lastUpdate).getTime() > cutoff);
  }, [docs, now]);

  return { liveSessions };
}
