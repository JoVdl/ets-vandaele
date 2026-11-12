import { useMemo, useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, AlertTriangle, Clock, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { SuiviSession } from '../../types/suivi';
import type { Chantier } from '../../types';
import { formatDuration, formatArea, smoothPoints, centroid, filterGpsTrack } from '../../lib/geo';
import type { AlignedRect } from '../../lib/alignedVolumes';
import { INCIDENT_LABELS, INCIDENT_COLORS, HIST_PALETTE, GlobalTimeline, SessionTimeline } from './incidentUtils';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function FitAll({ positions, fallback }: { positions: [number, number][]; fallback: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    const tid = setTimeout(() => {
      map.invalidateSize();
      if (positions.length >= 2) {
        map.fitBounds(L.latLngBounds(positions), { padding: [28, 28], animate: false });
      } else {
        map.setView(fallback, 16, { animate: false });
      }
    }, 150);
    return () => clearTimeout(tid);
  }, [map, positions, fallback]);
  return null;
}

interface Props {
  chantier:        Chantier;
  sessions:        SuiviSession[];
  isDragage:       boolean;
  volumeOf:        (s: SuiviSession) => number;
  rectOf:          (s: SuiviSession) => AlignedRect | undefined;
  machineWidthM:   number;
  salarieName?:    string;
  onClose:         () => void;
  onSessionClick?: (session: SuiviSession) => void;
}

