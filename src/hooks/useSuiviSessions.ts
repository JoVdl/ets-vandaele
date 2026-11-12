import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  collection, addDoc, deleteDoc, updateDoc, doc, onSnapshot, query, orderBy, where, getDocs,
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

// Toutes les sessions d'un chantier (sans la limite de la liste en direct), hors corbeille
export async function fetchAllChantierSessions(chantierId: string): Promise<SuiviSession[]> {
  const snap = await getDocs(query(collection(db, COL), where('chantierId', '==', chantierId)));
  return snap.docs
    .map(d => sessionFromFirestore(d.id, d.data() as Record<string, unknown>))
    .filter(s => !s.deletedAt)
    .sort((a, b) => new Date(a.dateDebut).getTime() - new Date(b.dateDebut).getTime());
}

export function useSuiviSessions() {
  const [allSessions, setAllSessions] = useState<SuiviSession[]>([]);
  const [syncing, setSyncing] = useState(false);

  // ── Real-time listener — re-souscrit au retour au premier plan ──────────
  useEffect(() => {
    const q = query(collection(db, COL), orderBy('dateDebut', 'desc'), limit(50));

    const subscribe = () => onSnapshot(q, snap => {
      setAllSessions(snap.docs.map(d => sessionFromFirestore(d.id, d.data() as Record<string, unknown>)));
    }, () => { /* offline — keep stale */ });

    let unsub = subscribe();

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        unsub();
        unsub = subscribe();
      }
    };

    // Re-subscribe périodique toutes les 3 min (évite les connexions WS figées)
    const interval = setInterval(() => {
      unsub();
      unsub = subscribe();
    }, 3 * 60 * 1000);

    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsub();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
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

  // Suppression douce : la session est gardée avec deletedAt, restaurable depuis la corbeille
  const deleteSession = useCallback(async (id: string) => {
    try {
      await updateDoc(doc(db, COL, id), { deletedAt: new Date().toISOString() });
    } catch { /* offline or not found — ignore */ }
  }, []);

  const restoreSession = useCallback(async (id: string) => {
    try {
      await updateDoc(doc(db, COL, id), { deletedAt: null });
    } catch { /* offline — ignore */ }
  }, []);

  const purgeSession = useCallback(async (id: string) => {
    try {
      await deleteDoc(doc(db, COL, id));
    } catch { /* offline or not found — ignore */ }
  }, []);

  const updateSession = useCallback(async (id: string, patch: Partial<Omit<SuiviSession, 'id'>>) => {
    try {
      await updateDoc(doc(db, COL, id), patch as Record<string, unknown>);
    } catch { /* offline — ignore */ }
  }, []);

  const sessions = useMemo(() => allSessions.filter(s => !s.deletedAt), [allSessions]);
  const trashedSessions = useMemo(
    () => allSessions.filter(s => !!s.deletedAt).sort((a, b) => (b.deletedAt! > a.deletedAt! ? 1 : -1)),
    [allSessions],
  );

  return { sessions, trashedSessions, saveSession, deleteSession, restoreSession, purgeSession, updateSession, syncing };
}
