import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CheckCheck, CircleAlert, Euro, Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import type { Chantier } from '../types';
import { CHANTIER_TYPES } from '../lib/constants';
import { caAnnuel } from '../lib/workingDays';

type Filter = 'toutes' | 'a_facturer' | 'en_attente' | 'payees';
type SortKey = 'dateFin' | 'nom' | 'ca' | 'status';

interface Props {
  chantiers: Chantier[];
  onClickChantier: (c: Chantier) => void;
  onUpdateChantier: (id: string, data: Partial<Chantier>) => Promise<void>;
}

export default function FacturationView({ chantiers, onClickChantier, onUpdateChantier }: Props) {
  const [filter, setFilter] = useState<Filter>('toutes');
  const [sortKey, setSortKey] = useState<SortKey>('dateFin');
  const [sortAsc, setSortAsc] = useState(false);

  // Only past confirmed/done chantiers are relevant for billing
  const today = new Date().toISOString().slice(0, 10);
  const billable = useMemo(() =>
    chantiers.filter(c =>
      (c.status === 'confirme') && c.dateFin <= today
    ), [chantiers, today]);

  const filtered = useMemo(() => {
    let list = billable;
    if (filter === 'a_facturer') list = list.filter(c => !c.factureFaite);
    else if (filter === 'en_attente') list = list.filter(c => c.factureFaite && !c.datePaiement);
    else if (filter === 'payees') list = list.filter(c => !!c.datePaiement);

    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'dateFin') cmp = a.dateFin.localeCompare(b.dateFin);
      else if (sortKey === 'nom') cmp = a.nom.localeCompare(b.nom, 'fr');
      else if (sortKey === 'ca') cmp = caAnnuel(a.chiffreAffaire, a.nombreAnnees) - caAnnuel(b.chiffreAffaire, b.nombreAnnees);
      else if (sortKey === 'status') {
        const rank = (c: Chantier) => c.datePaiement ? 2 : c.factureFaite ? 1 : 0;
        cmp = rank(a) - rank(b);
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [billable, filter, sortKey, sortAsc]);

  // Summary stats
  const stats = useMemo(() => {
    const caTotal    = billable.reduce((s, c) => s + caAnnuel(c.chiffreAffaire, c.nombreAnnees), 0);
    const caFacture  = billable.filter(c => c.factureFaite).reduce((s, c) => s + caAnnuel(c.chiffreAffaire, c.nombreAnnees), 0);
    const caPaye     = billable.filter(c => !!c.datePaiement).reduce((s, c) => s + caAnnuel(c.chiffreAffaire, c.nombreAnnees), 0);
    const aFacturer  = billable.filter(c => !c.factureFaite).length;
    const enAttente  = billable.filter(c => c.factureFaite && !c.datePaiement).length;
    return { caTotal, caFacture, caPaye, aFacturer, enAttente };
  }, [billable]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const toggleFacture = async (c: Chantier, e: React.MouseEvent) => {
    e.stopPropagation();
    await onUpdateChantier(c.id, {
      factureFaite: !c.factureFaite,
      dateFacture: !c.factureFaite ? today : undefined,
      datePaiement: !c.factureFaite ? c.datePaiement : undefined,
    });
  };

  const FILTERS: { key: Filter; label: string; count?: number }[] = [
    { key: 'toutes',     label: 'Tous' },
    { key: 'a_facturer', label: 'À facturer', count: stats.aFacturer },
    { key: 'en_attente', label: 'En attente', count: stats.enAttente },
    { key: 'payees',     label: 'Payés' },
  ];

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k
      ? sortAsc ? <ChevronUp size={11} className="inline ml-0.5"/> : <ChevronDown size={11} className="inline ml-0.5"/>
      : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-900">

      {/* ── Summary strip ──────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-4 sm:px-6 py-3 flex flex-wrap gap-4 sm:gap-8">
        <StatTile label="CA terminé" value={`${stats.caTotal.toLocaleString('fr-FR')} €`} color="text-slate-700 dark:text-slate-200" />
        <StatTile label="Facturé" value={`${stats.caFacture.toLocaleString('fr-FR')} €`} color="text-blue-600" />
        <StatTile label="Encaissé" value={`${stats.caPaye.toLocaleString('fr-FR')} €`} color="text-green-600" />
        <StatTile label="À facturer" value={`${stats.aFacturer} chantier${stats.aFacturer !== 1 ? 's' : ''}`} color="text-red-500" />
        {stats.enAttente > 0 && (
          <StatTile label="En attente paiement" value={`${stats.enAttente}`} color="text-amber-500" />
        )}
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-2 flex gap-2 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === f.key
                ? 'bg-slate-800 dark:bg-slate-600 text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}>
            {f.label}{f.count !== undefined ? ` (${f.count})` : ''}
          </button>
        ))}
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-2 sm:px-4 py-2">
        {filtered.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-12">Aucun chantier dans cette catégorie</p>
        ) : (
          <table className="w-full text-sm border-separate border-spacing-y-1">
            <thead>
              <tr className="text-left text-[11px] text-slate-400 uppercase tracking-wide">
                <Th onClick={() => handleSort('nom')}>Chantier <SortIcon k="nom"/></Th>
                <Th>Client</Th>
                <Th onClick={() => handleSort('dateFin')}>Fin <SortIcon k="dateFin"/></Th>
                <Th onClick={() => handleSort('ca')}>CA <SortIcon k="ca"/></Th>
                <Th onClick={() => handleSort('status')}>Facture <SortIcon k="status"/></Th>
                <Th>Date facture</Th>
                <Th>Paiement</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const meta = CHANTIER_TYPES[c.type];
                const annualCA = caAnnuel(c.chiffreAffaire, c.nombreAnnees);
                const isPaid   = !!c.datePaiement;
                const isWaiting = c.factureFaite && !c.datePaiement;
                const rowBg = isPaid
                  ? 'bg-green-50 dark:bg-green-900/10'
                  : isWaiting
                    ? 'bg-amber-50 dark:bg-amber-900/10'
                    : 'bg-white dark:bg-slate-800';

                return (
                  <tr
                    key={c.id}
                    onClick={() => onClickChantier(c)}
                    className={`cursor-pointer hover:brightness-95 transition-all rounded-lg ${rowBg}`}>
                    <td className="px-3 py-2 rounded-l-lg">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: meta.color }}/>
                        <span className="font-medium text-slate-800 dark:text-slate-100 truncate max-w-[160px]">{c.nom}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400 text-xs truncate max-w-[120px]">
                      {c.client ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                      <span className="flex items-center gap-1">
                        <Calendar size={11}/>
                        {format(new Date(c.dateFin), 'd MMM yy', { locale: fr })}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      <span className="flex items-center gap-0.5">
                        <Euro size={11} className="text-slate-400"/>
                        {annualCA.toLocaleString('fr-FR')}
                      </span>
                    </td>
                    <td className="px-3 py-2" onClick={e => toggleFacture(c, e)}>
                      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer select-none ${
                        isPaid     ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : isWaiting ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        :             'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {isPaid
                          ? <><CheckCheck size={11}/> Payé</>
                          : isWaiting
                            ? <><CheckCheck size={11}/> Envoyée</>
                            : <><CircleAlert size={11}/> À faire</>
                        }
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {c.dateFacture ? format(new Date(c.dateFacture), 'd MMM yy', { locale: fr }) : '—'}
                    </td>
                    <td className="px-3 py-2 rounded-r-lg text-xs whitespace-nowrap">
                      {c.datePaiement
                        ? <span className="text-green-600 dark:text-green-400 font-medium">{format(new Date(c.datePaiement), 'd MMM yy', { locale: fr })}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <th
      className={`px-3 py-1.5 font-medium ${onClick ? 'cursor-pointer hover:text-slate-600 dark:hover:text-slate-200' : ''}`}
      onClick={onClick}>
      {children}
    </th>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</span>
      <span className={`text-sm font-bold ${color}`}>{value}</span>
    </div>
  );
}
