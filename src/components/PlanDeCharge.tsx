import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  startOfMonth, endOfMonth, addMonths, subMonths, startOfDay, differenceInCalendarDays,
} from 'date-fns';
import {
  Plus, ChevronLeft, ChevronRight, ChevronDown, Calendar, BarChart2,
  TrendingUp, AlertCircle, ZoomIn, ZoomOut, Map, Wand2, Loader2, Moon, Sun, MapPin, MoreVertical,
} from 'lucide-react';
import { useTheme } from '../lib/theme';
import { useChantiers } from '../hooks/useChantiers';
import GanttChart from './GanttChart';
import ChantierModal from './ChantierModal';
import ImportButton from './ImportButton';
import MapView from './MapView';
import type { Chantier } from '../types';
import { CHANTIER_TYPES, MONTH_FR } from '../lib/constants';
import { reorganize } from '../lib/reorganize';
import { geocode, extractLocation } from '../lib/geocoder';
import { countWorkingDays } from '../lib/workingDays';
import {
  ExcavatorIcon, DumperIcon, TractoBenneIcon, BullIcon,
  CheniletteIcon, BateauFaucardeurIcon, DragueIcon, TelescoIcon, RouleauIcon,
} from './EquipmentIcons';

type ZoomPreset = 1 | 2 | 3 | 6 | 'year';
type ViewTab = 'gantt' | 'carte';


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
  let dumperDays = 0, tractoDays = 0, bullDays = 0, roulDays = 0;
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
    if (c.rouleaux)       roulDays    += wd * c.rouleaux;
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
  add('rouleau', <RouleauIcon size={13}/>,          'Rouleau 700kg', roulDays);
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
  const [dayWidth, setDayWidth]         = useState(() => {
    const start = startOfMonth(new Date());
    const end   = endOfMonth(addMonths(start, 1));
    const numDays = differenceInCalendarDays(end, start) + 1;
    return Math.max(3, (window.innerWidth - 260) / numDays);
  });
  const [activeTab, setActiveTab]       = useState<ViewTab>('gantt');
  const [reorganizing, setReorganizing] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; chantier: Chantier | null; defaultDate?: string }>({
    open: false, chantier: null,
  });
  const [filterStatus, setFilterStatus] = useState<'all' | 'confirme' | 'potentiel' | 'archive'>('all');
  const [geocoding, setGeocoding] = useState<{ done: number; total: number } | null>(null);
  const { theme, toggle: toggleTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showEquip, setShowEquip] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 640);
  const [showMenu, setShowMenu]   = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Period ─────────────────────────────────────────────────────────────────
  const periodStart = startOfMonth(currentMonth);
  const periodEnd = zoomPreset === 'year'
    ? new Date(currentMonth.getFullYear(), 11, 31)
    : endOfMonth(addMonths(currentMonth, (zoomPreset as number) - 1));

  // ── Filtered chantiers ─────────────────────────────────────────────────────
  const filtered = chantiers.filter(c => {
    if (filterStatus === 'archive') {
      if (c.status !== 'refuse' && c.status !== 'annule') return false;
    } else if (filterStatus !== 'all') {
      if (c.status !== filterStatus) return false;
    } else {
      // Default "all" hides archived unless explicitly selected
      if (c.status === 'refuse' || c.status === 'annule') return false;
    }
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

  // ── Zoom / fit ─────────────────────────────────────────────────────────────
  const fitDayWidth = useCallback((p: ZoomPreset, baseMonth: Date): number => {
    const start = startOfMonth(baseMonth);
    const end = p === 'year'
      ? new Date(baseMonth.getFullYear(), 11, 31)
      : endOfMonth(addMonths(start, (p as number) - 1));
    const numDays = differenceInCalendarDays(end, start) + 1;
    const availableW = (containerRef.current?.clientWidth ?? window.innerWidth) - 260;
    return Math.max(3, availableW / numDays);
  }, []);

  const applyPreset = (p: ZoomPreset) => {
    setZoomPreset(p);
    setDayWidth(fitDayWidth(p, currentMonth));
  };
  const handleDayWidthChange = useCallback((w: number) => setDayWidth(w), []);
  const zoomIn  = () => setDayWidth(w => Math.min(100, w * 1.3));
  const zoomOut = () => setDayWidth(w => Math.max(3,   w / 1.3));

  // ── Navigation ─────────────────────────────────────────────────────────────
  const step       = zoomPreset === 'year' ? 12 : zoomPreset as number;
  const prevPeriod = () => {
    const next = subMonths(currentMonth, step);
    setCurrentMonth(next);
    setDayWidth(fitDayWidth(zoomPreset, next));
  };
  const nextPeriod = () => {
    const next = addMonths(currentMonth, step);
    setCurrentMonth(next);
    setDayWidth(fitDayWidth(zoomPreset, next));
  };
  const goToday = () => {
    const t = new Date();
    setCurrentMonth(t);
    setDayWidth(fitDayWidth(zoomPreset, t));
  };

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

  const handleGeocodeBatch = async () => {
    const toGeocode = chantiers.filter(c => !c.latitude || !c.longitude);
    if (!toGeocode.length) { alert('Tous les chantiers ont déjà une localisation.'); return; }
    if (!confirm(`Géolocaliser ${toGeocode.length} chantier(s) sans coordonnées ?\nCela peut prendre quelques secondes (1 req/s).`)) return;
    setGeocoding({ done: 0, total: toGeocode.length });
    let done = 0;
    for (const c of toGeocode) {
      const q = extractLocation(c.nom, c.adresse || c.lieu);
      if (q) {
        const res = await geocode(q);
        if (res) {
          await updateChantier(c.id, {
            latitude: res.lat,
            longitude: res.lon,
            adresse: c.adresse || res.displayName.split(',').slice(0, 2).join(',').trim(),
          });
        }
      }
      done++;
      setGeocoding({ done, total: toGeocode.length });
      if (done < toGeocode.length) await new Promise(r => setTimeout(r, 1100));
    }
    setGeocoding(null);
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

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
    <div ref={containerRef} className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">

      {/* ── Top bar ── */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">

        {/* Row 1 — Title + CA (desktop) + actions */}
        <div className="flex items-center justify-between px-3 sm:px-6 py-2 sm:py-3 border-b border-slate-100 dark:border-slate-700/50">
          {/* Logo + title */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-7 h-7 sm:w-8 sm:h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <BarChart2 size={14} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100">Plan de charge</h1>
              <p className="text-[10px] text-slate-400 hidden sm:block">ETS Vandaele</p>
            </div>
          </div>

          {/* CA summary — desktop only */}
          <div className="hidden sm:flex items-center gap-5">
            <div className="text-right">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">CA validé</p>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{caConfirme.toLocaleString('fr-FR')} €</p>
            </div>
            <div className="w-px h-8 bg-slate-100 dark:bg-slate-700" />
            <div className="text-right">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">CA potentiel</p>
              <p className="text-sm font-semibold text-slate-400">{caPotentiel.toLocaleString('fr-FR')} €</p>
            </div>
            <div className="w-px h-8 bg-slate-100 dark:bg-slate-700" />
            <div className="text-right">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide flex items-center gap-1 justify-end">
                <TrendingUp size={10} className="text-green-500"/> Total
              </p>
              <p className="text-sm font-bold text-blue-600">{(caConfirme + caPotentiel).toLocaleString('fr-FR')} €</p>
            </div>
            {warnCount > 0 && (
              <>
                <div className="w-px h-8 bg-slate-100 dark:bg-slate-700" />
                <div className="text-right">
                  <p className="text-[10px] text-orange-400 uppercase tracking-wide">Hors période</p>
                  <p className="text-sm font-bold text-orange-500">{warnCount} ⚠</p>
                </div>
              </>
            )}
          </div>

          {/* Desktop action buttons */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden text-xs">
              {([
                { key: 'all',       label: 'Tous' },
                { key: 'confirme',  label: 'Confirmés' },
                { key: 'potentiel', label: 'Potentiels' },
                { key: 'archive',   label: 'Archivés' },
              ] as const).map(({ key, label }) => (
                <button key={key} onClick={() => setFilterStatus(key)}
                  className={`px-3 py-1.5 font-medium transition-colors ${
                    filterStatus === key
                      ? key === 'archive' ? 'bg-slate-400 text-white' : 'bg-slate-800 text-white dark:bg-slate-600'
                      : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            <ImportButton />
            <button
              onClick={handleGeocodeBatch}
              disabled={!!geocoding}
              title="Géolocaliser automatiquement les chantiers sans coordonnées"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-40">
              {geocoding
                ? <><Loader2 size={14} className="animate-spin"/> {geocoding.done}/{geocoding.total}</>
                : <><MapPin size={14}/> Géolocaliser</>}
            </button>
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
              <Plus size={15} /> Nouveau chantier
            </button>
          </div>

          {/* Mobile: + button + overflow menu */}
          <div className="flex sm:hidden items-center gap-1.5">
            <button onClick={() => openNew()}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
              <Plus size={15}/> <span className="text-xs">Nouveau</span>
            </button>
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setShowMenu(m => !m)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <MoreVertical size={18}/>
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-100 dark:border-slate-700 z-[2000] py-1.5 min-w-[200px]">
                  {/* Filters */}
                  <div className="px-3 py-1.5">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Filtre</p>
                    <div className="flex flex-wrap gap-1">
                      {([
                        { key: 'all',       label: 'Tous' },
                        { key: 'confirme',  label: 'Confirmés' },
                        { key: 'potentiel', label: 'Potentiels' },
                        { key: 'archive',   label: 'Archivés' },
                      ] as const).map(({ key, label }) => (
                        <button key={key} onClick={() => { setFilterStatus(key); setShowMenu(false); }}
                          className={`px-2 py-1 text-xs rounded-md font-medium transition-colors ${
                            filterStatus === key ? 'bg-slate-800 dark:bg-slate-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                          }`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />
                  <button
                    onClick={() => { handleGeocodeBatch(); setShowMenu(false); }}
                    disabled={!!geocoding}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors">
                    {geocoding ? <Loader2 size={14} className="animate-spin"/> : <MapPin size={14} className="text-emerald-600"/>}
                    {geocoding ? `${geocoding.done}/${geocoding.total}…` : 'Géolocaliser'}
                  </button>
                  <button
                    onClick={() => { handleReorganize(); setShowMenu(false); }}
                    disabled={reorganizing || potentiels.length === 0}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors">
                    {reorganizing ? <Loader2 size={14} className="animate-spin"/> : <Wand2 size={14} className="text-violet-600"/>}
                    Réorganiser
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile CA stats row */}
        <div className="sm:hidden flex divide-x divide-slate-100 dark:divide-slate-700 border-b border-slate-100 dark:border-slate-700/50">
          <div className="flex-1 px-2 py-1.5 text-center">
            <p className="text-[9px] text-slate-400 uppercase tracking-wide">Validé</p>
            <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{caConfirme.toLocaleString('fr-FR')} €</p>
          </div>
          <div className="flex-1 px-2 py-1.5 text-center">
            <p className="text-[9px] text-slate-400 uppercase tracking-wide">Potentiel</p>
            <p className="text-xs font-semibold text-slate-400">{caPotentiel.toLocaleString('fr-FR')} €</p>
          </div>
          <div className="flex-1 px-2 py-1.5 text-center">
            <p className="text-[9px] text-slate-400 uppercase tracking-wide flex items-center justify-center gap-0.5"><TrendingUp size={8} className="text-green-500"/> Total</p>
            <p className="text-xs font-bold text-blue-600">{(caConfirme + caPotentiel).toLocaleString('fr-FR')} €</p>
          </div>
          {warnCount > 0 && (
            <div className="px-2 py-1.5 text-center">
              <p className="text-[9px] text-orange-400 uppercase tracking-wide">Hors pér.</p>
              <p className="text-xs font-bold text-orange-500">{warnCount} ⚠</p>
            </div>
          )}
        </div>

        {/* Equipment utilization — collapsible */}
        {equipLines.length > 0 && (
          <div className="border-b border-slate-100 dark:border-slate-700/50">
            <button
              onClick={() => setShowEquip(e => !e)}
              className="w-full flex items-center gap-2 px-3 sm:px-6 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Engins
              </span>
              {!showEquip && (
                <span className="text-[10px] text-slate-400 ml-1">
                  — {equipLines.map(e => e.label).join(', ')}
                </span>
              )}
              <ChevronDown size={12} className={`ml-auto text-slate-300 transition-transform duration-150 ${showEquip ? '' : '-rotate-90'}`} />
            </button>
            {showEquip && (
              <div className="flex items-start gap-3 px-3 sm:px-6 pb-2 overflow-x-auto">
                <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                  {equipLines.map(eq => {
                    const pct = Math.min(100, Math.round((eq.days / eq.maxDays) * 100));
                    const barColor = pct > 80 ? '#EF4444' : pct > 50 ? '#F97316' : '#3B82F6';
                    return (
                      <div key={eq.key} className="flex items-center gap-1.5" title={`${eq.label} : ${eq.days} j ouvrés sur ${eq.maxDays}`}>
                        <span className="text-slate-500 flex-shrink-0">{eq.icon}</span>
                        <span className="text-[10px] text-slate-500 flex-shrink-0">{eq.label}</span>
                        <div className="w-12 sm:w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                        </div>
                        <span className="text-[10px] font-bold tabular-nums" style={{ color: barColor }}>{eq.days}j</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Counts row — desktop only */}
        <div className="hidden sm:flex items-center gap-6 px-6 py-1.5 border-b border-slate-100 dark:border-slate-700/50">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full" />
            <span className="text-xs text-slate-500">{confirmes.length} confirmés</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-slate-300 rounded-full border border-dashed border-slate-400" />
            <span className="text-xs text-slate-500">{potentiels.length} potentiels</span>
          </div>
        </div>

        {/* Navigation + zoom + tabs */}
        <div className="flex items-center gap-1.5 sm:gap-3 px-3 sm:px-6 py-2">
          {/* Prev / Today / Next */}
          <div className="flex items-center gap-0.5 sm:gap-1">
            <button onClick={prevPeriod} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
              <ChevronLeft size={16} className="text-slate-600 dark:text-slate-300" />
            </button>
            <button onClick={goToday} className="hidden sm:flex px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors items-center gap-1">
              <Calendar size={12} /> Aujourd'hui
            </button>
            <button onClick={nextPeriod} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
              <ChevronRight size={16} className="text-slate-600 dark:text-slate-300" />
            </button>
          </div>

          <span className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 flex-1 sm:flex-none sm:min-w-[200px] text-center sm:text-left truncate">
            {periodLabel}
          </span>

          {/* Zoom presets — desktop */}
          <div className="hidden sm:flex items-center gap-1">
            <span className="text-xs text-slate-400 mr-1">Vue :</span>
            {([1, 2, 3, 6, 'year'] as ZoomPreset[]).map(p => (
              <button key={String(p)} onClick={() => applyPreset(p)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  zoomPreset === p ? 'bg-slate-800 dark:bg-slate-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}>
                {p === 1 ? '1 mois' : p === 2 ? '2 mois' : p === 3 ? '3 mois' : p === 6 ? '6 mois' : 'Année'}
              </button>
            ))}
            <div className="flex items-center border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden ml-1">
              <button onClick={zoomOut} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors" title="Dézoomer">
                <ZoomOut size={13} />
              </button>
              <span className="text-[10px] text-slate-400 px-1.5 tabular-nums">{Math.round(dayWidth)}px</span>
              <button onClick={zoomIn} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors" title="Zoomer">
                <ZoomIn size={13} />
              </button>
            </div>
            <span className="text-[10px] text-slate-300 ml-1">Ctrl+scroll</span>
          </div>

          {/* Mobile: zoom buttons */}
          <div className="flex sm:hidden items-center gap-0.5">
            <button onClick={zoomOut} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 rounded-lg transition-colors" title="Dézoomer">
              <ZoomOut size={14} />
            </button>
            <button onClick={zoomIn} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 rounded-lg transition-colors" title="Zoomer">
              <ZoomIn size={14} />
            </button>
          </div>

          {/* Gantt / Carte tab switcher */}
          <div className="flex items-center border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden ml-auto sm:ml-0">
            <button onClick={() => setActiveTab('gantt')}
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'gantt' ? 'bg-slate-800 dark:bg-slate-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}>
              <BarChart2 size={13}/> <span className="hidden sm:inline">Gantt</span>
            </button>
            <button onClick={() => setActiveTab('carte')}
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'carte' ? 'bg-slate-800 dark:bg-slate-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}>
              <Map size={13}/> <span className="hidden sm:inline">Carte</span>
            </button>
          </div>
        </div>

        {/* Mobile only: zoom presets row */}
        <div className="sm:hidden flex items-center gap-0.5 px-3 pb-2 overflow-x-auto">
          {([1, 2, 3, 6, 'year'] as ZoomPreset[]).map(p => (
            <button key={String(p)} onClick={() => applyPreset(p)}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors flex-shrink-0 ${
                zoomPreset === p ? 'bg-slate-800 dark:bg-slate-600 text-white' : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700'
              }`}>
              {p === 1 ? '1M' : p === 2 ? '2M' : p === 3 ? '3M' : p === 6 ? '6M' : 'An'}
            </button>
          ))}
          <button onClick={goToday} className="ml-auto px-2.5 py-1 text-xs font-medium rounded text-slate-500 bg-slate-100 dark:bg-slate-700 dark:text-slate-300 flex-shrink-0 flex items-center gap-1">
            <Calendar size={11}/> Auj.
          </button>
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
          key={filtered.map(c => `${c.id}:${c.latitude}:${c.longitude}`).join(',')}
          chantiers={filtered}
          onClickChantier={openEdit}
        />
      )}

      {/* ── Legend (Gantt only) ───────────────────────────────────────────── */}
      {activeTab === 'gantt' && (
        <div className="bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/50 px-3 sm:px-6 py-1.5 sm:py-2 flex gap-2 sm:gap-3 flex-shrink-0 overflow-x-auto">
          {Object.entries(CHANTIER_TYPES).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
              <div className="w-2 sm:w-2.5 h-2 sm:h-2.5 rounded-sm" style={{ backgroundColor: v.color }} />
              <span className="text-[10px] sm:text-xs text-slate-500 whitespace-nowrap">{v.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1 sm:gap-1.5 ml-1 pl-1 sm:ml-2 sm:pl-2 border-l border-slate-100 dark:border-slate-700 flex-shrink-0">
            <div className="w-4 sm:w-6 h-2 sm:h-3 rounded-sm border border-dashed border-green-400 bg-green-50 opacity-80" />
            <span className="text-[10px] sm:text-xs text-slate-400 whitespace-nowrap">Préconisée</span>
          </div>
        </div>
      )}

      {/* ── Theme toggle (fixed bottom-right) ───────────────────────────── */}
      <button
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
        className="fixed bottom-4 right-4 z-50 p-2.5 rounded-full bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800 shadow-lg hover:scale-110 transition-transform">
        {theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}
      </button>

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
