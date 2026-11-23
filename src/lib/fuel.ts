import type { SuiviSession } from '../types/suivi';
import type { FuelRefill } from '../hooks/useFuelRefills';

export interface FuelStats {
  totalL: number;          // total fuel added
  lPerH: number | null;    // average consumption: all fuel added ÷ all hours worked since the start
  hoursTotal: number;      // all hours worked on the chantier
}

// Refills are sparse, so per-interval rates are noisy: consumption is averaged over the whole chantier.
export function computeFuel(refills: FuelRefill[], sessions: SuiviSession[]): FuelStats {
  const totalL = refills.reduce((a, r) => a + r.litres, 0);
  const hoursTotal = sessions.reduce((a, s) => a + s.dureeMinutes, 0) / 60;
  return { totalL, lPerH: hoursTotal > 0 && totalL > 0 ? totalL / hoursTotal : null, hoursTotal };
}
