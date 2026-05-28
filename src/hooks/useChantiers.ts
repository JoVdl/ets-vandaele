import { useState, useEffect } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, query, orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Chantier } from '../types';

const COLLECTION = 'chantiers';

export function useChantiers() {
  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, COLLECTION), orderBy('dateDebut'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Chantier));
        setChantiers(data);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  const addChantier = async (data: Omit<Chantier, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    await addDoc(collection(db, COLLECTION), { ...data, createdAt: now, updatedAt: now });
  };

  const updateChantier = async (id: string, data: Partial<Omit<Chantier, 'id' | 'createdAt'>>) => {
    await updateDoc(doc(db, COLLECTION, id), { ...data, updatedAt: new Date().toISOString() });
  };

  const deleteChantier = async (id: string) => {
    await deleteDoc(doc(db, COLLECTION, id));
  };

  const confirmChantier = (id: string) => updateChantier(id, { status: 'confirme' });

  return { chantiers, loading, error, addChantier, updateChantier, deleteChantier, confirmChantier };
}
