import type { Chantier, ChantierEtat } from '../types';

export function getEffectiveEtat(c: Chantier): ChantierEtat {
  if (c.etat) return c.etat;
  const today = new Date().toISOString().slice(0, 10);
  if (c.dateFin < today) return 'termine';
  if (c.dateDebut <= today) return 'en_cours';
  return 'a_venir';
}

export const ETAT_LABELS: Record<ChantierEtat, string> = {
  a_venir: 'À venir',
  en_cours: 'En cours',
  termine: 'Terminé',
};

export const ETAT_COLORS: Record<ChantierEtat, { bg: string; text: string; border: string }> = {
  a_venir:  { bg: 'bg-blue-50',   text: 'text-blue-700',  border: 'border-blue-200' },
  en_cours: { bg: 'bg-green-50',  text: 'text-green-700', border: 'border-green-200' },
  termine:  { bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-200' },
};
