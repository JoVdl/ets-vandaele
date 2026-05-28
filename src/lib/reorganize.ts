import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';
import { format } from 'date-fns';
import type { Chantier } from '../types';
import { nextWorkingDay } from './workingDays';

/** Haversine distance in km between two lat/lon points */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function durationDays(c: Chantier): number {
  return differenceInCalendarDays(new Date(c.dateFin), new Date(c.dateDebut));
}

export interface ReorganizeResult {
  id: string;
  dateDebut: string;
  dateFin: string;
}

export interface ReorganizeSummary {
  moved: number;
  warnings: string[];
  results: ReorganizeResult[];
}

/**
 * Smart reorganization:
 * 1. Confirmed chantiers stay fixed (anchors).
 * 2. Potentiel chantiers are shifted:
 *    a. If they have a recommended period, move them to start at the recommended début.
 *    b. Then order overlapping-window chantiers by geographic proximity (nearest-neighbor TSP).
 * 3. All chantiers snap to working days.
 * 4. Dates are pushed forward to avoid overlaps with confirmed anchors.
 */
export function reorganize(chantiers: Chantier[]): ReorganizeSummary {
  const warnings: string[] = [];

  // Refused/annulled are ignored entirely
  const active = chantiers.filter(c => c.status !== 'refuse' && c.status !== 'annule');

  // Anchors: confirmed chantiers + potentiels with locked dates
  const anchors = active
    .filter(c => c.status === 'confirme' || c.datesVerrouillees)
    .map(c => ({ ...c }));

  const moveable = active
    .filter(c => c.status === 'potentiel' && !c.datesVerrouillees)
    .map(c => ({ ...c }));

  if (moveable.length === 0) {
    return { moved: 0, warnings: ['Aucun chantier potentiel (non verrouillé) à réorganiser.'], results: [] };
  }

  // Step 1: For moveable chantiers with a recommended period, pin to recommended start
  for (const c of moveable) {
    if (c.periodePreconiseeDebut) {
      const recomm = startOfDay(new Date(c.periodePreconiseeDebut));
      const snap = nextWorkingDay(recomm);
      const dur = durationDays(c);
      c.dateDebut = format(snap, 'yyyy-MM-dd');
      c.dateFin   = format(addDays(snap, dur), 'yyyy-MM-dd');
    }
  }

  // Step 2: Sort moveable by dateDebut, then apply nearest-neighbor reordering
  // within groups that start in the same week
  moveable.sort((a, b) => a.dateDebut.localeCompare(b.dateDebut));

  const withCoords = moveable.filter(c => c.latitude && c.longitude);
  const noCoords   = moveable.filter(c => !c.latitude || !c.longitude);

  // Nearest-neighbor on those with coordinates
  const ordered: typeof moveable = [];
  const remaining = [...withCoords];
  let lastLat = 48.8; // Paris default
  let lastLon = 2.3;

  while (remaining.length) {
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const dist = haversine(lastLat, lastLon, c.latitude!, c.longitude!);
      // Score = distance + days until recommended start (penalizes going too early)
      const daysUntil = differenceInCalendarDays(new Date(c.dateDebut), new Date());
      const score = dist + Math.max(0, -daysUntil) * 10;
      if (score < bestScore) { bestScore = score; bestIdx = i; }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    ordered.push(chosen);
    lastLat = chosen.latitude!;
    lastLon = chosen.longitude!;
  }

  // Combine: ordered (geo-optimized) + no-coords at end
  const finalOrder = [...ordered, ...noCoords];

  // Step 3: Resolve overlaps with anchors
  // Build a list of "occupied" day ranges from anchors
  const anchorRanges = anchors.map(c => ({
    start: startOfDay(new Date(c.dateDebut)),
    end:   startOfDay(new Date(c.dateFin)),
  }));

  const results: ReorganizeResult[] = [];
  let moved = 0;

  for (const c of finalOrder) {
    const originalStart = c.dateDebut;
    let start = nextWorkingDay(startOfDay(new Date(c.dateDebut)));
    const dur = durationDays(c);

    // Push start forward past any conflicting anchor
    let pushed = true;
    let safetyLimit = 0;
    while (pushed && safetyLimit < 60) {
      pushed = false;
      safetyLimit++;
      const end = addDays(start, dur);
      for (const r of anchorRanges) {
        if (start <= r.end && end >= r.start) {
          // Overlap: push to day after anchor ends
          start = nextWorkingDay(addDays(r.end, 1));
          pushed = true;
        }
      }
    }

    const newDebut = format(start, 'yyyy-MM-dd');
    const newFin   = format(addDays(start, dur), 'yyyy-MM-dd');

    // Check recommended period
    if (c.periodePreconiseeFin && newFin > c.periodePreconiseeFin) {
      warnings.push(`"${c.nom}" ne peut pas être placé dans sa période préconisée (conflit avec chantiers confirmés).`);
    }

    if (newDebut !== originalStart) moved++;

    results.push({ id: c.id, dateDebut: newDebut, dateFin: newFin });
  }

  return { moved, warnings, results };
}
