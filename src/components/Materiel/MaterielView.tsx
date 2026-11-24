import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ArrowLeft, Plus, X, Trash2, Camera } from 'lucide-react';
import { format } from 'date-fns';
import { useMateriel } from '../../hooks/useMateriel';
import { FAMILLES, ETATS, type FamilleMateriel, type EtatMateriel, type Materiel } from '../../types/materiel';
import { heuresCompteur, tauxUtilisation, tachesOuvertes } from '../../lib/materielStats';
import { uploadMaterielPhoto } from '../../lib/storage';
import { PELLES_DE_DEPART, TRANSPORT_DE_DEPART, DRAGUES_DE_DEPART } from '../../lib/materielSeed';

const uid = () => crypto.randomUUID();

export default function MaterielView({ onClose }: { onClose: () => void }) {
  const { items, loaded, add, update, remove } = useMateriel();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = items.find(m => m.id === selectedId) ?? null;

  const [query, setQuery] = useState('');
  const [filtre, setFiltre] = useState<'tous' | EtatMateriel>('tous');
  const visibles = useMemo(() => items.filter(m => {
    if (filtre !== 'tous' && m.etat !== filtre) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [m.nom, m.marque, m.modele, String(m.annee ?? '')].filter(Boolean).join(' ').toLowerCase().includes(q);
  }), [items, query, filtre]);
  const nonUtilisables = useMemo(() => visibles.filter(m => m.etat === 'non_utilisable').sort((a, b) => a.nom.localeCompare(b.nom)), [visibles]);
  const groups = useMemo(() => (Object.keys(FAMILLES) as FamilleMateriel[]).map(f => ({
    famille: f,
    list: visibles.filter(m => m.famille === f && m.etat !== 'non_utilisable').sort((a, b) => a.nom.localeCompare(b.nom)),
  })).filter(g => g.list.length > 0), [visibles]);
  const pellesManquantes = [...PELLES_DE_DEPART, ...TRANSPORT_DE_DEPART, ...DRAGUES_DE_DEPART].filter(p => !items.some(m => m.nom === p.nom));
  const addPelles = async () => {
    for (const p of pellesManquantes) {
      await add({ ...p, journal: [], taches: [], suiviDepuis: new Date().toISOString() } as Omit<Materiel, 'id'>);
    }
  };
  // One-time import of the starting excavators, only once the database has answered.
  useEffect(() => {
    if (!loaded) return;
    try {
      if (localStorage.getItem('materiel_seed_v11') === '1') return;
      localStorage.setItem('materiel_seed_v11', '1');
    } catch { return; }
    if (pellesManquantes.length > 0) addPelles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  return (
    <div className="fixed inset-0 z-[500] bg-slate-950 flex flex-col">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-white/[0.07] flex-shrink-0">
        <button onClick={onClose} className="p-1.5 -ml-1 text-slate-400 hover:text-white"><ArrowLeft size={20} /></button>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm">Matériel</p>
          <p className="text-slate-500 text-[10px]">{items.length} engin{items.length > 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"><Plus size={13} />Ajouter</button>
      </div>

      <div className="px-3 pt-2.5 pb-2 space-y-2 border-b border-white/[0.05] flex-shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un engin, une marque…"
            className="w-full bg-white/[0.06] text-slate-200 text-xs rounded-lg pl-8 pr-2 py-2 border border-white/[0.08]" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {(['tous', 'operationnel', 'maintenance', 'panne', 'non_utilisable'] as const).map(f => (
            <button key={f} onClick={() => setFiltre(f)}
              className={`px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap ${filtre === f ? 'bg-white/[0.18] text-white' : 'bg-white/[0.05] text-slate-400'}`}>
              {f === 'tous' ? 'Tous' : ETATS[f].label.replace(' (à remettre en état)', '')}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {pellesManquantes.length > 0 && (
          <button onClick={addPelles} className="w-full py-2 rounded-lg bg-white/[0.06] text-slate-300 text-xs">
            Ajouter les {pellesManquantes.length} engins de départ (fiches avec caractéristiques)
          </button>
        )}
        {nonUtilisables.length > 0 && (
          <section>
            <p className="sticky top-0 z-10 bg-slate-950/95 py-1 text-[10px] font-semibold uppercase tracking-wide mb-2 text-slate-400">Non utilisables · à remettre en état</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {nonUtilisables.map(m => <MaterielCard key={m.id} m={m} onOpen={() => setSelectedId(m.id)} />)}
            </div>
          </section>
        )}
        {groups.length === 0 && nonUtilisables.length === 0 && <p className="text-slate-500 text-sm text-center py-10">Aucun engin pour l'instant</p>}
        {groups.map(g => (
          <section key={g.famille}>
            <p className="sticky top-0 z-10 bg-slate-950/95 py-1 text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: FAMILLES[g.famille].color }}>{FAMILLES[g.famille].label} · {g.list.length}</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {g.list.map(m => <MaterielCard key={m.id} m={m} onOpen={() => setSelectedId(m.id)} />)}
            </div>
          </section>
        ))}
      </div>

      {creating && (
        <EditSheet
          title="Nouvel engin"
          initial={null}
          onCancel={() => setCreating(false)}
          onSave={async data => {
            const id = await add({
              ...data, journal: [], taches: [], specs: {},
              suiviDepuis: new Date().toISOString(),
            } as Omit<Materiel, 'id'>);
            setCreating(false);
            setSelectedId(id);
          }}
        />
      )}

      {selected && !creating && (
        <Detail
          m={selected}
          onClose={() => setSelectedId(null)}
          onUpdate={patch => update(selected.id, patch)}
          onDelete={async () => { await remove(selected.id); setSelectedId(null); }}
        />
      )}
    </div>
  );
}

function MaterielCard({ m, onOpen }: { m: Materiel; onOpen: () => void }) {
  const t = tachesOuvertes(m);
  const taux = tauxUtilisation(m);
  const enPanne = m.etat === 'panne';
  const bloque = t.bloquantes > 0 || enPanne;
  // Most urgent open item: blocking first
  const ouvertes = m.taches.filter(x => !x.fait).sort((a, b) => Number(b.bloquant) - Number(a.bloquant));
  const probleme = enPanne ? 'Panne' : ouvertes[0]?.texte;
  return (
    <button onClick={onOpen} className={`text-left rounded-xl overflow-hidden border ${bloque ? 'border-red-600/80' : 'border-white/[0.08]'} bg-white/[0.04]`}>
      <div className="h-16 bg-slate-800 flex items-center justify-center relative">
        {m.photoUrl ? <img src={m.photoUrl} alt="" className="w-full h-full object-cover" /> : <Camera size={18} className="text-slate-600" />}
        {bloque && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center shadow">
            {enPanne ? '!' : t.bloquantes}
          </span>
        )}
      </div>
      <div className="p-1.5 space-y-0.5">
        <p className="text-white text-[11px] font-semibold truncate leading-tight">{m.nom}</p>
        <p className="text-slate-500 text-[9px] truncate">{[m.marque, m.annee].filter(Boolean).join(' · ') || '—'}</p>
        <div className="flex items-center justify-between gap-1">
          <span className={`px-1 py-px rounded text-[8px] font-semibold truncate ${ETATS[m.etat].color}`}>{ETATS[m.etat].label.replace(' (à remettre en état)', '')}</span>
          {t.total > 0 && !bloque && <span className="text-[8px] text-slate-400">{t.total}</span>}
        </div>
        {probleme && (
          <p className={`text-[9px] truncate ${bloque ? 'text-red-300' : 'text-amber-300'}`} title={probleme}>⚠ {probleme}</p>
        )}
        <p className="text-slate-500 text-[9px] tabular-nums">{heuresCompteur(m).toFixed(0)} h · {taux != null ? taux.toFixed(0) : '—'} %</p>
      </div>
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <span className="text-slate-500 text-[11px]">{label}</span>
      <span className="text-slate-100 text-xs font-medium text-right">{value}</span>
    </div>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div className="bg-white/[0.04] rounded-xl py-2">
      <p className="text-white text-sm font-bold tabular-nums">{v}</p>
      <p className="text-slate-500 text-[9px] uppercase">{l}</p>
    </div>
  );
}

function EditSheet({ title, initial, onCancel, onSave }: {
  title: string;
  initial: Materiel | null;
  onCancel: () => void;
  onSave: (data: Partial<Omit<Materiel, 'id'>>) => Promise<void>;
}) {
  const [nom, setNom] = useState(initial?.nom ?? '');
  const [famille, setFamille] = useState<FamilleMateriel>(initial?.famille ?? 'pelle');
  const [marque, setMarque] = useState(initial?.marque ?? '');
  const [modele, setModele] = useState(initial?.modele ?? '');
  const [annee, setAnnee] = useState(initial?.annee ? String(initial.annee) : '');
  const [etat, setEtat] = useState<EtatMateriel>(initial?.etat ?? 'operationnel');
  const [heures, setHeures] = useState(initial?.heuresInitiales != null ? String(initial.heuresInitiales) : '');
  const [specs, setSpecs] = useState<{ k: string; v: string }[]>(Object.entries(initial?.specs ?? {}).map(([k, v]) => ({ k, v })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!nom.trim()) return;
    setBusy(true);
    const specsObj: Record<string, string> = {};
    specs.forEach(({ k, v }) => { if (k.trim() && v.trim()) specsObj[k.trim()] = v.trim(); });
    const h = parseFloat(heures.replace(',', '.'));
    setError(null);
    try {
      await onSave({
        nom: nom.trim(), famille, etat,
        marque: marque.trim() || undefined,
        modele: modele.trim() || undefined,
        annee: parseInt(annee, 10) || undefined,
        heuresInitiales: h > 0 ? h : undefined,
        specs: specsObj,
      });
    } catch (e) {
      setError(`Enregistrement impossible : ${e instanceof Error ? e.message : 'erreur inconnue'}`);
    } finally { setBusy(false); }
  };

  const input = 'w-full bg-white/[0.06] text-slate-200 text-xs rounded-lg px-2 py-2 border border-white/[0.08]';
  return (
    <div className="fixed inset-0 z-[520] bg-black/60 flex items-end">
      <div className="w-full max-h-[90vh] overflow-y-auto bg-slate-900 rounded-t-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-white font-bold text-sm">{title}</p>
          <button onClick={onCancel} className="text-slate-400"><X size={18} /></button>
        </div>
        <input className={input} placeholder="Nom (ex. Pelle 8 t)" value={nom} onChange={e => setNom(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <select className={input} value={famille} onChange={e => setFamille(e.target.value as FamilleMateriel)}>
            {(Object.keys(FAMILLES) as FamilleMateriel[]).map(f => <option key={f} value={f}>{FAMILLES[f].label}</option>)}
          </select>
          <select className={input} value={etat} onChange={e => setEtat(e.target.value as EtatMateriel)}>
            {(Object.keys(ETATS) as EtatMateriel[]).map(s => <option key={s} value={s}>{ETATS[s].label}</option>)}
          </select>
          <input className={input} placeholder="Marque" value={marque} onChange={e => setMarque(e.target.value)} />
          <input className={input} placeholder="Modèle" value={modele} onChange={e => setModele(e.target.value)} />
          <input className={input} inputMode="numeric" placeholder="Année" value={annee} onChange={e => setAnnee(e.target.value)} />
          <input className={input} inputMode="decimal" placeholder="Compteur initial (h)" value={heures} onChange={e => setHeures(e.target.value)} />
        </div>
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Caractéristiques</p>
          {specs.map((row, i) => (
            <div key={i} className="flex gap-1.5 items-center">
              <input className={`${input} w-2/5`} placeholder="Poids" value={row.k}
                onChange={e => setSpecs(specs.map((r, j) => j === i ? { ...r, k: e.target.value } : r))} />
              <input className={`${input} flex-1 min-w-0`} placeholder="8 t" value={row.v}
                onChange={e => setSpecs(specs.map((r, j) => j === i ? { ...r, v: e.target.value } : r))} />
              <button type="button" onClick={() => setSpecs(specs.filter((_, j) => j !== i))}
                className="p-2 text-slate-500 hover:text-red-400" title="Retirer"><X size={14} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setSpecs([...specs, { k: '', v: '' }])}
            className="w-full py-2 rounded-lg border border-dashed border-white/[0.15] text-slate-400 text-xs flex items-center justify-center gap-1">
            <Plus size={12} /> Ajouter une caractéristique
          </button>
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button onClick={save} disabled={busy || !nom.trim()} className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40">Enregistrer</button>
      </div>
    </div>
  );
}
