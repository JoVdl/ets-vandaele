import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Clock, AlertTriangle } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { SuiviSession } from '../../types/suivi';
import type { Chantier } from '../../types';
import { formatDuration } from '../../lib/geo';

interface Props {
  sessions:    SuiviSession[];
  chantiers:   Chantier[];
  salarieName?: string;
  onSessionClick: (s: SuiviSession) => void;
}

const PALETTE = [
  '#06b6d4', '#8b5cf6', '#f97316', '#ec4899',
  '#14b8a6', '#f59e0b', '#a3e635', '#38bdf8',
  '#c084fc', '#fb923c',
];

const JOURS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];

export default function CalendarView({ sessions, chantiers, salarieName = 'Hugo', onSessionClick }: Props) {
  const [cursor, setCursor] = useState(() => {
    // Start on the month of the most recent session, or current month
    const last = [...sessions].sort((a, b) =>
      new Date(b.dateDebut).getTime() - new Date(a.dateDebut).getTime())[0];
    return last ? new Date(last.dateDebut) : new Date();
  });
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  // Assign a stable color per chantier
  const chantierColor = useMemo(() => {
    const map = new Map<string, string>();
    const ids = [...new Set(sessions.map(s => s.chantierId))].sort();
    ids.forEach((id, i) => map.set(id, PALETTE[i % PALETTE.length]));
    return map;
  }, [sessions]);

  // Group sessions by YYYY-MM-DD
  const byDay = useMemo(() => {
    const map = new Map<string, SuiviSession[]>();
    for (const s of sessions) {
      const key = s.dateDebut.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [sessions]);

  const monthStart = startOfMonth(cursor);
  const monthEnd   = endOfMonth(cursor);
  const days       = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Monday-first offset (getDay: 0=Sun → shift to Mon=0)
  const startOffset = (getDay(monthStart) + 6) % 7;

  const selectedKey = selectedDay ? format(selectedDay, 'yyyy-MM-dd') : null;
  const selectedSessions = selectedKey ? (byDay.get(selectedKey) ?? []) : [];

  function chantierName(id: string) {
    return chantiers.find(c => c.id === id)?.nom ?? id;
  }

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      {/* Month nav */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07]">
        <button
          onClick={() => { setCursor(d => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n; }); setSelectedDay(null); }}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors">
          <ChevronLeft size={18} />
        </button>
        <span className="text-white font-bold text-sm capitalize">
          {format(cursor, 'MMMM yyyy', { locale: fr })}
        </span>
        <button
          onClick={() => { setCursor(d => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; }); setSelectedDay(null); }}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Grid */}
      <div className="px-2 pt-2 pb-1">
        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {JOURS.map(j => (
            <div key={j} className="text-center text-slate-600 text-[10px] uppercase tracking-wide py-1">{j}</div>
          ))}
        </div>

        {/* Cells */}
        <div className="grid grid-cols-7 gap-y-1">
          {/* Leading empty cells */}
          {Array.from({ length: startOffset }).map((_, i) => (
            <div key={`e${i}`} />
          ))}

          {days.map(day => {
            const key      = format(day, 'yyyy-MM-dd');
            const daySess  = byDay.get(key) ?? [];
            const isActive = daySess.length > 0;
            const isSel    = selectedDay ? isSameDay(day, selectedDay) : false;
            const isNow    = isToday(day);

            // Unique chantiers for this day (for color dots)
            const dotColors = [...new Set(daySess.map(s => s.chantierId))]
              .slice(0, 4)
              .map(id => chantierColor.get(id) ?? '#64748b');

            return (
              <button
                key={key}
                onClick={() => setSelectedDay(isSel ? null : day)}
                disabled={!isActive}
                className={`relative flex flex-col items-center rounded-xl py-1.5 transition-colors ${
                  isSel
                    ? 'bg-white/[0.12] border border-white/[0.15]'
                    : isActive
                      ? 'hover:bg-white/[0.07] active:bg-white/[0.10]'
                      : ''
                }`}>
                <span className={`text-xs font-medium leading-none mb-1 ${
                  isNow    ? 'text-green-400 font-bold'
                  : isSel  ? 'text-white'
                  : isActive ? 'text-slate-200'
                  : 'text-slate-700'
                }`}>
                  {day.getDate()}
                </span>
                {/* Color dots */}
                {dotColors.length > 0 && (
                  <div className="flex gap-0.5 flex-wrap justify-center">
                    {dotColors.map((c, i) => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
                    ))}
                  </div>
                )}
                {/* Session count badge if > 1 */}
                {daySess.length > 1 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-slate-700 text-white text-[9px] font-bold flex items-center justify-center">
                    {daySess.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      {chantierColor.size > 0 && (
        <div className="px-3 py-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/[0.05]">
          {[...chantierColor.entries()].map(([id, color]) => (
            <span key={id} className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              {chantierName(id)}
            </span>
          ))}
        </div>
      )}

      {/* Selected day sessions */}
      {selectedDay && (
        <div className="border-t border-white/[0.07] px-3 py-3 space-y-2">
          <p className="text-slate-400 text-[10px] uppercase tracking-wide mb-2">
            {format(selectedDay, 'EEEE d MMMM', { locale: fr })}
            {' · '}{selectedSessions.length} session{selectedSessions.length > 1 ? 's' : ''}
          </p>
          {selectedSessions
            .sort((a, b) => new Date(a.dateDebut).getTime() - new Date(b.dateDebut).getTime())
            .map(s => {
              const color      = chantierColor.get(s.chantierId) ?? '#64748b';
              const incidentMin = s.incidents?.reduce((a, i) => a + i.dureeMinutes, 0) ?? 0;
              const isDragSess  = (s.volumeM3 ?? 0) > 0;
              return (
                <button
                  key={s.id}
                  onClick={() => onSessionClick(s)}
                  className="w-full text-left bg-white/[0.05] hover:bg-white/[0.09] active:scale-[0.99] transition-all rounded-2xl p-3 border border-white/[0.07]">
                  {/* Chantier name + operator */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-white font-semibold text-xs flex-1 truncate">{chantierName(s.chantierId)}</span>
                    <span className="text-slate-500 text-[10px] flex-shrink-0">
                      {s.operateur === 'patron' ? 'Patron' : salarieName}
                    </span>
                  </div>
                  {/* Time + duration */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 text-slate-400 text-[10px]">
                      <Clock size={10} />
                      {format(new Date(s.dateDebut), 'HH:mm')}
                      {s.dateFin && ` → ${format(new Date(s.dateFin), 'HH:mm')}`}
                    </div>
                    <span className="text-slate-300 text-[10px] font-semibold">
                      {formatDuration(s.dureeMinutes)}
                    </span>
                    {isDragSess && (
                      <span className="text-cyan-400 text-[10px]">{s.volumeM3!.toFixed(1)} m³</span>
                    )}
                    {!isDragSess && s.surfaceCoveredM2 > 0 && (
                      <span className="text-green-400 text-[10px]">
                        {s.surfaceCoveredM2 >= 10000
                          ? `${(s.surfaceCoveredM2 / 10000).toFixed(2)} ha`
                          : `${Math.round(s.surfaceCoveredM2)} m²`}
                      </span>
                    )}
                    {incidentMin > 0 && (
                      <span className="flex items-center gap-0.5 text-amber-400 text-[10px] ml-auto">
                        <AlertTriangle size={9} />
                        {incidentMin} min
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
        </div>
      )}

      {/* Empty state */}
      {sessions.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-slate-600 text-sm py-12">
          Aucune session enregistrée
        </div>
      )}
    </div>
  );
}
