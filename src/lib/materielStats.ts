import { differenceInCalendarDays } from 'date-fns';
import type { Materiel } from '../types/materiel';

// Hours on the meter: approximate starting value plus hours logged since tracking began.
export function heuresCompteur(m: Materiel): number {
  return (m.heuresInitiales ?? 0) + m.journal
    .filter(j => j.type === 'utilisation')
    .reduce((a, j) => a + (j.heures ?? 0), 0);
}

// Utilisation rate: hours used ÷ hours available (8 h per calendar working day since tracking began).
export function tauxUtilisation(m: Materiel, now = new Date()): number | null {
  const jours = Math.max(0, differenceInCalendarDays(now, new Date(m.suiviDepuis)));
  const joursOuvres = Math.max(1, Math.round(jours * 5 / 7));
  const heures = m.journal.filter(j => j.type === 'utilisation').reduce((a, j) => a + (j.heures ?? 0), 0);
  return heures > 0 ? Math.min(100, (heures / (joursOuvres * 8)) * 100) : 0;
}

// Open tasks; a blocking one puts the machine in a red state.
export function tachesOuvertes(m: Materiel) {
  const ouvertes = m.taches.filter(t => !t.fait);
  return { total: ouvertes.length, bloquantes: ouvertes.filter(t => t.bloquant).length };
}
