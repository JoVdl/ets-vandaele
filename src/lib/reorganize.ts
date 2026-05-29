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
    day = nextWorkingDay(addDays(maxConflictEnd, 1));
  }

  return null;
}

/**
 * Sort a group of chantiers by periodePreconiseeDebut/dateDebut then apply
 * nearest-neighbor + equipment synergy within each month group.
 * Returns ordered array and the last geographic position reached.
 */
function orderByProximity(
  group: Chantier[],
  startLat: number,
  startLon: number,
  prevChantier: Chantier | null,
): { ordered: Chantier[]; lastLat: number; lastLon: number; lastChantier: Chantier | null } {
  const sorted = [...group].sort((a, b) =>
    (a.periodePreconiseeDebut ?? a.dateDebut).localeCompare(b.periodePreconiseeDebut ?? b.dateDebut)
  );

  // Group by YYYY-MM
  const byMonth = new Map<string, Chantier[]>();
  for (const c of sorted) {
    const key = (c.periodePreconiseeDebut ?? c.dateDebut).substring(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(c);
  }

  const ordered: Chantier[] = [];
  let lastLat = startLat, lastLon = startLon;
  let lastChantier = prevChantier;

  for (const key of [...byMonth.keys()].sort()) {
    const monthGroup = byMonth.get(key)!;
    const withCoords = monthGroup.filter(c => c.latitude && c.longitude);
    const noCoords   = monthGroup.filter(c => !c.latitude || !c.longitude);

    const remaining = [...withCoords];
    while (remaining.length) {
      let bestIdx = 0, bestScore = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const c = remaining[i];
        const dist = haversine(lastLat, lastLon, c.latitude!, c.longitude!);
        const syn = lastChantier ? equipmentSynergy(lastChantier, c) * 15 : 0;
        const score = dist - syn;
        if (score < bestScore) { bestScore = score; bestIdx = i; }
      }
      const chosen = remaining.splice(bestIdx, 1)[0];
      ordered.push(chosen);
      lastLat = chosen.latitude!;
      lastLon = chosen.longitude!;
      lastChantier = chosen;
    }
    for (const c of noCoords) { ordered.push(c); lastChantier = c; }
  }

  return { ordered, lastLat, lastLon, lastChantier };
}

export interface ReorganizeResult { id: string; dateDebut: string; dateFin: string; }
export interface ReorganizeSummary { moved: number; warnings: string[]; results: ReorganizeResult[]; }

export type FilterStatus = 'all' | 'confirme' | 'potentiel' | 'archive';

/**
 * 'all'       — tous les chantiers non-verrouillés bougent (confirmés + potentiels)
 * 'confirme'  — seuls les confirmés non-verrouillés bougent ; les potentiels sont ignorés
 * 'potentiel' — les confirmés + verrouillés sont des ancres ; seuls les potentiels non-verrouillés bougent
 */
export type ReorganizeMode = 'all' | 'confirme' | 'potentiel';

