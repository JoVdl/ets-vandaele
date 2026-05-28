import { useState, useCallback, useMemo } from 'react';
import {
  startOfMonth, endOfMonth, addMonths, subMonths, startOfDay,
} from 'date-fns';
import {
  Plus, ChevronLeft, ChevronRight, Calendar, BarChart2,
  TrendingUp, AlertCircle, ZoomIn, ZoomOut, Map, Wand2, Loader2,
} from 'lucide-react';
import { useChantiers } from '../hooks/useChantiers';
import GanttChart from './GanttChart';
import ChantierModal from './ChantierModal';
import ImportButton from './ImportButton';
import MapView from './MapView';
import type { Chantier } from '../types';
import { CHANTIER_TYPES, MONTH_FR } from '../lib/constants';
import { reorganize } from '../lib/reorganize';
import { countWorkingDays } from '../lib/workingDays';
import {
  ExcavatorIcon, DumperIcon, TractoBenneIcon, BullIcon,
  CheniletteIcon, BateauFaucardeurIcon, DragueIcon, TelescoIcon,
} from './EquipmentIcons';

type ZoomPreset = 1 | 2 | 3 | 6 | 'year';
type ViewTab = 'gantt' | 'carte';

const PRESET_DAY_WIDTHS: Record<string, number> = {
  '1': 40, '2': 24, '3': 16, '6': 9, 'year': 5,
};

// ── Equipment utilization ─────────────────────────────────────────────────────

interface EquipLine {
  key: string;
  icon: React.ReactNode;
  label: string;
  days: number;
  maxDays: number;
}

function computeEquipUtilization(chantiers: Chantier[], periodStart: Date, periodEnd: Date): EquipLine[] {
  const periodWorkDays = countWorkingDays(periodStart, periodEnd);
  const lines: EquipLine[] = [];

  const pelleDays: Record<string, number> = {};
  let dumperDays = 0, tractoDays = 0, bullDays = 0;
  let cheniDays = 0, bateauDays = 0, dragueDays = 0, telescoDays = 0;

  for (const c of chantiers) {
    const s = startOfDay(new Date(c.dateDebut));
    const e = startOfDay(new Date(c.dateFin));
    const clampS = s < periodStart ? periodStart : s;
    const clampE = e > periodEnd   ? periodEnd   : e;
    if (clampS > clampE) continue;
    const wd = countWorkingDays(clampS, clampE);
    if (wd <= 0) continue;

    (c.pelles ?? []).forEach(t => { pelleDays[t] = (pelleDays[t] ?? 0) + wd; });
    if (c.dumpers)        dumperDays  += wd * c.dumpers;
    if (c.tractoBennes)   tractoDays  += wd * c.tractoBennes;
    if (c.bulls)          bullDays    += wd * c.bulls;
    if (c.chenillette)    cheniDays   += wd;
    if (c.bateauFaucardeur) bateauDays += wd;
    if (c.drague)         dragueDays  += wd;
    if (c.telesco)        telescoDays += wd;
  }

  const add = (key: string, icon: React.ReactNode, label: string, days: number) => {
    if (days > 0) lines.push({ key, icon, label, days, maxDays: periodWorkDays });
  };

  for (const [t, d] of Object.entries(pelleDays))
    add(`pelle-${t}`, <ExcavatorIcon size={13}/>, `Pelle ${t}`, d);
  add('dumper',  <DumperIcon size={13}/>,           'Dumper',        dumperDays);
  add('tracto',  <TractoBenneIcon size={13}/>,      'Tracto',        tractoDays);
  add('bull',    <BullIcon size={13}/>,              'Bull',          bullDays);
  add('cheni',   <CheniletteIcon size={13}/>,       'Chenillette',   cheniDays);
  add('bateau',  <BateauFaucardeurIcon size={13}/>,  'Bateau fauc.',  bateauDays);
  add('drague',  <DragueIcon size={13}/>,           'Drague',        dragueDays);
  add('telesco', <TelescoIcon size={13}/>,          'Télesco',       telescoDays);

  return lines;
}

