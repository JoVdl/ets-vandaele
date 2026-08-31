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

/**
 * Formate un temps de transfert (aller / A-R) en chaîne lisible.
 * Ex: "45 min aller · 1h30 A/R"
 */
export function formatTransfert(lat: number, lng: number): string {
  const distKm = distanceDepotKm(lat, lng);
  const mins   = (distKm / TRACTEUR_VITESSE_KMH) * 60;
  const fmt = (m: number) => {
    const h = Math.floor(m / 60);
    const mn = Math.round(m % 60);
    return h === 0 ? `${mn} min` : mn === 0 ? `${h}h` : `${h}h${String(mn).padStart(2, '0')}`;
  };
  return `${fmt(mins)} aller · ${fmt(mins * 2)} A/R · ${Math.round(distKm)} km`;
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
