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
  const far = findFarMasks(sessions, chantiers);
  const hidden = new Set<string>();
  const geometrySessions = sessions.flatMap(s => {
    const iso = masks.get(s.id);
    const fr = far.get(s.id);
    if (!iso && !fr) return [s];
    const mask = s.gpsPoints.map((_, i) => (iso ? iso[i] : true) && (fr ? fr[i] : true));
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
      const others = group.filter(o => o.id !== s.id).flatMap(o => xys.get(o.id)!);
      const isolatedMask = xy.map(p => others.every(q => Math.hypot(p.x - q.x, p.y - q.y) > 60));
      masks.set(s.id, isolatedMask.map(v => !v));
    }
  }
  return masks;
}

// Points far beyond the chantier's usual spread are GPS excursions: left out of geometry only.
function findFarMasks(sessions: SuiviSession[], chantiers: Chantier[]): Map<string, boolean[]> {
  const masks = new Map<string, boolean[]>();
  const dragueIds = new Set(chantiers.filter(c => c.drague).map(c => c.id));
  const byChantier = new Map<string, SuiviSession[]>();
  for (const s of sessions) {
    if (!dragueIds.has(s.chantierId) || s.gpsPoints.length < 4) continue;
    byChantier.set(s.chantierId, [...(byChantier.get(s.chantierId) ?? []), s]);
  }
  const M = 111320;
  for (const group of byChantier.values()) {
    const all = group.flatMap(s => s.gpsPoints);
    const lat0 = all.reduce((a, p) => a + p.lat, 0) / all.length;
    const lng0 = all.reduce((a, p) => a + p.lng, 0) / all.length;
    const kx = Math.cos(lat0 * Math.PI / 180) * M, ky = M;
    const xy = all.map(p => ({ x: (p.lng - lng0) * kx, y: (p.lat - lat0) * ky }));
    const mx = [...xy.map(p => p.x)].sort((a, b) => a - b)[Math.floor(xy.length / 2)];
    const my = [...xy.map(p => p.y)].sort((a, b) => a - b)[Math.floor(xy.length / 2)];
    const d = xy.map(p => Math.hypot(p.x - mx, p.y - my));
    const p75 = [...d].sort((a, b) => a - b)[Math.floor(0.75 * (d.length - 1))];
    const R = Math.max(50, 2.5 * p75);
    let i = 0;
    for (const s of group) {
      const mask = s.gpsPoints.map((_, k) => d[i + k] <= R);
      i += s.gpsPoints.length;
      if (mask.some(v => !v)) masks.set(s.id, mask);
    }
  }
  return masks;
}
