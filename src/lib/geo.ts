import type { GpsPoint } from '../types/suivi';

const R = 6371000; // Earth radius in metres

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

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return `${h}h${m.toString().padStart(2, '0')}`;
}
