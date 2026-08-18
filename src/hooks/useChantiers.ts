import { useState, useEffect } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, query, orderBy, deleteField,
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
        const data = snap.docs.map((d) => {
          const raw = { id: d.id, ...d.data() } as unknown as Chantier & { polygon?: unknown };
          // Migrate old flat polygon {lat,lng}[] → new nested {lat,lng}[][]
          if (Array.isArray(raw.polygon) && raw.polygon.length > 0) {
            const first = (raw.polygon as unknown[])[0];
            if (first && typeof first === 'object' && 'lat' in (first as object)) {
              (raw as unknown as Record<string, unknown>).polygon = [raw.polygon];
            }
          }
          return raw as unknown as Chantier;
        });
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
    const clean = Object.fromEntries(
      Object.entries({ ...data, createdAt: now, updatedAt: now }).filter(([, v]) => v !== undefined)
    );
    await addDoc(collection(db, COLLECTION), clean);
  };

  const updateChantier = async (id: string, data: Partial<Omit<Chantier, 'id' | 'createdAt'>>) => {
    const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const [k, v] of Object.entries(data)) {
      payload[k] = v === undefined ? deleteField() : v;
    }
    await updateDoc(doc(db, COLLECTION, id), payload);
  };

  const deleteChantier = async (id: string) => {
    await deleteDoc(doc(db, COLLECTION, id));
  };

  const confirmChantier = (id: string) => updateChantier(id, { status: 'confirme' });

  return { chantiers, loading, error, addChantier, updateChantier, deleteChantier, confirmChantier };
}
