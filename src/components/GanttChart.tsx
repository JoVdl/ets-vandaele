import { useMemo, useCallback, useRef, useEffect } from 'react';
import {
  startOfDay, addDays, differenceInCalendarDays,
  format, isToday, isWeekend, getDay,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Chantier } from '../types';
import { CHANTIER_TYPES, MONTH_FR } from '../lib/constants';
import ChantierBlock from './ChantierBlock';

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
}

interface MonthGroup {
  label: string; year: number; month: number; startIndex: number; count: number;
}

const ROW_H   = 52;
const HEAD_H  = 56;  // month row 22 + day row 34
const SIDE_W  = 260;

export default function GanttChart({
  chantiers, periodStart, periodEnd,
  dayWidth, onDayWidthChange,
  onMoveChantier, onResizeChantier, onClickChantier, onClickDay,
}: Props) {
  const scrollRef    = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<number | null>(null);
  const prevDayWidth  = useRef(dayWidth);

  // ── Days array ────────────────────────────────────────────────────────────
  const days = useMemo(() => {
    const arr: Date[] = [];
    let cur = startOfDay(periodStart);
    const end = startOfDay(periodEnd);
    while (cur <= end) { arr.push(cur); cur = addDays(cur, 1); }
    return arr;
  }, [periodStart, periodEnd]);

  const totalW     = days.length * dayWidth;
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

  const blockProps = useCallback((c: Chantier) => {
    const s = differenceInCalendarDays(startOfDay(new Date(c.dateDebut)), startOfDay(periodStart));
    const e = differenceInCalendarDays(startOfDay(new Date(c.dateFin)),   startOfDay(periodStart));
    return { left: s * dayWidth, width: (e - s + 1) * dayWidth };
  }, [periodStart, dayWidth]);

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const handleMoveEnd = useCallback((id: string, delta: number) => {
    const c = chantiers.find(x => x.id === id);
    if (!c) return;
    onMoveChantier(id,
      format(addDays(new Date(c.dateDebut), delta), 'yyyy-MM-dd'),
      format(addDays(new Date(c.dateFin),   delta), 'yyyy-MM-dd'));
  }, [chantiers, onMoveChantier]);

  const handleResizeEnd = useCallback((id: string, delta: number) => {
    const c = chantiers.find(x => x.id === id);
    if (!c) return;
    const end = addDays(new Date(c.dateFin), delta);
    if (end >= new Date(c.dateDebut)) onResizeChantier(id, format(end, 'yyyy-MM-dd'));
  }, [chantiers, onResizeChantier]);

  // ── Wheel zoom — native non-passive listener so preventDefault() works ────
  // (React's synthetic onWheel is passive in modern browsers, blocking preventDefault)
  const dayWidthRef        = useRef(dayWidth);
  const onDayWidthChangeRef = useRef(onDayWidthChange);
  dayWidthRef.current        = dayWidth;
  onDayWidthChangeRef.current = onDayWidthChange;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX   = e.clientX - rect.left - SIDE_W;
      const contentX = el.scrollLeft + mouseX;
      const dw       = dayWidthRef.current;
      const dayAtMouse = contentX / dw;
      const factor = e.deltaY > 0 ? 1 / 1.18 : 1.18;
      const nw = Math.max(3, Math.min(100, dw * factor));
      pendingScroll.current = dayAtMouse * nw - mouseX;
      onDayWidthChangeRef.current(nw);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []); // attach once

  // ── After every render: apply scroll corrections ───────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (pendingScroll.current !== null) {
      // Wheel zoom → scroll to keep day-under-mouse fixed
      el.scrollLeft = Math.max(0, pendingScroll.current);
      pendingScroll.current = null;
    } else if (prevDayWidth.current !== dayWidth) {
      // Button zoom → maintain the center of the visible area
      const center     = el.scrollLeft + el.clientWidth / 2;
      const dayAtCenter = center / prevDayWidth.current;
      el.scrollLeft = Math.max(0, dayAtCenter * dayWidth - el.clientWidth / 2);
    }
    prevDayWidth.current = dayWidth;
  });

  // Scroll to today on mount
  useEffect(() => {
    if (scrollRef.current && todayIndex > 0)
      scrollRef.current.scrollLeft = Math.max(0, todayIndex * dayWidth - 160);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto"
      style={{ cursor: 'default' }}
    >
      {/* Inner content: SIDE_W + timeline width */}
      <div style={{ minWidth: SIDE_W + totalW, width: SIDE_W + totalW }}>

        {/* ── STICKY HEADER ROW ─────────────────────────────────────────── */}
        <div className="sticky top-0 z-30 flex border-b border-slate-200"
          style={{ height: HEAD_H }}>

          {/* Sidebar header corner — sticky left inside sticky top */}
          <div className="sticky left-0 z-40 flex items-end px-4 pb-2
            bg-slate-50 border-r border-slate-200 flex-shrink-0"
            style={{ width: SIDE_W, minWidth: SIDE_W }}>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Chantier</span>
          </div>

          {/* Timeline header */}
          <div style={{ width: totalW, minWidth: totalW }}>
            {/* Month row */}
            <div className="flex bg-slate-100" style={{ height: 22 }}>
              {monthGroups.map(mg => (
                <div key={`${mg.year}-${mg.month}`}
                  className="flex items-center justify-center border-r border-slate-200 overflow-hidden"
                  style={{ width: mg.count * dayWidth }}>
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wider truncate px-1">
                    {mg.count * dayWidth > 50
                      ? `${mg.label} ${mg.year}`
                      : mg.count * dayWidth > 20
                        ? mg.label.slice(0, 3)
                        : ''}
                  </span>
                </div>
              ))}
            </div>
            {/* Day row */}
            <div className="flex bg-white" style={{ height: 34 }}>
              {days.map((d, i) => {
                const isWkd = isWeekend(d);
                const isTod = isToday(d);
                const isMon = getDay(d) === 1;
                const show  = showDayNums || (showWeekMark && (isMon || d.getDate() === 1));
                return (
                  <div key={i}
                    className={`flex flex-col items-center justify-center overflow-hidden border-r
                      ${isWkd ? 'bg-slate-50' : 'bg-white'}
                      ${isTod ? '!bg-blue-50' : ''}
                      ${show ? 'cursor-pointer hover:bg-blue-50' : ''}
                    `}
                    style={{ width: dayWidth, height: 34, borderColor: '#e2e8f0' }}
                    onClick={() => show && onClickDay(format(d, 'yyyy-MM-dd'))}>
                    {show && (
                      <>
                        <span className={`leading-none
                          ${isTod ? 'font-bold text-blue-600' : isWkd ? 'text-slate-400' : 'text-slate-500'}
                          ${dayWidth < 18 ? 'text-[9px]' : 'text-xs'}
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

        {/* ── DATA ROWS ─────────────────────────────────────────────────── */}
        {sorted.map((c, i) => {
          const meta = CHANTIER_TYPES[c.type];
          const isPotentiel = c.status === 'potentiel';
          const { left, width } = blockProps(c);
          return (
            <div key={c.id} className="flex border-b border-slate-100"
              style={{ height: ROW_H, backgroundColor: i % 2 === 0 ? 'white' : '#fafafa' }}>

              {/* Sidebar cell — sticky left */}
              <div
                className="sticky left-0 z-10 flex items-center gap-2 px-3 border-r border-slate-100
                  cursor-pointer hover:bg-slate-50 transition-colors flex-shrink-0"
                style={{ width: SIDE_W, minWidth: SIDE_W,
                  backgroundColor: i % 2 === 0 ? 'white' : '#fafafa' }}
                onClick={() => onClickChantier(c)}>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: meta.color, opacity: isPotentiel ? 0.5 : 1,
                    border: isPotentiel ? `1.5px dashed ${meta.color}` : 'none' }} />
                <div className="min-w-0">
                  <p className={`text-xs font-semibold truncate ${isPotentiel ? 'text-slate-400' : 'text-slate-700'}`}>
                    {c.nom}
                  </p>
                  {c.client && <p className="text-xs text-slate-400 truncate">{c.client}</p>}
                </div>
              </div>

              {/* Grid cell */}
              <div className="relative flex-shrink-0 overflow-hidden" style={{ width: totalW, height: ROW_H }}>
                {/* Grid lines */}
                {!denseGrid
                  ? days.map((d, di) => (
                      <div key={di} className="absolute top-0 bottom-0 border-r border-slate-50"
                        style={{ left: di * dayWidth, width: dayWidth,
                          backgroundColor: isWeekend(d) ? 'rgba(148,163,184,0.06)' : undefined,
                          ...(isToday(d) ? { backgroundColor: 'rgba(59,130,246,0.04)' } : {}) }} />
                    ))
                  : monthGroups.map(mg => (
                      <div key={`${mg.year}-${mg.month}`}
                        className="absolute top-0 bottom-0 border-r border-slate-100"
                        style={{ left: mg.startIndex * dayWidth, width: mg.count * dayWidth }} />
                    ))
                }
                {/* Today line */}
                {todayIndex >= 0 && todayIndex < days.length && (
                  <div className="absolute top-0 bottom-0 w-0.5 bg-blue-400 z-20 pointer-events-none"
                    style={{ left: todayIndex * dayWidth + dayWidth / 2 }} />
                )}
                {/* Block */}
                {left + width > 0 && left < totalW && (
                  <ChantierBlock
                    chantier={c} left={left} width={width} dayWidth={dayWidth}
                    onMoveEnd={handleMoveEnd} onResizeEnd={handleResizeEnd}
                    onClick={onClickChantier}
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* Empty rows padding */}
        {Array.from({ length: Math.max(0, 5 - sorted.length) }).map((_, i) => (
          <div key={`e-${i}`} className="flex border-b border-slate-50"
            style={{ height: ROW_H, backgroundColor: (sorted.length + i) % 2 === 0 ? 'white' : '#fafafa' }}>
            <div className="sticky left-0 flex-shrink-0 border-r border-slate-100"
              style={{ width: SIDE_W, backgroundColor: (sorted.length + i) % 2 === 0 ? 'white' : '#fafafa' }} />
            <div className="flex-shrink-0" style={{ width: totalW }} />
          </div>
        ))}

        {sorted.length === 0 && (
          <div className="flex">
            <div className="sticky left-0 flex-shrink-0 border-r border-slate-100"
              style={{ width: SIDE_W }} />
            <div className="flex items-center justify-center py-16 text-slate-400"
              style={{ width: totalW }}>
              <p className="text-sm">Aucun chantier sur cette période</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
