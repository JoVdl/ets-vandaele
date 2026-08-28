import { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, Printer } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { SuiviSession, GpsPoint } from '../../types/suivi';
import type { Chantier } from '../../types';
import type { ChantierZone } from './SuiviMap';
import { formatArea, formatDistance, formatDuration, centroid, distanceM, totalDistanceM } from '../../lib/geo';
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
  machineParams?: { largeurTravailM: number; vitesseMaxKmh: number; recouvrementPct: number };
  workColor:     string;
  onClose:       () => void;
}

// Keep only GPS points with inter-point speed below maxSpeedKmh — removes transit driving
function filterBySpeed(points: GpsPoint[], maxSpeedKmh = 25): GpsPoint[] {
  if (points.length < 2) return points;
  const kept: GpsPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (b.ts > a.ts) {
      const dtH = (b.ts - a.ts) / 3_600_000;
      const dKm = distanceM(a.lat, a.lng, b.lat, b.lng) / 1000;
      if (dKm / dtH <= maxSpeedKmh) kept.push(b);
    } else {
      kept.push(b);
    }
  }
  return kept;
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
  rawPoints: GpsPoint[],
  color: string,
  zonePolygons: { lat: number; lng: number }[][],
  W = 560, H = 320,
): string {
  if (rawPoints.length < 2) return '';
  // Filter out high-speed transit segments (driving to/from worksite) before projecting
  const workPoints = filterBySpeed(rawPoints, 25);
  const points = downsample(workPoints.length >= 2 ? workPoints : rawPoints, 400);
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

  // Use a dark, high-contrast trail regardless of workColor (avoids light-on-light)
  const trailColor = '#1e3a5f';

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block">` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>` +
    `<rect x="0.5" y="0.5" width="${W-1}" height="${H-1}" fill="none" stroke="#e2e8f0" stroke-width="1"/>` +
    zonePaths +
    `<path d="${trailD}" stroke="${trailColor}" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${x0.toFixed(1)}" cy="${y0.toFixed(1)}" r="5" fill="#16a34a" stroke="white" stroke-width="2"/>` +
    `<circle cx="${xN.toFixed(1)}" cy="${yN.toFixed(1)}" r="5" fill="#dc2626" stroke="white" stroke-width="2"/>` +
    `</svg>`;
}

const BRAND_GREEN = '#56B57A';
const BRAND_TEAL  = '#266E7B';

interface RecapExtras {
  workSpeedKmh:      number | null;
  correctedSurfaceM2: number | null;
  correctedRendement: number | null;
}

