import type { SuiviSession } from '../types/suivi';
import type { FuelRefill } from '../hooks/useFuelRefills';

export interface FuelStats {
  totalL: number;          // total fuel added
  lPerH: number | null;    // smoothed consumption, litres per hour worked
  hoursSpan: number;       // hours worked covered by the refills
}

// Hours worked between two instants: session time overlapping the interval.
function hoursBetween(sessions: SuiviSession[], from: number, to: number): number {
  let ms = 0;
  for (const s of sessions) {
    const start = new Date(s.dateDebut).getTime();
    const end = s.dateFin ? new Date(s.dateFin).getTime() : start + s.dureeMinutes * 60000;
    const o = Math.min(end, to) - Math.max(start, from);
    if (o > 0) ms += o;
  }
  return ms / 3600000;
}

// Each refill covers the fuel burnt since the previous refill; its rate is litres / hours worked
// in that interval. Rates are smoothed over the last five intervals (weighted by hours).
export function computeFuel(refills: FuelRefill[], sessions: SuiviSession[]): FuelStats {
  const totalL = refills.reduce((a, r) => a + r.litres, 0);
  const intervals: { litres: number; hours: number }[] = [];
  for (let i = 1; i < refills.length; i++) {
    const from = new Date(refills[i - 1].ts).getTime();
    const to = new Date(refills[i].ts).getTime();
    const hours = hoursBetween(sessions, from, to);
    if (hours > 0) intervals.push({ litres: refills[i].litres, hours });
  }
  const recent = intervals.slice(-5);
  const H = recent.reduce((a, x) => a + x.hours, 0);
  const L = recent.reduce((a, x) => a + x.litres, 0);
  const hoursSpan = intervals.reduce((a, x) => a + x.hours, 0);
  return { totalL, lPerH: H > 0 ? L / H : null, hoursSpan };
}
