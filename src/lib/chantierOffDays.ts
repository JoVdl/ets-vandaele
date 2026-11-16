import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

// Writes only the joursOff field of one chantier, from an explicit user action.
export async function setChantierOffDays(chantierId: string, days: string[]): Promise<void> {
  await updateDoc(doc(db, 'chantiers', chantierId), { joursOff: days });
}
