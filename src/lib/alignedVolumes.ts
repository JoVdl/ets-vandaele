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
  const rects = alignedRectsBySession(geometrySessions, chantiers, params);
  applyOverrides(rects, sessions);
  return { rects, hidden };
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

// Manually corrected zones replace the computed footprint; area, advancement and width follow
// from the corners and the volume keeps the session's depth.
function applyOverrides(rects: Map<string, AlignedRect>, sessions: SuiviSession[]): void {
  const M = 111320;
  for (const s of sessions) {
    const c: [number, number][] | undefined = s.zoneOverride?.map(p => [p.lat, p.lng] as [number, number]);
    if (!c || c.length !== 4) continue;
    const la0 = c.reduce((a, p) => a + p[0], 0) / 4;
    const ln0 = c.reduce((a, p) => a + p[1], 0) / 4;
    const kx = Math.cos(la0 * Math.PI / 180) * M, ky = M;
    const P = c.map(([la, ln]) => ({ x: (ln - ln0) * kx, y: (la - la0) * ky }));
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const L = (d(P[0], P[1]) + d(P[3], P[2])) / 2;
    const W = (d(P[0], P[3]) + d(P[1], P[2])) / 2;
    let sa = 0;
    for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4]; sa += a.x * b.y - b.x * a.y; }
    const area = Math.abs(sa) / 2;
    const depth = (s.profondeurDragageM ?? 0) * Math.max(1, s.nbPassesParPosition ?? 1);
    rects.set(s.id, {
      polygon: c.map(p => [p[0], p[1]] as [number, number]),
      lengthM: L, widthM: W, measuredWidthM: W, areaM2: area,
      volumeM3: depth > 0 ? area * depth : undefined,
    });
  }
}

// Area (m²) shared by two zone polygons. Zones are convex quadrilaterals.
export function overlapM2(a: [number, number][], b: [number, number][]): number {
  if (a.length < 3 || b.length < 3) return 0;
  const la0 = a.concat(b).reduce((s, p) => s + p[0], 0) / (a.length + b.length);
  const ln0 = a.concat(b).reduce((s, p) => s + p[1], 0) / (a.length + b.length);
  const M = 111320, kx = Math.cos(la0 * Math.PI / 180) * M, ky = M;
  const toXY = (p: [number, number]) => ({ x: (p[1] - ln0) * kx, y: (p[0] - la0) * ky });
  const orient = (P: { x: number; y: number }[]) => {
    let sa = 0;
    for (let i = 0; i < P.length; i++) { const u = P[i], v = P[(i + 1) % P.length]; sa += u.x * v.y - v.x * u.y; }
    return sa >= 0 ? P : [...P].reverse();
  };
  let subject = orient(a.map(toXY));
  const clip = orient(b.map(toXY));
  for (let i = 0; i < clip.length && subject.length > 0; i++) {
    const A = clip[i], B = clip[(i + 1) % clip.length];
    const side = (P: { x: number; y: number }) => (B.x - A.x) * (P.y - A.y) - (B.y - A.y) * (P.x - A.x);
    const out: { x: number; y: number }[] = [];
    for (let j = 0; j < subject.length; j++) {
      const cur = subject[j], prev = subject[(j - 1 + subject.length) % subject.length];
      const sc = side(cur), sp = side(prev);
      if (sc >= 0) {
        if (sp < 0) out.push(intersect(prev, cur, A, B));
        out.push(cur);
      } else if (sp >= 0) {
        out.push(intersect(prev, cur, A, B));
      }
    }
    subject = out;
  }
  let sa = 0;
  for (let i = 0; i < subject.length; i++) { const u = subject[i], v = subject[(i + 1) % subject.length]; sa += u.x * v.y - v.x * u.y; }
  return Math.abs(sa) / 2;
}

function intersect(p1: { x: number; y: number }, p2: { x: number; y: number }, A: { x: number; y: number }, B: { x: number; y: number }) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y, d2x = B.x - A.x, d2y = B.y - A.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return p1;
  const t = ((A.x - p1.x) * d2y - (A.y - p1.y) * d2x) / den;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}
