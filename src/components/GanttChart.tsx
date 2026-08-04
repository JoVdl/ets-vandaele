import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import {
  startOfDay, addDays, differenceInCalendarDays,
  format, isToday, getDay,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Chantier } from '../types';
import { CHANTIER_TYPES, MONTH_FR } from '../lib/constants';
import ChantierBlock from './ChantierBlock';
import ChantierTooltip from './ChantierTooltip';
import MobilePeekCard from './MobilePeekCard';
import { isWorkingDay, findGaps, nextWorkingDay, prevWorkingDay } from '../lib/workingDays';
import { resourceConflict } from '../lib/reorganize';
import { getEffectiveEtat } from '../lib/etat';

interface Props {
  chantiers: Chantier[];
  periodStart: Date;
  periodEnd: Date;
  dayWidth: number;
  onDayWidthChange: (w: number) => void;
  onMoveChantier: (id: string, newStart: string, newEnd: string) => void;
  onResizeChantier: (id: string, newEnd: string) => void;
  onClickChantier: (c: Chantier) => void;
  onClickDay: (date: string) => void;
  showGaps: boolean;
}

interface MonthGroup {
  label: string; year: number; month: number; startIndex: number; count: number;
}

const ROW_H  = 52;
const HEAD_H = 56;

function isOutOfPreconisee(c: Chantier): boolean {
  if (!c.periodePreconiseeDebut || !c.periodePreconiseeFin) return false;
  return c.dateDebut < c.periodePreconiseeDebut || c.dateFin > c.periodePreconiseeFin;
}

