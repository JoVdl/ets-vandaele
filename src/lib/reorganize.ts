import { addDays, startOfDay } from 'date-fns';
import { format } from 'date-fns';
import type { Chantier } from '../types';
import { nextWorkingDay, prevWorkingDay, countWorkingDays, addWorkingDays } from './workingDays';

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Score bonus for consecutive chantiers sharing equipment (reduces transport cost) */
function equipmentSynergy(a: Chantier, b: Chantier): number {
  let score = 0;
  if (a.chenillette && b.chenillette) score += 3;
  if (a.bateauFaucardeur && b.bateauFaucardeur) score += 4;
  if (a.drague && b.drague) score += 4;
  if (a.telesco && b.telesco) score += 3;
  if (a.pelles?.length && b.pelles?.length) {
    const aSet = new Set(a.pelles);
    score += b.pelles.filter(p => aSet.has(p)).length * 2;
  }
  if ((a.dumpers ?? 0) > 0 && (b.dumpers ?? 0) > 0) score += 1;
  if ((a.bulls ?? 0) > 0 && (b.bulls ?? 0) > 0) score += 1;
  if ((a.tractoBennes ?? 0) > 0 && (b.tractoBennes ?? 0) > 0) score += 1;
  return score;
}

/**
 * Returns true if running both chantiers simultaneously would exceed available resources.
 *
 * Assumptions: 2 people total, 1 unit of each equipment type (chenillette, bateauFaucardeur,
 * drague, telesco, each pelle type, bull, dumper, tractoBenne, rouleau).
 */
function resourceConflict(a: Chantier, b: Chantier): boolean {
  if ((a.nombrePersonnes ?? 1) + (b.nombrePersonnes ?? 1) > 2) return true;
  if (a.chenillette && b.chenillette) return true;
  if (a.bateauFaucardeur && b.bateauFaucardeur) return true;
  if (a.drague && b.drague) return true;
  if (a.telesco && b.telesco) return true;
  if (a.pelles?.length && b.pelles?.length) {
    const aSet = new Set(a.pelles);
    if (b.pelles.some(p => aSet.has(p))) return true;
  }
  if ((a.bulls ?? 0) > 0 && (b.bulls ?? 0) > 0) return true;
  if ((a.dumpers ?? 0) > 0 && (b.dumpers ?? 0) > 0) return true;
  if ((a.tractoBennes ?? 0) > 0 && (b.tractoBennes ?? 0) > 0) return true;
  if ((a.rouleaux ?? 0) > 0 && (b.rouleaux ?? 0) > 0) return true;
  return false;
}

interface Slot { chantier: Chantier; start: Date; end: Date; }

/**
 * Find the earliest working-day start ≥ searchFrom such that [start, start+wdDur working days]
 * has no resource conflict with any already-scheduled slot.
 * Jumps past conflicting slots rather than advancing one day at a time.
 */
function findSlot(
  c: Chantier,
  wdDur: number,
  searchFrom: Date,
  scheduled: Slot[],
): { start: Date; end: Date } | null {
  let day = nextWorkingDay(startOfDay(searchFrom));

  for (let iter = 0; iter < 500; iter++) {
    const end = wdDur > 1 ? addWorkingDays(day, wdDur - 1) : day;

    let maxConflictEnd: Date | null = null;
    for (const s of scheduled) {
      if (day <= s.end && end >= s.start && resourceConflict(c, s.chantier)) {
        if (!maxConflictEnd || s.end > maxConflictEnd) maxConflictEnd = s.end;
      }
    }

    if (!maxConflictEnd) return { start: day, end };
    // Jump to the working day after the latest conflicting slot
    day = nextWorkingDay(addDays(maxConflictEnd, 1));
  }

  return null;
}

export interface ReorganizeResult { id: string; dateDebut: string; dateFin: string; }
export interface ReorganizeSummary { moved: number; warnings: string[]; results: ReorganizeResult[]; }