export default function ChantierDetailView({ chantier, sessions, isDragage, volumeOf, rectOf, machineWidthM, salarieName = 'Hugo', onClose, onSessionClick }: Props) {
  const ordered = useMemo(
    () => [...sessions].sort((a, b) => new Date(a.dateDebut).getTime() - new Date(b.dateDebut).getTime()),
    [sessions],
  );

  const advanceM = (s: SuiviSession) => rectOf(s)?.lengthM ?? 0;

  // Cumul stats
  const totalVolumeM3    = sessions.reduce((a, s) => a + volumeOf(s), 0);
  const totalMinutes     = sessions.reduce((a, s) => a + s.dureeMinutes, 0);
  const totalSurfaceM2   = sessions.reduce((a, s) => a + s.surfaceCoveredM2, 0);
  const totalIncidentMin = sessions.reduce((a, s) => a + (s.incidents?.reduce((b, i) => b + i.dureeMinutes, 0) ?? 0), 0);
  const totalIncidentCnt = sessions.reduce((a, s) => a + (s.incidents?.length ?? 0), 0);

  const netDebits = sessions
    .filter(s => volumeOf(s) > 0)
    .map(s => {
      const incMin = s.incidents?.reduce((b, i) => b + i.dureeMinutes, 0) ?? 0;
      const netH = Math.max(0, s.dureeMinutes - incMin) / 60;
      return netH > 0 ? volumeOf(s) / netH : 0;
    })
    .filter(d => d > 0);
  const avgDebitM3h = netDebits.length > 0 ? netDebits.reduce((a, b) => a + b, 0) / netDebits.length : 0;

  const netRendements = sessions
    .filter(s => s.surfaceCoveredM2 > 0)
    .map(s => {
      const incMin = s.incidents?.reduce((b, i) => b + i.dureeMinutes, 0) ?? 0;
      const netH = Math.max(0, s.dureeMinutes - incMin) / 60;
      return netH > 0 ? s.surfaceCoveredM2 / netH : 0;
    })
    .filter(r => r > 0);
  const avgRendM2h = netRendements.length > 0 ? netRendements.reduce((a, b) => a + b, 0) / netRendements.length : 0;

  const totalH     = totalMinutes / 60;
  const budgetH    = chantier.dureeEstimeeH ?? 0;
  const budgetPct  = budgetH > 0 ? Math.min(100, (totalH / budgetH) * 100) : null;
  const remainingH = budgetH > 0 ? Math.max(0, budgetH - totalH) : null;

  const trails = useMemo(() => ordered.map((s, i) => {
    const filtered = filterGpsTrack(
      s.gpsPoints,
      isDragage ? 3 : 25,
      isDragage ? 1.6 : 2.0,
      isDragage ? 150 : Infinity,
    );
    const smoothed = smoothPoints(filtered, 0.3);
    const rect = rectOf(s);
    return {
      id:            s.id,
      color:         HIST_PALETTE[i % HIST_PALETTE.length],
      positions:     smoothed.map(p => [p.lat, p.lng] as [number, number]),
      hullPositions: rect?.polygon ?? [],
      hullArea:      rect?.areaM2 ?? 0,
      date:          s.dateDebut,
    };
  }), [ordered, isDragage, rectOf]);

  const allPositions = useMemo(() => trails.flatMap(t => t.positions), [trails]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (chantier.polygon && chantier.polygon.length > 0) {
      const all = chantier.polygon.flat();
      if (all.length > 0) { const c = centroid(all); return [c.lat, c.lng]; }
    }
    if (chantier.latitude && chantier.longitude) return [chantier.latitude, chantier.longitude];
    if (allPositions.length > 0) return allPositions[0];
    return [43.7, -0.26];
  }, [chantier, allPositions]);

  // Assign stable color index per session (preserves map legend matching)
  const sessionColorMap = useMemo(() => {
    const m = new Map<string, number>();
    ordered.forEach((s, i) => m.set(s.id, i));
    return m;
  }, [ordered]);

  // Group sessions by calendar day
  const byDay = useMemo(() => {
    const map = new Map<string, SuiviSession[]>();
    for (const s of ordered) {
      const key = s.dateDebut.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [ordered]);

  const dayKeys = useMemo(() => [...byDay.keys()].sort(), [byDay]);

  // Default: last day expanded
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => {
    const sortedKeys = [...sessions]
      .sort((a, b) => new Date(a.dateDebut).getTime() - new Date(b.dateDebut).getTime())
      .map(s => s.dateDebut.slice(0, 10));
    const last = sortedKeys[sortedKeys.length - 1];
    return last ? new Set([last]) : new Set();
  });

  function toggleDay(key: string) {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-[300] bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-white/[0.07] flex-shrink-0">
        <button onClick={onClose} className="p-1.5 -ml-1 text-slate-400 hover:text-white active:scale-95 transition-all">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm truncate">{chantier.nom}</p>
          {chantier.lieu && <p className="text-slate-500 text-[10px]">{chantier.lieu}</p>}
        </div>
        {isDragage && (
          <span className="px-1.5 py-0.5 rounded-full bg-cyan-900 text-cyan-300 text-[9px] font-semibold uppercase tracking-wide flex-shrink-0">Drague</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* Map */}
        <div className="h-56 relative flex-shrink-0">
          <MapContainer center={mapCenter} zoom={16} className="w-full h-full" zoomControl={false} preferCanvas>
            <TileLayer
              url="https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
              attribution="&copy; IGN"
              maxZoom={20}
            />
            <FitAll positions={allPositions} fallback={mapCenter} />
            {chantier.polygon?.flatMap((poly, pi) =>
              poly.length >= 3 ? [
                <Polygon key={`zone-${pi}`}
                  positions={poly.map(p => [p.lat, p.lng] as [number, number])}
                  color="#64748b" fillColor="#64748b" fillOpacity={0.15} weight={2}
                />,
              ] : []
            )}
            {trails.map(t => [
              t.positions.length > 1 && (
                <Polyline key={`line-${t.id}`} positions={t.positions} color={t.color} weight={3.5} opacity={0.9} />
              ),
              t.hullPositions.length >= 3 && (
                <Polygon key={`hull-${t.id}`}
                  positions={t.hullPositions}
                  color={t.color}
                  fillColor={t.color}
                  fillOpacity={0.10}
                  weight={1.5}
                  opacity={0.70}
                  dashArray="6 4"
                >
                  {t.hullArea > 0 && (
                    <Tooltip permanent direction="center" className="bg-transparent border-0 shadow-none">
                      <span className="text-[9px] font-semibold opacity-80" style={{ color: t.color }}>
                        {t.hullArea >= 10000
                          ? `${(t.hullArea / 10000).toFixed(2)} ha`
                          : `${Math.round(t.hullArea)} m²`}
                      </span>
                    </Tooltip>
                  )}
                </Polygon>
              ),
            ])}
          </MapContainer>
          {trails.length > 0 && (
            <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-sm rounded-lg px-2 py-1.5 flex flex-col gap-1 max-h-32 overflow-y-auto z-[1000]">
              {trails.map((t) => (
                <span key={t.id} className="flex items-center gap-1.5 text-[9px] text-white whitespace-nowrap">
                  <span className="w-3 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                  {format(new Date(t.date), 'dd MMM', { locale: fr })}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="px-3 py-3 space-y-4">

          {/* Hours budget progress */}
          {budgetH > 0 && (
            <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={13} className="text-slate-400 flex-shrink-0" />
                <p className="text-slate-400 text-xs font-semibold">Avancement — heures</p>
              </div>
              <div className="flex items-end justify-between mb-1.5">
                <span className="text-white text-xl font-bold tabular-nums">{totalH.toFixed(1)} h</span>
                <span className="text-slate-500 text-xs">/ {budgetH} h vendues</span>
              </div>
              <div className="h-3 bg-slate-800 rounded-full overflow-hidden mb-1.5">
                <div
                  className={`h-full rounded-full transition-all ${
                    budgetPct! >= 90 ? 'bg-red-500' : budgetPct! >= 70 ? 'bg-amber-400' : 'bg-green-500'
                  }`}
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px]">
                <span className={budgetPct! >= 90 ? 'text-red-400' : budgetPct! >= 70 ? 'text-amber-400' : 'text-green-400'}>
                  {budgetPct!.toFixed(0)} %
                </span>
                {remainingH! > 0 && <span className="text-slate-500">{remainingH!.toFixed(1)} h restantes</span>}
                {remainingH === 0 && <span className="text-red-400 font-semibold">Budget atteint</span>}
              </div>
            </div>
          )}

          {/* Global cumul */}
          <div>
            <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-2">
              Cumul total — {sessions.length} session{sessions.length > 1 ? 's' : ''}
            </p>
            <div className={`grid gap-1 mb-2 ${isDragage ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <StatTile label="Durée tot."  value={formatDuration(totalMinutes)} />
              {isDragage ? (
                <>
                  <StatTile label="Volume tot." value={`${totalVolumeM3.toFixed(1)} m³`} />
                  <StatTile label="Rend. moy."  value={avgDebitM3h > 0 ? `${avgDebitM3h.toFixed(1)} m³/h` : '—'} />
                  <StatTile label="Incidents"   value={totalIncidentCnt > 0 ? `${totalIncidentCnt}` : '—'} accent={totalIncidentCnt > 0 ? 'amber' : undefined} />
                </>
              ) : (
                <>
                  <StatTile label="Surface tot." value={formatArea(totalSurfaceM2)} />
                  <StatTile label="Rend. moy."   value={avgRendM2h > 0 ? `${Math.round(avgRendM2h).toLocaleString('fr-FR')} m²/h` : '—'} />
                </>
              )}
            </div>
            {isDragage && totalIncidentMin > 0 && (
              <div className="flex items-center gap-1.5 mb-2">
                <AlertTriangle size={11} className="text-amber-400 flex-shrink-0" />
                <span className="text-amber-400 text-[10px]">
                  {totalIncidentCnt} incident{totalIncidentCnt > 1 ? 's' : ''} · {totalIncidentMin} min perdues
                </span>
              </div>
            )}
            {isDragage && ordered.length > 0 && <GlobalTimeline sessions={ordered} />}
          </div>

          {/* Sessions grouped by day */}
          <div>
            <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-2">
              Sessions — {dayKeys.length} jour{dayKeys.length > 1 ? 's' : ''}
            </p>

            <div className="space-y-2">
              {dayKeys.map(dayKey => {
                const daySessions   = byDay.get(dayKey)!;
                const dayTotal      = daySessions.reduce((a, s) => a + s.dureeMinutes, 0);
                const dayIncidents  = daySessions.reduce((a, s) => a + (s.incidents?.length ?? 0), 0);
                const dayIncMin     = daySessions.reduce((a, s) => a + (s.incidents?.reduce((b, i) => b + i.dureeMinutes, 0) ?? 0), 0);
                const dayVolume     = daySessions.reduce((a, s) => a + volumeOf(s), 0);
                const dayAdvance    = daySessions.reduce((a, s) => a + advanceM(s), 0);
                const daySurface    = daySessions.reduce((a, s) => a + s.surfaceCoveredM2, 0);
                const isExpanded    = expandedDays.has(dayKey);

                return (
                  <div key={dayKey} className="bg-white/[0.05] border border-white/[0.08] rounded-2xl overflow-hidden">
                    {/* Day header — always visible */}
                    <button
                      onClick={() => toggleDay(dayKey)}
                      className="w-full flex items-center gap-3 px-3 py-3 hover:bg-white/[0.04] active:bg-white/[0.07] transition-colors text-left"
                    >
                      {/* Date */}
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs font-bold capitalize">
                          {format(new Date(dayKey), 'EEEE d MMMM', { locale: fr })}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {/* Time range: start of first session → end of last session */}
                          <span className="text-slate-400 text-[10px] tabular-nums">
                            {format(new Date(daySessions[0].dateDebut), 'HH:mm')}
                            {' → '}
                            {daySessions[daySessions.length - 1].dateFin
                              ? format(new Date(daySessions[daySessions.length - 1].dateFin!), 'HH:mm')
                              : '—'}
                          </span>
                          <span className="text-slate-600 text-[10px]">·</span>
                          <span className="text-slate-500 text-[10px]">
                            {daySessions.length} session{daySessions.length > 1 ? 's' : ''}
                          </span>
                          {dayIncidents > 0 && (
                            <span className="flex items-center gap-0.5 text-amber-400 text-[10px]">
                              <AlertTriangle size={9} />
                              {dayIncidents} incident{dayIncidents > 1 ? 's' : ''} · {dayIncMin} min
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Daily stats */}
                      <div className="text-right flex-shrink-0">
                        <p className="text-white text-sm font-bold tabular-nums">{formatDuration(dayTotal)}</p>
                        {isDragage && dayVolume > 0 && (
                          <p className="text-cyan-400 text-[10px] tabular-nums">{dayVolume.toFixed(1)} m³</p>
                        )}
                        {isDragage && dayAdvance > 0 && (
                          <p className="text-slate-400 text-[10px] tabular-nums">larg. {machineWidthM.toFixed(1)} m · avance {dayAdvance.toFixed(0)} m</p>
                        )}
                        {!isDragage && daySurface > 0 && (
                          <p className="text-green-400 text-[10px] tabular-nums">{formatArea(daySurface)}</p>
                        )}
                      </div>

                      <ChevronDown
                        size={15}
                        className={`text-slate-500 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {/* Expanded: individual sessions */}
                    {isExpanded && (
                      <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
                        {daySessions.map((s) => {
                          const colorIdx     = sessionColorMap.get(s.id) ?? 0;
                          const color        = HIST_PALETTE[colorIdx % HIST_PALETTE.length];
                          const incMin       = s.incidents?.reduce((a, inc) => a + inc.dureeMinutes, 0) ?? 0;
                          const netH         = Math.max(0, s.dureeMinutes - incMin) / 60;
                          const netDebit     = netH > 0 && volumeOf(s) > 0 ? volumeOf(s) / netH : 0;
                          const netRendement = netH > 0 && s.surfaceCoveredM2 > 0 ? s.surfaceCoveredM2 / netH : 0;

                          return (
                            <div
                              key={s.id}
                              className={`px-3 py-3 ${onSessionClick ? 'cursor-pointer hover:bg-white/[0.04] active:bg-white/[0.07] transition-colors' : ''}`}
                              onClick={onSessionClick ? () => onSessionClick(s) : undefined}
                              role={onSessionClick ? 'button' : undefined}
                            >
                              {/* Session header */}
                              <div className="flex items-center gap-2 mb-2">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                                <p className="text-slate-300 text-xs font-semibold flex-1">
                                  {format(new Date(s.dateDebut), 'HH:mm', { locale: fr })}
                                  {s.dateFin && ` → ${format(new Date(s.dateFin), 'HH:mm', { locale: fr })}`}
                                </p>
                                <p className="text-slate-500 text-[10px] flex-shrink-0">
                                  {s.operateur === 'patron' ? 'Patron' : salarieName}
                                </p>
                                {onSessionClick && <span className="text-slate-600 text-[10px]">›</span>}
                              </div>

                              {/* Stats */}
                              {isDragage ? (
                                <div className="grid grid-cols-4 gap-1">
                                  <StatTile small label="Durée"  value={formatDuration(s.dureeMinutes)} />
                                  <StatTile small label="Perdu"  value={incMin > 0 ? `${incMin} min` : '—'} accent={incMin > 0 ? 'amber' : undefined} />
                                  <StatTile small label="Volume" value={volumeOf(s) > 0 ? `${volumeOf(s).toFixed(1)} m³` : '—'} />
                                  <StatTile small label="Rend."  value={netDebit > 0 ? `${netDebit.toFixed(1)} m³/h` : '—'} />
                                  <StatTile small label="Largeur" value={`${machineWidthM.toFixed(1)} m`} />
                                  <StatTile small label="Avancement" value={advanceM(s) > 0 ? `${advanceM(s).toFixed(0)} m` : '—'} />
                                </div>
                              ) : (
                                <div className="grid grid-cols-4 gap-1">
                                  <StatTile small label="Durée"   value={formatDuration(s.dureeMinutes)} />
                                  <StatTile small label="Surface" value={formatArea(s.surfaceCoveredM2)} />
                                  <StatTile small label="Rend."   value={netRendement > 0 ? `${Math.round(netRendement)} m²/h` : '—'} />
                                  <StatTile small label="Vit."    value={s.vitesseMoyenneKmh > 0 ? `${s.vitesseMoyenneKmh.toFixed(1)} km/h` : '—'} />
                                </div>
                              )}

                              {/* Incidents */}
                              {isDragage && s.incidents && s.incidents.length > 0 && (
                                <>
                                  <SessionTimeline session={s} />
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {s.incidents.map((inc, ii) => (
                                      <span key={ii}
                                        className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] border"
                                        style={{
                                          backgroundColor: INCIDENT_COLORS[inc.type] + '22',
                                          borderColor:     INCIDENT_COLORS[inc.type] + '55',
                                          color:           INCIDENT_COLORS[inc.type],
                                        }}>
                                        <AlertTriangle size={8} />
                                        {INCIDENT_LABELS[inc.type]} · {inc.dureeMinutes} min
                                      </span>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {ordered.length === 0 && (
                <p className="text-slate-600 text-xs text-center py-4">Aucune session enregistrée</p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, small, accent }: { label: string; value: string; small?: boolean; accent?: 'amber' }) {
  return (
    <div className="bg-white/[0.05] rounded-xl px-2 py-2 text-center">
      <p className={`font-bold tabular-nums leading-tight ${small ? 'text-xs' : 'text-sm'} ${accent === 'amber' ? 'text-amber-400' : 'text-white'}`}>
        {value}
      </p>
      <p className="text-slate-500 text-[10px] uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}
