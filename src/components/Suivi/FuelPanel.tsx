import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import type { SuiviSession } from '../../types/suivi';
import { useFuelRefills } from '../../hooks/useFuelRefills';
import { computeFuel } from '../../lib/fuel';

const nowLocal = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");

// Fuel added to the machine, and the consumption it implies over the hours worked since the previous refill.
export default function FuelPanel({ chantierId, sessions }: { chantierId: string; sessions: SuiviSession[] }) {
  const { refills, addRefill, removeRefill } = useFuelRefills(chantierId);
  const [when, setWhen] = useState(nowLocal);
  const [litres, setLitres] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stats = useMemo(() => computeFuel(refills, sessions), [refills, sessions]);

  const submit = async () => {
    const l = parseFloat(litres.replace(',', '.'));
    if (!when || !(l > 0)) { setError('Date et quantité (litres) requises'); return; }
    setError(null);
    try {
      await addRefill(new Date(when).toISOString(), l);
      setLitres('');
      setWhen(nowLocal());
    } catch {
      setError('Enregistrement impossible (connexion ?)');
    }
  };

  return (
    <div className="px-3 py-3 space-y-3">
      <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-wide">Gasoil</p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-white/[0.04] rounded-xl py-2">
          <p className="text-white font-bold text-sm tabular-nums">{stats.totalL.toFixed(0)} L</p>
          <p className="text-slate-500 text-[9px] uppercase">Consommé total</p>
        </div>
        <div className="bg-white/[0.04] rounded-xl py-2">
          <p className="text-white font-bold text-sm tabular-nums">{stats.lPerH != null ? stats.lPerH.toFixed(1) : '—'}</p>
          <p className="text-slate-500 text-[9px] uppercase">L / h (moyenne)</p>
        </div>
        <div className="bg-white/[0.04] rounded-xl py-2">
          <p className="text-white font-bold text-sm tabular-nums">{stats.hoursTotal.toFixed(1)} h</p>
          <p className="text-slate-500 text-[9px] uppercase">Heures totales</p>
        </div>
      </div>

      <div className="flex gap-2">
        <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
          className="flex-1 min-w-0 bg-white/[0.06] text-slate-200 text-xs rounded-lg px-2 py-2 border border-white/[0.08]" />
        <input inputMode="decimal" placeholder="Litres" value={litres} onChange={e => setLitres(e.target.value)}
          className="w-20 bg-white/[0.06] text-slate-200 text-xs rounded-lg px-2 py-2 border border-white/[0.08]" />
        <button onClick={submit} className="px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold">Ajouter</button>
      </div>
      {error && <p className="text-red-400 text-[11px]">{error}</p>}

      {refills.length > 0 && (
        <div className="divide-y divide-white/[0.05]">
          {[...refills].reverse().map(r => (
            <div key={r.id} className="flex items-center justify-between py-1.5 text-xs text-slate-300">
              <span>{format(new Date(r.ts), 'dd/MM/yyyy HH:mm')}</span>
              <span className="flex items-center gap-3 tabular-nums">
                {r.litres.toFixed(0)} L
                <button onClick={() => removeRefill(r.id)} className="text-slate-600 hover:text-red-400" title="Supprimer ce plein"><Trash2 size={12} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
