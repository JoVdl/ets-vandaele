import { useMemo, useState, useCallback } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isToday, format, addMonths,
  addDays, differenceInCalendarDays, parseISO,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import type { Chantier } from '../types';
import { CHANTIER_TYPES } from '../lib/constants';
import { isWorkingDay, nextWorkingDay } from '../lib/workingDays';
import ChantierTooltip from './ChantierTooltip';
import MobilePeekCard from './MobilePeekCard';

type ZoomPreset = 1 | 2 | 3 | 6 | 'year' | 'fiscal' | 'custom';
type CellMode   = 'full' | 'compact' | 'mini';

const DOW_LONG  = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DOW_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

interface DragState {
  chantier: Chantier;
  offsetDays: number; // which day within the chantier was grabbed
}

interface PreviewRange {
  chantier: Chantier;
  start: string; // yyyy-MM-dd
  end: string;
}

interface Props {
  chantiers: Chantier[];
  periodStart: Date;
  periodEnd: Date;
  zoomPreset: ZoomPreset;
  onPrevPeriod: () => void;
  onNextPeriod: () => void;
  onDrillDown: (month: Date) => void;
  onClickChantier: (c: Chantier) => void;
  onMoveChantier: (id: string, newStart: string, newEnd: string) => void;
}

// ── Day cell ──────────────────────────────────────────────────────────────────

