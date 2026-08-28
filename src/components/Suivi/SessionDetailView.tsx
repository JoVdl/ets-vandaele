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

// Downsample a point array to at most maxPts (keeps first, last, evenly spaced between)
function downsample<T>(arr: T[], maxPts: number): T[] {
  if (arr.length <= maxPts) return arr;
  const result: T[] = [arr[0]];
  const step = (arr.length - 1) / (maxPts - 1);
  for (let i = 1; i < maxPts - 1; i++) result.push(arr[Math.round(i * step)]);
  result.push(arr[arr.length - 1]);
  return result;
}

function buildGpsSvg(
  rawPoints: { lat: number; lng: number }[],
  color: string,
  zonePolygons: { lat: number; lng: number }[][],
  W = 560, H = 320,
): string {
  if (rawPoints.length < 2) return '';
  const points = downsample(rawPoints, 400);
  const pad = 28;
  const allPts = [...points, ...zonePolygons.flat()];
  const lats = allPts.map(p => p.lat);
  const lngs = allPts.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  // Ensure non-zero span (single point or all same location)
  const latSpan = Math.max(maxLat - minLat, 0.0001);
  const lngSpan = Math.max(maxLng - minLng, 0.0001);
  const midLat  = (minLat + maxLat) / 2;
  const cosLat  = Math.cos((midLat * Math.PI) / 180);
  const lngSpanM = lngSpan * cosLat * 111320;
  const latSpanM = latSpan * 111320;
  const scaleX  = (W - 2 * pad) / lngSpanM;
  const scaleY  = (H - 2 * pad) / latSpanM;
  const scale   = Math.min(scaleX, scaleY);
  const usedW   = lngSpanM * scale;
  const usedH   = latSpanM * scale;
  const offX    = (W - usedW) / 2;
  const offY    = (H - usedH) / 2;

  const toX = (lng: number) => offX + (lng - minLng) * cosLat * 111320 * scale;
  const toY = (lat: number) => H - offY - (lat - minLat) * 111320 * scale;

  const zonePaths = zonePolygons.map(poly => {
    const d = poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.lng).toFixed(1)},${toY(p.lat).toFixed(1)}`).join(' ') + ' Z';
    return `<path d="${d}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1.5" stroke-opacity="0.4" stroke-dasharray="5 3"/>`;
  }).join('');

  const trailD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.lng).toFixed(1)},${toY(p.lat).toFixed(1)}`).join(' ');
  const x0 = toX(points[0].lng),           y0 = toY(points[0].lat);
  const xN = toX(points[points.length-1].lng), yN = toY(points[points.length-1].lat);

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block">` +
    `<rect width="${W}" height="${H}" fill="#f0fdf4" rx="6"/>` +
    `<rect x="1" y="1" width="${W-2}" height="${H-2}" fill="none" stroke="#bbf7d0" stroke-width="1" rx="5"/>` +
    zonePaths +
    `<path d="${trailD}" stroke="${color}" stroke-width="2.5" fill="none" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>` +
    `<circle cx="${x0.toFixed(1)}" cy="${y0.toFixed(1)}" r="6" fill="#22c55e" stroke="white" stroke-width="2"/>` +
    `<circle cx="${xN.toFixed(1)}" cy="${yN.toFixed(1)}" r="6" fill="#ef4444" stroke="white" stroke-width="2"/>` +
    `</svg>`;
}

const BRAND_GREEN = '#56B57A';
const BRAND_TEAL  = '#266E7B';

