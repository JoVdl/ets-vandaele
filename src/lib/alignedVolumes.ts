import type { SuiviSession } from '../types/suivi';
import type { Chantier } from '../types';
import { filterGpsTrack, smoothPoints, sessionOBBsAligned } from './geo';

export interface AlignedRect {
  polygon:   [number, number][];   // [lat, lng] corners
  lengthM:   number;               // work width: extent along the passes
  widthM:    number;
  measuredWidthM: number;          // advancement: extent across the passes
  areaM2:    number;
  volumeM3?: number;               // areaM2 × depth × passes, when depth is known
}

// Display-only: rectangles on the shared work axis of each drague chantier.
// Stored session values are never modified.
export function alignedRectsBySession(
  sessions: SuiviSession[],
  chantiers: Chantier[],
  params: { vitesseMaxKmh: number; largeurM: number; smoothAlpha: number },
): Map<string, AlignedRect> {
  const out = new Map<string, AlignedRect>();
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
      if (!obb) return;
      const depth = (s.profondeurDragageM ?? 0) * Math.max(1, s.nbPassesParPosition ?? 1);
      out.set(s.id, {
        polygon:  obb.polygon.map(p => [p.lat, p.lng] as [number, number]),
        lengthM:  obb.lengthM,
        widthM:   obb.widthM,
        measuredWidthM: obb.measuredWidthM,
        areaM2:   obb.areaM2,
        volumeM3: depth > 0 ? obb.areaM2 * depth : undefined,
      });
    });
  }
  return out;
}
