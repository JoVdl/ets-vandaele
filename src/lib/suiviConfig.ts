import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export interface SuiviConfig {
  salaryPin: string;   // PIN salarié
  patronPin: string;   // PIN patron (donne accès à l'historique complet)
}

const DEFAULTS: SuiviConfig = { salaryPin: '1234', patronPin: '0000' };
const SESSION_KEY = 'suivi_pin_role';

export async function loadSuiviConfig(): Promise<SuiviConfig> {
  try {
    const snap = await getDoc(doc(db, 'config', 'suivi'));
    if (snap.exists()) return { ...DEFAULTS, ...(snap.data() as Partial<SuiviConfig>) };
  } catch { /* offline — use defaults */ }
  return DEFAULTS;
}

export async function saveSuiviConfig(cfg: SuiviConfig): Promise<void> {
  await setDoc(doc(db, 'config', 'suivi'), cfg, { merge: true });
}

export function checkPin(entered: string, cfg: SuiviConfig): 'patron' | 'salarie' | null {
  if (entered === cfg.patronPin) return 'patron';
  if (entered === cfg.salaryPin) return 'salarie';
  return null;
}

// ── Session storage (so PIN isn't re-entered on every open) ─────────────────

interface PinSession { role: 'patron' | 'salarie'; expiresAt: number; }

export function saveSession(role: 'patron' | 'salarie'): void {
  const s: PinSession = { role, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function loadSession(): 'patron' | 'salarie' | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s: PinSession = JSON.parse(raw);
    if (Date.now() > s.expiresAt) { localStorage.removeItem(SESSION_KEY); return null; }
    return s.role;
  } catch { return null; }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}