function DayCell({
  day, inMonth, items, mode,
  onChantierClick, onHover, onUnhover,
  dragId, preview,
  onDragStartBar, onDragOverCell, onDropCell, onDragEndBar,
}: {
  day: Date;
  inMonth: boolean;
  items: Chantier[];
  mode: CellMode;
  onChantierClick: (c: Chantier) => void;
  onHover: (c: Chantier, x: number, y: number) => void;
  onUnhover: () => void;
  dragId: string | null;
  preview: PreviewRange | null;
  onDragStartBar: (c: Chantier, offsetDays: number, e: React.DragEvent) => void;
  onDragOverCell: (e: React.DragEvent) => void;
  onDropCell: (e: React.DragEvent) => void;
  onDragEndBar: () => void;
}) {
  const key     = format(day, 'yyyy-MM-dd');
  const today   = isToday(day);
  const workDay = isWorkingDay(day);

  const sorted  = [...items].sort((a, b) =>
    (a.status === 'confirme' ? 0 : 1) - (b.status === 'confirme' ? 0 : 1)
  );

  // Ghost bar: preview chantier landing here but not currently on this day
  const isPreviewDay = !!(preview && key >= preview.start && key <= preview.end);
  const ghostNeeded  = isPreviewDay && !!preview && !items.find(c => c.id === preview.chantier.id);

  // Effective item count for sizing (include ghost if it's extra)
  const count   = sorted.length + (ghostNeeded ? 1 : 0);
  const BAR_H   =
    mode === 'compact'
      ? count <= 1 ? 18 : count <= 2 ? 13 : count <= 3 ? 10 : 8
      : mode === 'mini'
      ? count <= 1 ? 13 : count <= 2 ? 9  : count <= 3 ? 7  : 6
      : 0;
  const FONT_SZ =
    mode === 'compact'
      ? count <= 1 ? 10 : count <= 2 ? 9 : 8
      : count <= 1 ? 9  : count <= 2 ? 8 : 7;

  const MAX_ITEMS = mode === 'full' ? 3 : mode === 'compact' ? 5 : 4;
  const visible   = sorted.slice(0, MAX_ITEMS);
  const overflow  = sorted.length - MAX_ITEMS;

  const isDragging  = (c: Chantier) => c.id === dragId;
  const canDrag     = (c: Chantier) =>
    !c.datesVerrouillees && c.status !== 'refuse' && c.status !== 'annule';

  return (
    <div
      className={`flex flex-col border-r border-b border-slate-100 dark:border-slate-700/40 last:border-r-0 ${
        !inMonth ? 'opacity-20 pointer-events-none' : ''
      } ${isPreviewDay && preview ? 'bg-blue-50/40 dark:bg-blue-900/10' : !workDay ? 'bg-slate-50/70 dark:bg-slate-800/30' : 'bg-white dark:bg-slate-800'}`}
      style={{ minHeight: mode === 'full' ? 90 : mode === 'compact' ? 56 : 36 }}
      onDragOver={dragId ? onDragOverCell : undefined}
      onDrop={dragId ? onDropCell : undefined}>

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
            {/* Ghost bar in full mode */}
            {ghostNeeded && preview && (() => {
              const meta = CHANTIER_TYPES[preview.chantier.type];
              return (
                <div
                  className="w-full text-left text-[9px] sm:text-[10px] font-medium leading-tight px-1 py-0.5 truncate rounded pointer-events-none"
                  style={{
                    backgroundColor: `${meta.color}20`,
                    color: meta.color,
                    borderLeft: `2px dashed ${meta.color}`,
                  }}>
                  {preview.chantier.nom}
                </div>
              );
            })()}
            {visible.map(c => {
              const meta        = CHANTIER_TYPES[c.type];
              const isPotentiel = c.status === 'potentiel';
              const isPreviewBar = !!(preview && c.id === preview.chantier.id && isPreviewDay);
              return (
                <button
                  key={c.id}
                  draggable={canDrag(c)}
                  onDragStart={e => onDragStartBar(c, differenceInCalendarDays(day, parseISO(c.dateDebut)), e)}
                  onDragEnd={onDragEndBar}
                  onClick={() => onChantierClick(c)}
                  onMouseEnter={e => onHover(c, e.clientX, e.clientY)}
                  onMouseLeave={onUnhover}
                  title={c.nom}
                  className="w-full text-left text-[9px] sm:text-[10px] font-medium leading-tight px-1 py-0.5 truncate rounded hover:opacity-70 transition-opacity"
                  style={{
                    backgroundColor: `${meta.color}${isPotentiel ? '25' : '38'}`,
                    color: meta.color,
                    borderLeft: isPreviewBar ? `2px dashed ${meta.color}` : `2px solid ${meta.color}`,
                    fontStyle: isPotentiel ? 'italic' : undefined,
                    opacity: isDragging(c) ? 0.35 : 1,
                    cursor: canDrag(c) ? 'grab' : 'pointer',
                  }}>
                  {c.dateDebut === key ? c.nom : ' '}
                </button>
              );
            })}
            {overflow > 0 && (
              <span className="text-[8px] text-slate-400 pl-1">+{overflow}</span>
            )}
          </>
        ) : (
          /* Bars for compact / mini */
          <>
            {/* Ghost bar */}
            {ghostNeeded && preview && (() => {
              const meta = CHANTIER_TYPES[preview.chantier.type];
              return (
                <div
                  className="w-full block truncate rounded pointer-events-none"
                  style={{
                    height: BAR_H,
                    backgroundColor: `${meta.color}20`,
                    color: meta.color,
                    borderLeft: `2px dashed ${meta.color}`,
                    fontSize: FONT_SZ,
                    lineHeight: `${BAR_H}px`,
                    paddingLeft: 3,
                  }}>
                  {preview.chantier.nom}
                </div>
              );
            })()}
            {visible.map(c => {
              const meta        = CHANTIER_TYPES[c.type];
              const isPotentiel = c.status === 'potentiel';
              const isPreviewBar = !!(preview && c.id === preview.chantier.id && isPreviewDay);
              return (
                <button
                  key={c.id}
                  draggable={canDrag(c)}
                  onDragStart={e => onDragStartBar(c, differenceInCalendarDays(day, parseISO(c.dateDebut)), e)}
                  onDragEnd={onDragEndBar}
                  onClick={() => onChantierClick(c)}
                  onMouseEnter={e => onHover(c, e.clientX, e.clientY)}
                  onMouseLeave={onUnhover}
                  title={c.nom}
                  className="w-full block text-left truncate rounded hover:opacity-70 transition-opacity"
                  style={{
                    height: BAR_H,
                    backgroundColor: `${meta.color}${isPotentiel ? '25' : '38'}`,
                    color: meta.color,
                    borderLeft: isPreviewBar ? `2px dashed ${meta.color}` : `2px solid ${meta.color}`,
                    fontStyle: isPotentiel ? 'italic' : undefined,
                    fontSize: FONT_SZ,
                    lineHeight: `${BAR_H}px`,
                    paddingLeft: 3,
                    paddingRight: 2,
                    opacity: isDragging(c) ? 0.35 : 1,
                    cursor: canDrag(c) ? 'grab' : 'pointer',
                  }}>
                  {c.nom}
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
  month, chantiers, mode, onDrillDown,
  onChantierClick, onHover, onUnhover,
  dragId, preview, onDragStartBar, onDragOverDay, onDropDay, onDragEndBar,
}: {
  month: Date;
  chantiers: Chantier[];
  mode: CellMode;
  onDrillDown: () => void;
  onChantierClick: (c: Chantier) => void;
  onHover: (c: Chantier, x: number, y: number) => void;
  onUnhover: () => void;
  dragId: string | null;
  preview: PreviewRange | null;
  onDragStartBar: (c: Chantier, offsetDays: number, e: React.DragEvent) => void;
  onDragOverDay: (key: string, e: React.DragEvent) => void;
  onDropDay: (key: string, e: React.DragEvent) => void;
  onDragEndBar: () => void;
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
            {week.map(day => {
              const dayKey = format(day, 'yyyy-MM-dd');
              return (
                <DayCell
                  key={dayKey}
                  day={day}
                  inMonth={isSameMonth(day, month)}
                  items={byDay.get(dayKey) ?? []}
                  mode={mode}
                  onChantierClick={onChantierClick}
                  onHover={onHover}
                  onUnhover={onUnhover}
                  dragId={dragId}
                  preview={preview}
                  onDragStartBar={onDragStartBar}
                  onDragOverCell={e => onDragOverDay(dayKey, e)}
                  onDropCell={e => onDropDay(dayKey, e)}
                  onDragEndBar={onDragEndBar}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Period label ──────────────────────────────────────────────────────────────

function periodLabel(periodStart: Date, periodEnd: Date, zoomPreset: ZoomPreset): string {
  if (zoomPreset === 'year')   return format(periodStart, 'yyyy');
  if (zoomPreset === 'fiscal') return `Exercice ${format(periodStart, 'yyyy')}/${format(periodEnd, 'yyyy')}`;
  if (zoomPreset === 'custom') return `${format(periodStart, 'd MMM yyyy', { locale: fr })} – ${format(periodEnd, 'd MMM yyyy', { locale: fr })}`;
  if (zoomPreset === 1)        return format(periodStart, 'MMMM yyyy', { locale: fr });
  const end = addMonths(periodStart, (zoomPreset as number) - 1);
  return `${format(periodStart, 'MMM', { locale: fr })} – ${format(end, 'MMM yyyy', { locale: fr })}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CalendarView({
  chantiers, periodStart, periodEnd, zoomPreset,
  onPrevPeriod, onNextPeriod, onDrillDown, onClickChantier, onMoveChantier,
}: Props) {

  // ── Hover tooltip — desktop only ─────────────────────────────────────────
  const [tooltip, setTooltip] = useState<{ chantier: Chantier; x: number; y: number } | null>(null);
  const handleHover = useCallback((c: Chantier, x: number, y: number) => {
    if (window.innerWidth < 640) return;
    setTooltip({ chantier: c, x, y });
  }, []);
  const handleUnhover = useCallback(() => setTooltip(null), []);

  // ── Mobile peek card ──────────────────────────────────────────────────────
  const [mobilePeek, setMobilePeek] = useState<Chantier | null>(null);
  const handleChantierClick = useCallback((c: Chantier) => {
    if (window.innerWidth < 640) {
      setMobilePeek(c);
    } else {
      onClickChantier(c);
    }
  }, [onClickChantier]);

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  // Live preview range while dragging
  const preview = useMemo<PreviewRange | null>(() => {
    if (!drag || !dragOverDay) return null;
    const dur      = differenceInCalendarDays(parseISO(drag.chantier.dateFin), parseISO(drag.chantier.dateDebut));
    const newStart = addDays(parseISO(dragOverDay), -drag.offsetDays);
    const newEnd   = addDays(newStart, dur);
    return {
      chantier: drag.chantier,
      start: format(newStart, 'yyyy-MM-dd'),
      end:   format(newEnd,   'yyyy-MM-dd'),
    };
  }, [drag, dragOverDay]);

  const handleDragStartBar = useCallback((c: Chantier, offsetDays: number, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    setTooltip(null);
    setDrag({ chantier: c, offsetDays });
  }, []);

  const handleDragOverDay = useCallback((key: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDay(key);
  }, []);

  const handleDropDay = useCallback((key: string, e: React.DragEvent) => {
    e.preventDefault();
    if (!drag) return;
    const dur      = differenceInCalendarDays(parseISO(drag.chantier.dateFin), parseISO(drag.chantier.dateDebut));
    const rawStart = addDays(parseISO(key), -drag.offsetDays);
    const newStart = nextWorkingDay(rawStart);
    const newEnd   = addDays(newStart, dur);
    onMoveChantier(
      drag.chantier.id,
      format(newStart, 'yyyy-MM-dd'),
      format(newEnd,   'yyyy-MM-dd'),
    );
    setDrag(null);
    setDragOverDay(null);
  }, [drag, onMoveChantier]);

  const handleDragEnd = useCallback(() => {
    setDrag(null);
    setDragOverDay(null);
  }, []);

  // ── Enumerate months first — mode/cols derived from actual count ─────────
  const months = useMemo(() => {
    const list: Date[] = [];
    let m = startOfMonth(periodStart);
    while (m <= periodEnd) { list.push(m); m = addMonths(m, 1); }
    return list;
  }, [periodStart, periodEnd]);

  const mc = months.length;
  const mode: CellMode = mc <= 1 ? 'full' : mc <= 4 ? 'compact' : 'mini';
  const colsCss =
    mc === 1 ? 'grid-cols-1' :
    mc === 2 ? 'grid-cols-1 sm:grid-cols-2' :
    mc === 3 ? 'grid-cols-1 sm:grid-cols-3' :
    mc <= 6  ? 'grid-cols-2 sm:grid-cols-3' :
               'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden bg-slate-50 dark:bg-slate-900"
      style={{ cursor: drag ? 'grabbing' : undefined }}>

      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-3 sm:px-6 py-2 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
        <button onClick={onPrevPeriod}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
          <ChevronLeft size={16} className="text-slate-500" />
        </button>

        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 capitalize">
            {periodLabel(periodStart, periodEnd, zoomPreset)}
          </h2>
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
            dragId={drag?.chantier.id ?? null}
            preview={preview}
            onDragStartBar={handleDragStartBar}
            onDragOverDay={handleDragOverDay}
            onDropDay={handleDropDay}
            onDragEndBar={handleDragEnd}
          />
        ))}
      </div>

      {/* ── Hover tooltip (desktop) ── */}
      {tooltip && !drag && (
        <ChantierTooltip chantier={tooltip.chantier} x={tooltip.x} y={tooltip.y} />
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
