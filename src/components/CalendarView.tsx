import { useMemo, useState, useCallback } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isToday, format, addMonths,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import type { Chantier } from '../types';
import { CHANTIER_TYPES } from '../lib/constants';
import { isWorkingDay } from '../lib/workingDays';
import ChantierTooltip from './ChantierTooltip';
import MobilePeekCard from './MobilePeekCard';

type ZoomPreset = 1 | 2 | 3 | 6 | 'year';
type CellMode   = 'full' | 'compact' | 'mini';

const DOW_LONG  = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DOW_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

interface Props {
  chantiers: Chantier[];
  periodStart: Date;
  periodEnd: Date;
  zoomPreset: ZoomPreset;
  onPrevPeriod: () => void;
  onNextPeriod: () => void;
  onDrillDown: (month: Date) => void;
  onClickChantier: (c: Chantier) => void;
}

// ── Day cell ──────────────────────────────────────────────────────────────────

function DayCell({
  day, inMonth, items, mode, onChantierClick, onHover, onUnhover,
}: {
  day: Date;
  inMonth: boolean;
  items: Chantier[];
  mode: CellMode;
  onChantierClick: (c: Chantier) => void;
  onHover: (c: Chantier, x: number, y: number) => void;
  onUnhover: () => void;
}) {
  const key     = format(day, 'yyyy-MM-dd');
  const today   = isToday(day);
  const workDay = isWorkingDay(day);
  const sorted  = [...items].sort((a, b) =>
    (a.status === 'confirme' ? 0 : 1) - (b.status === 'confirme' ? 0 : 1)
  );

  const MAX_ITEMS = mode === 'full' ? 3 : mode === 'compact' ? 3 : 2;
  const visible   = sorted.slice(0, MAX_ITEMS);
  const overflow  = sorted.length - MAX_ITEMS;

  // Bar height for compact / mini
  const BAR_H = mode === 'compact' ? 11 : 8;

  return (
    <div
      className={`flex flex-col border-r border-b border-slate-100 dark:border-slate-700/40 last:border-r-0 ${
        !inMonth ? 'opacity-20 pointer-events-none' : ''
      } ${!workDay ? 'bg-slate-50/70 dark:bg-slate-800/30' : 'bg-white dark:bg-slate-800'}`}
      style={{ minHeight: mode === 'full' ? 90 : mode === 'compact' ? 56 : 36 }}>

      {/* Day number */}
      <div className={`flex-shrink-0 flex items-center justify-center ${
        mode === 'full' ? 'w-6 h-6 m-1' : mode === 'compact' ? 'w-5 h-5 m-0.5' : 'w-4 h-4 m-0.5'
      } rounded-full text-center ${
        today ? 'bg-blue-500 text-white' : !workDay ? 'text-slate-300' : 'text-slate-500'
      } ${mode === 'full' ? 'text-xs font-semibold' : mode === 'compact' ? 'text-[10px] font-semibold' : 'text-[9px] font-medium'}`}>
        {inMonth ? format(day, 'd') : ''}
      </div>

      {/* Content */}
      <div className="flex-1 px-0.5 pb-0.5 overflow-hidden space-y-px">
        {mode === 'full' ? (
          <>
            {visible.map(c => {
              const meta        = CHANTIER_TYPES[c.type];
              const isPotentiel = c.status === 'potentiel';
              const isStart     = c.dateDebut === key;
              return (
                <button
                  key={c.id}
                  onClick={() => onChantierClick(c)}
                  onMouseEnter={e => onHover(c, e.clientX, e.clientY)}
                  onMouseLeave={onUnhover}
                  title={c.nom}
                  className="w-full text-left text-[9px] sm:text-[10px] font-medium leading-tight px-1 py-0.5 truncate rounded hover:opacity-70 transition-opacity"
                  style={{
                    backgroundColor: `${meta.color}${isPotentiel ? '25' : '38'}`,
                    color: meta.color,
                    borderLeft: `2px solid ${meta.color}`,
                    fontStyle: isPotentiel ? 'italic' : undefined,
                  }}>
                  {isStart ? c.nom : ' '}
                </button>
              );
            })}
            {overflow > 0 && (
              <span className="text-[8px] text-slate-400 pl-1">+{overflow}</span>
            )}
          </>
        ) : (
          /* Colored bars for compact / mini */
          <>
            {visible.map(c => {
              const meta        = CHANTIER_TYPES[c.type];
              const isPotentiel = c.status === 'potentiel';
              // Show name on the first day of the chantier or first day of the month (compact only)
              const showName = mode === 'compact' && (c.dateDebut === key || day.getDate() === 1);
              return (
                <button
                  key={c.id}
                  onClick={() => onChantierClick(c)}
                  onMouseEnter={e => onHover(c, e.clientX, e.clientY)}
                  onMouseLeave={onUnhover}
                  title={c.nom}
                  className="w-full block text-left truncate rounded hover:opacity-70 transition-opacity"
                  style={{
                    height: BAR_H,
                    backgroundColor: `${meta.color}${isPotentiel ? '25' : '38'}`,
                    color: meta.color,
                    borderLeft: `2px solid ${meta.color}`,
                    fontStyle: isPotentiel ? 'italic' : undefined,
                    fontSize: mode === 'compact' ? 9 : 7,
                    lineHeight: `${BAR_H}px`,
                    paddingLeft: 3,
                    paddingRight: 2,
                  }}>
                  {showName ? c.nom : ' '}
                </button>
              );
            })}
            {overflow > 0 && (
              <span style={{ fontSize: 7 }} className="text-slate-400 pl-0.5 leading-none">
                +{overflow}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Single month grid ─────────────────────────────────────────────────────────

function MonthGrid({
  month, chantiers, mode, onDrillDown, onChantierClick, onHover, onUnhover,
}: {
  month: Date;
  chantiers: Chantier[];
  mode: CellMode;
  onDrillDown: () => void;
  onChantierClick: (c: Chantier) => void;
  onHover: (c: Chantier, x: number, y: number) => void;
  onUnhover: () => void;
}) {
  const monthStart = startOfMonth(month);
  const monthEnd   = endOfMonth(month);
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd    = endOfWeek(monthEnd,   { weekStartsOn: 1 });
  const days       = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const byDay = useMemo(() => {
    const map = new Map<string, Chantier[]>();
    for (const d of days) {
      const key = format(d, 'yyyy-MM-dd');
      map.set(key, chantiers.filter(c => c.dateDebut <= key && c.dateFin >= key));
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chantiers, month.getTime()]);

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const dow = mode === 'full' ? DOW_LONG : DOW_SHORT;

  return (
    <div className="flex flex-col bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
      {/* Month name — clickable to drill down in compact/mini */}
      <button
        onClick={mode !== 'full' ? onDrillDown : undefined}
        className={`flex-shrink-0 text-center px-2 py-1.5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 capitalize font-semibold ${
          mode === 'full'
            ? 'text-sm text-slate-700 dark:text-slate-200 cursor-default'
            : 'text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer'
        }`}>
        {format(month, mode === 'full' ? 'MMMM yyyy' : 'MMMM', { locale: fr })}
      </button>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
        {dow.map((d, i) => (
          <div key={i} className={`text-center font-semibold text-slate-300 uppercase ${
            mode === 'full' ? 'text-[10px] py-1.5' : mode === 'compact' ? 'text-[9px] py-1' : 'text-[8px] py-0.5'
          }`}>
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div className="flex-1 flex flex-col">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 flex-1">
            {week.map(day => (
              <DayCell
                key={format(day, 'yyyy-MM-dd')}
                day={day}
                inMonth={isSameMonth(day, month)}
                items={byDay.get(format(day, 'yyyy-MM-dd')) ?? []}
                mode={mode}
                onChantierClick={onChantierClick}
                onHover={onHover}
                onUnhover={onUnhover}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Period label ──────────────────────────────────────────────────────────────

function periodLabel(periodStart: Date, zoomPreset: ZoomPreset): string {
  if (zoomPreset === 'year') return format(periodStart, 'yyyy');
  if (zoomPreset === 1) return format(periodStart, 'MMMM yyyy', { locale: fr });
  const end = addMonths(periodStart, (zoomPreset as number) - 1);
  return `${format(periodStart, 'MMM', { locale: fr })} – ${format(end, 'MMM yyyy', { locale: fr })}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CalendarView({
  chantiers, periodStart, periodEnd, zoomPreset,
  onPrevPeriod, onNextPeriod, onDrillDown, onClickChantier,
}: Props) {

  // Hover tooltip — desktop only
  const [tooltip, setTooltip] = useState<{ chantier: Chantier; x: number; y: number } | null>(null);
  const handleHover = useCallback((c: Chantier, x: number, y: number) => {
    if (window.innerWidth < 640) return;
    setTooltip({ chantier: c, x, y });
  }, []);
  const handleUnhover = useCallback(() => setTooltip(null), []);

  // Mobile peek card
  const [mobilePeek, setMobilePeek] = useState<Chantier | null>(null);
  const handleChantierClick = useCallback((c: Chantier) => {
    if (window.innerWidth < 640) {
      setMobilePeek(c);
    } else {
      onClickChantier(c);
    }
  }, [onClickChantier]);

  // Determine display mode and grid columns
  const mode: CellMode =
    zoomPreset === 1                     ? 'full'    :
    zoomPreset === 2 || zoomPreset === 3 ? 'compact' : 'mini';

  const colsCss =
    zoomPreset === 1 ? 'grid-cols-1' :
    zoomPreset === 2 ? 'grid-cols-1 sm:grid-cols-2' :
    zoomPreset === 3 ? 'grid-cols-1 sm:grid-cols-3' :
    zoomPreset === 6 ? 'grid-cols-2 sm:grid-cols-3' :
                       'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';

  // Enumerate months in the period
  const months = useMemo(() => {
    const list: Date[] = [];
    let m = startOfMonth(periodStart);
    while (m <= periodEnd) { list.push(m); m = addMonths(m, 1); }
    return list;
  }, [periodStart, periodEnd]);

  const label = periodLabel(periodStart, zoomPreset);

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-slate-50 dark:bg-slate-900">

      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-3 sm:px-6 py-2 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
        <button onClick={onPrevPeriod}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
          <ChevronLeft size={16} className="text-slate-500" />
        </button>

        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 capitalize">{label}</h2>
          <button onClick={() => onDrillDown(startOfMonth(new Date()))}
            className="hidden sm:flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors">
            <Calendar size={10}/> Aujourd'hui
          </button>
        </div>

        <button onClick={onNextPeriod}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
          <ChevronRight size={16} className="text-slate-500" />
        </button>
      </div>

      {/* ── Month grid ── */}
      <div
        className={`flex-1 overflow-y-auto p-2 sm:p-3 grid ${colsCss} gap-2 sm:gap-3`}
        style={zoomPreset === 1 ? { display: 'flex', flexDirection: 'column' } : undefined}>
        {months.map(m => (
          <MonthGrid
            key={format(m, 'yyyy-MM')}
            month={m}
            chantiers={chantiers}
            mode={mode}
            onDrillDown={() => onDrillDown(m)}
            onChantierClick={handleChantierClick}
            onHover={handleHover}
            onUnhover={handleUnhover}
          />
        ))}
      </div>

      {/* ── Hover tooltip (desktop) ── */}
      {tooltip && (
        <ChantierTooltip
          chantier={tooltip.chantier}
          x={tooltip.x}
          y={tooltip.y}
        />
      )}

      {/* ── Mobile peek card ── */}
      {mobilePeek && (
        <MobilePeekCard
          chantier={mobilePeek}
          onClose={() => setMobilePeek(null)}
          onEdit={() => { setMobilePeek(null); onClickChantier(mobilePeek); }}
        />
      )}
    </div>
  );
}