export default function GanttChart({
  chantiers, periodStart, periodEnd,
  dayWidth, onDayWidthChange,
  onMoveChantier, onResizeChantier, onClickChantier, onClickDay,
  showGaps,
}: Props) {
  const scrollRef     = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<number | null>(null);
  const prevDayWidth  = useRef(dayWidth);
  const [containerW, setContainerW] = useState(() => window.innerWidth);

  // Sidebar width: smaller on mobile to leave room for the chart
  const SIDE_W = window.innerWidth < 640 ? 120 : 260;

  // Keep container width in sync
  useEffect(() => {
    if (!scrollRef.current) return;
    const ro = new ResizeObserver(entries => {
      setContainerW(entries[0].contentRect.width);
    });
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Mobile peek card ─────────────────────────────────────────────────────
  const [mobilePeek, setMobilePeek] = useState<Chantier | null>(null);

  // On mobile: tap shows the peek card; on desktop: opens modal directly
  const handleChantierTap = useCallback((c: Chantier) => {
    if (window.innerWidth < 640) {
      setMobilePeek(c);
    } else {
      onClickChantier(c);
    }
  }, [onClickChantier]);

  // ── Hover tooltip (desktop only) ─────────────────────────────────────────
  const [tooltip, setTooltip] = useState<{ chantier: Chantier; x: number; y: number } | null>(null);
  const handleHover   = useCallback((c: Chantier, x: number, y: number) => {
    if (window.innerWidth < 640) return;
    setTooltip({ chantier: c, x, y });
  }, []);
  const handleUnhover = useCallback(() => setTooltip(null), []);

  // ── Days array ────────────────────────────────────────────────────────────
  const days = useMemo(() => {
    const arr: Date[] = [];
    let cur = startOfDay(periodStart);
    const end = startOfDay(periodEnd);
    while (cur <= end) { arr.push(cur); cur = addDays(cur, 1); }
    return arr;
  }, [periodStart, periodEnd]);

  // Stretch dayWidth so the grid always fills the available width
  const minDayW    = days.length > 0 ? Math.ceil((containerW - SIDE_W) / days.length) : dayWidth;
  const effDayW    = Math.max(dayWidth, minDayW);
  const totalW     = days.length * effDayW;
  const todayIndex = differenceInCalendarDays(startOfDay(new Date()), startOfDay(periodStart));

  // ── Month groups ──────────────────────────────────────────────────────────
  const monthGroups = useMemo<MonthGroup[]>(() => {
    const g: MonthGroup[] = [];
    days.forEach((d, i) => {
      const m = d.getMonth(), y = d.getFullYear();
      const last = g[g.length - 1];
      if (last && last.month === m && last.year === y) last.count++;
      else g.push({ label: MONTH_FR[m], year: y, month: m, startIndex: i, count: 1 });
    });
    return g;
  }, [days]);

  // ── Density thresholds ────────────────────────────────────────────────────
  const showDayNums  = dayWidth >= 14;
  const showWeekMark = dayWidth >= 6;
  const showDOW      = dayWidth >= 22;
  const denseGrid    = dayWidth < 8;

  // ── Sorted rows ───────────────────────────────────────────────────────────
  const sorted = useMemo(
    () => [...chantiers].sort((a, b) => a.dateDebut.localeCompare(b.dateDebut)),
    [chantiers]
  );

  // ── Conflict detection ────────────────────────────────────────────────────
  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    const active = chantiers.filter(c =>
      c.status !== 'refuse' && c.status !== 'annule' && getEffectiveEtat(c) !== 'termine'
    );
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        if (a.dateDebut <= b.dateFin && a.dateFin >= b.dateDebut && resourceConflict(a, b)) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    return ids;
  }, [chantiers]);

  // ── Availability gaps ─────────────────────────────────────────────────────
  const gaps = useMemo(() => {
    const intervals = chantiers.map(c => ({
      start: startOfDay(new Date(c.dateDebut)),
      end:   startOfDay(new Date(c.dateFin)),
    }));
    return findGaps(startOfDay(periodStart), startOfDay(periodEnd), intervals);
  }, [chantiers, periodStart, periodEnd]);

  // ── Block position calculation ────────────────────────────────────────────
  const blockProps = useCallback((c: Chantier) => {
    const s = differenceInCalendarDays(startOfDay(new Date(c.dateDebut)), startOfDay(periodStart));
    const e = differenceInCalendarDays(startOfDay(new Date(c.dateFin)),   startOfDay(periodStart));
    const rawLeft  = s * effDayW;
    const rawRight = (e + 1) * effDayW;
    const dispLeft  = Math.max(0, rawLeft);
    const dispWidth = Math.max(effDayW, Math.min(totalW, rawRight) - dispLeft);
    return { left: dispLeft, width: dispWidth };
  }, [periodStart, effDayW, totalW]);

  // ── Recommended period overlay position ───────────────────────────────────
  const preconiseeProps = useCallback((c: Chantier) => {
    if (!c.periodePreconiseeDebut || !c.periodePreconiseeFin) return null;
    const s = differenceInCalendarDays(startOfDay(new Date(c.periodePreconiseeDebut)), startOfDay(periodStart));
    const e = differenceInCalendarDays(startOfDay(new Date(c.periodePreconiseeFin)),   startOfDay(periodStart));
    const left  = Math.max(0, s * effDayW);
    const right = Math.min(totalW, (e + 1) * effDayW);
    if (right <= left) return null;
    return { left, width: right - left };
  }, [periodStart, effDayW, totalW]);

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const handleMoveEnd = useCallback((id: string, delta: number) => {
    const c = chantiers.find(x => x.id === id);
    if (!c) return;
    const start = nextWorkingDay(addDays(new Date(c.dateDebut), delta));
    const end   = prevWorkingDay(addDays(new Date(c.dateFin),   delta));
    onMoveChantier(id,
      format(start, 'yyyy-MM-dd'),
      format(end < start ? start : end, 'yyyy-MM-dd'));
  }, [chantiers, onMoveChantier]);

  const handleResizeEnd = useCallback((id: string, delta: number) => {
    const c = chantiers.find(x => x.id === id);
    if (!c) return;
    const rawEnd = addDays(new Date(c.dateFin), delta);
    const start  = new Date(c.dateDebut);
    if (rawEnd < start) return;
    const end = prevWorkingDay(rawEnd);
    onResizeChantier(id, format(end < start ? start : end, 'yyyy-MM-dd'));
  }, [chantiers, onResizeChantier]);

  // ── Wheel zoom — native non-passive listener ──────────────────────────────
  const dayWidthRef        = useRef(dayWidth);
  const onDayWidthChangeRef = useRef(onDayWidthChange);
  dayWidthRef.current        = dayWidth;
  onDayWidthChangeRef.current = onDayWidthChange;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // ── Ctrl+scroll zoom (desktop) ──────────────────────────────────────────
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect      = el.getBoundingClientRect();
      const mouseX    = e.clientX - rect.left - SIDE_W;
      const dw        = dayWidthRef.current;
      const dayAtMouse = (el.scrollLeft + mouseX) / dw;
      const factor    = e.deltaY > 0 ? 1 / 1.18 : 1.18;
      const nw        = Math.max(3, Math.min(100, dw * factor));
      pendingScroll.current = dayAtMouse * nw - mouseX;
      onDayWidthChangeRef.current(nw);
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    // ── Pinch-to-zoom (mobile) ───────────────────────────────────────────────
    let pinchDist0 = 0;
    let pinchDw0   = 0;
    let pinchMidX  = 0;
    let pinchDayAt = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDist0 = Math.sqrt(dx * dx + dy * dy);
      pinchDw0   = dayWidthRef.current;
      const rect = el.getBoundingClientRect();
      pinchMidX  = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left - SIDE_W;
      pinchDayAt = (el.scrollLeft + pinchMidX) / pinchDw0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchDist0 === 0) return;
      e.preventDefault();
      const dx   = e.touches[0].clientX - e.touches[1].clientX;
      const dy   = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nw   = Math.max(3, Math.min(100, pinchDw0 * (dist / pinchDist0)));
      pendingScroll.current = pinchDayAt * nw - pinchMidX;
      onDayWidthChangeRef.current(nw);
    };

    const onTouchEnd = () => { pinchDist0 = 0; };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove',  onTouchMove,  { passive: false });
    el.addEventListener('touchend',   onTouchEnd,   { passive: true });

    return () => {
      el.removeEventListener('wheel',      onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pendingScroll.current !== null) {
      el.scrollLeft = Math.max(0, pendingScroll.current);
      pendingScroll.current = null;
    } else if (prevDayWidth.current !== dayWidth) {
      const center      = el.scrollLeft + el.clientWidth / 2;
      const dayAtCenter = center / prevDayWidth.current;
      el.scrollLeft = Math.max(0, dayAtCenter * dayWidth - el.clientWidth / 2);
    }
    prevDayWidth.current = dayWidth;
  });

  useEffect(() => {
    if (scrollRef.current && todayIndex > 0)
      scrollRef.current.scrollLeft = Math.max(0, todayIndex * effDayW - 160);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* ── Availability bar — shown only when chip is active ── */}
      {showGaps && (
        <div className="flex-shrink-0 border-b border-slate-100 dark:border-slate-700/50 bg-white dark:bg-slate-800 px-4 py-1.5 overflow-x-auto">
          <div className="flex items-center gap-2 flex-wrap">
            {gaps.length === 0 ? (
              <span className="text-xs text-slate-400">Période entièrement chargée</span>
            ) : gaps.map((g, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 rounded-full border border-green-200 text-xs">
                <span className="font-semibold">{g.workingDays}j</span>
                <span className="text-green-500 text-[10px]">
                  {format(g.start, 'd MMM', { locale: fr })}–{format(g.end, 'd MMM', { locale: fr })}
                </span>
              </span>
            ))}
            {gaps.length > 0 && (
              <span className="ml-auto text-slate-300 text-[10px] flex-shrink-0">
                {gaps.reduce((s, g) => s + g.workingDays, 0)} j ouvrés libres
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Scrollable Gantt ──────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-auto" style={{ cursor: 'default' }}>
        <div style={{ minWidth: SIDE_W + totalW, width: '100%' }}>

          {/* ── STICKY HEADER ROW ──────────────────────────────────────────── */}
          <div className="sticky top-0 z-30 flex border-b border-slate-200 dark:border-slate-700" style={{ height: HEAD_H }}>

            <div className="sticky left-0 z-40 flex items-end px-4 pb-2
              bg-slate-50 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex-shrink-0"
              style={{ width: SIDE_W, minWidth: SIDE_W }}>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Chantier</span>
            </div>

            <div style={{ flex: 1, minWidth: totalW }}>
              {/* Month row */}
              <div className="flex" style={{ height: 22, backgroundColor: 'var(--bg-month-row)' }}>
                {monthGroups.map(mg => (
                  <div key={`${mg.year}-${mg.month}`}
                    className="flex items-center justify-center border-r border-slate-200 overflow-hidden"
                    style={{ width: mg.count * effDayW }}>
                    <span className="text-xs font-bold text-slate-600 uppercase tracking-wider truncate px-1">
                      {mg.count * effDayW > 50
                        ? `${mg.label} ${mg.year}`
                        : mg.count * effDayW > 20
                          ? mg.label.slice(0, 3)
                          : ''}
                    </span>
                  </div>
                ))}
              </div>
              {/* Day row */}
              <div className="flex" style={{ height: 34, backgroundColor: 'var(--bg-primary)' }}>
                {days.map((d, i) => {
                  const isTod = isToday(d);
                  const isMon = getDay(d) === 1;
                  const isWD  = isWorkingDay(d);
                  const show  = showDayNums || (showWeekMark && (isMon || d.getDate() === 1));
                  return (
                    <div key={i}
                      className={`flex flex-col items-center justify-center overflow-hidden border-r
                        ${!isWD ? 'bg-slate-50' : 'bg-white'}
                        ${isTod ? '!bg-blue-50' : ''}
                        ${show ? 'cursor-pointer hover:bg-blue-50' : ''}
                      `}
                      style={{ width: effDayW, height: 34, borderColor: '#e2e8f0' }}
                      onClick={() => show && onClickDay(format(nextWorkingDay(d), 'yyyy-MM-dd'))}>
                      {show && (
                        <>
                          <span className={`leading-none
                            ${isTod ? 'font-bold text-blue-600' : !isWD ? 'text-slate-300' : 'text-slate-500'}
                            ${effDayW < 18 ? 'text-[9px]' : 'text-xs'}
                          `}>{format(d, 'd')}</span>
                          {showDOW && (
                            <span className={`text-[9px] leading-none mt-0.5 ${isTod ? 'text-blue-400' : 'text-slate-300'}`}>
                              {format(d, 'EEE', { locale: fr }).slice(0, 2)}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── DATA ROWS ──────────────────────────────────────────────────── */}
          {sorted.map((c, i) => {
            const meta = CHANTIER_TYPES[c.type];
            const isPotentiel = c.status === 'potentiel';
            const { left, width } = blockProps(c);
            const precon = preconiseeProps(c);
            const outOfPrecon = isOutOfPreconisee(c);
            return (
              <div key={c.id} className="flex border-b border-slate-100 dark:border-slate-700/50"
                style={{ height: ROW_H, backgroundColor: i % 2 === 0 ? 'var(--bg-row-even)' : 'var(--bg-row-odd)' }}>

                {/* Sidebar cell — z-20 so it always paints over any block touching the left edge */}
                <div
                  className="sticky left-0 z-20 flex items-center gap-2 px-3 border-r border-slate-100 dark:border-slate-700/50
                    cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors flex-shrink-0"
                  style={{ width: SIDE_W, minWidth: SIDE_W,
                    backgroundColor: i % 2 === 0 ? 'var(--bg-row-even)' : 'var(--bg-row-odd)' }}
                  onClick={() => handleChantierTap(c)}
                  onMouseEnter={e => handleHover(c, e.pageX, e.pageY)}
                  onMouseMove={e => handleHover(c, e.pageX, e.pageY)}
                  onMouseLeave={handleUnhover}>
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: meta.color, opacity: isPotentiel ? 0.5 : 1,
                      border: isPotentiel ? `1.5px dashed ${meta.color}` : 'none' }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <p className={`text-xs font-semibold truncate ${isPotentiel ? 'text-slate-400' : 'text-slate-700'}`}>
                        {c.nom}
                      </p>
                      {conflictIds.has(c.id) && (
                        <span title="Conflit de ressources" className="flex-shrink-0 text-red-500 text-[10px] font-bold">!</span>
                      )}
                      {outOfPrecon && (
                        <span title="Hors période préconisée" className="flex-shrink-0 text-orange-400">⚠</span>
                      )}
                    </div>
                    {c.client && <p className="hidden sm:block text-xs text-slate-400 truncate">{c.client}</p>}
                  </div>
                </div>

                {/* Grid cell — isolation:isolate contains block z-indices inside this stacking context */}
                <div className="relative flex-1" style={{ minWidth: totalW, height: ROW_H, isolation: 'isolate', overflow: 'hidden',
                  backgroundColor: i % 2 === 0 ? 'var(--bg-row-even)' : 'var(--bg-row-odd)' }}>
                  {/* Grid lines */}
                  {!denseGrid
                    ? days.map((d, di) => (
                        <div key={di} className="absolute top-0 bottom-0 border-r border-slate-50"
                          style={{
                            left: di * effDayW,
                            width: effDayW,
                            backgroundColor: !isWorkingDay(d)
                              ? 'var(--bg-nonworking)'
                              : isToday(d) ? 'var(--bg-today-col)' : undefined,
                          }} />
                      ))
                    : monthGroups.map(mg => (
                        <div key={`${mg.year}-${mg.month}`}
                          className="absolute top-0 bottom-0 border-r border-slate-100"
                          style={{ left: mg.startIndex * effDayW, width: mg.count * effDayW }} />
                      ))
                  }

                  {/* Recommended period band */}
                  {precon && (
                    <div className="absolute top-1 bottom-1 rounded pointer-events-none z-5"
                      style={{
                        left: precon.left,
                        width: precon.width,
                        backgroundColor: outOfPrecon ? 'rgba(249,115,22,0.1)' : 'rgba(34,197,94,0.12)',
                        border: `1px dashed ${outOfPrecon ? '#F97316' : '#22C55E'}`,
                      }} />
                  )}

                  {/* Today line */}
                  {todayIndex >= 0 && todayIndex < days.length && (
                    <div className="absolute top-0 bottom-0 w-0.5 bg-blue-400 z-20 pointer-events-none"
                      style={{ left: todayIndex * effDayW + effDayW / 2 }} />
                  )}

                  {/* Block */}
                  {left + width > 0 && left < totalW && (
                    <ChantierBlock
                      chantier={c} left={left} width={width} dayWidth={effDayW}
                      onMoveEnd={handleMoveEnd} onResizeEnd={handleResizeEnd}
                      onClick={handleChantierTap} outOfPreconisee={outOfPrecon}
                      onHover={handleHover} onUnhover={handleUnhover}
                      isConflicting={conflictIds.has(c.id)}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {/* Empty rows padding */}
          {Array.from({ length: Math.max(0, 5 - sorted.length) }).map((_, i) => (
            <div key={`e-${i}`} className="flex border-b border-slate-50"
              style={{ height: ROW_H, backgroundColor: (sorted.length + i) % 2 === 0 ? 'var(--bg-row-even)' : 'var(--bg-row-odd)' }}>
              <div className="sticky left-0 flex-shrink-0 border-r border-slate-100"
                style={{ width: SIDE_W, backgroundColor: (sorted.length + i) % 2 === 0 ? 'var(--bg-row-even)' : 'var(--bg-row-odd)' }} />
              <div className="flex-shrink-0" style={{ width: totalW }} />
            </div>
          ))}

          {sorted.length === 0 && (
            <div className="flex">
              <div className="sticky left-0 flex-shrink-0 border-r border-slate-100" style={{ width: SIDE_W }} />
              <div className="flex items-center justify-center py-16 text-slate-400" style={{ width: totalW }}>
                <p className="text-sm">Aucun chantier sur cette période</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hover tooltip (desktop) */}
      {tooltip && (
        <ChantierTooltip chantier={tooltip.chantier} x={tooltip.x} y={tooltip.y} />
      )}

      {/* Mobile peek card */}
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
