import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import type { Chantier } from '../../types';
import type { SuiviSession } from '../../types/suivi';
import { computeBilling } from '../../lib/billing';
import { setChantierFacturation } from '../../lib/chantierBilling';
import { estimateEnd } from '../../lib/estimateEnd';

const eur = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;

// Patron-only billing follow-up: sold price, hours done, what is billable and what is still to invoice.
export default function BillingPanel({ chantier, sessions }: { chantier: Chantier; sessions: SuiviSession[] }) {
  const f = chantier.facturation ?? {};
  const [tarif, setTarif] = useState(f.tarifHoraire != null ? String(f.tarifHoraire) : '');
  const [total, setTotal] = useState(f.montantTotal != null ? String(f.montantTotal) : '');
  const [fDate, setFDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [fMontant, setFMontant] = useState('');
  const [fNote, setFNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const b = useMemo(() => computeBilling(chantier, sessions), [chantier, sessions]);
  const est = useMemo(() => (chantier.dureeEstimeeH
    ? estimateEnd(sessions, chantier.dureeEstimeeH, new Set(chantier.joursOff ?? []))
    : null), [sessions, chantier]);
  const factures = f.factures ?? [];
  const totalPrevu = f.montantTotal ?? (b.tarifEffectif != null && b.budgetH > 0 ? b.tarifEffectif * b.budgetH : null);

  const save = async (patch: Partial<NonNullable<Chantier['facturation']>>) => {
    setError(null);
    try {
      await setChantierFacturation(chantier.id, { ...f, ...patch });
    } catch {
      setError('Enregistrement impossible (connexion ?)');
    }
  };

  const saveRates = () => {
    const t = parseFloat(tarif.replace(',', '.'));
    const m = parseFloat(total.replace(',', '.'));
    save({
      tarifHoraire: t > 0 ? t : undefined,
      montantTotal: m > 0 ? m : undefined,
    });
  };

  const addFacture = () => {
    const m = parseFloat(fMontant.replace(',', '.'));
    if (!(m > 0) || !fDate) { setError('Date et montant requis'); return; }
    save({ factures: [...factures, { id: `${Date.now()}`, date: fDate, montant: m, note: fNote.trim() || undefined }] });
    setFMontant('');
    setFNote('');
  };

  const pctFact = totalPrevu ? Math.min(100, (b.facture / totalPrevu) * 100) : null;
  const pctDone = b.pourcentage;

  return (
    <div className="px-3 py-3 space-y-3">
      <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-wide">Facturation · patron</p>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-emerald-900/30 border border-emerald-800/40 rounded-xl p-3">
          <p className="text-emerald-300 text-lg font-bold tabular-nums">{eur(b.aFacturer)}</p>
          <p className="text-emerald-500/80 text-[10px] uppercase">à facturer maintenant</p>
        </div>
        <div className="bg-white/[0.04] rounded-xl p-3">
          <p className="text-white text-lg font-bold tabular-nums">{eur(b.facture)}</p>
          <p className="text-slate-500 text-[10px] uppercase">déjà facturé</p>
        </div>
        <div className="bg-white/[0.04] rounded-xl p-3">
          <p className="text-white text-sm font-bold tabular-nums">{eur(b.facturable)}</p>
          <p className="text-slate-500 text-[10px] uppercase">gagné à ce jour · {b.heuresFaites.toFixed(1)} h</p>
        </div>
        <div className="bg-white/[0.04] rounded-xl p-3">
          <p className="text-white text-sm font-bold tabular-nums">{totalPrevu != null ? eur(totalPrevu) : '—'}</p>
          <p className="text-slate-500 text-[10px] uppercase">montant total prévu{est ? ` · fin ${format(est.date, 'dd/MM/yy')}` : ''}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div>
          <div className="flex justify-between text-[10px] text-slate-500"><span>Travail réalisé</span><span>{pctDone != null ? `${pctDone.toFixed(0)} %` : '—'}</span></div>
          <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden"><div className="h-full bg-cyan-500" style={{ width: `${pctDone ?? 0}%` }} /></div>
        </div>
        <div>
          <div className="flex justify-between text-[10px] text-slate-500"><span>Facturé</span><span>{pctFact != null ? `${pctFact.toFixed(0)} %` : '—'}</span></div>
          <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pctFact ?? 0}%` }} /></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-slate-500">Tarif vendu (€/h)
          <input inputMode="decimal" value={tarif} onChange={e => setTarif(e.target.value)} placeholder="ex. 95"
            className="mt-1 w-full bg-white/[0.06] text-slate-200 text-xs rounded-lg px-2 py-2 border border-white/[0.08]" />
        </label>
        <label className="text-[10px] text-slate-500">ou montant total (€)
          <input inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} placeholder="ex. 19950"
            className="mt-1 w-full bg-white/[0.06] text-slate-200 text-xs rounded-lg px-2 py-2 border border-white/[0.08]" />
        </label>
      </div>
      <button onClick={saveRates} className="w-full py-2 rounded-lg bg-white/[0.08] text-slate-200 text-xs font-semibold">Enregistrer le prix</button>

      <div className="space-y-2 pt-2 border-t border-white/[0.06]">
        <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-wide">Factures émises</p>
        <div className="grid grid-cols-3 gap-2">
          <input type="date" value={fDate} onChange={e => setFDate(e.target.value)}
            className="bg-white/[0.06] text-slate-200 text-xs rounded-lg px-2 py-2 border border-white/[0.08]" />
          <input inputMode="decimal" placeholder="Montant €" value={fMontant} onChange={e => setFMontant(e.target.value)}
            className="bg-white/[0.06] text-slate-200 text-xs rounded-lg px-2 py-2 border border-white/[0.08]" />
          <button onClick={addFacture} className="rounded-lg bg-emerald-600 text-white text-xs font-semibold">Ajouter</button>
        </div>
        <input placeholder="Note (facultatif)" value={fNote} onChange={e => setFNote(e.target.value)}
          className="w-full bg-white/[0.06] text-slate-200 text-xs rounded-lg px-2 py-2 border border-white/[0.08]" />
        {error && <p className="text-red-400 text-[11px]">{error}</p>}
        {factures.length > 0 && (
          <div className="divide-y divide-white/[0.05]">
            {[...factures].sort((a, b) => a.date.localeCompare(b.date)).map(x => (
              <div key={x.id} className="flex items-center justify-between py-1.5 text-xs text-slate-300">
                <span>{format(new Date(x.date), 'dd/MM/yyyy')}{x.note ? ` · ${x.note}` : ''}</span>
                <span className="flex items-center gap-3 tabular-nums">
                  {eur(x.montant)}
                  <button onClick={() => save({ factures: factures.filter(y => y.id !== x.id) })} className="text-slate-600 hover:text-red-400" title="Supprimer"><Trash2 size={12} /></button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
