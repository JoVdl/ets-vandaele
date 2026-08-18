import { useEffect, useState } from 'react';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

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

/** Subscribe to all active live sessions (patron view). */
export function useLiveSessions() {
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);

  useEffect(() => {
    return onSnapshot(collection(db, COL), snap => {
      const cutoff = Date.now() - 5 * 60 * 1000; // ignore stale (> 5 min)
      setLiveSessions(
        snap.docs
          .map(d => {
            const raw = d.data() as Record<string, unknown>;
            return {
              ...raw,
              sessionId: d.id,
              lastUpdate: (raw.lastUpdate as Timestamp).toDate().toISOString(),
            } as LiveSession;
          })
          .filter(s => new Date(s.lastUpdate).getTime() > cutoff)
      );
    }, () => {});
  }, []);

  return { liveSessions };
}
