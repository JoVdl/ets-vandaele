import { useMemo } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isToday, format, addMonths, subMonths,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import type { Chantier } from '../types';
import { CHANTIER_TYPES } from '../lib/constants';
import { isWorkingDay } from '../lib/workingDays';

const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

interface Props {
  chantiers: Chantier[];
  currentMonth: Date;
  onChangeMonth: (d: Date) => void;
  onClickChantier: (c: Chantier) => void;
}

export default function CalendarView({ chantiers, currentMonth, onChangeMonth, onClickChantier }: Props) {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd   = endOfMonth(currentMonth);
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd    = endOfWeek(monthEnd,   { weekStartsOn: 1 });
  const days       = eachDayOfInterval({ start: gridStart, end: gridEnd });

  // Pre-index chantiers by day for O(1) lookup
  const byDay = useMemo(() => {
    const map = new Map<string, Chantier[]>();
    for (const day of days) {
      const key = format(day, 'yyyy-MM-dd');
      map.set(key, chantiers.filter(c => c.dateDebut <= key && c.dateFin >= key));
    }
    return map;
  }, [chantiers, days]);

  // Split days into week rows
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-slate-50 dark:bg-slate-900">

      {/* ── Month header ── */}
      <div className="flex items-center justify-between px-3 sm:px-6 py-2 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
        <button
          onClick={() => onChangeMonth(subMonths(currentMonth, 1))}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
          <ChevronLeft size={16} className="text-slate-500" />
        </button>

        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 capitalize">
            {format(currentMonth, 'MMMM yyyy', { locale: fr })}
          </h2>
          <button
            onClick={() => onChangeMonth(new Date())}
            className="hidden sm:flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors">
            <Calendar size={10}/> Aujourd'hui
          </button>
        </div>

        <button
          onClick={() => onChangeMonth(addMonths(currentMonth, 1))}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
          <ChevronRight size={16} className="text-slate-500" />
        </button>
      </div>

      {/* ── Day-of-week header ── */}
      <div className="grid grid-cols-7 border-b border-slate-100 dark:border-slate-700 flex-shrink-0 bg-white dark:bg-slate-800">
        {DOW.map(d => (
          <div key={d} className="text-center text-[10px] sm:text-xs font-semibold text-slate-400 uppercase py-1.5">
            {d}
          </div>
        ))}
      </div>

      {/* ── Week grid ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid h-full" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b border-slate-100 dark:border-slate-700/50 last:border-0"
              style={{ minHeight: 80 }}>
              {week.map(day => {
                const key      = format(day, 'yyyy-MM-dd');
                const items    = byDay.get(key) ?? [];
                const inMonth  = isSameMonth(day, currentMonth);
                const today    = isToday(day);
                const workDay  = isWorkingDay(day);

                // Separate confirmed and potentiel, sort confirmed first
                const confirmed  = items.filter(c => c.status === 'confirme');
                const potentiels = items.filter(c => c.status === 'potentiel');
                const sorted     = [...confirmed, ...potentiels];
                const MAX        = 3;
                const visible    = sorted.slice(0, MAX);
                const overflow   = sorted.length - MAX;

                return (
                  <div key={key}
                    className={`border-r border-slate-100 dark:border-slate-700/50 last:border-r-0 p-1 sm:p-1.5 flex flex-col gap-0.5 ${
                      !inMonth ? 'opacity-30' : ''
                    } ${!workDay ? 'bg-slate-50/60 dark:bg-slate-800/30' : 'bg-white dark:bg-slate-800'}`}>

                    {/* Day number */}
                    <div className={`flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full text-[10px] sm:text-xs font-semibold mb-0.5 ${
                      today
                        ? 'bg-blue-500 text-white'
                        : !workDay
                          ? 'text-slate-300'
                          : 'text-slate-500'
                    }`}>
                      {format(day, 'd')}
                    </div>

                    {/* Chantier chips */}
                    {visible.map(c => {
                      const meta        = CHANTIER_TYPES[c.type];
                      const isPotentiel = c.status === 'potentiel';
                      const isStart     = c.dateDebut === key;
                      const isEnd       = c.dateFin   === key;

                      return (
                        <button
                          key={c.id}
                          onClick={() => onClickChantier(c)}
                          title={c.nom}
                          className={`w-full text-left text-[8px] sm:text-[10px] font-medium leading-tight px-1 py-0.5 truncate transition-opacity hover:opacity-80 active:opacity-60 ${
                            isStart ? 'rounded-l' : ''} ${isEnd ? 'rounded-r' : ''}`}
                          style={{
                            backgroundColor: `${meta.color}${isPotentiel ? '28' : '3a'}`,
                            color: meta.color,
                            borderLeft: isStart ? `2.5px solid ${meta.color}` : `0.5px solid ${meta.color}40`,
                            borderRight: isEnd ? `2.5px solid ${meta.color}` : 'none',
                            filter: isPotentiel ? 'brightness(0.9)' : undefined,
                            fontStyle: isPotentiel ? 'italic' : undefined,
                          }}>
                          {/* Show name only on start day or if cell is wide enough (desktop) */}
                          <span className={isStart ? '' : 'sm:inline hidden'}>{c.nom}</span>
                          {!isStart && <span className="sm:hidden">&nbsp;</span>}
                        </button>
                      );
                    })}

                    {overflow > 0 && (
                      <span className="text-[8px] sm:text-[9px] text-slate-400 pl-1 flex-shrink-0">
                        +{overflow}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
