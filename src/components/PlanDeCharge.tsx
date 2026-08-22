import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  startOfMonth, endOfMonth, addMonths, subMonths, addDays, startOfDay, differenceInCalendarDays, format,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, ChevronLeft, ChevronRight, Calendar, CalendarDays, BarChart2,
  TrendingUp, AlertCircle, ZoomIn, ZoomOut, Map, Wand2, Loader2, Moon, Sun, MapPin, MoreVertical,
  List, Users, User, Receipt, Settings2, Home,
} from 'lucide-react';
import { useTheme } from '../lib/theme';
import { useChantiers } from '../hooks/useChantiers';
import GanttChart from './GanttChart';
import ChantierModal from './ChantierModal';
import ImportButton from './ImportButton';
import MapView from './MapView';
import CalendarView from './CalendarView';
import FacturationView from './FacturationView';
import type { Chantier } from '../types';
import { CHANTIER_TYPES, MONTH_FR } from '../lib/constants';
import { reorganize, type ReorganizeMode } from '../lib/reorganize';
import { loadReorgSettings, saveReorgSettings, type ReorgSettings } from '../lib/reorgSettings';
import ReorgSettingsModal from './ReorgSettingsModal';
import { geocode, extractLocationCandidates } from '../lib/geocoder';
import { countWorkingDays, caAnnuel } from '../lib/workingDays';
import {
  ExcavatorIcon, DumperIcon, TractoBenneIcon, BullIcon,
  CheniletteIcon, BateauFaucardeurIcon, DragueIcon, TelescoIcon, RouleauIcon,
} from './EquipmentIcons';

type ZoomPreset = 1 | 2 | 3 | 6 | 'year' | 'fiscal' | 'custom';
type ViewTab = 'gantt' | 'carte' | 'liste' | 'calendrier' | 'facturation';

