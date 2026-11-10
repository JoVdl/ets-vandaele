import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, Printer, AlertTriangle, Plus, X, Check } from 'lucide-react';
import { INCIDENT_LABELS, INCIDENT_COLORS } from './incidentUtils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { SuiviSession, SuiviIncident, IncidentType, GpsPoint } from '../../types/suivi';
import type { Chantier } from '../../types';
import type { ChantierZone } from './SuiviMap';
import { formatArea, formatDistance, formatDuration, centroid, distanceM, totalDistanceM, filterGpsTrack, stripVolumeM3WithSegments } from '../../lib/geo';
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

function FitBounds({ positions, fallback }: { positions: [number, number][]; fallback: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    const tid = setTimeout(() => {
      map.invalidateSize();
      if (positions.length >= 2) {
        map.fitBounds(L.latLngBounds(positions), { padding: [32, 32], animate: false });
      } else {
        map.setView(fallback, 16, { animate: false });
      }
    }, 150);
    return () => clearTimeout(tid);
  }, [map, positions, fallback]);
  return null;
}

const INCIDENT_OPTIONS: { value: IncidentType; label: string }[] = [
  { value: 'bouchon_avant_pompe', label: 'Bouchon avant pompe' },
  { value: 'bouchon_apres_pompe', label: 'Bouchon après pompe' },
  { value: 'deplacement_cables',  label: 'Déplacement câbles' },
  { value: 'ajout_tuyaux',        label: 'Ajout de tuyaux' },
  { value: 'panne_mecanique',     label: 'Panne mécanique' },
  { value: 'autre',               label: 'Autre' },
];

