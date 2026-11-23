import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Chantier } from '../types';

type Facturation = NonNullable<Chantier['facturation']>;

// Writes only the facturation field of one chantier, from an explicit patron action.
export async function setChantierFacturation(chantierId: string, value: Facturation): Promise<void> {
  await updateDoc(doc(db, 'chantiers', chantierId), { facturation: value });
}