export function reorganize(chantiers: Chantier[], mode: ReorganizeMode = 'potentiel'): ReorganizeSummary {
  const warnings: string[] = [];
  const results: ReorganizeResult[] = [];
  let moved = 0;

  const active = chantiers.filter(c => c.status !== 'refuse' && c.status !== 'annule');

  // Locked anchors never move regardless of mode
  const lockedAnchors = active.filter(c => c.datesVerrouillees);

  // Batches: confirmés always scheduled before potentiels to guarantee their priority
  let batch1: Chantier[]; // scheduled first (highest priority)
  let batch2: Chantier[]; // scheduled second (fills remaining gaps)

  if (mode === 'potentiel') {
    // Confirmed (non-locked) are also fixed anchors; only free potentiels move
    const confirmedAnchors = active.filter(c => c.status === 'confirme' && !c.datesVerrouillees);
    batch1 = active.filter(c => c.status === 'potentiel' && !c.datesVerrouillees).map(c => ({ ...c }));
    batch2 = [];
    // Add confirmed to locked anchors for slot conflict detection
    lockedAnchors.push(...confirmedAnchors);
  } else if (mode === 'confirme') {
    // Potentiels completely ignored; only free confirmed move
    batch1 = active.filter(c => c.status === 'confirme' && !c.datesVerrouillees).map(c => ({ ...c }));
    batch2 = [];
  } else {
    // 'all': confirmed are scheduled first (priority), potentiels fill the gaps
    batch1 = active.filter(c => c.status === 'confirme' && !c.datesVerrouillees).map(c => ({ ...c }));
    batch2 = active.filter(c => c.status === 'potentiel' && !c.datesVerrouillees).map(c => ({ ...c }));
  }

  if (batch1.length === 0 && batch2.length === 0) {
    const label = mode === 'confirme' ? ' confirmé' : mode === 'potentiel' ? ' potentiel (non verrouillé)' : '';
    return { moved: 0, warnings: [`Aucun chantier${label} à réorganiser.`], results: [] };
  }

  // Preserve working-day durations for all moveable chantiers
  const allMoveable = [...batch1, ...batch2];
  const wdDurations = new Map(
    allMoveable.map(c => [c.id, Math.max(1, countWorkingDays(new Date(c.dateDebut), new Date(c.dateFin)))])
  );

  // Seed geographic starting point from last geolocated locked anchor
  const geoLocked = lockedAnchors.filter(a => a.latitude && a.longitude);
  const seedLat = geoLocked.length ? geoLocked[geoLocked.length - 1].latitude! : 48.8;
  const seedLon = geoLocked.length ? geoLocked[geoLocked.length - 1].longitude! : 2.3;

  // Scheduled slots (starts with all fixed anchors)
  const scheduled: Slot[] = lockedAnchors.map(c => ({
    chantier: c,
    start: nextWorkingDay(startOfDay(new Date(c.dateDebut))),
    end:   prevWorkingDay(startOfDay(new Date(c.dateFin))),
  }));

  // Schedule one batch, updating scheduled in-place; returns last known geo position
  function scheduleBatch(batch: Chantier[], startLat: number, startLon: number): { lat: number; lon: number } {
    if (!batch.length) return { lat: startLat, lon: startLon };
    const { ordered } = orderByProximity(batch, startLat, startLon, null);
    let lat = startLat, lon = startLon;

    for (const c of ordered) {
      const wdDur = wdDurations.get(c.id) ?? 1;
      const searchFrom = nextWorkingDay(startOfDay(new Date(c.periodePreconiseeDebut ?? c.dateDebut)));
      const slot = findSlot(c, wdDur, searchFrom, scheduled);

      if (!slot) {
        warnings.push(`"${c.nom}" : impossible de trouver un créneau dans les 500 jours.`);
        results.push({ id: c.id, dateDebut: c.dateDebut, dateFin: c.dateFin });
        continue;
      }

      if (c.periodePreconiseeFin && slot.end > prevWorkingDay(startOfDay(new Date(c.periodePreconiseeFin)))) {
        const prefix = c.status === 'confirme' ? '⚠ Confirmé — ' : '';
        warnings.push(`${prefix}"${c.nom}" : ne peut pas être placé dans sa période préconisée (conflit de ressources ou effectifs).`);
      }

      const newDebut = format(slot.start, 'yyyy-MM-dd');
      const newFin   = format(slot.end,   'yyyy-MM-dd');
      if (newDebut !== c.dateDebut || newFin !== c.dateFin) moved++;

      scheduled.push({ chantier: { ...c, dateDebut: newDebut, dateFin: newFin }, start: slot.start, end: slot.end });
      results.push({ id: c.id, dateDebut: newDebut, dateFin: newFin });
      if (c.latitude && c.longitude) { lat = c.latitude; lon = c.longitude; }
    }
    return { lat, lon };
  }

  // Batch 1 (priority) goes first; batch 2 fills remaining slots
  const { lat, lon } = scheduleBatch(batch1, seedLat, seedLon);
  scheduleBatch(batch2, lat, lon);

  return { moved, warnings, results };
}