function openPrintRecap(
  session: SuiviSession,
  chantier: Chantier | undefined,
  thisPct: number | null,
  cumulPct: number | null,
  rendMoyen: number | null,
  workColor: string,
  zonePolygons: { lat: number; lng: number }[][],
) {
  const svgStr   = buildGpsSvg(session.gpsPoints, workColor, zonePolygons);
  const dateStr  = format(new Date(session.dateDebut), 'EEEE dd MMMM yyyy', { locale: fr });
  const dateFin  = session.dateFin ? new Date(session.dateFin) : null;
  const typeLabel = chantier ? (CHANTIER_TYPES[chantier.type]?.label ?? chantier.type) : '—';
  const logoUrl  = `${window.location.origin}/logo-vandaele.svg`;

  const rows: [string, string][] = [
    ['Durée de la session',    formatDuration(session.dureeMinutes)],
    ['Surface traitée',        formatArea(session.surfaceCoveredM2)],
    ['Distance parcourue',     formatDistance(session.distanceM)],
    ['Rendement',              `${Math.round(session.rendementM2h).toLocaleString('fr-FR')} m²/h`],
  ];
  if (rendMoyen != null) rows.push(['Rendement moyen (toutes sessions)', `${rendMoyen.toLocaleString('fr-FR')} m²/h`]);
  if (thisPct   != null) rows.push(['Avancement cette session',         `${thisPct} %`]);
  if (cumulPct  != null) rows.push(['Avancement total chantier',        `${cumulPct} %`]);

  const tableRows = rows.map(([l, v], i) =>
    `<tr style="${i % 2 === 1 ? 'background:#f8fafc' : ''}"><td>${l}</td><td class="val">${v}</td></tr>`
  ).join('');

  const mapSection = svgStr
    ? `<h2 class="section-title">Tracé GPS</h2>
       <div class="map-wrap">${svgStr}</div>
       <p class="map-note">&#9679; Début &nbsp;&nbsp; &#9679; Fin &nbsp;&mdash;&nbsp; Tracé schématique (sans fond de carte)</p>`
    : `<p style="color:#94a3b8;font-size:12px;margin-top:16px;">Aucun tracé GPS disponible pour cette session.</p>`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Récap · ${session.chantierNom}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Arial, sans-serif; color: #1e293b; background: #fff; }
  .page { max-width: 680px; margin: auto; padding: 0 24px 32px; }
  .header { background: ${BRAND_GREEN}; padding: 18px 24px; display: flex; justify-content: space-between; align-items: center; margin: 0 -24px 24px; }
  .header img { height: 52px; }
  .header .meta { text-align: right; color: rgba(255,255,255,.9); font-size: 12px; line-height: 1.6; }
  .header .doc-title { font-size: 13px; font-weight: 700; color: #fff; letter-spacing: .04em; text-transform: uppercase; }
  .section-title { font-size: 11px; font-weight: 700; color: ${BRAND_TEAL}; text-transform: uppercase; letter-spacing: .08em; margin: 20px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .info-grid { display: grid; grid-template-columns: auto 1fr; gap: 5px 16px; font-size: 13px; }
  .info-grid .lbl { color: #64748b; white-space: nowrap; }
  .info-grid .val { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
  td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
  td:last-child { border-bottom: none; }
  td.val { font-weight: 700; text-align: right; color: ${BRAND_TEAL}; font-variant-numeric: tabular-nums; }
  .map-wrap { border: 1px solid #d1fae5; border-radius: 8px; overflow: hidden; background: #f0fdf4; margin-top: 4px; }
  .map-wrap svg { display: block; width: 100%; height: auto; }
  .map-note { font-size: 10px; color: #94a3b8; margin-top: 6px; }
  .print-btn { display: block; margin: 24px auto 0; padding: 10px 28px; background: ${BRAND_GREEN}; color: #fff; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
  footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  @media print {
    .print-btn { display: none; }
    .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-size: 12px; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <img src="${logoUrl}" alt="ETS Vandaele" onerror="this.style.display='none';this.nextSibling.style.display='block'">
    <span style="display:none;color:#fff;font-size:18px;font-weight:800;letter-spacing:.04em">ETS VANDAELE</span>
    <div class="meta">
      <div class="doc-title">Rapport d'intervention</div>
      <div>${dateStr}</div>
      <div>${format(new Date(session.dateDebut), 'HH:mm', { locale: fr })}${dateFin ? ' → ' + format(dateFin, 'HH:mm', { locale: fr }) : ''}</div>
      <div>${session.operateur === 'patron' ? 'Patron' : 'Salarié'}</div>
    </div>
  </div>

  <h2 class="section-title">Chantier</h2>
  <div class="info-grid">
    <span class="lbl">Intitulé</span><span class="val">${session.chantierNom}</span>
    ${chantier?.client ? `<span class="lbl">Client</span><span class="val">${chantier.client}</span>` : ''}
    ${chantier?.lieu   ? `<span class="lbl">Lieu</span><span class="val">${chantier.lieu}</span>` : ''}
    <span class="lbl">Type de prestation</span><span class="val">${typeLabel}</span>
  </div>

  <h2 class="section-title">Métriques</h2>
  <table>${tableRows}</table>

  ${mapSection}

  <button class="print-btn" onclick="window.print()">Imprimer / Enregistrer en PDF</button>

  <footer>Document généré le ${format(new Date(), 'dd/MM/yyyy à HH:mm', { locale: fr })} · ETS Vandaele Marcel &amp; Fils</footer>
</div>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const w    = window.open(url, '_blank');
  if (!w) {
    // popup blocked — fallback: download the file
    const a = document.createElement('a');
    a.href = url;
    a.download = `recap-${session.chantierNom.replace(/\s+/g, '-')}.html`;
    a.click();
  }
  // Revoke after delay to allow the window to load
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
