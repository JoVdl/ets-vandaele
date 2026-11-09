import {
  collection, addDoc, query, where, onSnapshot,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';

export type ChantierEventType =
  | 'session_start'
  | 'session_pause'
  | 'session_resume'
  | 'session_end'
  | 'incident';

export interface ChantierEvent {
  id: string;
  type: ChantierEventType;
  chantierId: string;
  chantierNom: string;
  operateur: 'patron' | 'salarie';
  salarieNom?: string;
  deviceId: string;
  ts: Timestamp;
  incidentLabel?: string;
  incidentDureeMin?: number;
  dureeSessionMin?: number;
}

const COL = 'chantierEvents';

/** Stable per-device ID stored in localStorage. */
export function getDeviceId(): string {
  let id = localStorage.getItem('ets_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('ets_device_id', id);
  }
  return id;
}

export async function writeChantierEvent(
  ev: Omit<ChantierEvent, 'id' | 'ts'>,
): Promise<void> {
  try {
    await addDoc(collection(db, COL), { ...ev, ts: serverTimestamp() });
  } catch (e) {
    console.warn('[events] write failed', e);
  }
}

/**
 * Listen to events newer than `since` that did NOT come from this device.
 * Returns an unsubscribe function.
 */
export function listenChantierEvents(
  since: Date,
  deviceId: string,
  onEvent: (ev: ChantierEvent) => void,
): () => void {
  const q = query(
    collection(db, COL),
    where('ts', '>=', Timestamp.fromDate(since)),
  );
  return onSnapshot(q, snap => {
    for (const change of snap.docChanges()) {
      if (change.type !== 'added') continue;
      const ev = { id: change.doc.id, ...change.doc.data() } as ChantierEvent;
      if (ev.deviceId === deviceId) continue; // own event — skip
      onEvent(ev);
    }
  });
}
