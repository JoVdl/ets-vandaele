const KEY = 'suivi_excluded_zones';

// Sessions whose work zone is excluded from plans and volumes on this device. GPS data is untouched.
export function loadExcludedZones(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveExcludedZones(ids: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch { /* storage unavailable: exclusion lasts for this session only */ }
}
