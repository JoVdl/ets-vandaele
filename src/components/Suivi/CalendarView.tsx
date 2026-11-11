import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Clock, AlertTriangle } from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isSameDay, isToday, startOfWeek, addDays,
} from 'date-fns';
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

const JOURS_COURT = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
const JOURS_LONG  = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

type ViewMode = 'month' | 'week';

export default function CalendarView({ sessions, chantiers, salarieName = 'Hugo', onSessionClick }: Props) {
  const [cursor, setCursor] = useState(() => {
    const last = [...sessions].sort((a, b) =>
      new Date(b.dateDebut).getTime() - new Date(a.dateDebut).getTime())[0];
    return last ? new Date(last.dateDebut) : new Date();
  });
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('week');

  // Stable color per chantier
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

  function chantierName(id: string) {
    return chantiers.find(c => c.id === id)?.nom ?? id;
  }

  function prevPeriod() {
    setCursor(d => {
      const n = new Date(d);
      if (viewMode === 'week') n.setDate(n.getDate() - 7);
      else n.setMonth(n.getMonth() - 1);
      return n;
    });
    setSelectedDay(null);
  }
  function nextPeriod() {
    setCursor(d => {
      const n = new Date(d);
      if (viewMode === 'week') n.setDate(n.getDate() + 7);
      else n.setMonth(n.getMonth() + 1);
      return n;
    });
    setSelectedDay(null);
  }

  const selectedKey      = selectedDay ? format(selectedDay, 'yyyy-MM-dd') : null;
  const selectedSessions = selectedKey ? (byDay.get(selectedKey) ?? []) : [];

  // ── Week view data ───────────────────────────────────────────────────────────
  const weekStart = startOfWeek(cursor, { weekStartsOn: 1 });
  const weekDays  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const weekMinutesPerDay = useMemo(() => weekDays.map(d => {
    const key = format(d, 'yyyy-MM-dd');
    return (byDay.get(key) ?? []).reduce((a, s) => a + s.dureeMinutes, 0);
  }), [weekDays, byDay]);

  const maxWeekMinutes = Math.max(...weekMinutesPerDay, 1); // avoid div/0

  // ── Month view data ──────────────────────────────────────────────────────────
  const monthStart  = startOfMonth(cursor);
  const monthEnd    = endOfMonth(cursor);
  const monthDays   = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startOffset = (getDay(monthStart) + 6) % 7; // Monday-first

  // Nav label
  const navLabel = viewMode === 'week'
    ? (() => {
        const we = addDays(weekStart, 6);
        const startFmt = format(weekStart, 'd', { locale: fr });
        const endFmt   = startFmt === format(we, 'd', { locale: fr })
          ? format(we, 'd MMM', { locale: fr })
          : format(we, 'd MMM', { locale: fr });
        const monthSame = weekStart.getMonth() === we.getMonth();
        return monthSame
          ? `${startFmt} – ${endFmt} ${format(we, 'yyyy')}`
          : `${format(weekStart, 'd MMM', { locale: fr })} – ${endFmt} ${format(we, 'yyyy')}`;
      })()
    : format(cursor, 'MMMM yyyy', { locale: fr });

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">

      {/* Nav bar */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.07] flex-shrink-0">
        <button onClick={prevPeriod}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors">
          <ChevronLeft size={18} />
        </button>
        <span className="flex-1 text-center text-white font-bold text-sm capitalize">{navLabel}</span>
        <button onClick={nextPeriod}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors">
          <ChevronRight size={18} />
        </button>

        {/* View toggle */}
        <div className="flex items-center bg-white/[0.07] rounded-lg p-0.5 ml-1">
          {(['week', 'month'] as ViewMode[]).map(m => (
            <button key={m}
              onClick={() => { setViewMode(m); setSelectedDay(null); }}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                viewMode === m ? 'bg-white/[0.15] text-white' : 'text-slate-500 hover:text-slate-300'
              }`}>
              {m === 'week' ? 'Sem.' : 'Mois'}
            </button>
          ))}
        </div>
      </div>

      {/* ── WEEK VIEW ─────────────────────────────────────────────────────────── */}
      {viewMode === 'week' && (
        <div className="px-2 pt-3 pb-2">
          <div className="grid grid-cols-7 gap-1">
            {weekDays.map((day, idx) => {
              const key         = format(day, 'yyyy-MM-dd');
              const daySessions = byDay.get(key) ?? [];
              const dayMinutes  = weekMinutesPerDay[idx];
              const isActive    = dayMinutes > 0;
              const isSel       = selectedDay ? isSameDay(day, selectedDay) : false;
              const isNow       = isToday(day);
              const isWeekend   = idx >= 5;

              const dotColors = [...new Set(daySessions.map(s => s.chantierId))]
                .slice(0, 3)
                .map(id => chantierColor.get(id) ?? '#64748b');
              const barColor = dotColors[0] ?? '#38bdf8';

              // Bar height: 4px min when active, up to 48px
              const barH = isActive ? Math.max(4, Math.round((dayMinutes / maxWeekMinutes) * 48)) : 0;

              return (
                <button
                  key={key}
                  onClick={() => setSelectedDay(isSel ? null : day)}
                  disabled={!isActive}
                  className={`flex flex-col items-center rounded-2xl py-2.5 px-1 transition-all ${
                    isSel
                      ? 'bg-white/[0.12] border border-white/[0.18]'
                      : isActive
                        ? 'hover:bg-white/[0.07] active:scale-95'
                        : ''
                  }`}
                >
                  {/* Day abbrev */}
                  <span className={`text-[9px] font-semibold uppercase tracking-wide mb-0.5 ${
                    isWeekend ? 'text-slate-600' : 'text-slate-500'
                  }`}>{JOURS_LONG[idx]}</span>

                  {/* Day number */}
                  <span className={`text-sm font-bold leading-none mb-2 ${
                    isNow    ? 'text-green-400'
                    : isSel  ? 'text-white'
                    : isActive ? 'text-white'
                    : isWeekend ? 'text-slate-700'
                    : 'text-slate-600'
                  }`}>{day.getDate()}</span>

                  {/* Bar chart area — fixed 48px height, bar grows from bottom */}
                  <div className="w-full flex items-end justify-center" style={{ height: 48 }}>
                    {barH > 0 && (
                      <div
                        className="w-5 rounded-t-md"
                        style={{
                          height: barH,
                          backgroundColor: isSel ? '#fff' : barColor,
                          opacity: isSel ? 0.9 : 0.75,
                        }}
                      />
                    )}
                  </div>

                  {/* Hours worked */}
                  <span className={`text-[9px] font-bold tabular-nums mt-1 leading-none ${
                    isActive ? (isSel ? 'text-white' : 'text-slate-300') : 'text-transparent'
                  }`}>
                    {isActive ? formatDuration(dayMinutes) : '·'}
                  </span>

                  {/* Chantier dots */}
                  <div className="flex gap-0.5 mt-1.5 min-h-[6px]">
                    {dotColors.map((c, i) => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: isSel ? '#fff' : c }} />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Week totals row */}
          {weekMinutesPerDay.some(m => m > 0) && (
            <div className="mt-2 mx-1 bg-white/[0.04] rounded-xl px-3 py-2 flex items-center justify-between">
              <span className="text-slate-500 text-[10px]">Total semaine</span>
              <span className="text-white text-xs font-bold tabular-nums">
                {formatDuration(weekMinutesPerDay.reduce((a, b) => a + b, 0))}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── MONTH VIEW ────────────────────────────────────────────────────────── */}
      {viewMode === 'month' && (
        <div className="px-2 pt-2 pb-1">
          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {JOURS_COURT.map(j => (
              <div key={j} className="text-center text-slate-600 text-[10px] uppercase tracking-wide py-1">{j}</div>
            ))}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7 gap-y-1">
            {Array.from({ length: startOffset }).map((_, i) => <div key={`e${i}`} />)}

            {monthDays.map(day => {
              const key      = format(day, 'yyyy-MM-dd');
              const daySess  = byDay.get(key) ?? [];
              const dayMins  = daySess.reduce((a, s) => a + s.dureeMinutes, 0);
              const isActive = daySess.length > 0;
              const isSel    = selectedDay ? isSameDay(day, selectedDay) : false;
              const isNow    = isToday(day);

              const dotColors = [...new Set(daySess.map(s => s.chantierId))]
                .slice(0, 3)
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
                  <span className={`text-xs font-medium leading-none mb-0.5 ${
                    isNow    ? 'text-green-400 font-bold'
                    : isSel  ? 'text-white'
                    : isActive ? 'text-slate-200'
                    : 'text-slate-700'
                  }`}>{day.getDate()}</span>

                  {/* Hours worked below date */}
                  {dayMins > 0 && (
                    <span className={`text-[8px] font-bold tabular-nums leading-none mb-0.5 ${isSel ? 'text-white' : 'text-slate-400'}`}>
                      {formatDuration(dayMins)}
                    </span>
                  )}

                  {/* Chantier dots */}
                  {dotColors.length > 0 && (
                    <div className="flex gap-0.5 flex-wrap justify-center">
                      {dotColors.map((c, i) => (
                        <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: isSel ? '#fff' : c }} />
                      ))}
                    </div>
                  )}

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
      )}

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
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-slate-400 text-[10px] uppercase tracking-wide capitalize">
              {format(selectedDay, 'EEEE d MMMM', { locale: fr })}
            </p>
            <p className="text-slate-500 text-[10px]">
              {selectedSessions.length} session{selectedSessions.length > 1 ? 's' : ''} · {formatDuration(selectedSessions.reduce((a, s) => a + s.dureeMinutes, 0))}
            </p>
          </div>
          {selectedSessions
            .sort((a, b) => new Date(a.dateDebut).getTime() - new Date(b.dateDebut).getTime())
            .map(s => {
              const color       = chantierColor.get(s.chantierId) ?? '#64748b';
              const incidentMin = s.incidents?.reduce((a, i) => a + i.dureeMinutes, 0) ?? 0;
              const isDragSess  = (s.volumeM3 ?? 0) > 0;
              return (
                <button
                  key={s.id}
                  onClick={() => onSessionClick(s)}
                  className="w-full text-left bg-white/[0.05] hover:bg-white/[0.09] active:scale-[0.99] transition-all rounded-2xl p-3 border border-white/[0.07]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-white font-semibold text-xs flex-1 truncate">{chantierName(s.chantierId)}</span>
                    <span className="text-slate-500 text-[10px] flex-shrink-0">
                      {s.operateur === 'patron' ? 'Patron' : salarieName}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1 text-slate-400 text-[10px]">
                      <Clock size={10} />
                      {format(new Date(s.dateDebut), 'HH:mm')}
                      {s.dateFin && ` → ${format(new Date(s.dateFin), 'HH:mm')}`}
                    </div>
                    <span className="text-slate-300 text-[10px] font-bold tabular-nums">
                      {formatDuration(s.dureeMinutes)}
                    </span>
                    {isDragSess && (
                      <span className="text-cyan-400 text-[10px] tabular-nums">{s.volumeM3!.toFixed(1)} m³</span>
                    )}
                    {!isDragSess && s.surfaceCoveredM2 > 0 && (
                      <span className="text-green-400 text-[10px] tabular-nums">
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

      {sessions.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-slate-600 text-sm py-12">
          Aucune session enregistrée
        </div>
      )}
    </div>
  );
}
