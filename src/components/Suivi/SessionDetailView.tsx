import { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { SuiviSession } from '../../types/suivi';
import type { Chantier } from '../../types';
import type { ChantierZone } from './SuiviMap';
import { formatArea, formatDistance, formatDuration, centroid } from '../../lib/geo';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function zoneLabel(nom: string, color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="
      transform:translateX(-50%);
      display:inline-block;
      background:${color}cc;
      color:#fff;font-size:10px;font-weight:700;
      padding:2px 6px;border-radius:4px;
      white-space:nowrap;pointer-events:none;
      text-shadow:0 1px 2px rgba(0,0,0,.5);
      border:1px solid rgba(255,255,255,.3);
    ">${nom}</div>`,
    iconSize: [0, 0], iconAnchor: [0, 8],
  });
}

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length < 2) return;
    const bounds = L.latLngBounds(positions);
    map.fitBounds(bounds, { padding: [32, 32], animate: false });
  }, [map, positions]);
  return null;
}

interface Props {
  session:       SuiviSession;
  chantier?:     Chantier;
  chantierCumul?: Record<string, { totalCoveredM2: number; sessionCount: number; totalMinutes: number; rendementSum: number; rendementCount: number }>;
  chantierZones: ChantierZone[];
  workColor:     string;
  onClose:       () => void;
}

