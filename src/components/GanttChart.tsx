import { useMemo, useCallback } from 'react';
import {
  startOfDay, addDays, differenceInCalendarDays,
  format, isToday, isWeekend,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Chantier } from '../types';
import { CHANTIER_TYPES, DAY_WIDTH, MONTH_FR } from '../lib/constants';
import ChantierBlock from './ChantierBlock';

interface Props {
  chantiers: Chantier[];
  periodStart: Date;
  periodEnd: Date;
  onMoveChantier: (id: string, newStart: string, newEnd: string) => void;
  onResizeChantier: (id: string, newEnd: string) => void;
  onClickChantier: (c: Chantier) => void;
  onClickDay: (date: string) => void;
}

interface MonthGroup {
  label: string;
  year: number;
  month: number;
  startIndex: number;
  count: number;
}

const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 64;
const SIDEBAR_W = 260;

export default function GanttChart({
  chantiers, periodStart, periodEnd,
  onMoveChantier, onResizeChantier, onClickChantier, onClickDay,
}: Props) {
  // Build array of days in period
  const days = useMemo(() => {
    const arr: Date[] = [];
    let cur = startOfDay(periodStart);
    const end = startOfDay(periodEnd);
    while (cur <= end) { arr.push(cur); cur = addDays(cur, 1); }
    return arr;
  }, [periodStart, periodEnd]);

  const totalWidth = days.length * DAY_WIDTH;
  const todayIndex = differenceInCalendarDays(startOfDay(new Date()), startOfDay(periodStart));

  // Group days by month for the header
  const monthGroups = useMemo<MonthGroup[]>(() => {
    const groups: MonthGroup[] = [];
    days.forEach((d, i) => {
      const m = d.getMonth();
      const y = d.getFullYear();
      const last = groups[groups.length - 1];
      if (last && last.month === m && last.year === y) {
        last.count++;
      } else {
        groups.push({ label: MONTH_FR[m], year: y, month: m, startIndex: i, count: 1 });
      }
    });
    return groups;
  }, [days]);

  // Sort chantiers by start date
  const sorted = useMemo(
    () => [...chantiers].sort((a, b) => a.dateDebut.localeCompare(b.dateDebut)),
    [chantiers]
  );

  const getBlockProps = useCallback((c: Chantier) => {
    const s = differenceInCalendarDays(startOfDay(new Date(c.dateDebut)), startOfDay(periodStart));
    const e = differenceInCalendarDays(startOfDay(new Date(c.dateFin)), startOfDay(periodStart));
    const left = s * DAY_WIDTH;
    const width = (e - s + 1) * DAY_WIDTH;
    return { left, width };
  }, [periodStart]);

  const handleMoveEnd = useCallback((id: string, deltaDays: number) => {
    const c = chantiers.find(x => x.id === id);
    if (!c) return;
    const newStart = addDays(new Date(c.dateDebut), deltaDays);
    const newEnd = addDays(new Date(c.dateFin), deltaDays);
    onMoveChantier(id, format(newStart, 'yyyy-MM-dd'), format(newEnd, 'yyyy-MM-dd'));
  }, [chantiers, onMoveChantier]);

  const handleResizeEnd = useCallback((id: string, deltaDays: number) => {
    const c = chantiers.find(x => x.id === id);
    if (!c) return;
    const newEnd = addDays(new Date(c.dateFin), deltaDays);
    if (newEnd >= new Date(c.dateDebut)) {
      onResizeChantier(id, format(newEnd, 'yyyy-MM-dd'));
    }
  }, [chantiers, onResizeChantier]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Gantt container with sticky sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div
          className="flex-shrink-0 bg-white border-r border-slate-200 z-20 flex flex-col"
          style={{ width: SIDEBAR_W, minWidth: SIDEBAR_W }}
        >
          {/* Sidebar header */}
          <div
            className="flex items-end px-4 pb-2 border-b border-slate-200 bg-slate-50 flex-shrink-0"
            style={{ height: HEADER_HEIGHT }}
          >
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Chantier</span>
          </div>

          {/* Sidebar rows */}
          <div className="overflow-y-auto flex-1 overflow-x-hidden">
            {sorted.map((c, i) => {
              const meta = CHANTIER_TYPES[c.type];
              const isPotentiel = c.status === 'potentiel';
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-2 px-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors"
                  style={{ height: ROW_HEIGHT, backgroundColor: i % 2 === 0 ? 'white' : '#fafafa' }}
                  onClick={() => onClickChantier(c)}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: meta.color,
                      opacity: isPotentiel ? 0.5 : 1,
                      border: isPotentiel ? `1.5px dashed ${meta.color}` : 'none',
                    }}
                  />
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold truncate ${isPotentiel ? 'text-slate-400' : 'text-slate-700'}`}>
                      {c.nom}
                    </p>
                    {c.client && (
                      <p className="text-xs text-slate-400 truncate">{c.client}</p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Empty state */}
            {sorted.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <p className="text-sm">Aucun chantier</p>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable grid */}
        <div className="flex-1 overflow-auto relative">
          <div style={{ width: totalWidth, minWidth: totalWidth }}>
            {/* Header: months row + days row */}
            <div
              className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200"
              style={{ height: HEADER_HEIGHT }}
            >
              {/* Month row */}
              <div className="flex" style={{ height: 28 }}>
                {monthGroups.map((mg) => (
                  <div
                    key={`${mg.year}-${mg.month}`}
                    className="flex items-center justify-center border-r border-slate-200 bg-slate-100"
                    style={{ width: mg.count * DAY_WIDTH, height: 28 }}
                  >
                    <span className="text-xs font-bold text-slate-600 uppercase tracking-wider truncate px-1">
                      {mg.label} {mg.year}
                    </span>
                  </div>
                ))}
              </div>

              {/* Day numbers row */}
              <div className="flex" style={{ height: 36 }}>
                {days.map((d, i) => {
                  const isWkd = isWeekend(d);
                  const isToday_ = isToday(d);
                  return (
                    <div
                      key={i}
                      className={`flex flex-col items-center justify-center border-r cursor-pointer transition-colors
                        ${isWkd ? 'bg-slate-100' : 'bg-white'}
                        ${isToday_ ? 'bg-blue-50' : ''}
                        hover:bg-blue-50
                      `}
                      style={{ width: DAY_WIDTH, height: 36, borderColor: '#e2e8f0' }}
                      onClick={() => onClickDay(format(d, 'yyyy-MM-dd'))}
                    >
                      <span className={`text-xs leading-none ${isToday_ ? 'font-bold text-blue-600' : isWkd ? 'text-slate-400' : 'text-slate-500'}`}>
                        {format(d, 'd')}
                      </span>
                      <span className={`text-[9px] leading-none mt-0.5 ${isToday_ ? 'text-blue-400' : 'text-slate-300'}`}>
                        {format(d, 'EEE', { locale: fr }).slice(0, 2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Rows */}
            <div>
              {sorted.map((c, i) => {
                const { left, width } = getBlockProps(c);
                return (
                  <div
                    key={c.id}
                    className="relative border-b border-slate-100"
                    style={{
                      height: ROW_HEIGHT,
                      backgroundColor: i % 2 === 0 ? 'white' : '#fafafa',
                    }}
                  >
                    {/* Day vertical lines + weekend shading */}
                    {days.map((d, di) => (
                      <div
                        key={di}
                        className="absolute top-0 bottom-0 border-r border-slate-50"
                        style={{
                          left: di * DAY_WIDTH,
                          width: DAY_WIDTH,
                          backgroundColor: isWeekend(d) ? 'rgba(148,163,184,0.07)' : undefined,
                          ...(isToday(d) ? { backgroundColor: 'rgba(59,130,246,0.05)' } : {}),
                        }}
                      />
                    ))}

                    {/* Today line */}
                    {todayIndex >= 0 && todayIndex < days.length && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-blue-400 z-20 pointer-events-none"
                        style={{ left: todayIndex * DAY_WIDTH + DAY_WIDTH / 2 }}
                      />
                    )}

                    {/* Chantier block */}
                    {left + width > 0 && left < totalWidth && (
                      <ChantierBlock
                        chantier={c}
                        left={left}
                        width={width}
                        onMoveEnd={handleMoveEnd}
                        onResizeEnd={handleResizeEnd}
                        onClick={onClickChantier}
                      />
                    )}
                  </div>
                );
              })}

              {/* Empty rows for visual breathing room */}
              {Array.from({ length: Math.max(0, 5 - sorted.length) }).map((_, i) => (
                <div key={`empty-${i}`}
                  className="border-b border-slate-50 relative"
                  style={{ height: ROW_HEIGHT, backgroundColor: (sorted.length + i) % 2 === 0 ? 'white' : '#fafafa' }}>
                  {days.map((d, di) => (
                    <div key={di} className="absolute top-0 bottom-0 border-r border-slate-50"
                      style={{ left: di * DAY_WIDTH, width: DAY_WIDTH,
                        backgroundColor: isWeekend(d) ? 'rgba(148,163,184,0.07)' : undefined }} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
