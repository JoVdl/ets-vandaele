import type { SuiviSession } from '../types/suivi';
import type { Chantier } from '../types';
import { filterGpsTrack, smoothPoints, sessionOBBsAligned } from './geo';

// Display-only: volumes recomputed from the aligned rectangles (area × depth × passes).
// Stored session volumes are never modified.
export function alignedVolumesBySession(
  sessions: SuiviSession[],
  chantiers: Chantier[],
  params: { vitesseMaxKmh: number; largeurM: number; smoothAlpha: number },
): Map<string, number> {
  const out = new Map<string, number>();
  const dragueIds = new Set(chantiers.filter(c => c.drague).map(c => c.id));

  const byChantier = new Map<string, SuiviSession[]>();
  for (const s of sessions) {
    if (!dragueIds.has(s.chantierId) || s.gpsPoints.length <= 1) continue;
    const list = byChantier.get(s.chantierId) ?? [];
    list.push(s);
    byChantier.set(s.chantierId, list);
  }

  for (const list of byChantier.values()) {
    const prepared = list.map(s => ({
      s,
      sm: smoothPoints(filterGpsTrack(s.gpsPoints, params.vitesseMaxKmh, 1.6, 150), params.smoothAlpha),
    }));
    const obbs = sessionOBBsAligned(prepared.map(p => ({ points: p.sm })), params.largeurM);
    prepared.forEach(({ s }, i) => {
      const obb = obbs[i];
      const depth = (s.profondeurDragageM ?? 0) * Math.max(1, s.nbPassesParPosition ?? 1);
      if (obb && depth > 0) out.set(s.id, obb.areaM2 * depth);
    });
  }
  return out;
}
