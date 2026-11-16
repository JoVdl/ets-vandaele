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
      sm: smoothPoints(filterGpsTrack(s.gpsPoints, params.vitesseMaxKmh, 1.6, 150, false), params.smoothAlpha),
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

// In a long straight session (aspect ≥ 8, ≥ 40 m), points more than 60 m away from every other
// session of the chantier are GPS artefacts (transit line): they are left out of the geometry.
// A session left with too few points is dropped. GPS points are not modified.
export function chantierZones(
  sessions: SuiviSession[],
  chantiers: Chantier[],
  params: { vitesseMaxKmh: number; largeurM: number; smoothAlpha: number },
): { rects: Map<string, AlignedRect>; hidden: Set<string> } {
  const masks = findIsolatedSlivers(sessions, chantiers);
  const hidden = new Set<string>();
  const geometrySessions = sessions.flatMap(s => {
    const mask = masks.get(s.id);
    if (!mask) return [s];
    const gpsPoints = s.gpsPoints.filter((_, i) => mask[i]);
    if (gpsPoints.length < 4) { hidden.add(s.id); return []; }
    return [{ ...s, gpsPoints }];
  });
  return { rects: alignedRectsBySession(geometrySessions, chantiers, params), hidden };
}

function findIsolatedSlivers(sessions: SuiviSession[], chantiers: Chantier[]): Map<string, boolean[]> {
  const masks = new Map<string, boolean[]>();
  const dragueIds = new Set(chantiers.filter(c => c.drague).map(c => c.id));
  const byChantier = new Map<string, SuiviSession[]>();
  for (const s of sessions) {
    if (!dragueIds.has(s.chantierId) || s.gpsPoints.length < 10) continue;
    byChantier.set(s.chantierId, [...(byChantier.get(s.chantierId) ?? []), s]);
  }
  const M = 111320;
  for (const group of byChantier.values()) {
    if (group.length < 3) continue;
    const all = group.flatMap(s => s.gpsPoints);
    const lat0 = all.reduce((a, p) => a + p.lat, 0) / all.length;
    const lng0 = all.reduce((a, p) => a + p.lng, 0) / all.length;
    const kx = Math.cos(lat0 * Math.PI / 180) * M, ky = M;
    const xyOf = (s: SuiviSession) => s.gpsPoints.map(p => ({ x: (p.lng - lng0) * kx, y: (p.lat - lat0) * ky }));
    const xys = new Map(group.map(s => [s.id, xyOf(s)]));
    for (const s of group) {
      const xy = xys.get(s.id)!;
      const mx = xy.reduce((a, p) => a + p.x, 0) / xy.length;
      const my = xy.reduce((a, p) => a + p.y, 0) / xy.length;
      let sxx = 0, sxy = 0, syy = 0;
      for (const p of xy) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
      const tr = sxx + syy, det = sxx * syy - sxy * sxy;
      const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const l1 = tr / 2 + disc, l2 = Math.max(1e-9, tr / 2 - disc);
      const aspect = Math.sqrt(l1 / l2);
      const extent = 4 * Math.sqrt(l1);
      const others = group.filter(o => o.id !== s.id).flatMap(o => xys.get(o.id)!);
      const isolatedMask = xy.map(p => others.every(q => Math.hypot(p.x - q.x, p.y - q.y) > 60));
      masks.set(s.id, isolatedMask.map(v => !v));
    }
  }
  return masks;
}