interface Props {
  session:       SuiviSession;
  chantier?:     Chantier;
  chantierCumul?: Record<string, { totalCoveredM2: number; sessionCount: number; totalMinutes: number; rendementSum: number; rendementCount: number }>;
  chantierZones: ChantierZone[];
  machineParams?: { largeurTravailM: number; vitesseMaxKmh: number; recouvrementPct: number };
  workColor:     string;
  salarieName?:  string;
  onUpdateIncidents?: (incidents: SuiviIncident[]) => Promise<void>;
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


const BRAND_GREEN = '#56B57A';
const BRAND_TEAL  = '#266E7B';

interface RecapExtras {
  workSpeedKmh:       number | null;
  correctedSurfaceM2: number | null;
  correctedRendement: number | null;
  correctedVolumeM3:  number | null;
  correctedDebitM3h:  number | null;
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
  salarieName = 'Hugo',
) {
  const dateStr   = format(new Date(session.dateDebut), 'EEEE dd MMMM yyyy', { locale: fr });
  const dateFin   = session.dateFin ? new Date(session.dateFin) : null;
  const typeLabel = chantier ? (CHANTIER_TYPES[chantier.type]?.label ?? chantier.type) : '—';
  const logoUrl   = `${window.location.origin}${import.meta.env.BASE_URL}logo-vandaele.svg`;

  // Filter transit GPS points; downsample for payload size
  const workPts   = filterBySpeed(session.gpsPoints, 25);
  const mapPts    = downsample(workPts.length >= 2 ? workPts : session.gpsPoints, 800);
  const ptsJson   = JSON.stringify(mapPts.map(p => [p.lat, p.lng]));
  const zonesJson = JSON.stringify(zonePolygons.map(z => z.map(p => [p.lat, p.lng])));

  // Use corrected metrics when available (speed × width formula), else fall back to stored values
  const displaySurface   = extras.correctedSurfaceM2 ?? session.surfaceCoveredM2;
  const displayRendement = extras.correctedRendement  ?? session.rendementM2h;
  const displayVolumeM3  = extras.correctedVolumeM3   ?? session.volumeM3 ?? 0;
  const displayDebitM3h  = extras.correctedDebitM3h   ?? session.debitM3h ?? 0;

  const isDragageSession = (session.volumeM3 ?? 0) > 0;
  const rows: [string, string][] = [
    ['Durée de la session',  formatDuration(session.dureeMinutes)],
    ...(isDragageSession ? [
      ['Volume dragué',        `${displayVolumeM3.toFixed(1)} m³`] as [string, string],
      ['Surface draguée',      formatArea(displaySurface)] as [string, string],
      ['Débit de dragage',     displayDebitM3h > 0 ? `${displayDebitM3h.toFixed(1)} m³/h` : '—'] as [string, string],
      ...(session.profondeurDragageM != null ? [[
        'Profondeur par passe',
        session.nbPassesParPosition != null && session.nbPassesParPosition > 1
          ? `${session.profondeurDragageM.toFixed(2)} m × ${session.nbPassesParPosition} passes = ${(session.profondeurDragageM * session.nbPassesParPosition).toFixed(2)} m total`
          : `${session.profondeurDragageM.toFixed(2)} m`,
      ] as [string, string]] : []),
    ] : [
      ['Surface traitée',      formatArea(displaySurface)] as [string, string],
      ['Rendement',            `${Math.round(displayRendement).toLocaleString('fr-FR')} m²/h`] as [string, string],
    ]),
    ['Distance de travail',  formatDistance(totalDistanceM(workPts))],
  ];
  if (extras.workSpeedKmh != null)
    rows.push(['Vitesse moyenne de travail', `${extras.workSpeedKmh.toFixed(1)} km/h`]);
  if (!isDragageSession && rendMoyen != null)
    rows.push(['Rendement moyen (toutes sessions)', `${Math.round(rendMoyen).toLocaleString('fr-FR')} m²/h`]);
  if (thisPct  != null) rows.push(['Avancement cette session',  `${thisPct} %`]);
  if (cumulPct != null) rows.push(['Avancement total chantier', `${cumulPct} %`]);

  const tableRows = rows.map(([l, v], i) =>
    `<tr style="${i % 2 === 1 ? 'background:#f8fafc' : ''}"><td>${l}</td><td style="font-weight:700;text-align:right;color:${BRAND_TEAL};font-variant-numeric:tabular-nums">${v}</td></tr>`
  ).join('');

  const hasMap = mapPts.length >= 2;
  const mapSection = hasMap ? `
<p style="font-size:11px;font-weight:700;color:${BRAND_TEAL};text-transform:uppercase;letter-spacing:.08em;margin:20px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px">Tracé GPS</p>
<div id="recap-map" style="height:360px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-top:4px"></div>
<p style="font-size:10px;color:#94a3b8;margin-top:6px">● Début &nbsp;● Fin — Photo aérienne IGN</p>
<script>
(function() {
  var pts   = ${ptsJson};
  var zones = ${zonesJson};
  var wc    = '${workColor}';
  var map = L.map('recap-map', { zoomControl: true, attributionControl: true });
  L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg' +
    '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    { maxZoom: 20, attribution: '© IGN' }
  ).addTo(map);
  zones.forEach(function(z) {
    L.polygon(z, { color: wc, weight: 1.5, fillOpacity: 0.12 }).addTo(map);
  });
  var line = L.polyline(pts, { color: '#1e3a5f', weight: 3, opacity: 0.9 }).addTo(map);
  function dot(latlng, fill) {
    return L.circleMarker(latlng, { radius: 6, color: '#fff', weight: 2, fillColor: fill, fillOpacity: 1 });
  }
  dot(pts[0],           '#16a34a').addTo(map);
  dot(pts[pts.length-1],'#dc2626').addTo(map);
  map.fitBounds(line.getBounds(), { padding: [28, 28] });
  window.recapMap = map;
})();
</script>` : `<p style="color:#94a3b8;font-size:12px;margin-top:16px">Aucun tracé GPS disponible.</p>`;

  const logoHtml = `<img src="${logoUrl}" alt="ETS Vandaele" style="height:52px;display:block" onerror="this.style.display='none'">`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Récap · ${session.chantierNom}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"><\/script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Arial, sans-serif; color: #1e293b; background: #fff; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
  td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
  @media print {
    .no-print { display: none !important; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    #recap-map { break-inside: avoid; }
    .leaflet-control-container { display: none; }
  }
</style>
</head>
<body>
<div style="background:${BRAND_TEAL};padding:16px 24px;display:flex;justify-content:space-between;align-items:center">
  <div style="display:flex;align-items:center">
    ${logoHtml}
  </div>
  <div style="text-align:right;color:rgba(255,255,255,.9);font-size:12px;line-height:1.7">
    <div style="font-weight:700;color:#fff;letter-spacing:.04em;text-transform:uppercase;font-size:11px">Rapport d'intervention</div>
    <div>${dateStr}</div>
    <div>${format(new Date(session.dateDebut), 'HH:mm', { locale: fr })}${dateFin ? ' → ' + format(dateFin, 'HH:mm', { locale: fr }) : ''}</div>
    <div>${session.operateur === 'patron' ? 'Patron' : salarieName}</div>
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
    <button onclick="if(window.recapMap){window.recapMap.invalidateSize();}window.print();"
      style="padding:10px 32px;background:${BRAND_GREEN};color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">
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

export default function SessionDetailView({ session, chantier, chantierCumul, chantierZones, machineParams, workColor, salarieName = 'Hugo', onUpdateIncidents, onClose }: Props) {
  const isDragageSession = !!(chantier?.drague ?? (session.volumeM3 != null && session.volumeM3 > 0));

  // Local incidents state — reflects Firestore changes via updated session prop
  const [incidents, setIncidents] = useState<SuiviIncident[]>(session.incidents ?? []);
  const [showAddIncident, setShowAddIncident] = useState(false);
  const [incType, setIncType] = useState<IncidentType>('bouchon_avant_pompe');
  const [incDuree, setIncDuree] = useState(10);
  const [saving, setSaving] = useState(false);

  // Sync when session prop is updated from Firestore
  useEffect(() => {
    setIncidents(session.incidents ?? []);
  }, [session.incidents]);

  async function handleAddIncident() {
    if (!onUpdateIncidents) return;
    const newInc: SuiviIncident = { type: incType, dureeMinutes: incDuree, ts: new Date().toISOString() };
    const updated = [...incidents, newInc];
    setSaving(true);
    await onUpdateIncidents(updated);
    setIncidents(updated);
    setShowAddIncident(false);
    setSaving(false);
  }

  async function handleDeleteIncident(idx: number) {
    if (!onUpdateIncidents) return;
    const updated = incidents.filter((_, i) => i !== idx);
    setSaving(true);
    await onUpdateIncidents(updated);
    setIncidents(updated);
    setSaving(false);
  }

  const totalIncidentMin = incidents.reduce((a, i) => a + i.dureeMinutes, 0);
  const curageMin = Math.max(0, session.dureeMinutes - totalIncidentMin);
  // Apply the same filter used at capture time (speed + anchor drift for dragage)
  const filteredGps = filterGpsTrack(
    session.gpsPoints,
    machineParams?.vitesseMaxKmh ?? 25,
    isDragageSession ? 1.6 : 2.0,
    isDragageSession ? Math.max((machineParams?.largeurTravailM ?? 6) * 10, 150) : Infinity,
  );
  const trail = filteredGps.map(p => [p.lat, p.lng] as [number, number]);
  const center: [number, number] = trail.length > 0
    ? trail[Math.floor(trail.length / 2)]
    : [43.7, -0.26];

  // Corrected metrics: recompute from filtered GPS (speed × width) using machine params
  const { workSpeedKmh, correctedSurfaceM2, correctedRendement, correctedVolumeM3, correctedDebitM3h } = (() => {
    if (!machineParams || machineParams.largeurTravailM <= 0 || session.dureeMinutes <= 0)
      return { workSpeedKmh: null, correctedSurfaceM2: null, correctedRendement: null, correctedVolumeM3: null, correctedDebitM3h: null };
    const workPts    = filteredGps;
    const workDistM  = totalDistanceM(workPts);
    const durationH  = session.dureeMinutes / 60;
    const speedKmh   = workDistM / 1000 / durationH;
    const effWidth   = machineParams.largeurTravailM * (1 - machineParams.recouvrementPct / 100);
    const surfaceM2  = workDistM * effWidth;
    const rendt      = surfaceM2 / durationH;
    // Volume: use per-segment depth if recorded, else flat surface × profondeur × nbPasses
    const profondeur = session.profondeurDragageM ?? 0;
    const nbPasses   = Math.max(1, session.nbPassesParPosition ?? 1);
    const volM3 = isDragageSession && profondeur > 0
      ? (session.depthSegments && session.depthSegments.length > 0 && machineParams
          ? stripVolumeM3WithSegments(workPts, machineParams.largeurTravailM, machineParams.recouvrementPct, session.depthSegments)
          : surfaceM2 * profondeur * nbPasses)
      : null;
    const debitM3h   = volM3 != null && durationH > 0 ? volM3 / durationH : null;
    return { workSpeedKmh: speedKmh, correctedSurfaceM2: surfaceM2, correctedRendement: rendt, correctedVolumeM3: volM3, correctedDebitM3h: debitM3h };
  })();

  // Use corrected surface for progress % when available
  const surface        = chantier?.surface ?? 0;
  const dureeEstimeeMin = (chantier?.dureeEstimeeH ?? 0) * 60;
  const cumul          = chantierCumul?.[session.chantierId];
  const displaySurface = correctedSurfaceM2 ?? session.surfaceCoveredM2;

  // Durée estimée prioritaire ; sinon surface ; sinon pas de %
  const thisPct = dureeEstimeeMin > 0
    ? Math.min(100, Math.round((session.dureeMinutes / dureeEstimeeMin) * 100))
    : surface > 0 && displaySurface > 0
      ? Math.min(100, Math.round((displaySurface / surface) * 100))
      : null;
  const cumulPct = dureeEstimeeMin > 0 && cumul
    ? Math.min(100, Math.round((cumul.totalMinutes / dureeEstimeeMin) * 100))
    : surface > 0 && cumul
      ? Math.min(100, Math.round((cumul.totalCoveredM2 / surface) * 100))
      : null;
  // If correctedRendement is available, swap this session's stored value out of the cumul average
  const rendMoyen = (() => {
    if (!cumul || cumul.rendementCount <= 0) return null;
    if (correctedRendement != null && session.rendementM2h > 0) {
      const adjustedSum = cumul.rendementSum - session.rendementM2h + correctedRendement;
      return Math.round(adjustedSum / cumul.rendementCount);
    }
    return Math.round(cumul.rendementSum / cumul.rendementCount);
  })();
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
            {' · '}{session.operateur === 'patron' ? 'Patron' : salarieName}
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
            { workSpeedKmh, correctedSurfaceM2, correctedRendement, correctedVolumeM3, correctedDebitM3h },
            salarieName,
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

            <FitBounds positions={trail} fallback={center} />

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
          {isDragageSession ? (
            <>
              <StatCard label="Volume dragué" value={`${(correctedVolumeM3 ?? session.volumeM3 ?? 0).toFixed(1)} m³`} />
              <StatCard label="Surface"       value={formatArea(displaySurface)} />
              <StatCard label="Débit"         value={(correctedDebitM3h ?? session.debitM3h ?? 0) > 0 ? `${(correctedDebitM3h ?? session.debitM3h!).toFixed(1)} m³/h` : '—'} />
            </>
          ) : (
            <>
              <StatCard label="Surface"   value={formatArea(correctedSurfaceM2 ?? session.surfaceCoveredM2)} />
              <StatCard label="Distance"  value={formatDistance(session.distanceM)} />
              <StatCard label="Rendement" value={`${Math.round(correctedRendement ?? session.rendementM2h).toLocaleString('fr-FR')} m²/h`} />
            </>
          )}
        </div>

        {/* Secondary metrics */}
        <div className="grid grid-cols-4 gap-1 mb-2">
          {isDragageSession && session.profondeurDragageM != null && (
            <StatCard
              label="Profondeur"
              value={session.nbPassesParPosition != null && session.nbPassesParPosition > 1
                ? `${(session.profondeurDragageM * session.nbPassesParPosition).toFixed(2)} m`
                : `${session.profondeurDragageM.toFixed(2)} m`}
            />
          )}
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
              {dureeEstimeeMin > 0 && cumul && cumul.totalMinutes < dureeEstimeeMin && (
                <span> · {formatDuration(Math.max(0, dureeEstimeeMin - cumul.totalMinutes))} restantes</span>
              )}
              {dureeEstimeeMin === 0 && surface > 0 && cumul && cumul.totalCoveredM2 < surface && (
                <span> · {formatArea(Math.max(0, surface - cumul.totalCoveredM2))} restants</span>
              )}
            </p>
          </div>
        )}

        {/* Time breakdown bar */}
        {session.dureeMinutes > 0 && (
          <div className="mb-2">
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
              <span>Répartition du temps · {formatDuration(session.dureeMinutes)}</span>
              {totalIncidentMin > 0 && (
                <span className="text-amber-400">{totalIncidentMin} min d'incidents</span>
              )}
            </div>
            <div className="flex h-4 rounded-full overflow-hidden gap-px">
              <div
                className="bg-green-700/80 flex items-center justify-center text-[8px] text-white font-bold min-w-0"
                style={{ flex: curageMin }}
                title={`Curage: ${formatDuration(curageMin)}`}
              >
                {curageMin > 15 && formatDuration(curageMin)}
              </div>
              {incidents.map((inc, i) => (
                <div
                  key={i}
                  className="flex items-center justify-center text-[8px] text-white font-bold min-w-0"
                  style={{ flex: inc.dureeMinutes, backgroundColor: INCIDENT_COLORS[inc.type] + 'cc' }}
                  title={`${INCIDENT_LABELS[inc.type]}: ${inc.dureeMinutes} min`}
                >
                  {inc.dureeMinutes >= 15 && `${inc.dureeMinutes}m`}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-1">
              <span className="flex items-center gap-1 text-[9px] text-green-500">
                <span className="w-2 h-2 rounded-full bg-green-700 flex-shrink-0" />
                Curage · {formatDuration(curageMin)}
              </span>
              {incidents.map((inc, i) => (
                <span key={i} className="flex items-center gap-1 text-[9px]" style={{ color: INCIDENT_COLORS[inc.type] }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: INCIDENT_COLORS[inc.type] }} />
                  {INCIDENT_LABELS[inc.type]} · {inc.dureeMinutes} min
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Incidents list with delete + add */}
        {onUpdateIncidents && (
          <div className="mb-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-500 uppercase tracking-wide">Incidents</span>
              <button
                onClick={() => setShowAddIncident(true)}
                className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 px-2 py-0.5 rounded-lg border border-amber-700/40 hover:bg-amber-900/30 transition-colors"
              >
                <Plus size={10} /> Ajouter
              </button>
            </div>
            {incidents.length === 0 && (
              <p className="text-slate-600 text-[10px]">Aucun incident enregistré</p>
            )}
            <div className="flex flex-wrap gap-1">
              {incidents.map((inc, i) => (
                <span key={i} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[9px] border"
                  style={{
                    backgroundColor: INCIDENT_COLORS[inc.type] + '22',
                    borderColor:     INCIDENT_COLORS[inc.type] + '55',
                    color:           INCIDENT_COLORS[inc.type],
                  }}>
                  <AlertTriangle size={8} />
                  {INCIDENT_LABELS[inc.type]} · {inc.dureeMinutes} min
                  <button
                    onClick={() => handleDeleteIncident(i)}
                    disabled={saving}
                    className="ml-0.5 hover:opacity-70 transition-opacity"
                    title="Supprimer"
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Add incident inline panel */}
        {showAddIncident && (
          <div className="mb-2 bg-slate-800/80 border border-white/[0.1] rounded-2xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-white font-semibold flex items-center gap-1.5">
                <AlertTriangle size={12} className="text-amber-400" /> Ajouter un incident
              </span>
              <button onClick={() => setShowAddIncident(false)} className="text-slate-400"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              {INCIDENT_OPTIONS.map(o => (
                <button key={o.value} onClick={() => setIncType(o.value)}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-medium text-left border transition-colors ${
                    incType === o.value
                      ? 'bg-amber-700/70 border-amber-500 text-amber-100'
                      : 'bg-white/[0.05] border-white/[0.08] text-slate-300'
                  }`}>
                  {incType === o.value && <Check size={10} className="text-amber-300 flex-shrink-0" />}
                  <span className="truncate">{o.label}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {[5, 10, 15, 20, 30, 45, 60].map(min => (
                <button key={min} onClick={() => setIncDuree(min)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition-colors ${
                    incDuree === min
                      ? 'bg-amber-600 border-amber-500 text-white'
                      : 'bg-white/[0.06] border-white/[0.08] text-slate-300'
                  }`}>
                  {min < 60 ? `${min} min` : '1 h'}
                </button>
              ))}
            </div>
            <button
              onClick={handleAddIncident}
              disabled={saving}
              className="w-full h-9 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-500 transition-colors disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        )}

        {/* Timestamps */}
        <div className="flex items-center justify-between text-[10px] text-slate-600">
          <span>Début : {format(new Date(session.dateDebut), 'HH:mm', { locale: fr })}</span>
          {dateFin && <span>Fin : {format(dateFin, 'HH:mm', { locale: fr })}</span>}
          <span>{session.operateur === 'patron' ? 'Patron' : salarieName}</span>
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
