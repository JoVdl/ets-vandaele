import type { SuiviSession, GpsPoint } from '../types/suivi';

const KEY_ACTIVE  = 'suivi_active_session';
const KEY_PENDING = 'suivi_pending_sessions';

// ── Active session (crash recovery) ────────────────────────────────────────

export function saveActiveSession(data: {
  chantierId: string;
  chantierNom: string;
  operateur: 'patron' | 'salarie';
  dateDebut: string;
  points: GpsPoint[];
}): void {
  try { localStorage.setItem(KEY_ACTIVE, JSON.stringify(data)); } catch { /* quota */ }
}

export function loadActiveSession(): {
  chantierId: string;
  chantierNom: string;
  operateur: 'patron' | 'salarie';
  dateDebut: string;
  points: GpsPoint[];
} | null {
  try {
    const raw = localStorage.getItem(KEY_ACTIVE);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearActiveSession(): void {
  localStorage.removeItem(KEY_ACTIVE);
}

// ── Offline queue (completed sessions pending Firestore sync) ───────────────

export function queuePendingSession(session: Omit<SuiviSession, 'id'>): void {
  try {
    const list = loadPendingSessions();
    list.push({ ...session, id: `offline_${Date.now()}` });
    localStorage.setItem(KEY_PENDING, JSON.stringify(list));
  } catch { /* ignore */ }
}

export function loadPendingSessions(): SuiviSession[] {
  try {
    const raw = localStorage.getItem(KEY_PENDING);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function removePendingSession(id: string): void {
  const remaining = loadPendingSessions().filter(s => s.id !== id);
  localStorage.setItem(KEY_PENDING, JSON.stringify(remaining));
}
