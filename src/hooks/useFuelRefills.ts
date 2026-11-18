import { useEffect, useState, useCallback } from 'react';
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';

const COL = 'suivi_gasoil';

export interface FuelRefill {
  id: string;
  chantierId: string;
  ts: string;      // ISO date-time of the refill
  litres: number;
}

// Refills are separate records: sessions are never modified by fuel entries.
export function useFuelRefills(chantierId: string) {
  const [refills, setRefills] = useState<FuelRefill[]>([]);

  useEffect(() => {
    const q = query(collection(db, COL), where('chantierId', '==', chantierId));
    return onSnapshot(q, snap => {
      setRefills(
        snap.docs
          .map(d => ({ id: d.id, ...(d.data() as Omit<FuelRefill, 'id'>) }))
          .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()),
      );
    }, () => { /* offline — keep last known */ });
  }, [chantierId]);

  const addRefill = useCallback(async (ts: string, litres: number) => {
    await addDoc(collection(db, COL), { chantierId, ts, litres });
  }, [chantierId]);

  const removeRefill = useCallback(async (id: string) => {
    await deleteDoc(doc(db, COL, id));
  }, []);

  return { refills, addRefill, removeRefill };
}
