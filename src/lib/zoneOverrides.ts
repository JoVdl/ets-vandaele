export type Corners = [number, number][]; // [lat, lng] × 4

const KEY = 'suivi_zone_overrides';

// Manually corrected work zones, per session id. Stored on this device; GPS data is untouched.
export function loadZoneOverrides(): Record<string, Corners> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, Corners>) : {};
  } catch {
    return {};
  }
}

export function saveZoneOverrides(o: Record<string, Corners>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch { /* storage unavailable: correction lasts for this session only */ }
}
