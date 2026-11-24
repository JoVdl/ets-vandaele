import { useEffect, useState, useCallback } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Materiel } from '../types/materiel';

const COL = 'materiel';

// Firestore rejects undefined values: drop them before writing.
function clean<T extends object>(o: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

// Equipment records: patron-only UI; each record is updated as a whole from explicit actions.
export function useMateriel() {
  const [items, setItems] = useState<Materiel[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => onSnapshot(collection(db, COL), snap => {
    setItems(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Materiel, 'id'>) })));
    setLoaded(true);
  }, () => { /* offline — keep last known */ }), []);

  const add = useCallback(async (m: Omit<Materiel, 'id'>) => {
    const ref = await addDoc(collection(db, COL), clean(m));
    return ref.id;
  }, []);

  const update = useCallback(async (id: string, patch: Partial<Omit<Materiel, 'id'>>) => {
    await updateDoc(doc(db, COL, id), clean(patch));
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteDoc(doc(db, COL, id));
  }, []);

  return { items, loaded, add, update, remove };
}
