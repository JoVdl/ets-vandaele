import type { ChantierType } from '../types';

export interface ReorgSettings {
  /** Ordered list of types to schedule first (index 0 = highest priority).
   *  Types absent from the list are scheduled last using standard EDF logic. */
  typePriorities: ChantierType[];
}

const LS_KEY = 'ets_reorgSettings';

export function loadReorgSettings(): ReorgSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { typePriorities: [] };
    const parsed = JSON.parse(raw);
    return { typePriorities: Array.isArray(parsed.typePriorities) ? parsed.typePriorities : [] };
  } catch {
    return { typePriorities: [] };
  }
}

export function saveReorgSettings(s: ReorgSettings): void {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}
