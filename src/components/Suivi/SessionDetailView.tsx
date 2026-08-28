import { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, Printer } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { SuiviSession } from '../../types/suivi';
import type { Chantier } from '../../types';
import type { ChantierZone } from './SuiviMap';
import { formatArea, formatDistance, formatDuration, centroid } from '../../lib/geo';
import { CHANTIER_TYPES } from '../../lib/constants';

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

function buildGpsSvg(
  points: { lat: number; lng: number }[],
  color: string,
  zonePolygons: { lat: number; lng: number }[][],
  W = 560, H = 340,
): string {
  if (points.length < 2) return '';
  const pad = 24;
  const allPts = [...points, ...zonePolygons.flat()];
  const lats = allPts.map(p => p.lat);
  const lngs = allPts.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const lngSpanM = (maxLng - minLng) * cosLat * 111320;
  const latSpanM = (maxLat - minLat) * 111320;
  const scaleX = lngSpanM > 0 ? (W - 2 * pad) / lngSpanM : 1;
  const scaleY = latSpanM > 0 ? (H - 2 * pad) / latSpanM : 1;
  const scale = Math.min(scaleX, scaleY);
  const usedW = lngSpanM * scale, usedH = latSpanM * scale;
  const offX = (W - usedW) / 2, offY = (H - usedH) / 2;

  const toX = (lng: number) => offX + (lng - minLng) * cosLat * 111320 * scale;
  const toY = (lat: number) => H - offY - (lat - minLat) * 111320 * scale;

  // Zone polygons
  const zonePaths = zonePolygons.map(poly => {
    const d = poly.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.lng).toFixed(1)} ${toY(p.lat).toFixed(1)}`).join(' ') + ' Z';
    return `<path d="${d}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1.5" stroke-opacity="0.5" stroke-dasharray="4 3"/>`;
  }).join('');

  // GPS trail
  const trailD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.lng).toFixed(1)} ${toY(p.lat).toFixed(1)}`).join(' ');
  const x0 = toX(points[0].lng), y0 = toY(points[0].lat);
  const xN = toX(points[points.length - 1].lng), yN = toY(points[points.length - 1].lat);

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#f1f5f9" rx="6"/>
    ${zonePaths}
    <path d="${trailD}" stroke="${color}" stroke-width="2.5" fill="none" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>
    <circle cx="${x0.toFixed(1)}" cy="${y0.toFixed(1)}" r="5" fill="#22c55e" stroke="white" stroke-width="2"/>
    <circle cx="${xN.toFixed(1)}" cy="${yN.toFixed(1)}" r="5" fill="#ef4444" stroke="white" stroke-width="2"/>
    <text x="${x0.toFixed(1)}" y="${(y0 + 16).toFixed(1)}" font-size="9" fill="#16a34a" text-anchor="middle" font-family="sans-serif">Début</text>
    <text x="${xN.toFixed(1)}" y="${(yN + 16).toFixed(1)}" font-size="9" fill="#dc2626" text-anchor="middle" font-family="sans-serif">Fin</text>
  </svg>`;
}

function openPrintRecap(
  session: SuiviSession,
  chantier: Chantier | undefined,
  thisPct: number | null,
  cumulPct: number | null,
  rendMoyen: number | null,
  workColor: string,
  zonePolygons: { lat: number; lng: number }[][],
) {
  const svgStr = buildGpsSvg(session.gpsPoints, workColor, zonePolygons);
  const dateStr = format(new Date(session.dateDebut), 'dd MMMM yyyy', { locale: fr });
  const dateFin = session.dateFin ? new Date(session.dateFin) : null;
  const typeLabel = chantier ? (CHANTIER_TYPES[chantier.type]?.label ?? chantier.type) : '—';
  const rows: [string, string][] = [
    ['Durée',        formatDuration(session.dureeMinutes)],
    ['Surface traitée', formatArea(session.surfaceCoveredM2)],
    ['Distance parcourue', formatDistance(session.distanceM)],
    ['Rendement',    `${Math.round(session.rendementM2h).toLocaleString('fr-FR')} m²/h`],
  ];
  if (rendMoyen != null) rows.push(['Rendement moyen (chantier)', `${rendMoyen.toLocaleString('fr-FR')} m²/h`]);
  if (thisPct != null)   rows.push(['Avancement cette session', `${thisPct} %`]);
  if (cumulPct != null)  rows.push(['Avancement total chantier', `${cumulPct} %`]);

  const tableRows = rows.map(([l, v]) =>
    `<tr><td>${l}</td><td class="val">${v}</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Récap session – ${session.chantierNom}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, Arial, sans-serif; color: #1e293b; padding: 32px; max-width: 680px; margin: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 2px solid #0f4c81; margin-bottom: 20px; }
  header h1 { font-size: 18px; font-weight: 700; color: #0f4c81; }
  header .meta { text-align: right; font-size: 11px; color: #64748b; }
  h2 { font-size: 13px; font-weight: 700; color: #0f4c81; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 8px; margin-top: 20px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; font-size: 13px; margin-bottom: 4px; }
  .info-grid .lbl { color: #64748b; }
  .info-grid .val { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
  td.val { font-weight: 700; text-align: right; }
  .map-wrap { margin-top: 16px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
  .legend { display: flex; gap: 16px; font-size: 11px; color: #64748b; margin-top: 8px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; }
  footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  @media print { body { padding: 16px; } }
</style>
</head><body>
<header>
  <div>
    <h1>ETS VANDAELE</h1>
    <div style="font-size:12px;color:#475569;margin-top:4px;">Rapport d'intervention</div>
  </div>
  <div class="meta">
    <div>${dateStr}</div>
    <div>${format(new Date(session.dateDebut), 'HH:mm', { locale: fr })}${dateFin ? ' → ' + format(dateFin, 'HH:mm', { locale: fr }) : ''}</div>
    <div style="margin-top:4px;">${session.operateur === 'patron' ? 'Patron' : 'Salarié'}</div>
  </div>
</header>

<h2>Chantier</h2>
<div class="info-grid">
  <span class="lbl">Intitulé</span><span class="val">${session.chantierNom}</span>
  ${chantier?.client ? `<span class="lbl">Client</span><span class="val">${chantier.client}</span>` : ''}
  ${chantier?.lieu   ? `<span class="lbl">Lieu</span><span class="val">${chantier.lieu}</span>` : ''}
  <span class="lbl">Type de prestation</span><span class="val">${typeLabel}</span>
</div>

<h2>Métriques de la session</h2>
<table>${tableRows}</table>

${svgStr ? `<h2>Tracé GPS</h2><div class="map-wrap">${svgStr}</div>
<div class="legend">
  <span><span class="dot" style="background:#22c55e;"></span>Début</span>
  <span><span class="dot" style="background:#ef4444;"></span>Fin</span>
  <span style="color:#94a3b8;margin-left:auto;">Tracé schématique – sans fond de carte</span>
</div>` : ''}

<footer>Document généré automatiquement · ETS Vandaele · ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: fr })}</footer>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 600);
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
        <button
          onClick={() => openPrintRecap(
            session, chantier, thisPct, cumulPct, rendMoyen, workColor,
            chantierZones.flatMap(z => z.polygons.filter(p => p.length >= 3)),
          )}
          title="Récap client (PDF)"
          className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white"
        >
          <Printer size={17} />
        </button>
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
