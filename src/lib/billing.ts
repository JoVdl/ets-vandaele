import type { Chantier } from '../types';
import type { SuiviSession } from '../types/suivi';

export interface Billing {
  heuresFaites: number;
  budgetH: number;
  facturable: number;        // € earned so far at the sold rate
  facture: number;           // € already invoiced
  aFacturer: number;         // € still to invoice (negative = over-invoiced)
  tarifEffectif: number | null; // € per hour, from hourly rate or total ÷ budget
  pourcentage: number | null;   // share of the sold work done
}

// Billable amount: hourly rate × hours done, or, for a total price, the total pro-rata of the hours done
// against the planned hours.
export function computeBilling(chantier: Chantier, sessions: SuiviSession[]): Billing {
  const f = chantier.facturation ?? {};
  const heuresFaites = sessions.reduce((a, s) => a + s.dureeMinutes, 0) / 60;
  const budgetH = chantier.dureeEstimeeH ?? 0;
  const tarifEffectif = f.tarifHoraire ?? (f.montantTotal && budgetH > 0 ? f.montantTotal / budgetH : null);
  const facturable = f.tarifHoraire != null
    ? heuresFaites * f.tarifHoraire
    : f.montantTotal != null && budgetH > 0
      ? f.montantTotal * Math.min(1, heuresFaites / budgetH)
      : 0;
  const facture = (f.factures ?? []).reduce((a, x) => a + x.montant, 0);
  const total = f.montantTotal ?? (tarifEffectif != null && budgetH > 0 ? tarifEffectif * budgetH : null);
  return {
    heuresFaites,
    budgetH,
    facturable,
    facture,
    aFacturer: facturable - facture,
    tarifEffectif,
    pourcentage: total ? Math.min(100, (facturable / total) * 100) : null,
  };
}