export default function SessionDetailView({ session, chantier, chantierCumul, chantierZones, workColor, onClose }: Props) {
  const trail = session.gpsPoints.map(p => [p.lat, p.lng] as [number, number]);
  const center: [number, number] = trail.length > 0
    ? trail[Math.floor(trail.length / 2)]
    : [50.4, 2.8];

  // Compute session-specific stats
  const surface       = chantier?.surface ?? 0;
  const cumul         = chantierCumul?.[session.chantierId];
  const thisPct       = surface > 0 && session.surfaceCoveredM2 > 0
    ? Math.min(100, Math.round((session.surfaceCoveredM2 / surface) * 100)) : null;
  const cumulPct      = surface > 0 && cumul
    ? Math.min(100, Math.round((cumul.totalCoveredM2 / surface) * 100)) : null;
  const rendMoyen     = cumul && cumul.rendementCount > 0
    ? Math.round(cumul.rendementSum / cumul.rendementCount) : null;
  const dateFin       = session.dateFin ? new Date(session.dateFin) : null;
  const gpsCount      = session.gpsPoints.length;

  const startMarker = trail.length > 0
    ? L.divIcon({
        className: '',
        html: `<div style="width:12px;height:12px;border-radius:50%;background:#22c55e;border:2px solid white;box-shadow:0 0 0 3px rgba(34,197,94,.4);"></div>`,
        iconSize: [12, 12], iconAnchor: [6, 6],
      })
    : null;
  const endMarker = trail.length > 1
    ? L.divIcon({
        className: '',
        html: `<div style="width:12px;height:12px;border-radius:50%;background:#ef4444;border:2px solid white;box-shadow:0 0 0 3px rgba(239,68,68,.4);"></div>`,
        iconSize: [12, 12], iconAnchor: [6, 6],
      })
    : null;

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900 flex flex-col">

      {/* Top bar */}
      <div className="flex items-center gap-3 px-3 py-2 bg-slate-900 border-b border-slate-800 flex-shrink-0">
        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white flex-shrink-0">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold truncate">{session.chantierNom}</p>
          <p className="text-slate-400 text-[10px]">
            {format(new Date(session.dateDebut), 'dd MMM yyyy – HH:mm', { locale: fr })}
            {' · '}{session.operateur === 'patron' ? 'Patron' : 'Salarié'}
          </p>
        </div>
        {session.pendingSync && (
          <span className="flex-shrink-0 text-[10px] px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded-full">
            Non synchronisé
          </span>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 relative overflow-hidden">
        {trail.length >= 2 ? (
          <MapContainer
            center={center}
            zoom={16}
            className="w-full h-full"
            zoomControl={false}
            preferCanvas={true}
          >
            <TileLayer
              url="https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
              attribution='&copy; <a href="https://www.ign.fr">IGN</a>'
              maxZoom={20}
            />

            <FitBounds positions={trail} />

            {/* Chantier zones */}
            {chantierZones.flatMap(z => {
              const validPolygons = z.polygons.filter(p => p.length >= 3);
              if (validPolygons.length === 0) return [];
              const allPoints = validPolygons.flat();
              const c = centroid(allPoints);
              return [
                ...validPolygons.map((poly, pi) => (
                  <Polygon
                    key={`zone-${z.id}-${pi}`}
                    positions={poly.map(p => [p.lat, p.lng] as [number, number])}
                    color={z.color}
                    fillColor={z.color}
                    fillOpacity={0.18}
                    weight={2}
                  />
                )),
                <Marker key={`label-${z.id}`} position={[c.lat, c.lng]} icon={zoneLabel(z.nom, z.color)} />,
              ];
            })}

            {/* GPS trail */}
            <Polyline positions={trail} color={workColor} weight={4} opacity={0.9} />

            {/* Start / end markers */}
            {startMarker && <Marker position={trail[0]} icon={startMarker} />}
            {endMarker && <Marker position={trail[trail.length - 1]} icon={endMarker} />}
          </MapContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            Pas de tracé GPS pour cette session
          </div>
        )}
      </div>

      {/* Metrics panel */}
      <div className="flex-shrink-0 bg-slate-900 border-t border-slate-800 px-2 py-3">

        {/* Primary metrics */}
        <div className="grid grid-cols-4 gap-1 mb-2">
          <StatCard label="Durée"     value={formatDuration(session.dureeMinutes)} />
          <StatCard label="Surface"   value={formatArea(session.surfaceCoveredM2)} />
          <StatCard label="Distance"  value={formatDistance(session.distanceM)} />
          <StatCard label="Rendement" value={`${Math.round(session.rendementM2h).toLocaleString('fr-FR')} m²/h`} />
        </div>

        {/* Secondary metrics */}
        <div className="grid grid-cols-4 gap-1 mb-2">
          {session.vitesseMoyenneKmh > 0 && (
            <StatCard label="Vit. moy." value={`${session.vitesseMoyenneKmh.toFixed(1)} km/h`} />
          )}
          {thisPct != null && (
            <StatCard label="% cette sess." value={`${thisPct} %`} />
          )}
          {cumulPct != null && (
            <StatCard label="% chantier" value={`${cumulPct} %`} />
          )}
          {cumul && cumul.sessionCount > 1 && (
            <StatCard label="Sessions" value={`${cumul.sessionCount}`} />
          )}
          {rendMoyen != null && (
            <StatCard label="Rend. moy." value={`${rendMoyen.toLocaleString('fr-FR')} m²/h`} />
          )}
          {gpsCount > 0 && (
            <StatCard label="Points GPS" value={`${gpsCount}`} />
          )}
        </div>

        {/* Chantier progress bar */}
        {cumulPct != null && (
          <div className="mb-2">
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  cumulPct >= 80 ? 'bg-green-500' : cumulPct >= 40 ? 'bg-amber-400' : 'bg-orange-500'
                }`}
                style={{ width: `${cumulPct}%` }}
              />
            </div>
            <p className="text-slate-500 text-[10px] mt-1 text-center">
              {cumulPct}% du chantier effectué au total
              {surface > 0 && cumul && cumul.totalCoveredM2 < surface && (
                <span> · {formatArea(Math.max(0, surface - cumul.totalCoveredM2))} restants</span>
              )}
            </p>
          </div>
        )}

        {/* Timestamps */}
        <div className="flex items-center justify-between text-[10px] text-slate-600">
          <span>Début : {format(new Date(session.dateDebut), 'HH:mm', { locale: fr })}</span>
          {dateFin && <span>Fin : {format(dateFin, 'HH:mm', { locale: fr })}</span>}
          <span>{session.operateur === 'patron' ? 'Patron' : 'Salarié'}</span>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-800 rounded-xl px-2 py-2 text-center">
      <p className="text-white text-sm font-bold tabular-nums leading-tight">{value}</p>
      <p className="text-slate-500 text-[10px] uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}
