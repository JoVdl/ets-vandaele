import { useState, useCallback } from 'react';
import {
  startOfMonth, endOfMonth, addMonths, subMonths, startOfDay,
} from 'date-fns';
import {
  Plus, ChevronLeft, ChevronRight, Calendar, BarChart2,
  TrendingUp, AlertCircle, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useChantiers } from '../hooks/useChantiers';
import GanttChart from './GanttChart';
import ChantierModal from './ChantierModal';
import ImportButton from './ImportButton';
import type { Chantier } from '../types';
import { CHANTIER_TYPES, MONTH_FR } from '../lib/constants';

type ZoomPreset = 1 | 2 | 3 | 6 | 'year';

// pixels per day for each preset
const PRESET_DAY_WIDTHS: Record<string, number> = {
  '1': 40,
  '2': 24,
  '3': 16,
  '6': 9,
  'year': 5,
};

export default function PlanDeCharge() {
  const { chantiers, loading, error, addChantier, updateChantier, deleteChantier, confirmChantier } = useChantiers();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [zoomPreset, setZoomPreset] = useState<ZoomPreset>(2);
  const [dayWidth, setDayWidth]     = useState(PRESET_DAY_WIDTHS['2']);
  const [modal, setModal] = useState<{ open: boolean; chantier: Chantier | null; defaultDate?: string }>({
    open: false, chantier: null,
  });
  const [filterStatus, setFilterStatus] = useState<'all' | 'confirme' | 'potentiel'>('all');

  // ── Period calculation ─────────────────────────────────────────────────────
  const periodStart = startOfMonth(currentMonth);
  const periodEnd = zoomPreset === 'year'
    ? new Date(currentMonth.getFullYear(), 11, 31)   // Dec 31 of the current year
    : endOfMonth(addMonths(currentMonth, (zoomPreset as number) - 1));

  // ── Filtered chantiers ─────────────────────────────────────────────────────
  const filtered = chantiers.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false;
    return new Date(c.dateDebut) <= periodEnd && new Date(c.dateFin) >= periodStart;
  });

  // ── Stats ──────────────────────────────────────────────────────────────────
  const confirmes   = chantiers.filter(c => c.status === 'confirme');
  const potentiels  = chantiers.filter(c => c.status === 'potentiel');
  const caConfirme  = confirmes.reduce((s, c)  => s + (c.chiffreAffaire ?? 0), 0);
  const caPotentiel = potentiels.reduce((s, c) => s + (c.chiffreAffaire ?? 0), 0);

  // ── Modal helpers ──────────────────────────────────────────────────────────
  const openNew  = (defaultDate?: string) => setModal({ open: true, chantier: null, defaultDate });
  const openEdit = (c: Chantier)           => setModal({ open: true, chantier: c });
  const closeModal = ()                    => setModal({ open: false, chantier: null });

  const handleSave = async (data: Omit<Chantier, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (modal.chantier) await updateChantier(modal.chantier.id, data);
    else                await addChantier(data);
  };
  const handleDelete  = async () => { if (modal.chantier) await deleteChantier(modal.chantier.id); };
  const handleConfirm = async () => { if (modal.chantier) await confirmChantier(modal.chantier.id); };

  const handleMove   = useCallback(async (id: string, s: string, e: string) => updateChantier(id, { dateDebut: s, dateFin: e }), [updateChantier]);
  const handleResize = useCallback(async (id: string, e: string) => updateChantier(id, { dateFin: e }), [updateChantier]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const step = zoomPreset === 'year' ? 12 : zoomPreset as number;
  const prevPeriod = () => setCurrentMonth(m => subMonths(m, step));
  const nextPeriod = () => setCurrentMonth(m => addMonths(m, step));
  const goToday    = () => setCurrentMonth(new Date());

  // ── Preset zoom buttons ────────────────────────────────────────────────────
  const applyPreset = (p: ZoomPreset) => {
    setZoomPreset(p);
    setDayWidth(PRESET_DAY_WIDTHS[String(p)]);
    if (p === 'year') {
      // Start from today's month, go to end of year
      setCurrentMonth(startOfDay(new Date()));
    }
  };

  // ── Wheel zoom callback (from GanttChart) ──────────────────────────────────
  const handleDayWidthChange = useCallback((w: number) => {
    setDayWidth(w);
    setZoomPreset('year'); // free zoom → no preset active
  }, []);

  // ── Manual zoom buttons ────────────────────────────────────────────────────
  const zoomIn  = () => handleDayWidthChange(Math.min(100, dayWidth * 1.3));
  const zoomOut = () => handleDayWidthChange(Math.max(3,   dayWidth / 1.3));

  // ── Period label ──────────────────────────────────────────────────────────
  const periodLabel = zoomPreset === 'year'
    ? `Année ${currentMonth.getFullYear()}`
    : zoomPreset === 1
      ? `${MONTH_FR[periodStart.getMonth()]} ${periodStart.getFullYear()}`
      : `${MONTH_FR[periodStart.getMonth()]} – ${MONTH_FR[periodEnd.getMonth()]} ${periodEnd.getFullYear()}`;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500">
        <AlertCircle size={40} className="text-red-400" />
        <p className="font-medium">Erreur de connexion Firebase</p>
        <p className="text-sm text-center max-w-sm">{error}</p>
        <p className="text-xs text-slate-400">Vérifiez votre fichier .env et la configuration Firebase</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0">

        {/* Title + actions */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <BarChart2 size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-800">Plan de charge</h1>
              <p className="text-xs text-slate-400">ETS Vandaele</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
              {(['all', 'confirme', 'potentiel'] as const).map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1.5 font-medium transition-colors ${
                    filterStatus === s ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}>
                  {s === 'all' ? 'Tous' : s === 'confirme' ? 'Confirmés' : 'Potentiels'}
                </button>
              ))}
            </div>
            <ImportButton />
            <button onClick={() => openNew()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
              <Plus size={15} />
              Nouveau chantier
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6 px-6 py-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full" />
            <span className="text-xs text-slate-500">{confirmes.length} confirmés</span>
            <span className="text-xs font-semibold text-slate-700">{caConfirme.toLocaleString('fr-FR')} €</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-slate-300 rounded-full border border-dashed border-slate-400" />
            <span className="text-xs text-slate-500">{potentiels.length} potentiels</span>
            <span className="text-xs font-semibold text-slate-400">{caPotentiel.toLocaleString('fr-FR')} €</span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <TrendingUp size={13} className="text-green-500" />
            <span className="text-xs text-slate-500">CA total :</span>
            <span className="text-xs font-bold text-slate-700">{(caConfirme + caPotentiel).toLocaleString('fr-FR')} €</span>
          </div>
        </div>

        {/* Navigation + zoom controls */}
        <div className="flex items-center gap-3 px-6 py-2 border-t border-slate-100">
          {/* Prev / Today / Next */}
          <div className="flex items-center gap-1">
            <button onClick={prevPeriod} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
              <ChevronLeft size={16} className="text-slate-600" />
            </button>
            <button onClick={goToday} className="px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1">
              <Calendar size={12} />
              Aujourd'hui
            </button>
            <button onClick={nextPeriod} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
              <ChevronRight size={16} className="text-slate-600" />
            </button>
          </div>

          <span className="text-sm font-semibold text-slate-700 min-w-[220px]">{periodLabel}</span>

          {/* Zoom presets */}
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-slate-400 mr-1">Vue :</span>
            {([1, 2, 3, 6, 'year'] as ZoomPreset[]).map(p => (
              <button key={String(p)} onClick={() => applyPreset(p)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  zoomPreset === p ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}>
                {p === 1 ? '1 mois' : p === 2 ? '2 mois' : p === 3 ? '3 mois' : p === 6 ? '6 mois' : 'Année'}
              </button>
            ))}

            {/* Fine zoom +/- */}
            <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden ml-2">
              <button onClick={zoomOut} className="p-1.5 hover:bg-slate-100 text-slate-500 transition-colors" title="Dézoomer">
                <ZoomOut size={13} />
              </button>
              <span className="text-[10px] text-slate-400 px-1.5 tabular-nums">{Math.round(dayWidth)}px</span>
              <button onClick={zoomIn}  className="p-1.5 hover:bg-slate-100 text-slate-500 transition-colors" title="Zoomer">
                <ZoomIn size={13} />
              </button>
            </div>
            <span className="text-[10px] text-slate-300 ml-1">Ctrl+scroll</span>
          </div>
        </div>
      </div>

      {/* ── Gantt ────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm">Chargement...</p>
          </div>
        </div>
      ) : (
        <GanttChart
          chantiers={filtered}
          periodStart={periodStart}
          periodEnd={periodEnd}
          dayWidth={dayWidth}
          onDayWidthChange={handleDayWidthChange}
          onMoveChantier={handleMove}
          onResizeChantier={handleResize}
          onClickChantier={openEdit}
          onClickDay={openNew}
        />
      )}

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      <div className="bg-white border-t border-slate-100 px-6 py-2 flex flex-wrap gap-3 flex-shrink-0">
        {Object.entries(CHANTIER_TYPES).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: v.color }} />
            <span className="text-xs text-slate-500">{v.label}</span>
          </div>
        ))}
      </div>

      <ChantierModal
        isOpen={modal.open}
        onClose={closeModal}
        chantier={modal.chantier}
        defaultDateDebut={modal.defaultDate}
        onSave={handleSave}
        onDelete={modal.chantier ? handleDelete : undefined}
        onConfirm={modal.chantier?.status === 'potentiel' ? handleConfirm : undefined}
      />
    </div>
  );
}