function openPrintRecap(
  session: SuiviSession,
  chantier: Chantier | undefined,
  thisPct: number | null,
  cumulPct: number | null,
  rendMoyen: number | null,
  workColor: string,
  zonePolygons: { lat: number; lng: number }[][],
  extras: RecapExtras,
) {
  const svgStr    = buildGpsSvg(session.gpsPoints, workColor, zonePolygons);
  const dateStr   = format(new Date(session.dateDebut), 'EEEE dd MMMM yyyy', { locale: fr });
  const dateFin   = session.dateFin ? new Date(session.dateFin) : null;
  const typeLabel = chantier ? (CHANTIER_TYPES[chantier.type]?.label ?? chantier.type) : '—';
  const logoUrl   = `${window.location.origin}${import.meta.env.BASE_URL}logo-vandaele.svg`;

  // Use corrected metrics when available (speed × width formula), else fall back to stored values
  const displaySurface  = extras.correctedSurfaceM2 ?? session.surfaceCoveredM2;
  const displayRendement = extras.correctedRendement ?? session.rendementM2h;

  const rows: [string, string][] = [
    ['Durée de la session',   formatDuration(session.dureeMinutes)],
    ['Surface traitée',       formatArea(displaySurface)],
    ['Distance de travail',   formatDistance(totalDistanceM(filterBySpeed(session.gpsPoints, 25)))],
    ['Rendement',             `${Math.round(displayRendement).toLocaleString('fr-FR')} m²/h`],
  ];
  if (extras.workSpeedKmh != null)
    rows.push(['Vitesse moyenne de travail', `${extras.workSpeedKmh.toFixed(1)} km/h`]);
  if (rendMoyen != null)
    rows.push(['Rendement moyen (toutes sessions)', `${Math.round(rendMoyen).toLocaleString('fr-FR')} m²/h`]);
  if (thisPct   != null) rows.push(['Avancement cette session',    `${thisPct} %`]);
  if (cumulPct  != null) rows.push(['Avancement total chantier',   `${cumulPct} %`]);

  const tableRows = rows.map(([l, v], i) =>
    `<tr style="${i % 2 === 1 ? 'background:#f8fafc' : ''}"><td>${l}</td><td style="font-weight:700;text-align:right;color:${BRAND_TEAL};font-variant-numeric:tabular-nums">${v}</td></tr>`
  ).join('');

  const mapSection = svgStr
    ? `<p style="font-size:11px;font-weight:700;color:${BRAND_TEAL};text-transform:uppercase;letter-spacing:.08em;margin:20px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px">Tracé GPS</p>` +
      `<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-top:4px">${svgStr}</div>` +
      `<p style="font-size:10px;color:#94a3b8;margin-top:6px">● Début &nbsp; ● Fin — Tracé schématique (sans fond de carte)</p>`
    : `<p style="color:#94a3b8;font-size:12px;margin-top:16px">Aucun tracé GPS disponible.</p>`;

  // Header: logo on left (abs URL), text label always shown. All colors via inline styles for blob-URL robustness.
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="" style="height:52px;display:block" onerror="this.style.display='none'">`
    : '';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Récap · ${session.chantierNom}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Arial, sans-serif; color: #1e293b; background: #fff; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
  td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
  @media print { .no-print { display: none !important; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<!-- HEADER — inline styles only, no class dependency -->
<div style="background:${BRAND_GREEN};padding:16px 24px;display:flex;justify-content:space-between;align-items:center">
  <div style="display:flex;align-items:center;gap:12px">
    ${logoHtml}
    <div>
      <div style="color:#fff;font-size:17px;font-weight:800;letter-spacing:.04em;line-height:1.1">ETS VANDAELE</div>
      <div style="color:rgba(255,255,255,.8);font-size:11px;margin-top:2px">Marcel &amp; Fils</div>
    </div>
  </div>
  <div style="text-align:right;color:rgba(255,255,255,.9);font-size:12px;line-height:1.7">
    <div style="font-weight:700;color:#fff;letter-spacing:.04em;text-transform:uppercase;font-size:11px">Rapport d'intervention</div>
    <div>${dateStr}</div>
    <div>${format(new Date(session.dateDebut), 'HH:mm', { locale: fr })}${dateFin ? ' → ' + format(dateFin, 'HH:mm', { locale: fr }) : ''}</div>
    <div>${session.operateur === 'patron' ? 'Patron' : 'Salarié'}</div>
  </div>
</div>

<div style="max-width:680px;margin:auto;padding:20px 24px 40px">
  <p style="font-size:11px;font-weight:700;color:${BRAND_TEAL};text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px">Chantier</p>
  <div style="display:grid;grid-template-columns:auto 1fr;gap:5px 16px;font-size:13px">
    <span style="color:#64748b">Intitulé</span><span style="font-weight:600">${session.chantierNom}</span>
    ${chantier?.client ? `<span style="color:#64748b">Client</span><span style="font-weight:600">${chantier.client}</span>` : ''}
    ${chantier?.lieu   ? `<span style="color:#64748b">Lieu</span><span style="font-weight:600">${chantier.lieu}</span>` : ''}
    <span style="color:#64748b">Type de prestation</span><span style="font-weight:600">${typeLabel}</span>
  </div>

  <p style="font-size:11px;font-weight:700;color:${BRAND_TEAL};text-transform:uppercase;letter-spacing:.08em;margin:20px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px">Métriques de la session</p>
  <table>${tableRows}</table>

  ${mapSection}

  <div class="no-print" style="margin-top:24px;text-align:center">
    <button onclick="window.print()" style="padding:10px 32px;background:${BRAND_GREEN};color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">
      Imprimer / Enregistrer en PDF
    </button>
  </div>

  <p style="margin-top:28px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;text-align:center">
    Document généré le ${format(new Date(), 'dd/MM/yyyy à HH:mm', { locale: fr })} · ETS Vandaele Marcel &amp; Fils
  </p>
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

export default function SessionDetailView({ session, chantier, chantierCumul, chantierZones, machineParams, workColor, onClose }: Props) {
  const trail = session.gpsPoints.map(p => [p.lat, p.lng] as [number, number]);
  const center: [number, number] = trail.length > 0
    ? trail[Math.floor(trail.length / 2)]
    : [50.4, 2.8];

  // Corrected metrics: recompute from filtered GPS (speed × width) using machine params
  const { workSpeedKmh, correctedSurfaceM2, correctedRendement } = (() => {
    if (!machineParams || machineParams.largeurTravailM <= 0 || session.dureeMinutes <= 0)
      return { workSpeedKmh: null, correctedSurfaceM2: null, correctedRendement: null };
    const workPts    = filterBySpeed(session.gpsPoints, machineParams.vitesseMaxKmh);
    const workDistM  = totalDistanceM(workPts);
    const durationH  = session.dureeMinutes / 60;
    const speedKmh   = workDistM / 1000 / durationH;
    const effWidth   = machineParams.largeurTravailM * (1 - machineParams.recouvrementPct / 100);
    const surfaceM2  = workDistM * effWidth;
    const rendt      = surfaceM2 / durationH;
    return { workSpeedKmh: speedKmh, correctedSurfaceM2: surfaceM2, correctedRendement: rendt };
  })();

  // Use corrected surface for progress % when available
  const surface       = chantier?.surface ?? 0;
  const cumul         = chantierCumul?.[session.chantierId];
  const displaySurface = correctedSurfaceM2 ?? session.surfaceCoveredM2;
  const thisPct       = surface > 0 && displaySurface > 0
    ? Math.min(100, Math.round((displaySurface / surface) * 100)) : null;
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
            { workSpeedKmh, correctedSurfaceM2, correctedRendement },
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
          <StatCard label="Surface"   value={formatArea(correctedSurfaceM2 ?? session.surfaceCoveredM2)} />
          <StatCard label="Distance"  value={formatDistance(session.distanceM)} />
          <StatCard label="Rendement" value={`${Math.round(correctedRendement ?? session.rendementM2h).toLocaleString('fr-FR')} m²/h`} />
        </div>

        {/* Secondary metrics */}
        <div className="grid grid-cols-4 gap-1 mb-2">
          {workSpeedKmh != null && (
            <StatCard label="Vit. travail" value={`${workSpeedKmh.toFixed(1)} km/h`} />
          )}
          {workSpeedKmh == null && session.vitesseMoyenneKmh > 0 && (
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
