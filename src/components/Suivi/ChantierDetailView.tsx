import { useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, AlertTriangle, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { SuiviSession } from '../../types/suivi';
import type { Chantier } from '../../types';
import { formatDuration, formatArea, smoothPoints, centroid } from '../../lib/geo';
import { INCIDENT_LABELS, INCIDENT_COLORS, HIST_PALETTE, GlobalTimeline, SessionTimeline } from './incidentUtils';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function FitAll({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    // Defer fitBounds so the browser has fully painted the container
    // before Leaflet computes its pixel dimensions.
    const tid = setTimeout(() => {
      map.invalidateSize();
      if (positions.length >= 2) {
        map.fitBounds(L.latLngBounds(positions), { padding: [28, 28], animate: false });
      }
    }, 80);
    return () => clearTimeout(tid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

interface Props {
  chantier:    Chantier;
  sessions:    SuiviSession[];
  isDragage:   boolean;
  salarieName?: string;
  onClose:     () => void;
}

export default function ChantierDetailView({ chantier, sessions, isDragage, salarieName = 'Hugo', onClose }: Props) {
  const ordered = useMemo(
    () => [...sessions].sort((a, b) => new Date(a.dateDebut).getTime() - new Date(b.dateDebut).getTime()),
    [sessions],
  );

  // Cumul stats
  const totalVolumeM3    = sessions.reduce((a, s) => a + (s.volumeM3 ?? 0), 0);
  const totalMinutes     = sessions.reduce((a, s) => a + s.dureeMinutes, 0);
  const totalSurfaceM2   = sessions.reduce((a, s) => a + s.surfaceCoveredM2, 0);
  const totalIncidentMin = sessions.reduce((a, s) => a + (s.incidents?.reduce((b, i) => b + i.dureeMinutes, 0) ?? 0), 0);
  const totalIncidentCnt = sessions.reduce((a, s) => a + (s.incidents?.length ?? 0), 0);
  const debits           = sessions.filter(s => (s.debitM3h ?? 0) > 0).map(s => s.debitM3h!);
  const avgDebitM3h      = debits.length > 0 ? debits.reduce((a, b) => a + b, 0) / debits.length : 0;
  const rendements       = sessions.filter(s => s.rendementM2h > 0).map(s => s.rendementM2h);
  const avgRendM2h       = rendements.length > 0 ? rendements.reduce((a, b) => a + b, 0) / rendements.length : 0;

  // Hours-budget progress
  const totalH          = totalMinutes / 60;
  const budgetH         = chantier.dureeEstimeeH ?? 0;
  const budgetPct       = budgetH > 0 ? Math.min(100, (totalH / budgetH) * 100) : null;
  const remainingH      = budgetH > 0 ? Math.max(0, budgetH - totalH) : null;

  // Map data
  const allPositions = useMemo(
    () => ordered.flatMap(s => s.gpsPoints.map(p => [p.lat, p.lng] as [number, number])),
    [ordered],
  );
  const trails = useMemo(() => ordered.map((s, i) => ({
    id:        s.id,
    color:     HIST_PALETTE[i % HIST_PALETTE.length],
    positions: smoothPoints(s.gpsPoints, 0.3).map(p => [p.lat, p.lng] as [number, number]),
    date:      s.dateDebut,
  })), [ordered]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (chantier.polygon && chantier.polygon.length > 0) {
      const all = chantier.polygon.flat();
      if (all.length > 0) { const c = centroid(all); return [c.lat, c.lng]; }
    }
    if (chantier.latitude && chantier.longitude) return [chantier.latitude, chantier.longitude];
    if (allPositions.length > 0) return allPositions[0];
    return [43.7, -0.26]; // fallback SW France
  }, [chantier, allPositions]);

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

        {/* Map — always shown; FitAll fits GPS traces when available, else zoom on mapCenter */}
        <div className="h-56 relative flex-shrink-0">
          <MapContainer center={mapCenter} zoom={16} className="w-full h-full" zoomControl={false} preferCanvas>
            <TileLayer
              url="https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
              attribution="&copy; IGN"
              maxZoom={20}
            />
            <FitAll positions={allPositions} />
            {chantier.polygon?.flatMap((poly, pi) =>
              poly.length >= 3 ? [
                <Polygon key={`zone-${pi}`}
                  positions={poly.map(p => [p.lat, p.lng] as [number, number])}
                  color="#64748b" fillColor="#64748b" fillOpacity={0.15} weight={2}
                />,
              ] : []
            )}
            {trails.map(t => t.positions.length > 1 && (
              <Polyline key={t.id} positions={t.positions} color={t.color} weight={3.5} opacity={0.9} />
            ))}
          </MapContainer>
          {/* Session color legend */}
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
                <span className="text-white text-xl font-bold tabular-nums">
                  {totalH.toFixed(1)} h
                </span>
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
                {remainingH! > 0 && (
                  <span className="text-slate-500">{remainingH!.toFixed(1)} h restantes</span>
                )}
                {remainingH === 0 && (
                  <span className="text-red-400 font-semibold">Budget atteint</span>
                )}
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

          {/* Sessions list */}
          <div>
            <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-2">Sessions</p>
            <div className="space-y-2">
              {ordered.map((s, i) => {
                const incMin = s.incidents?.reduce((a, inc) => a + inc.dureeMinutes, 0) ?? 0;
                const color  = HIST_PALETTE[i % HIST_PALETTE.length];
                return (
                  <div key={s.id} className="bg-white/[0.05] border border-white/[0.08] rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <p className="text-slate-300 text-xs font-semibold flex-1">
                        {format(new Date(s.dateDebut), 'dd MMM yyyy – HH:mm', { locale: fr })}
                      </p>
                      <p className="text-slate-500 text-[10px] flex-shrink-0">
                        {s.operateur === 'patron' ? 'Patron' : salarieName}
                      </p>
                    </div>
                    {isDragage ? (
                      <div className="grid grid-cols-4 gap-1">
                        <StatTile small label="Durée"  value={formatDuration(s.dureeMinutes)} />
                        <StatTile small label="Perdu"  value={incMin > 0 ? `${incMin} min` : '—'} accent={incMin > 0 ? 'amber' : undefined} />
                        <StatTile small label="Volume" value={s.volumeM3 != null && s.volumeM3 > 0 ? `${s.volumeM3.toFixed(1)} m³` : '—'} />
                        <StatTile small label="Rend."  value={s.debitM3h != null && s.debitM3h > 0 ? `${s.debitM3h.toFixed(1)} m³/h` : '—'} />
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-1">
                        <StatTile small label="Durée"   value={formatDuration(s.dureeMinutes)} />
                        <StatTile small label="Surface" value={formatArea(s.surfaceCoveredM2)} />
                        <StatTile small label="Rend."   value={`${Math.round(s.rendementM2h)} m²/h`} />
                        <StatTile small label="Vit."    value={s.vitesseMoyenneKmh > 0 ? `${s.vitesseMoyenneKmh.toFixed(1)} km/h` : '—'} />
                      </div>
                    )}
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