// Fiscal year: 1 Jul → 30 Jun
function getFiscalYearStart(ref: Date): Date {
  const y = ref.getMonth() >= 6 ? ref.getFullYear() : ref.getFullYear() - 1;
  return new Date(y, 6, 1);
}
function getFiscalYearEnd(ref: Date): Date {
  return new Date(getFiscalYearStart(ref).getFullYear() + 1, 5, 30);
}
function parseDateInput(val: string): Date {
  const [y, m, d] = val.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Sidebar width used by the Gantt — must match GanttChart's SIDE_W
const GANTT_SIDEBAR = typeof window !== 'undefined' && window.innerWidth < 640 ? 120 : 260;


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
  const [zoomPreset, setZoomPreset]     = useState<ZoomPreset>('year');
  const [dayWidth, setDayWidth]         = useState(() => {
    const start = startOfMonth(new Date());
    const end   = new Date(new Date().getFullYear(), 11, 31);
    const numDays = differenceInCalendarDays(end, start) + 1;
    return Math.max(3, (window.innerWidth - GANTT_SIDEBAR) / numDays);
  });
  const [activeTab, setActiveTab]       = useState<ViewTab>('gantt');
  const [reorganizing, setReorganizing]     = useState(false);
  const [reorganizeMode, setReorganizeMode] = useState<ReorganizeMode>('potentiel');
  const [modal, setModal] = useState<{ open: boolean; chantier: Chantier | null; defaultDate?: string }>({
    open: false, chantier: null,
  });
  const [filterStatus, setFilterStatus] = useState<'all' | 'confirme' | 'potentiel' | 'archive'>('confirme');
  const [geocoding, setGeocoding] = useState<{ done: number; total: number } | null>(null);
  const [autoReorgBanner, setAutoReorgBanner] = useState<{ moved: number; warnings: string[] } | null>(null);
  const autoReorgDone = useRef(false);
  const [reorgSettings, setReorgSettings] = useState<ReorgSettings>(loadReorgSettings);
  const [showReorgSettings, setShowReorgSettings] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showEquip, setShowEquip] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showGaps,  setShowGaps]  = useState(false);
  const [showNav,   setShowNav]   = useState(false);
  const [showMenu,   setShowMenu]   = useState(false);
  const [showFiscal, setShowFiscal] = useState(false);
  const [customStart, setCustomStart] = useState(() => startOfMonth(new Date()));
  const [customEnd,   setCustomEnd]   = useState(() => endOfMonth(addMonths(new Date(), 2)));
  const [showMonthlyCA,   setShowMonthlyCA]   = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [monthPickerYear, setMonthPickerYear] = useState(new Date().getFullYear());
  const [monthPickerAnchor, setMonthPickerAnchor] = useState<Date | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const menuRef       = useRef<HTMLDivElement>(null);
  const monthPickRef  = useRef<HTMLDivElement>(null);
  const isPanningRef  = useRef(false);
  const panRef = useRef<{
    startX: number;
    startPeriodStart: Date;
    startPeriodEnd: Date;
    origPreset: ZoomPreset;
    origMonth: Date;
    origDayWidth: number;
    lastDayShift: number;
    moved: boolean;
  } | null>(null);

  // ── Period ─────────────────────────────────────────────────────────────────
  const periodStart =
    zoomPreset === 'fiscal' ? getFiscalYearStart(currentMonth) :
    zoomPreset === 'custom' ? customStart :
    startOfMonth(currentMonth);
  const periodEnd =
    zoomPreset === 'year'   ? new Date(currentMonth.getFullYear(), 11, 31) :
    zoomPreset === 'fiscal' ? getFiscalYearEnd(currentMonth) :
    zoomPreset === 'custom' ? customEnd :
    endOfMonth(addMonths(currentMonth, (zoomPreset as number) - 1));

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

  // ── Stats — scoped to the current view period ─────────────────────────────
  const inPeriod    = (c: Chantier) => new Date(c.dateFin) >= periodStart && new Date(c.dateDebut) <= periodEnd;
  const periodConf  = chantiers.filter(c => c.status === 'confirme'  && inPeriod(c));
  const periodPot   = chantiers.filter(c => c.status === 'potentiel' && inPeriod(c));
  const caConfirme  = periodConf.reduce((s, c) => s + caAnnuel(c.chiffreAffaire ?? 0, c.nombreAnnees), 0);
  const caPotentiel = periodPot.reduce((s, c)  => s + caAnnuel(c.chiffreAffaire ?? 0, c.nombreAnnees), 0);

  const warnCount = filtered.filter(c =>
    c.periodePreconiseeDebut && c.periodePreconiseeFin &&
    (c.dateDebut < c.periodePreconiseeDebut || c.dateFin > c.periodePreconiseeFin)
  ).length;

  // ── Fiscal year estimate (always based on today's fiscal year) ────────────
  const fiscalYStart      = getFiscalYearStart(new Date());
  const fiscalYEnd        = getFiscalYearEnd(new Date());
  const fiscalYLabel      = `${fiscalYStart.getFullYear()}/${fiscalYEnd.getFullYear()}`;
  const inFiscalY         = (c: Chantier) =>
    new Date(c.dateFin) >= fiscalYStart && new Date(c.dateDebut) <= fiscalYEnd;
  const fiscalConfirmeCA  = chantiers.filter(c => c.status === 'confirme'  && inFiscalY(c))
    .reduce((s, c) => s + caAnnuel(c.chiffreAffaire ?? 0, c.nombreAnnees), 0);
  const fiscalPotentielCA = chantiers.filter(c => c.status === 'potentiel' && inFiscalY(c))
    .reduce((s, c) => s + caAnnuel(c.chiffreAffaire ?? 0, c.nombreAnnees), 0);

  // ── Working-day occupancy for the visible period ───────────────────────────
  const periodWd = useMemo(
    () => countWorkingDays(periodStart, periodEnd),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [periodStart.getTime(), periodEnd.getTime()]
  );
  // ── Forecast (CA signé + jours libres × CA moyen/jour ouvré) ────────────
  // Fill rate = jours signés uniquement (les potentiels ne sont pas comptabilisés)
  // Prévisionnel = CA signé + jours encore libres × CA moyen/jour (si on remplit bien le planning)
  const { confirmedWD, potentialWD, caPerWD, fillRate, previsionnel } = useMemo(() => {
    const clampWD = (c: Chantier) => {
      const s = startOfDay(new Date(c.dateDebut) < periodStart ? periodStart : new Date(c.dateDebut));
      const e = startOfDay(new Date(c.dateFin)   > periodEnd   ? periodEnd   : new Date(c.dateFin));
      return Math.max(0, countWorkingDays(s, e));
    };
    const confWD = periodConf.reduce((s, c) => s + clampWD(c), 0);
    const potWD  = periodPot.reduce((s, c)  => s + clampWD(c), 0);
    const perWD  = confWD > 0 ? Math.round(caConfirme / confWD) : 0;
    const total  = countWorkingDays(periodStart, periodEnd);
    // Taux de remplissage : chantiers signés seulement
    const rate   = total > 0 ? Math.round((confWD / total) * 100) : 0;
    // Prévisionnel : CA signé + jours libres (hors signés) × CA moyen/jour
    const freeF  = Math.max(0, total - confWD);
    const prev   = perWD > 0 ? Math.round(caConfirme + freeF * perWD) : null;
    return { confirmedWD: confWD, potentialWD: potWD, caPerWD: perWD, fillRate: rate, previsionnel: prev };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodConf.length, periodPot.length, caConfirme, periodStart.getTime(), periodEnd.getTime()]);

  // ── Monthly CA breakdown (confirmed, prorated by working days) ───────────
  const monthlyCAData = useMemo(() => {
    const months: Array<{ start: Date; label: string; ca: number; cumulCA: number }> = [];
    let m = startOfMonth(periodStart);
    while (m <= periodEnd) {
      const mEnd = endOfMonth(m);
      const mStart = m < periodStart ? periodStart : m;
      const mEndClamped = mEnd > periodEnd ? periodEnd : mEnd;
      let ca = 0;
      for (const c of periodConf) {
        const cs = startOfDay(new Date(c.dateDebut));
        const ce = startOfDay(new Date(c.dateFin));
        const oS = cs < mStart ? startOfDay(mStart) : cs;
        const oE = ce > mEndClamped ? startOfDay(mEndClamped) : ce;
        if (oS > oE) continue;
        const totalWD = countWorkingDays(cs, ce);
        if (totalWD <= 0) continue;
        const monthWD = countWorkingDays(oS, oE);
        ca += Math.round(caAnnuel(c.chiffreAffaire ?? 0, c.nombreAnnees) * monthWD / totalWD);
      }
      months.push({ start: m, label: format(m, 'MMM', { locale: fr }), ca, cumulCA: 0 });
      m = addMonths(m, 1);
    }
    let cumul = 0;
    for (const mo of months) { cumul += mo.ca; mo.cumulCA = cumul; }
    return months;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodConf.length, caConfirme, periodStart.getTime(), periodEnd.getTime()]);

  // ── Booking horizon — jusqu'où a-t-on du boulot confirmé ? ──────────────
  const bookingHorizon = useMemo(() => {
    const today = startOfDay(new Date());
    const conf = chantiers.filter(c => c.status === 'confirme');
    if (!conf.length) return null;
    const lastConf = conf.reduce((mx, c) => (c.dateFin > mx ? c.dateFin : mx), '');
    const lastConfDate = startOfDay(new Date(lastConf + 'T00:00:00'));
    const daysAhead = differenceInCalendarDays(lastConfDate, today);
    if (daysAhead < 0) return null; // tout est passé
    const weeksAhead  = Math.round(daysAhead / 7);
    const monthsAhead = +(daysAhead / 30.44).toFixed(1);
    // Potentiels: jusqu'où si tout se confirme
    const withPot = chantiers.filter(c => c.status === 'confirme' || c.status === 'potentiel');
    const lastPot = withPot.reduce((mx, c) => (c.dateFin > mx ? c.dateFin : mx), '');
    const lastPotDate = startOfDay(new Date(lastPot + 'T00:00:00'));
    const extraPotDays = differenceInCalendarDays(lastPotDate, lastConfDate);
    return { lastConfDate, lastPotDate, daysAhead, weeksAhead, monthsAhead, extraPotDays };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chantiers.map(c => `${c.id}:${c.dateFin}:${c.status}`).join(',')]);

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
    const orig = modal.chantier;
    // Auto-lock whenever a confirmed chantier's dates are manually changed
    const datesChanged = orig && (data.dateDebut !== orig.dateDebut || data.dateFin !== orig.dateFin);
    const autoLock     = datesChanged && data.status === 'confirme' && !data.datesVerrouillees;
    const saved        = autoLock ? { ...data, datesVerrouillees: true } : data;

    if (orig) await updateChantier(orig.id, saved);
    else      await addChantier(saved);

    // After locking, reorganize all non-locked chantiers to resolve any new conflicts
    if (autoLock && orig) {
      const updatedChantiers = chantiers.map(c =>
        c.id === orig.id ? { ...c, ...saved, id: orig.id, createdAt: c.createdAt, updatedAt: c.updatedAt } : c
      );
      const result = reorganize(updatedChantiers, 'all', reorgSettings.typePriorities);
      const otherMoves = result.results.filter(r => r.id !== orig.id);
      if (otherMoves.length > 0) {
        await Promise.all(otherMoves.map(r => updateChantier(r.id, { dateDebut: r.dateDebut, dateFin: r.dateFin })));
        setAutoReorgBanner({ moved: otherMoves.length, warnings: result.warnings });
        setTimeout(() => setAutoReorgBanner(null), 8000);
      }
    }
  };
  const handleDelete  = async () => { if (modal.chantier) await deleteChantier(modal.chantier.id); };
  const handleConfirm = async () => { if (modal.chantier) await confirmChantier(modal.chantier.id); };
  const handleDuplicate = useCallback(async (copies: Omit<Chantier, 'id' | 'createdAt' | 'updatedAt'>[]) => {
    for (const copy of copies) await addChantier(copy);
  }, [addChantier]);

  const handleMove   = useCallback(async (id: string, s: string, e: string) => updateChantier(id, { dateDebut: s, dateFin: e }), [updateChantier]);
  const handleResize = useCallback(async (id: string, e: string) => updateChantier(id, { dateFin: e }), [updateChantier]);

  // ── Zoom / fit ─────────────────────────────────────────────────────────────
  const fitDayWidth = useCallback((
    p: ZoomPreset, baseMonth: Date, cStart?: Date, cEnd?: Date
  ): number => {
    let start: Date, end: Date;
    if (p === 'fiscal') {
      start = getFiscalYearStart(baseMonth);
      end   = getFiscalYearEnd(baseMonth);
    } else if (p === 'custom') {
      start = cStart!;
      end   = cEnd!;
    } else if (p === 'year') {
      start = startOfMonth(baseMonth);
      end   = new Date(baseMonth.getFullYear(), 11, 31);
    } else {
      start = startOfMonth(baseMonth);
      end   = endOfMonth(addMonths(start, (p as number) - 1));
    }
    const numDays = differenceInCalendarDays(end, start) + 1;
    const availableW = (containerRef.current?.clientWidth ?? window.innerWidth) - GANTT_SIDEBAR;
    return Math.max(3, availableW / numDays);
  }, []);

  const applyPreset = (p: ZoomPreset) => {
    setZoomPreset(p);
    setDayWidth(fitDayWidth(p, currentMonth, customStart, customEnd));
  };
  const goToFiscalYear = (startYear: number) => {
    const base = new Date(startYear, 6, 1);
    setZoomPreset('fiscal');
    setCurrentMonth(base);
    setDayWidth(fitDayWidth('fiscal', base));
  };
  const handleDayWidthChange = useCallback((w: number) => setDayWidth(w), []);
  const zoomIn  = () => setDayWidth(w => Math.min(100, w * 1.3));
  const zoomOut = () => setDayWidth(w => Math.max(3,   w / 1.3));

  // ── Fiscal year quick-access (prev / current / next) ─────────────────────
  const curFiscalYear    = getFiscalYearStart(new Date()).getFullYear();
  const activeFiscalYear = zoomPreset === 'fiscal' ? getFiscalYearStart(currentMonth).getFullYear() : -1;
  const fiscalShortcuts  = [
    { year: curFiscalYear - 1, tag: null },
    { year: curFiscalYear,     tag: 'en cours' },
    { year: curFiscalYear + 1, tag: 'prév.' },
  ];
  const shortLabel = (y: number) => `${String(y).slice(-2)}/${String(y + 1).slice(-2)}`;

  // ── Navigation ─────────────────────────────────────────────────────────────
  const step = zoomPreset === 'year' || zoomPreset === 'fiscal' ? 12
             : typeof zoomPreset === 'number' ? zoomPreset : 1;

  const prevPeriod = () => {
    if (zoomPreset === 'custom') {
      const dur = differenceInCalendarDays(customEnd, customStart);
      const ns = addDays(customStart, -(dur + 1));
      const ne = addDays(customEnd,   -(dur + 1));
      setCustomStart(ns); setCustomEnd(ne);
      setDayWidth(fitDayWidth('custom', currentMonth, ns, ne));
    } else {
      const next = subMonths(currentMonth, step);
      setCurrentMonth(next);
      setDayWidth(fitDayWidth(zoomPreset, next));
    }
  };
  const nextPeriod = () => {
    if (zoomPreset === 'custom') {
      const dur = differenceInCalendarDays(customEnd, customStart);
      const ns = addDays(customStart, dur + 1);
      const ne = addDays(customEnd,   dur + 1);
      setCustomStart(ns); setCustomEnd(ne);
      setDayWidth(fitDayWidth('custom', currentMonth, ns, ne));
    } else {
      const next = addMonths(currentMonth, step);
      setCurrentMonth(next);
      setDayWidth(fitDayWidth(zoomPreset, next));
    }
  };
  const goToday = () => {
    const t = new Date();
    setCurrentMonth(t);
    if (zoomPreset !== 'custom') setDayWidth(fitDayWidth(zoomPreset, t));
  };

  // ── Period label ──────────────────────────────────────────────────────────
  const periodLabel =
    zoomPreset === 'year'   ? `Année ${currentMonth.getFullYear()}` :
    zoomPreset === 'fiscal' ? `Exercice ${getFiscalYearStart(currentMonth).getFullYear()}/${getFiscalYearEnd(currentMonth).getFullYear()}` :
    zoomPreset === 'custom' ? `${format(periodStart, 'd MMM yyyy', { locale: fr })} – ${format(periodEnd, 'd MMM yyyy', { locale: fr })}` :
    zoomPreset === 1        ? `${MONTH_FR[periodStart.getMonth()]} ${periodStart.getFullYear()}` :
    `${MONTH_FR[periodStart.getMonth()]} – ${MONTH_FR[periodEnd.getMonth()]} ${periodEnd.getFullYear()}`;

  // ── Smart reorganization ───────────────────────────────────────────────────
  const handleReorganize = async () => {
    const modeLabel = reorganizeMode === 'all'       ? 'tous les chantiers'
                    : reorganizeMode === 'confirme'  ? 'les chantiers confirmés'
                    :                                  'les chantiers potentiels';
    const modeDetail = reorganizeMode === 'potentiel'
      ? '• Confirmés : immobiles (contrat signé)\n• Potentiels verrouillés (🔒) : immobiles\n• Potentiels libres : repositionnés'
      : reorganizeMode === 'confirme'
      ? '• Confirmés verrouillés (🔒) : immobiles\n• Confirmés libres : repositionnés\n• Potentiels : ignorés'
      : '• Verrouillés (🔒) : immobiles\n• Tous les autres : repositionnés';

    if (!confirm(
      `Réorganiser ${modeLabel} ?\n\n${modeDetail}\n• Durées préservées en jours ouvrés\n• Périodes préconisées respectées si possible\n• Engins et effectifs pris en compte`
    )) return;

    setReorganizing(true);
    try {
      const result = reorganize(chantiers, reorganizeMode, reorgSettings.typePriorities);
      if (result.warnings.length && result.results.length === 0) {
        alert(result.warnings[0]);
        return;
      }
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
    if (!confirm(`Géolocaliser ${toGeocode.length} chantier(s) sans coordonnées ?\nCela peut prendre quelques secondes.`)) return;
    setGeocoding({ done: 0, total: toGeocode.length });
    let done = 0;
    let reqCount = 0;
    for (const c of toGeocode) {
      const candidates = extractLocationCandidates(c.nom, c.adresse || c.lieu);
      for (const q of candidates) {
        if (reqCount > 0) await new Promise(r => setTimeout(r, 1100)); // Nominatim: 1 req/s
        reqCount++;
        const res = await geocode(q);
        if (res) {
          await updateChantier(c.id, {
            latitude: res.lat,
            longitude: res.lon,
            adresse: c.adresse || res.displayName.split(',').slice(0, 2).join(',').trim(),
          });
          break;
        }
      }
      done++;
      setGeocoding({ done, total: toGeocode.length });
    }
    setGeocoding(null);
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
      if (monthPickRef.current && !monthPickRef.current.contains(e.target as Node)) {
        setMonthPickerOpen(false);
        setMonthPickerAnchor(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ── Auto-reorg des confirmés au démarrage si certains sont dans le passé ─────
  useEffect(() => {
    if (loading || autoReorgDone.current || !chantiers.length) return;
    autoReorgDone.current = true;

    const todayLocal = format(new Date(), 'yyyy-MM-dd');
    // Stale = confirmed chantier without explicit en_cours/termine etat whose dates are
    // in the past or touching today (should never be the case for a future chantier)
    const hasStale = chantiers.some(c =>
      c.status === 'confirme' &&
      !c.datesVerrouillees &&
      c.etat !== 'en_cours' &&
      c.etat !== 'termine' &&
      c.dateDebut <= todayLocal
    );
    if (!hasStale) return;

    const result = reorganize(chantiers, 'confirme', reorgSettings.typePriorities);
    if (result.moved === 0) return;

    Promise.all(
      result.results.map(r => updateChantier(r.id, { dateDebut: r.dateDebut, dateFin: r.dateFin }))
    ).then(() => {
      setAutoReorgBanner({ moved: result.moved, warnings: result.warnings });
      setTimeout(() => setAutoReorgBanner(null), 8000);
    });
  }, [loading, chantiers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag-to-pan (pointer events, works for mouse + touch) ─────────────────
  const activeTouchesRef = useRef(0);

  const onPanDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (activeTab === 'carte') return;
    // Count active touch points — abort if multi-touch (pinch-to-zoom)
    if (e.pointerType === 'touch') {
      activeTouchesRef.current += 1;
      if (activeTouchesRef.current > 1) { panRef.current = null; return; }
    }
    const target = e.target as HTMLElement;
    // Skip interactive elements and draggable chantier bars
    if (target.closest('button, input, a, select, textarea, [draggable="true"], .gantt-block')) return;
    panRef.current = {
      startX: e.clientX,
      startPeriodStart: periodStart,
      startPeriodEnd: periodEnd,
      origPreset: zoomPreset,
      origMonth: currentMonth,
      origDayWidth: dayWidth,
      lastDayShift: 0,
      moved: false,
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, [activeTab, periodStart, periodEnd, zoomPreset, currentMonth, dayWidth]);

  const onPanMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    // Abort pan if a second finger joined (pinch gesture)
    if (e.pointerType === 'touch' && activeTouchesRef.current > 1) {
      panRef.current = null;
      isPanningRef.current = false;
      setIsPanning(false);
      return;
    }
    const dx = panRef.current.startX - e.clientX; // positive → dragging left → future
    if (!panRef.current.moved && Math.abs(dx) < 8) return; // dead zone
    panRef.current.moved = true;
    if (!isPanningRef.current) { isPanningRef.current = true; setIsPanning(true); }

    const dayShift = Math.round(dx / panRef.current.origDayWidth);
    if (dayShift === panRef.current.lastDayShift) return;
    panRef.current.lastDayShift = dayShift;

    const newStart = addDays(panRef.current.startPeriodStart, dayShift);
    const newEnd   = addDays(panRef.current.startPeriodEnd,   dayShift);
    setCustomStart(newStart);
    setCustomEnd(newEnd);
    // Switch to custom so the period slides freely (dayWidth preserved)
    if (panRef.current.origPreset !== 'custom') setZoomPreset('custom');
  }, []);

  const onPanUp = useCallback((e?: React.PointerEvent<HTMLDivElement>) => {
    if (e?.pointerType === 'touch') activeTouchesRef.current = Math.max(0, activeTouchesRef.current - 1);
    if (!panRef.current) return;
    const { origPreset, origDayWidth, startPeriodStart, lastDayShift, moved } = panRef.current;
    panRef.current = null;
    isPanningRef.current = false;
    setIsPanning(false);
    if (!moved) return;

    if (origPreset !== 'custom') {
      // Restore original preset anchored at new position; snap to month start
      const newStart = addDays(startPeriodStart, lastDayShift);
      setCurrentMonth(origPreset === 'fiscal' ? newStart : startOfMonth(newStart));
      setZoomPreset(origPreset);
      setDayWidth(origDayWidth);
    }
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
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-slate-50 dark:bg-slate-900"
      onPointerDown={onPanDown}
      onPointerMove={onPanMove}
      onPointerUp={e => onPanUp(e)}
      onPointerCancel={e => onPanUp(e)}
      style={{ cursor: isPanning ? 'grabbing' : undefined, touchAction: 'pan-y pinch-zoom' }}
    >

      {/* ── Bannière auto-réorg ── */}
      {autoReorgBanner && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-violet-50 border-b border-violet-200 text-violet-800 text-xs">
          <Wand2 size={13} className="flex-shrink-0" />
          <span>
            <span className="font-semibold">{autoReorgBanner.moved} chantier{autoReorgBanner.moved > 1 ? 's' : ''} confirmé{autoReorgBanner.moved > 1 ? 's' : ''}</span> repositionné{autoReorgBanner.moved > 1 ? 's' : ''} automatiquement (dates passées détectées).
            {autoReorgBanner.warnings.length > 0 && (
              <span className="ml-1 text-amber-700"> ⚠ {autoReorgBanner.warnings.join(' — ')}</span>
            )}
          </span>
          <button onClick={() => setAutoReorgBanner(null)} className="ml-auto flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity">✕</button>
        </div>
      )}

      {/* ── Top bar ── */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">

        {/* Row 1 — Title + CA (desktop) + actions */}
        <div className="flex items-center justify-between px-3 sm:px-6 py-2 sm:py-3 border-b border-slate-100 dark:border-slate-700/50">
          {/* Logo + title */}
          <div className="flex items-center gap-2 sm:gap-3">
            <a href="#"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
              title="Accueil">
              <Home size={15} />
            </a>
            <div className="w-7 h-7 sm:w-8 sm:h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <BarChart2 size={14} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100">Plan de charge</h1>
              <p className="text-[10px] text-slate-400 hidden sm:block">ETS Vandaele</p>
            </div>
          </div>

          {/* CA summary — desktop only, scoped to current period */}
          <div className="hidden sm:flex items-center gap-4">
            {/* Period label as context */}
            <div className="text-right">
              <p className="text-[9px] text-slate-300 uppercase tracking-wide mb-0.5">{periodLabel}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">CA signé</p>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{caConfirme.toLocaleString('fr-FR')} €</p>
            </div>
            <div className="w-px h-8 bg-slate-100 dark:bg-slate-700" />
            <div className="text-right">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Potentiel</p>
              <p className="text-sm font-semibold text-slate-400">{caPotentiel.toLocaleString('fr-FR')} €</p>
            </div>
            {previsionnel !== null && (
              <>
                <div className="w-px h-8 bg-slate-100 dark:bg-slate-700" />
                <div className="text-right">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide flex items-center gap-1 justify-end">
                    <TrendingUp size={10} className="text-emerald-500"/> Prévisionnel
                  </p>
                  <p className="text-sm font-bold text-emerald-600">{previsionnel.toLocaleString('fr-FR')} €</p>
                  <p className="text-[10px] text-slate-400">{caPerWD.toLocaleString('fr-FR')} €/j · {fillRate}% signé</p>
                </div>
              </>
            )}
            <div className="w-px h-8 bg-slate-100 dark:bg-slate-700" />
            <div className="text-right">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Remplissage</p>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                {fillRate}%
                <span className="text-xs font-normal text-slate-400"> signé</span>
              </p>
              <p className="text-[10px]">
                <span className="text-blue-600">{confirmedWD}j</span>
                <span className="text-slate-400"> / {periodWd} j ouvrés</span>
                {potentialWD > 0 && <span className="text-amber-500"> + {potentialWD}j pot.</span>}
              </p>
            </div>
            {bookingHorizon && (
              <>
                <div className="w-px h-8 bg-slate-100 dark:bg-slate-700" />
                <div className="text-right">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">Boulot jusqu'au</p>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    {format(bookingHorizon.lastConfDate, 'd MMM yyyy', { locale: fr })}
                  </p>
                  <p className="text-[10px]">
                    <span className={bookingHorizon.monthsAhead >= 3 ? 'text-emerald-600' : bookingHorizon.monthsAhead >= 1.5 ? 'text-amber-500' : 'text-red-500'}>
                      {bookingHorizon.monthsAhead >= 2
                        ? `~${Math.round(bookingHorizon.monthsAhead)} mois d'avance`
                        : bookingHorizon.weeksAhead > 0
                        ? `~${bookingHorizon.weeksAhead} sem. d'avance`
                        : 'cette semaine'}
                    </span>
                    {bookingHorizon.extraPotDays > 7 && (
                      <span className="text-amber-400 ml-1" title="Extension avec potentiels">
                        +{Math.round(bookingHorizon.extraPotDays / 7)}sem. pot.
                      </span>
                    )}
                  </p>
                </div>
              </>
            )}
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

          {/* Fiscal + monthly CA toggles — desktop */}
          <div className="hidden sm:flex items-center gap-1.5">
            <button
              onClick={() => setShowFiscal(f => !f)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                showFiscal
                  ? 'bg-indigo-600 text-white'
                  : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400'
              }`}>
              <TrendingUp size={12}/>
              Exercice {shortLabel(curFiscalYear)}
            </button>
            <button
              onClick={() => setShowMonthlyCA(s => !s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                showMonthlyCA
                  ? 'bg-blue-600 text-white'
                  : 'bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400'
              }`}>
              <BarChart2 size={12}/>
              CA/mois
            </button>
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
            <div className="flex items-center rounded-lg overflow-hidden border border-violet-600">
              <select
                value={reorganizeMode}
                onChange={e => setReorganizeMode(e.target.value as ReorganizeMode)}
                className="text-xs font-medium bg-violet-50 text-violet-700 px-2 py-1.5 border-none outline-none cursor-pointer">
                <option value="potentiel">Potentiels</option>
                <option value="confirme">Confirmés</option>
                <option value="all">Tous</option>
              </select>
              <div className="flex items-center">
                <button
                  onClick={handleReorganize}
                  disabled={reorganizing || filterStatus === 'archive'}
                  title="Réorganiser les chantiers sélectionnés"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors disabled:opacity-40 rounded-l-lg">
                  {reorganizing ? <Loader2 size={14} className="animate-spin"/> : <Wand2 size={14}/>}
                  Réorganiser
                </button>
                <button
                  onClick={() => setShowReorgSettings(true)}
                  title="Paramètres de réorganisation"
                  className={`flex items-center px-2 py-1.5 border-l border-violet-500 text-white text-sm font-medium hover:bg-violet-700 transition-colors rounded-r-lg ${reorgSettings.typePriorities.length > 0 ? 'bg-violet-700' : 'bg-violet-600'}`}>
                  <Settings2 size={14}/>
                  {reorgSettings.typePriorities.length > 0 && (
                    <span className="ml-1 text-[10px] bg-white text-violet-700 rounded-full w-4 h-4 flex items-center justify-center font-bold">
                      {reorgSettings.typePriorities.length}
                    </span>
                  )}
                </button>
              </div>
            </div>
            <button onClick={() => openNew()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
              <Plus size={15} /> Nouveau chantier
            </button>
          </div>

          {/* Mobile: tab switcher + section toggles + actions */}
          <div className="flex sm:hidden items-center gap-1">
            {/* Tab switcher — always accessible */}
            <div className="flex items-center border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden mr-0.5">
              {([
                { key: 'gantt',        icon: <BarChart2 size={12}/> },
                { key: 'carte',        icon: <Map size={12}/> },
                { key: 'calendrier',   icon: <CalendarDays size={12}/> },
                { key: 'liste',        icon: <List size={12}/> },
                { key: 'facturation',  icon: <Receipt size={12}/> },
              ] as const).map(({ key, icon }) => (
                <button key={key} onClick={() => setActiveTab(key)}
                  className={`px-2 py-1.5 transition-colors ${
                    activeTab === key ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-50'
                  }`}>
                  {icon}
                </button>
              ))}
            </div>
            {/* Section toggle chips */}
            {([
              { key: 'CA',  active: showStats,     toggle: () => setShowStats(s => !s) },
              { key: 'Eng', active: showEquip,     toggle: () => setShowEquip(e => !e) },
              { key: 'Fis', active: showFiscal,    toggle: () => setShowFiscal(f => !f) },
              { key: 'Mois',active: showMonthlyCA, toggle: () => setShowMonthlyCA(s => !s) },
              { key: 'Dsp', active: showGaps,      toggle: () => setShowGaps(g => !g) },
              { key: 'Nav', active: showNav,       toggle: () => setShowNav(n => !n) },
            ] as const).map(({ key, active, toggle }) => (
              <button key={key} onClick={toggle}
                className={`px-1.5 py-1 rounded-md text-[10px] font-bold transition-colors ${
                  active ? 'bg-slate-800 dark:bg-slate-600 text-white' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}>
                {key}
              </button>
            ))}
            <button onClick={() => openNew()}
              className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0">
              <Plus size={15}/>
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
                  {/* Zoom presets */}
                  <div className="px-3 py-1.5">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Vue</p>
                    <div className="flex flex-wrap gap-1">
                      {([1, 2, 3, 6, 'year'] as ZoomPreset[]).map(p => (
                        <button key={String(p)} onClick={() => { applyPreset(p); setShowMenu(false); }}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                            zoomPreset === p ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'
                          }`}>
                          {p === 1 ? '1 mois' : p === 2 ? '2 mois' : p === 3 ? '3 mois' : p === 6 ? '6 mois' : 'Année'}
                        </button>
                      ))}
                      {fiscalShortcuts.map(({ year, tag }) => (
                        <button key={year} onClick={() => { goToFiscalYear(year); setShowMenu(false); }}
                          className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                            activeFiscalYear === year ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700'
                          }`}>
                          {shortLabel(year)}
                          {tag && <span className="text-[9px] opacity-80">{tag === 'en cours' ? '●' : '~'}</span>}
                        </button>
                      ))}
                      <button onClick={() => { applyPreset('custom'); setShowMenu(false); }}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                          zoomPreset === 'custom' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'
                        }`}>
                        Dates
                      </button>
                      <button onClick={() => { goToday(); setShowMenu(false); }}
                        className="px-2.5 py-1 text-xs font-medium rounded-md bg-blue-50 text-blue-600 flex items-center gap-1">
                        <Calendar size={11}/> Auj.
                      </button>
                    </div>
                    {/* Custom date inputs for mobile */}
                    {zoomPreset === 'custom' && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 w-8">Début</span>
                          <input
                            type="date"
                            value={format(customStart, 'yyyy-MM-dd')}
                            onChange={e => {
                              if (!e.target.value) return;
                              const d = parseDateInput(e.target.value);
                              setCustomStart(d);
                              setDayWidth(fitDayWidth('custom', currentMonth, d, customEnd));
                            }}
                            className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 text-slate-600" />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 w-8">Fin</span>
                          <input
                            type="date"
                            value={format(customEnd, 'yyyy-MM-dd')}
                            onChange={e => {
                              if (!e.target.value) return;
                              const d = parseDateInput(e.target.value);
                              setCustomEnd(d);
                              setDayWidth(fitDayWidth('custom', currentMonth, customStart, d));
                            }}
                            className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 text-slate-600" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />
                  <button
                    onClick={() => { handleGeocodeBatch(); setShowMenu(false); }}
                    disabled={!!geocoding}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors">
                    {geocoding ? <Loader2 size={14} className="animate-spin"/> : <MapPin size={14} className="text-emerald-600"/>}
                    {geocoding ? `${geocoding.done}/${geocoding.total}…` : 'Géolocaliser'}
                  </button>
                  <div className="px-3 py-1.5">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Réorganiser</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {([
                        { key: 'potentiel', label: 'Potentiels' },
                        { key: 'confirme',  label: 'Confirmés' },
                        { key: 'all',       label: 'Tous' },
                      ] as const).map(({ key, label }) => (
                        <button key={key} onClick={() => setReorganizeMode(key)}
                          className={`px-2 py-1 text-xs rounded-md font-medium transition-colors ${
                            reorganizeMode === key ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                          }`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => { handleReorganize(); setShowMenu(false); }}
                      disabled={reorganizing || filterStatus === 'archive'}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-40">
                      {reorganizing ? <Loader2 size={14} className="animate-spin"/> : <Wand2 size={14}/>}
                      Réorganiser
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile CA stats row — toggled by the CA button */}
        <div className={`sm:hidden divide-x divide-slate-100 dark:divide-slate-700 border-b border-slate-100 dark:border-slate-700/50 ${showStats ? 'flex' : 'hidden'}`}>
          <div className="flex-1 px-2 py-1.5 text-center">
            <p className="text-[9px] text-slate-400 uppercase tracking-wide">Signé</p>
            <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{caConfirme.toLocaleString('fr-FR')} €</p>
          </div>
          <div className="flex-1 px-2 py-1.5 text-center">
            <p className="text-[9px] text-slate-400 uppercase tracking-wide">Potentiel</p>
            <p className="text-xs font-semibold text-amber-600">{caPotentiel.toLocaleString('fr-FR')} €</p>
          </div>
          {previsionnel !== null && (
            <div className="flex-1 px-2 py-1.5 text-center">
              <p className="text-[9px] text-slate-400 uppercase tracking-wide flex items-center justify-center gap-0.5"><TrendingUp size={8} className="text-green-500"/> Prév.</p>
              <p className="text-xs font-bold text-green-700">{previsionnel.toLocaleString('fr-FR')} €</p>
              {caPerWD > 0 && <p className="text-[9px] text-slate-400">{caPerWD.toLocaleString('fr-FR')} €/j</p>}
            </div>
          )}
          <div className="px-2 py-1.5 text-center">
            <p className="text-[9px] text-slate-400 uppercase tracking-wide">Rempl.</p>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{fillRate}%</p>
            <p className="text-[9px] text-slate-400">{confirmedWD}/{periodWd}j</p>
          </div>
          {bookingHorizon && (
            <div className="px-2 py-1.5 text-center">
              <p className="text-[9px] text-slate-400 uppercase tracking-wide">Planifié</p>
              <p className={`text-xs font-bold ${bookingHorizon.monthsAhead >= 3 ? 'text-emerald-600' : bookingHorizon.monthsAhead >= 1.5 ? 'text-amber-500' : 'text-red-500'}`}>
                {bookingHorizon.monthsAhead >= 2
                  ? `~${Math.round(bookingHorizon.monthsAhead)}m`
                  : `~${bookingHorizon.weeksAhead}sem`}
              </p>
              <p className="text-[9px] text-slate-400">{format(bookingHorizon.lastConfDate, 'd MMM', { locale: fr })}</p>
            </div>
          )}
          {warnCount > 0 && (
            <div className="px-2 py-1.5 text-center">
              <p className="text-[9px] text-orange-400 uppercase tracking-wide">Hors pér.</p>
              <p className="text-xs font-bold text-orange-500">{warnCount} ⚠</p>
            </div>
          )}
        </div>

        {/* Equipment utilization — shown only when chip is active */}
        {showEquip && equipLines.length > 0 && (
          <div className="border-b border-slate-100 dark:border-slate-700/50 flex items-start gap-3 px-3 sm:px-6 py-2 overflow-x-auto">
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

        {/* Fiscal year estimate — toggled by Fis chip (mobile) or always visible (desktop) */}
        {showFiscal && (
          <div className="border-b border-slate-100 dark:border-slate-700/50 px-3 sm:px-6 py-2 flex flex-wrap items-center gap-3 bg-indigo-50/50 dark:bg-indigo-900/10">
            <div className="flex flex-col flex-shrink-0">
              <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
                Exercice {fiscalYLabel}
              </span>
              <span className="text-[9px] text-slate-400">
                {format(fiscalYStart, 'd MMM yyyy', { locale: fr })} → {format(fiscalYEnd, 'd MMM yyyy', { locale: fr })}
              </span>
            </div>
            <div className="w-px h-7 bg-indigo-100 dark:bg-indigo-800 flex-shrink-0" />
            <div className="flex items-center gap-4 overflow-x-auto">
              <div className="flex-shrink-0 text-center">
                <p className="text-[9px] text-slate-400 uppercase tracking-wide">CA signé</p>
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{fiscalConfirmeCA.toLocaleString('fr-FR')} €</p>
              </div>
              <div className="flex-shrink-0 text-center">
                <p className="text-[9px] text-slate-400 uppercase tracking-wide">Potentiel</p>
                <p className="text-xs font-semibold text-slate-400">{fiscalPotentielCA.toLocaleString('fr-FR')} €</p>
              </div>
              <div className="flex-shrink-0 text-center">
                <p className="text-[9px] text-slate-400 uppercase tracking-wide flex items-center gap-0.5 justify-center">
                  <TrendingUp size={8} className="text-indigo-500"/> Total exercice
                </p>
                <p className="text-xs font-bold text-indigo-600">{(fiscalConfirmeCA + fiscalPotentielCA).toLocaleString('fr-FR')} €</p>
              </div>
              <div className="flex-shrink-0 text-center">
                <p className="text-[9px] text-slate-400 uppercase tracking-wide">Tx. conversion</p>
                <p className="text-xs font-bold text-emerald-600">
                  {fiscalConfirmeCA + fiscalPotentielCA > 0
                    ? Math.round((fiscalConfirmeCA / (fiscalConfirmeCA + fiscalPotentielCA)) * 100)
                    : 0}%
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Monthly CA breakdown — toggled by CA/mois */}
        {showMonthlyCA && monthlyCAData.length > 0 && (() => {
          const maxCA = Math.max(...monthlyCAData.map(m => m.ca), 1);
          const fmt = (v: number) => v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v/1000)}k` : `${v}`;
          return (
            <div className="border-b border-slate-100 dark:border-slate-700/50 px-3 sm:px-6 py-2 bg-blue-50/40 dark:bg-blue-900/5">
              <div className="flex items-stretch gap-px overflow-x-auto">
                {monthlyCAData.map((mo, i) => {
                  const pct = maxCA > 0 ? (mo.ca / maxCA) * 100 : 0;
                  const isToday = new Date() >= mo.start && new Date() <= endOfMonth(mo.start);
                  return (
                    <div key={i} className={`flex-shrink-0 flex flex-col items-center w-[52px] sm:w-[60px] px-0.5 rounded-md ${isToday ? 'bg-blue-100/60 dark:bg-blue-800/20' : ''}`}>
                      <span className={`text-[9px] uppercase tracking-wide mb-1 ${isToday ? 'text-blue-600 font-bold' : 'text-slate-400'}`}>{mo.label}</span>
                      <div className="w-full h-10 bg-slate-100 dark:bg-slate-700 rounded relative overflow-hidden flex-shrink-0">
                        <div
                          className={`absolute bottom-0 left-0 right-0 rounded transition-all ${isToday ? 'bg-blue-500' : 'bg-blue-400/70 dark:bg-blue-500/60'}`}
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                      {mo.ca > 0
                        ? <span className="text-[8px] font-semibold text-blue-700 dark:text-blue-300 mt-0.5 tabular-nums">{fmt(mo.ca)}</span>
                        : <span className="text-[8px] text-slate-300 mt-0.5">—</span>
                      }
                      <span className="text-[8px] text-slate-400 tabular-nums">∑{fmt(mo.cumulCA)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Navigation + zoom + tabs — always desktop, toggled on mobile */}
        <div className={`items-center gap-1.5 sm:gap-3 px-3 sm:px-6 py-2 ${showNav ? 'flex' : 'hidden sm:flex'}`}>
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
          <div className="hidden sm:flex items-center gap-1 flex-wrap">
            <span className="text-xs text-slate-400 mr-1">Vue :</span>
            {([1, 2, 3, 6, 'year'] as ZoomPreset[]).map(p => (
              <button key={String(p)} onClick={() => applyPreset(p)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  zoomPreset === p
                    ? 'bg-slate-800 dark:bg-slate-600 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}>
                {p === 1 ? '1 mois' : p === 2 ? '2 mois' : p === 3 ? '3 mois' : p === 6 ? '6 mois' : 'Année'}
              </button>
            ))}
            {/* Fiscal year shortcuts */}
            <div className="flex items-center gap-0.5 border-l border-slate-200 dark:border-slate-600 pl-1.5 ml-0.5">
              {fiscalShortcuts.map(({ year, tag }) => (
                <button key={year} onClick={() => goToFiscalYear(year)}
                  className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                    activeFiscalYear === year
                      ? 'bg-indigo-600 text-white'
                      : 'text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                  }`}>
                  {shortLabel(year)}
                  {tag && (
                    <span className={`text-[9px] px-1 py-px rounded-full ${
                      activeFiscalYear === year
                        ? 'bg-white/20 text-white'
                        : tag === 'en cours' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {tag}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {/* Month range picker + custom date range */}
            <div className="relative border-l border-slate-200 dark:border-slate-600 ml-0.5 pl-2.5 flex items-center gap-1" ref={monthPickRef}>
              <button
                onClick={() => { setMonthPickerOpen(o => !o); setMonthPickerAnchor(null); setMonthPickerYear(periodStart.getFullYear()); }}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  monthPickerOpen ? 'bg-teal-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}>
                Mois…
              </button>
              {monthPickerOpen && (
                <div className="absolute top-full mt-1 left-0 z-50 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-3 w-60">
                  <div className="flex items-center justify-between mb-2">
                    <button onClick={() => setMonthPickerYear(y => y - 1)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300 transition-colors">
                      <ChevronLeft size={13}/>
                    </button>
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{monthPickerYear}</span>
                    <button onClick={() => setMonthPickerYear(y => y + 1)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300 transition-colors">
                      <ChevronRight size={13}/>
                    </button>
                  </div>
                  <p className="text-[10px] text-center text-slate-400 mb-2">
                    {monthPickerAnchor
                      ? `Début : ${format(monthPickerAnchor, 'MMM yyyy', { locale: fr })} — cliquez la fin`
                      : 'Cliquez le mois de début'}
                  </p>
                  <div className="grid grid-cols-4 gap-1">
                    {['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'].map((lbl, mi) => {
                      const clicked = new Date(monthPickerYear, mi, 1);
                      const isAnchor = monthPickerAnchor && monthPickerAnchor.getFullYear() === monthPickerYear && monthPickerAnchor.getMonth() === mi;
                      return (
                        <button key={mi}
                          onClick={() => {
                            if (!monthPickerAnchor) {
                              setMonthPickerAnchor(clicked);
                            } else {
                              const s = clicked < monthPickerAnchor ? clicked : monthPickerAnchor;
                              const e = clicked < monthPickerAnchor ? monthPickerAnchor : clicked;
                              const ns = startOfMonth(s);
                              const ne = endOfMonth(e);
                              setCustomStart(ns); setCustomEnd(ne);
                              setZoomPreset('custom');
                              setDayWidth(fitDayWidth('custom', currentMonth, ns, ne));
                              setMonthPickerOpen(false); setMonthPickerAnchor(null);
                            }
                          }}
                          className={`py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            isAnchor
                              ? 'bg-teal-600 text-white'
                              : 'text-slate-600 dark:text-slate-300 hover:bg-teal-50 dark:hover:bg-teal-900/20 hover:text-teal-700'
                          }`}>
                          {lbl}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 flex justify-end">
                    <button onClick={() => { setMonthPickerOpen(false); setMonthPickerAnchor(null); }} className="text-xs text-slate-400 px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors">
                      Annuler
                    </button>
                  </div>
                </div>
              )}
              <button onClick={() => applyPreset('custom')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  zoomPreset === 'custom'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}>
                Dates
              </button>
            </div>
            {/* Custom date pickers — shown inline when custom is active */}
            {zoomPreset === 'custom' && (
              <div className="flex items-center gap-1 ml-1 px-2 py-0.5 border border-sky-200 dark:border-sky-700 rounded-lg bg-sky-50 dark:bg-sky-900/20">
                <input
                  type="date"
                  value={format(customStart, 'yyyy-MM-dd')}
                  onChange={e => {
                    if (!e.target.value) return;
                    const d = parseDateInput(e.target.value);
                    setCustomStart(d);
                    setDayWidth(fitDayWidth('custom', currentMonth, d, customEnd));
                  }}
                  className="text-xs text-slate-600 dark:text-slate-300 bg-transparent border-none outline-none cursor-pointer w-28" />
                <span className="text-slate-300 text-xs">–</span>
                <input
                  type="date"
                  value={format(customEnd, 'yyyy-MM-dd')}
                  onChange={e => {
                    if (!e.target.value) return;
                    const d = parseDateInput(e.target.value);
                    setCustomEnd(d);
                    setDayWidth(fitDayWidth('custom', currentMonth, customStart, d));
                  }}
                  className="text-xs text-slate-600 dark:text-slate-300 bg-transparent border-none outline-none cursor-pointer w-28" />
              </div>
            )}
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

          {/* View tabs — desktop only (mobile uses Row 1 tabs) */}
          <div className="hidden sm:flex items-center border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden ml-auto sm:ml-0">
            {([
              { key: 'gantt',        icon: <BarChart2 size={13}/>,    label: 'Gantt' },
              { key: 'carte',        icon: <Map size={13}/>,           label: 'Carte' },
              { key: 'calendrier',   icon: <CalendarDays size={13}/>,  label: 'Calendrier' },
              { key: 'facturation',  icon: <Receipt size={13}/>,       label: 'Facturation' },
            ] as const).map(({ key, icon, label }) => (
              <button key={key} onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === key ? 'bg-slate-800 dark:bg-slate-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}>
                {icon} {label}
              </button>
            ))}
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
          showGaps={showGaps}
        />
      ) : activeTab === 'carte' ? (
        <MapView
          key={filtered.map(c => `${c.id}:${c.latitude}:${c.longitude}`).join(',')}
          chantiers={filtered}
          onClickChantier={openEdit}
        />
      ) : activeTab === 'calendrier' ? (
        <CalendarView
          chantiers={filtered}
          periodStart={periodStart}
          periodEnd={periodEnd}
          zoomPreset={zoomPreset}
          onPrevPeriod={prevPeriod}
          onNextPeriod={nextPeriod}
          onDrillDown={(month) => { setCurrentMonth(startOfMonth(month)); applyPreset(1); }}
          onClickChantier={openEdit}
          onMoveChantier={handleMove}
        />
      ) : activeTab === 'facturation' ? (
        /* ── Facturation ─────────────────────────────────────────────── */
        <FacturationView chantiers={chantiers} onClickChantier={openEdit} onUpdateChantier={updateChantier} />
      ) : (
        /* ── Liste mobile ──────────────────────────────────────────────── */
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 bg-slate-50 dark:bg-slate-900">
          {filtered.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-12">Aucun chantier sur cette période</p>
          )}
          {[...filtered]
            .sort((a, b) => a.dateDebut.localeCompare(b.dateDebut))
            .map(c => {
              const meta = CHANTIER_TYPES[c.type];
              const isPotentiel = c.status === 'potentiel';
              const isArchived  = c.status === 'refuse' || c.status === 'annule';
              const nb = c.nombrePersonnes ?? 1;
              const statusLabel = c.status === 'refuse' ? 'Refusé' : c.status === 'annule' ? 'Annulé'
                : isPotentiel ? 'Potentiel' : 'Confirmé';
              const statusCls = isArchived ? 'bg-slate-100 text-slate-400'
                : isPotentiel ? 'bg-slate-100 text-slate-500' : 'bg-green-50 text-green-700';
              return (
                <div key={c.id}
                  onClick={() => openEdit(c)}
                  className="bg-white dark:bg-slate-800 rounded-xl shadow-sm overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
                  style={{ borderLeft: `4px solid ${isArchived ? '#cbd5e1' : meta.color}` }}>
                  <div className="px-3 py-3">
                    {/* Top row: name + status */}
                    <div className="flex items-start justify-between gap-2">
                      <p className={`font-semibold text-slate-800 dark:text-slate-100 text-sm leading-tight ${isArchived ? 'line-through text-slate-400' : ''}`}>
                        {c.nom}
                      </p>
                      <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusCls}`}>
                        {statusLabel}
                      </span>
                    </div>
                    {/* Client */}
                    {c.client && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{c.client}</p>
                    )}
                    {/* Dates */}
                    <div className="flex items-center gap-1 mt-1.5 text-xs text-slate-500">
                      <Calendar size={11} className="flex-shrink-0"/>
                      <span>
                        {format(new Date(c.dateDebut), 'd MMM', { locale: fr })}
                        {' → '}
                        {format(new Date(c.dateFin), 'd MMM yyyy', { locale: fr })}
                      </span>
                    </div>
                    {/* Footer row: type label + personnel + lieu */}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white flex-shrink-0"
                        style={{ backgroundColor: meta.color }}>{meta.label}</span>
                      <span className="flex items-center gap-0.5 text-xs text-slate-400">
                        {nb >= 2 ? <Users size={10}/> : <User size={10}/>}
                        <span>{nb}</span>
                      </span>
                      {c.lieu && (
                        <span className="flex items-center gap-0.5 text-xs text-slate-400 truncate">
                          <MapPin size={10}/>{c.lieu}
                        </span>
                      )}
                      {c.chiffreAffaire > 0 && (
                        <span className="ml-auto text-xs font-semibold text-slate-600 dark:text-slate-300 flex-shrink-0">
                          {c.chiffreAffaire.toLocaleString('fr-FR')} €
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          }
          {/* Bottom padding so last card isn't under FAB */}
          <div className="h-20"/>
        </div>
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

      {/* FAB "nouveau chantier" — visible only on mobile liste tab */}
      {activeTab === 'liste' && (
        <button
          onClick={() => openNew(format(new Date(), 'yyyy-MM-dd'))}
          className="fixed bottom-16 right-4 z-50 sm:hidden w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform">
          <Plus size={24}/>
        </button>
      )}

      <ChantierModal
        isOpen={modal.open}
        onClose={closeModal}
        chantier={modal.chantier}
        defaultDateDebut={modal.defaultDate}
        onSave={handleSave}
        onDelete={modal.chantier ? handleDelete : undefined}
        onConfirm={modal.chantier?.status === 'potentiel' ? handleConfirm : undefined}
        onDuplicate={modal.chantier ? handleDuplicate : undefined}
      />

      {showReorgSettings && (
        <ReorgSettingsModal
          settings={reorgSettings}
          onSave={s => { setReorgSettings(s); saveReorgSettings(s); }}
          onClose={() => setShowReorgSettings(false)}
        />
      )}
    </div>
  );
}
