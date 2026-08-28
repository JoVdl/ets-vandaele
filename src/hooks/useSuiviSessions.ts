import { useEffect, useState, useCallback } from 'react';
import {
  collection, addDoc, onSnapshot, query, orderBy,
  limit, Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { SuiviSession } from '../types/suivi';
import { loadPendingSessions, removePendingSession, queuePendingSession } from '../lib/suiviOffline';
import { avgSpeedKmh, totalDistanceM, areaM2 } from '../lib/geo';

const COL = 'suivi_sessions';

function sessionToFirestore(s: Omit<SuiviSession, 'id' | 'pendingSync'>) {
  return {
    ...s,
    dateDebut: Timestamp.fromDate(new Date(s.dateDebut)),
    dateFin:   s.dateFin ? Timestamp.fromDate(new Date(s.dateFin)) : null,
    createdAt: Timestamp.now(),
  };
}

function sessionFromFirestore(id: string, data: Record<string, unknown>): SuiviSession {
  return {
    ...data,
    id,
    dateDebut: (data.dateDebut as Timestamp).toDate().toISOString(),
    dateFin:   data.dateFin ? (data.dateFin as Timestamp).toDate().toISOString() : undefined,
    pendingSync: false,
  } as SuiviSession;
}

export function useSuiviSessions() {
  const [sessions, setSessions] = useState<SuiviSession[]>([]);
  const [syncing, setSyncing] = useState(false);

  // ── Real-time listener ──────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, COL), orderBy('dateDebut', 'desc'), limit(50));
    return onSnapshot(q, snap => {
      setSessions(snap.docs.map(d => sessionFromFirestore(d.id, d.data() as Record<string, unknown>)));
    }, () => { /* offline — keep stale */ });
  }, []);

  // ── Sync pending offline sessions when network returns ──────────────────
  const syncPending = useCallback(async () => {
    const pending = loadPendingSessions();
    if (!pending.length) return;
    setSyncing(true);
    for (const s of pending) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await addDoc(collection(db, COL), sessionToFirestore(s));
        removePendingSession(s.id);
      } catch { break; }
    }
    setSyncing(false);
  }, []);

  useEffect(() => {
    const onOnline = () => syncPending();
    window.addEventListener('online', onOnline);
    syncPending(); // also try on mount
    return () => window.removeEventListener('online', onOnline);
  }, [syncPending]);

  // ── Save a completed session ────────────────────────────────────────────
  const saveSession = useCallback(async (
    s: Omit<SuiviSession, 'id' | 'pendingSync' | 'surfaceCoveredM2' | 'distanceM' | 'vitesseMoyenneKmh' | 'rendementM2h'>
      & { gpsPoints: import('../types/suivi').GpsPoint[] }
      & { surfaceCoveredM2?: number; rendementM2h?: number }
  ) => {
    const dist  = totalDistanceM(s.gpsPoints);
    const area  = s.surfaceCoveredM2 ?? areaM2(s.gpsPoints);
    const speed = avgSpeedKmh(s.gpsPoints);
    const rendt = s.rendementM2h ?? (s.dureeMinutes > 0 ? (area / s.dureeMinutes) * 60 : 0);

    const full: Omit<SuiviSession, 'id' | 'pendingSync'> = {
      ...s,
      distanceM:           dist,
      surfaceCoveredM2:    area,
      vitesseMoyenneKmh:   speed,
      rendementM2h:        rendt,
    };

    if (navigator.onLine) {
      try {
        await addDoc(collection(db, COL), sessionToFirestore(full));
        return;
      } catch { /* fall through to offline queue */ }
    }
    queuePendingSession(full);
  }, []);

  return { sessions, saveSession, syncing };
}
