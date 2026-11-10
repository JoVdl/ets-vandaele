import type { GpsPoint } from '../types/suivi';
import { DEPOT_LAT, DEPOT_LON, TRACTEUR_VITESSE_KMH } from './constants';

const R = 6371000; // Earth radius in metres

/**
 * Distance à vol d'oiseau entre le dépôt et un point (km).
 * Multiplie par 1.3 (facteur route standard) pour estimer la distance réelle.
 */
export function distanceDepotKm(lat: number, lng: number): number {
  const dLat = ((lat - DEPOT_LAT) * Math.PI) / 180;
  const dLng = ((lng - DEPOT_LON) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((DEPOT_LAT * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  const crow = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return crow * 1.3; // facteur de sinuosité routière
}

/**
 * Temps de transfert aller en minutes depuis le dépôt.
 */
export function transfertMinutes(lat: number, lng: number): number {
  return (distanceDepotKm(lat, lng) / TRACTEUR_VITESSE_KMH) * 60;
}

/** Distance crow×1.3 entre deux points géographiques quelconques (km). */
export function distanceBetweenKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  const crow = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return crow * 1.3;
}

function fmtTime(m: number): string {
  const h = Math.floor(m / 60);
  const mn = Math.round(m % 60);
  return h === 0 ? `${mn} min` : mn === 0 ? `${h}h` : `${h}h${String(mn).padStart(2, '0')}`;
}

export interface TransfertInfo {
  /** Label d'origine ("Dépôt" ou nom du chantier précédent) */
  fromLabel: string;
  /** Temps aller formaté */
  aller: string;
  /** Temps retour formaté (null si chantier enchaîné — pas de retour au dépôt) */
  retour: string | null;
  /** Distance en km arrondie */
  distKm: number;
}

/**
 * Calcule les infos de transfert tracteur.
 * Si fromLat/fromLon fournis (chantier précédent), le retour n'est pas calculé.
 */
export function getTransfertInfo(
  toLat: number, toLon: number,
  from?: { lat: number; lon: number; label: string },
): TransfertInfo {
  const fromLat = from?.lat ?? DEPOT_LAT;
  const fromLon = from?.lon ?? DEPOT_LON;
  const fromLabel = from?.label ?? 'Dépôt';
  const distKm = distanceBetweenKm(fromLat, fromLon, toLat, toLon);
  const mins   = (distKm / TRACTEUR_VITESSE_KMH) * 60;
  return {
    fromLabel,
    aller: fmtTime(mins),
    retour: from ? null : fmtTime(mins), // no return trip when chaining
    distKm: Math.round(distKm),
  };
}

/** Rétro-compat: retourne une chaîne simple (aller · A/R · km) */
export function formatTransfert(lat: number, lng: number): string {
  const info = getTransfertInfo(lat, lng);
  return `${info.aller} aller · ${info.retour} retour · ${info.distKm} km`;
}

export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function totalDistanceM(points: GpsPoint[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++)
    d += distanceM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  return d;
}

/**
 * Filtre une trace GPS brute pour éliminer les points incohérents.
 *
 * Trois filtres enchaînés :
 *  1. Vitesse instantanée > vitesseMaxKmh × speedTolerance → rejeté
 *  2. Dragage (anchorDriftM fini) : point à plus de anchorDriftM m
 *     du centroïde des 30 derniers points acceptés → rejeté
 *     (élimine l'opérateur qui s'éloigne de la machine avec son téléphone)
 *  3. Dragage seulement — post-filtre cluster : supprime les points aberrants
 *     isolés (transit de positionnement initial, saut GPS) en gardant uniquement
 *     les points à moins de 4.4 × MAD du centre médian global (≈ 3σ).
 *
 * @param points         Points GPS bruts (ordre chronologique)
 * @param vitesseMaxKmh  Vitesse max de la machine (paramètre utilisateur)
 * @param speedTolerance Multiplicateur de tolérance (1.4 dragage, 2.0 surface)
 * @param anchorDriftM   Distance max tolérée depuis le centroïde glissant.
 *                       Infinity = filtres 2 & 3 désactivés (non-dragage)
 */
export function filterGpsTrack(
  points: GpsPoint[],
  vitesseMaxKmh: number,
  speedTolerance = 2.0,
  anchorDriftM = Infinity,
): GpsPoint[] {
  const ANCHOR_WINDOW = 30;
  const maxSpeedKmh = vitesseMaxKmh * speedTolerance;
  const accepted: GpsPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (accepted.length === 0) { accepted.push(pt); continue; }

    // ── 1. Speed filter ────────────────────────────────────────────────
    const prev = accepted[accepted.length - 1];
    const dt   = (pt.ts - prev.ts) / 1000;
    if (dt <= 0) continue;
    const speedKmh = (distanceM(prev.lat, prev.lng, pt.lat, pt.lng) / dt) * 3.6;
    if (speedKmh > maxSpeedKmh) continue;

    // ── 2. Anchor drift filter (dragage only) ──────────────────────────
    if (anchorDriftM < Infinity && accepted.length >= 5) {
      const win    = accepted.slice(-ANCHOR_WINDOW);
      const avgLat = win.reduce((s, p) => s + p.lat, 0) / win.length;
      const avgLng = win.reduce((s, p) => s + p.lng, 0) / win.length;
      if (distanceM(avgLat, avgLng, pt.lat, pt.lng) > anchorDriftM) continue;
    }

    accepted.push(pt);
  }

  // ── 3. Cluster post-filter — drague only (iterative MAD) ─────────────
  // Removes transit-to-position path and GPS jumps.
  // Runs up to 3 iterations: each pass re-centres the median on the surviving
  // cluster, so outliers that survived the first cut get caught on the next.
  // 3.5 × MAD keeps all real work points (diagonal of a 6×20 m zone ≈ 20 m from
  // centre) while rejecting stray readings beyond ~2× that distance.
  if (anchorDriftM < Infinity && accepted.length >= 10) {
    let pts = accepted;
    for (let iter = 0; iter < 3 && pts.length >= 10; iter++) {
      const mid = Math.floor(pts.length / 2);
      const sortedLat = pts.map(p => p.lat).sort((a, b) => a - b);
      const sortedLng = pts.map(p => p.lng).sort((a, b) => a - b);
      const medLat = sortedLat[mid];
      const medLng = sortedLng[mid];
      const sortedDists = pts.map(p => distanceM(p.lat, p.lng, medLat, medLng)).sort((a, b) => a - b);
      const mad    = sortedDists[mid];
      const radius = Math.max(mad * 3.5, 20); // 3.5σ, min 20 m
      const next   = pts.filter(p => distanceM(p.lat, p.lng, medLat, medLng) <= radius);
      if (next.length === pts.length) break; // converged — no more outliers
      pts = next;
    }
    return pts;
  }

  return accepted;
}

/**
 * Convex hull of a set of lat/lng points (Andrew's monotone chain, O(n log n)).
 * Returns the boundary vertices in counter-clockwise order.
 * Useful for drague: turns the scattered papillonnage GPS points into a filled zone.
 */
export function convexHull(pts: { lat: number; lng: number }[]): { lat: number; lng: number }[] {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a.lng !== b.lng ? a.lng - b.lng : a.lat - b.lat);
  const cross = (o: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  const lower: { lat: number; lng: number }[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: { lat: number; lng: number }[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** Shoelace formula on local flat projection. Accurate for areas < ~100 km². */
export function areaM2(points: { lat: number; lng: number }[]): number {
  if (points.length < 3) return 0;
  const lat0 = (points[0].lat * Math.PI) / 180;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const xi = (points[i].lng * Math.PI / 180) * Math.cos(lat0) * R;
    const yi = (points[i].lat * Math.PI / 180) * R;
    const xj = (points[j].lng * Math.PI / 180) * Math.cos(lat0) * R;
    const yj = (points[j].lat * Math.PI / 180) * R;
    area += xi * yj - xj * yi;
  }
  return Math.abs(area) / 2;
}

export function instantSpeedKmh(p1: GpsPoint, p2: GpsPoint): number {
  if (p2.spd != null) return p2.spd * 3.6;
  const d = distanceM(p1.lat, p1.lng, p2.lat, p2.lng);
  const dt = (p2.ts - p1.ts) / 1000;
  return dt > 0 ? (d / dt) * 3.6 : 0;
}

export function avgSpeedKmh(points: GpsPoint[]): number {
  if (points.length < 2) return 0;
  const totalDist = totalDistanceM(points);
  const totalTime = (points[points.length - 1].ts - points[0].ts) / 1000;
  return totalTime > 0 ? (totalDist / totalTime) * 3.6 : 0;
}

export function formatArea(m2: number): string {
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha`;
  return `${Math.round(m2).toLocaleString('fr-FR')} m²`;
}

export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

/** Exponential moving average smoothing on lat/lng. alpha: 0=no smooth, 1=max. */
export function smoothPoints(points: GpsPoint[], alpha: number): GpsPoint[] {
  if (points.length < 2 || alpha <= 0) return points;
  const a = Math.min(1, Math.max(0, alpha));
  const out: GpsPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[i - 1];
    out.push({
      ...points[i],
      lat: a * points[i].lat + (1 - a) * prev.lat,
      lng: a * points[i].lng + (1 - a) * prev.lng,
    });
  }
  return out;
}

/**
 * Compute swath rectangle corners for each GPS segment.
 * Returns an array of 4-point polygons (one per segment pair).
 * halfWidthM = largeurTravailM / 2
 */
export function swathRects(
  points: GpsPoint[],
  halfWidthM: number,
): [number, number][][] {
  if (points.length < 2 || halfWidthM <= 0) return [];
  const R = 6371000;
  const out: [number, number][][] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dist = distanceM(p1.lat, p1.lng, p2.lat, p2.lng);
    if (dist < 0.5) continue; // skip noise

    const lat1R = p1.lat * Math.PI / 180;
    const dLat  = (p2.lat - p1.lat) * Math.PI / 180;
    const dLng  = (p2.lng - p1.lng) * Math.PI / 180;
    const bearing = Math.atan2(dLng * Math.cos(lat1R), dLat);

    const cosLat = Math.cos(((p1.lat + p2.lat) / 2) * Math.PI / 180);
    const dLatDeg = -Math.sin(bearing) * halfWidthM / R * (180 / Math.PI);
    const dLngDeg =  Math.cos(bearing) * halfWidthM / (R * cosLat) * (180 / Math.PI);

    out.push([
      [p1.lat + dLatDeg, p1.lng + dLngDeg],
      [p1.lat - dLatDeg, p1.lng - dLngDeg],
      [p2.lat - dLatDeg, p2.lng - dLngDeg],
      [p2.lat + dLatDeg, p2.lng + dLngDeg],
    ]);
  }
  return out;
}

/**
 * Surface covered by strip-based work: distance × effective width.
 * More accurate than Shoelace for back-and-forth row patterns.
 */
export function stripAreaM2(points: GpsPoint[], largeurM: number, recouvrementPct: number): number {
  if (largeurM <= 0) return 0;
  const effectiveWidth = largeurM * (1 - recouvrementPct / 100);
  return totalDistanceM(points) * effectiveWidth;
}

/**
 * Volume dragué avec profondeur variable par segment.
 * Chaque segment GPS utilise la profondeur active à ce moment (depthSegments).
 * Dépôt au segment ayant fromTs ≤ midpoint timestamp.
 * Si depthSegments est vide ou largeurM ≤ 0, retourne 0.
 */
export function stripVolumeM3WithSegments(
  points: GpsPoint[],
  largeurM: number,
  recouvrementPct: number,
  depthSegments: { fromTs: number; profondeurM: number }[],
): number {
  if (largeurM <= 0 || points.length < 2 || depthSegments.length === 0) return 0;
  const effectiveWidth = largeurM * (1 - recouvrementPct / 100);
  let volume = 0;
  for (let i = 1; i < points.length; i++) {
    const dist   = distanceM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    const midTs  = (points[i - 1].ts + points[i].ts) / 2;
    // Find depth: last segment whose fromTs ≤ midTs
    let depth = depthSegments[0].profondeurM;
    for (const seg of depthSegments) {
      if (midTs >= seg.fromTs) depth = seg.profondeurM;
      else break;
    }
    volume += dist * effectiveWidth * depth;
  }
  return volume;
}

export function centroid(points: { lat: number; lng: number }[]): { lat: number; lng: number } {
  if (!points.length) return { lat: 0, lng: 0 };
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  };
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return `${h}h${m.toString().padStart(2, '0')}`;
}