export function reorganize(chantiers: Chantier[]): ReorganizeSummary {
  const warnings: string[] = [];

  const active = chantiers.filter(c => c.status !== 'refuse' && c.status !== 'annule');

  // Only date-locked chantiers are anchors (confirmed OR potentiel with datesVerrouillees)
  const anchors  = active.filter(c => c.datesVerrouillees);
  const moveable = active.filter(c => !c.datesVerrouillees).map(c => ({ ...c }));

  if (moveable.length === 0) {
    return { moved: 0, warnings: ['Aucun chantier à réorganiser (tous verrouillés ou aucun actif).'], results: [] };
  }

  // Preserve working-day durations (minimum 1 day)
  const wdDurations = new Map(
    moveable.map(c => [c.id, Math.max(1, countWorkingDays(new Date(c.dateDebut), new Date(c.dateFin)))])
  );

  // Primary sort: earlier recommended period first (use current dateDebut for chantiers without one)
  moveable.sort((a, b) =>
    (a.periodePreconiseeDebut ?? a.dateDebut).localeCompare(b.periodePreconiseeDebut ?? b.dateDebut)
  );

  // Group by YYYY-MM of recommended start, then apply nearest-neighbor + equipment synergy within each group
  const groups = new Map<string, typeof moveable>();
  for (const c of moveable) {
    const key = (c.periodePreconiseeDebut ?? c.dateDebut).substring(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  // Seed from last geolocalised anchor, or Paris default
  const geoAnchors = anchors.filter(a => a.latitude && a.longitude);
  let lastLat = geoAnchors.length ? geoAnchors[geoAnchors.length - 1].latitude! : 48.8;
  let lastLon = geoAnchors.length ? geoAnchors[geoAnchors.length - 1].longitude! : 2.3;

  const finalOrder: typeof moveable = [];

  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)!;
    const withCoords = group.filter(c => c.latitude && c.longitude);
    const noCoords   = group.filter(c => !c.latitude || !c.longitude);

    const remaining = [...withCoords];
    while (remaining.length) {
      let bestIdx = 0, bestScore = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const c = remaining[i];
        const dist = haversine(lastLat, lastLon, c.latitude!, c.longitude!);
        // Equipment synergy lowers the effective distance (bonus = km reduction)
        const syn = finalOrder.length > 0 ? equipmentSynergy(finalOrder[finalOrder.length - 1], c) * 15 : 0;
        const score = dist - syn;
        if (score < bestScore) { bestScore = score; bestIdx = i; }
      }
      const chosen = remaining.splice(bestIdx, 1)[0];
      finalOrder.push(chosen);
      lastLat = chosen.latitude!;
      lastLon = chosen.longitude!;
    }
    finalOrder.push(...noCoords);
  }

  // Seed scheduled slots with anchor chantiers — snap to working days
  const scheduled: Slot[] = anchors.map(c => ({
    chantier: c,
    start: nextWorkingDay(startOfDay(new Date(c.dateDebut))),
    end:   prevWorkingDay(startOfDay(new Date(c.dateFin))),
  }));

  const results: ReorganizeResult[] = [];
  let moved = 0;

  for (const c of finalOrder) {
    const wdDur      = wdDurations.get(c.id) ?? 1;
    const searchFrom = nextWorkingDay(startOfDay(
      new Date(c.periodePreconiseeDebut ?? c.dateDebut)
    ));

    const slot = findSlot(c, wdDur, searchFrom, scheduled);

    if (!slot) {
      warnings.push(`"${c.nom}" : impossible de trouver un créneau dans les 500 jours.`);
      results.push({ id: c.id, dateDebut: c.dateDebut, dateFin: c.dateFin });
      continue;
    }

    if (c.periodePreconiseeFin && slot.end > prevWorkingDay(startOfDay(new Date(c.periodePreconiseeFin)))) {
      warnings.push(`"${c.nom}" : ne peut pas être placé dans sa période préconisée (conflit de ressources ou effectifs).`);
    }

    const newDebut = format(slot.start, 'yyyy-MM-dd');
    const newFin   = format(slot.end,   'yyyy-MM-dd');
    if (newDebut !== c.dateDebut || newFin !== c.dateFin) moved++;

    scheduled.push({ chantier: { ...c, dateDebut: newDebut, dateFin: newFin }, start: slot.start, end: slot.end });
    results.push({ id: c.id, dateDebut: newDebut, dateFin: newFin });
  }

  return { moved, warnings, results };
}