export default function PlanDeCharge() {
  const { chantiers, loading, error, addChantier, updateChantier, deleteChantier, confirmChantier } = useChantiers();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [zoomPreset, setZoomPreset]     = useState<ZoomPreset>(2);
  const [dayWidth, setDayWidth]         = useState(PRESET_DAY_WIDTHS['2']);
  const [activeTab, setActiveTab]       = useState<ViewTab>('gantt');
  const [reorganizing, setReorganizing] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; chantier: Chantier | null; defaultDate?: string }>({
    open: false, chantier: null,
  });
  const [filterStatus, setFilterStatus] = useState<'all' | 'confirme' | 'potentiel'>('all');

  // ── Period ─────────────────────────────────────────────────────────────────
  const periodStart = startOfMonth(currentMonth);
  const periodEnd = zoomPreset === 'year'
    ? new Date(currentMonth.getFullYear(), 11, 31)
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

  const warnCount = chantiers.filter(c =>
    c.periodePreconiseeDebut && c.periodePreconiseeFin &&
    (c.dateDebut < c.periodePreconiseeDebut || c.dateFin > c.periodePreconiseeFin)
  ).length;

  // ── Equipment utilization (visible period) ────────────────────────────────
  const equipLines = useMemo(
    () => computeEquipUtilization(filtered, periodStart, periodEnd),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, periodStart.getTime(), periodEnd.getTime()]
  );

  // ── Modal helpers ──────────────────────────────────────────────────────────
  const openNew    = (defaultDate?: string) => setModal({ open: true, chantier: null, defaultDate });
  const openEdit   = (c: Chantier)           => setModal({ open: true, chantier: c });
  const closeModal = ()                      => setModal({ open: false, chantier: null });

  const handleSave = async (data: Omit<Chantier, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (modal.chantier) await updateChantier(modal.chantier.id, data);
    else                await addChantier(data);
  };
  const handleDelete  = async () => { if (modal.chantier) await deleteChantier(modal.chantier.id); };
  const handleConfirm = async () => { if (modal.chantier) await confirmChantier(modal.chantier.id); };

  const handleMove   = useCallback(async (id: string, s: string, e: string) => updateChantier(id, { dateDebut: s, dateFin: e }), [updateChantier]);
  const handleResize = useCallback(async (id: string, e: string) => updateChantier(id, { dateFin: e }), [updateChantier]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const step       = zoomPreset === 'year' ? 12 : zoomPreset as number;
  const prevPeriod = () => setCurrentMonth(m => subMonths(m, step));
  const nextPeriod = () => setCurrentMonth(m => addMonths(m, step));
  const goToday    = () => setCurrentMonth(new Date());

  // ── Zoom ───────────────────────────────────────────────────────────────────
  const applyPreset = (p: ZoomPreset) => {
    setZoomPreset(p);
    setDayWidth(PRESET_DAY_WIDTHS[String(p)]);
    if (p === 'year') setCurrentMonth(startOfDay(new Date()));
  };
  const handleDayWidthChange = useCallback((w: number) => {
    setDayWidth(w);
    setZoomPreset('year');
  }, []);
  const zoomIn  = () => handleDayWidthChange(Math.min(100, dayWidth * 1.3));
  const zoomOut = () => handleDayWidthChange(Math.max(3,   dayWidth / 1.3));

  // ── Period label ──────────────────────────────────────────────────────────
  const periodLabel = zoomPreset === 'year'
    ? `Année ${currentMonth.getFullYear()}`
    : zoomPreset === 1
      ? `${MONTH_FR[periodStart.getMonth()]} ${periodStart.getFullYear()}`
      : `${MONTH_FR[periodStart.getMonth()]} – ${MONTH_FR[periodEnd.getMonth()]} ${periodEnd.getFullYear()}`;

  // ── Smart reorganization ───────────────────────────────────────────────────
  const handleReorganize = async () => {
    if (!confirm(
      `Réorganiser les ${potentiels.length} chantiers potentiels ?\n\n` +
      `• Les chantiers confirmés restent en place.\n` +
      `• Les potentiels sont repositionnés en respectant les périodes préconisées\n  et en optimisant les déplacements géographiques.`
    )) return;
    setReorganizing(true);
    try {
      const result = reorganize(chantiers);
      for (const r of result.results)
        await updateChantier(r.id, { dateDebut: r.dateDebut, dateFin: r.dateFin });
      const msg = result.moved > 0
        ? `✓ ${result.moved} chantier(s) repositionné(s).`
        : 'Aucun déplacement nécessaire.';
      const warns = result.warnings.length ? '\n\n⚠ ' + result.warnings.join('\n⚠ ') : '';
      alert(msg + warns);
    } finally {
      setReorganizing(false);
    }
  };

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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-slate-50">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0">

        {/* Row 1 — Title + CA stats + actions */}
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

          {/* CA summary */}
          <div className="flex items-center gap-5">
            <div className="text-right">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">CA validé</p>
              <p className="text-sm font-bold text-slate-800">{caConfirme.toLocaleString('fr-FR')} €</p>
            </div>
            <div className="w-px h-8 bg-slate-100" />
            <div className="text-right">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">CA potentiel</p>
              <p className="text-sm font-semibold text-slate-400">{caPotentiel.toLocaleString('fr-FR')} €</p>
            </div>
            <div className="w-px h-8 bg-slate-100" />
            <div className="text-right">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide flex items-center gap-1 justify-end">
                <TrendingUp size={10} className="text-green-500"/> Total
              </p>
              <p className="text-sm font-bold text-blue-600">{(caConfirme + caPotentiel).toLocaleString('fr-FR')} €</p>
            </div>
            {warnCount > 0 && (
              <>
                <div className="w-px h-8 bg-slate-100" />
                <div className="text-right">
                  <p className="text-[10px] text-orange-400 uppercase tracking-wide">Hors période</p>
                  <p className="text-sm font-bold text-orange-500">{warnCount} ⚠</p>
                </div>
              </>
            )}
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
            <button
              onClick={handleReorganize}
              disabled={reorganizing || potentiels.length === 0}
              title="Réorganiser intelligemment les chantiers potentiels"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-40">
              {reorganizing ? <Loader2 size={14} className="animate-spin"/> : <Wand2 size={14}/>}
              Réorganiser
            </button>
            <button onClick={() => openNew()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
              <Plus size={15} />
              Nouveau chantier
            </button>
          </div>
        </div>

        {/* Row 2 — Equipment utilization */}
        {equipLines.length > 0 && (
          <div className="flex items-center gap-3 px-6 py-1.5 border-b border-slate-100 overflow-x-auto">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex-shrink-0">Engins :</span>
            <div className="flex items-center gap-4 flex-wrap">
              {equipLines.map(eq => {
                const pct = Math.min(100, Math.round((eq.days / eq.maxDays) * 100));
                const barColor = pct > 80 ? '#EF4444' : pct > 50 ? '#F97316' : '#3B82F6';
                return (
                  <div key={eq.key} className="flex items-center gap-1.5" title={`${eq.label} : ${eq.days} j ouvrés sur ${eq.maxDays}`}>
                    <span className="text-slate-500 flex-shrink-0">{eq.icon}</span>
                    <span className="text-[10px] text-slate-500 flex-shrink-0">{eq.label}</span>
                    <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                    </div>
                    <span className="text-[10px] font-bold tabular-nums" style={{ color: barColor }}>{eq.days}j</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Row 3 — Counts */}
        <div className="flex items-center gap-6 px-6 py-1.5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full" />
            <span className="text-xs text-slate-500">{confirmes.length} confirmés</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-slate-300 rounded-full border border-dashed border-slate-400" />
            <span className="text-xs text-slate-500">{potentiels.length} potentiels</span>
          </div>
        </div>

        {/* Row 4 — Navigation + zoom + view tabs */}
        <div className="flex items-center gap-3 px-6 py-2">
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

          <span className="text-sm font-semibold text-slate-700 min-w-[200px]">{periodLabel}</span>

          {/* Zoom presets */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400 mr-1">Vue :</span>
            {([1, 2, 3, 6, 'year'] as ZoomPreset[]).map(p => (
              <button key={String(p)} onClick={() => applyPreset(p)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  zoomPreset === p ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}>
                {p === 1 ? '1 mois' : p === 2 ? '2 mois' : p === 3 ? '3 mois' : p === 6 ? '6 mois' : 'Année'}
              </button>
            ))}
            <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden ml-1">
              <button onClick={zoomOut} className="p-1.5 hover:bg-slate-100 text-slate-500 transition-colors" title="Dézoomer">
                <ZoomOut size={13} />
              </button>
              <span className="text-[10px] text-slate-400 px-1.5 tabular-nums">{Math.round(dayWidth)}px</span>
              <button onClick={zoomIn} className="p-1.5 hover:bg-slate-100 text-slate-500 transition-colors" title="Zoomer">
                <ZoomIn size={13} />
              </button>
            </div>
            <span className="text-[10px] text-slate-300 ml-1">Ctrl+scroll</span>
          </div>

          {/* Gantt / Carte tab switcher */}
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden ml-auto">
            <button onClick={() => setActiveTab('gantt')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'gantt' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'
              }`}>
              <BarChart2 size={13}/> Gantt
            </button>
            <button onClick={() => setActiveTab('carte')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'carte' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'
              }`}>
              <Map size={13}/> Carte
            </button>
          </div>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm">Chargement...</p>
          </div>
        </div>
      ) : activeTab === 'gantt' ? (
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
      ) : (
        <MapView
          key={chantiers.map(c => `${c.id}:${c.latitude}:${c.longitude}`).join(',')}
          chantiers={chantiers}
          onClickChantier={openEdit}
        />
      )}

      {/* ── Legend (Gantt only) ───────────────────────────────────────────── */}
      {activeTab === 'gantt' && (
        <div className="bg-white border-t border-slate-100 px-6 py-2 flex flex-wrap gap-3 flex-shrink-0">
          {Object.entries(CHANTIER_TYPES).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: v.color }} />
              <span className="text-xs text-slate-500">{v.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-slate-100">
            <div className="w-6 h-3 rounded-sm border border-dashed border-green-400 bg-green-50 opacity-80" />
            <span className="text-xs text-slate-400">Période préconisée</span>
          </div>
        </div>
      )}

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
