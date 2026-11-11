import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GpsPoint } from '../../types/suivi';
import { areaM2, formatArea, centroid, smoothPoints, distanceM, convexHull, orientedBoundingBoxM2, sessionOBBsAligned } from '../../lib/geo';
import type { LiveSession } from '../../hooks/useLiveSessions';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const drawIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:14px;height:14px;border-radius:50%;
    background:#3b82f6;border:2px solid white;
    box-shadow:0 0 0 3px rgba(59,130,246,.4);
  "></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7],
});

function zoneLabel(nom: string, color: string, progress: number | null) {
  const progressStr = progress != null
    ? `<span style="opacity:.85;font-weight:400;"> · ${progress}%</span>` : '';
  return L.divIcon({
    className: '',
    html: `<div style="
      transform:translateX(-50%);
      display:inline-block;
      background:${color}dd;
      color:#fff;font-size:10px;font-weight:700;
      padding:2px 7px;border-radius:4px;
      white-space:nowrap;pointer-events:none;
      text-shadow:0 1px 2px rgba(0,0,0,.5);
      border:1px solid rgba(255,255,255,.3);
    ">${nom}${progressStr}</div>`,
    iconSize: [0, 0], iconAnchor: [0, 8],
  });
}

/** Bearing in degrees (0=North, clockwise) from two GPS points. */
function bearingDeg(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): number {
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  const lat1R = p1.lat * Math.PI / 180;
  const b = Math.atan2(dLng * Math.cos(lat1R), dLat);
  return (b * 180 / Math.PI + 360) % 360;
}

function depthColor(depth: number, maxDepth: number): string {
  const t = maxDepth > 0 ? Math.min(depth / maxDepth, 1) : 0;
  const r = Math.round(0xbf - (0xbf - 0x1e) * t);
  const g = Math.round(0xdb - (0xdb - 0x3a) * t);
  const b = Math.round(0xfe - (0xfe - 0x8a) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Machine-shaped divIcon: oriented rectangle + forward arrow. */
function machineIcon(bearing: number, largeurM: number, color: string) {
  const PX_PER_M = 14; // visual scale (screen pixels per metre)
  const bodyW = Math.max(20, Math.min(72, Math.round(largeurM * PX_PER_M)));
  const bodyH = largeurM > 0 ? Math.round(bodyH_fromWidth(bodyW)) : bodyW;
  const arrowW = Math.round(bodyW * 0.55);
  const arrowH = 10;
  const totalH = bodyH + arrowH + 2;

  // Bounding box to contain the rotated icon
  const diag = Math.ceil(Math.sqrt(bodyW * bodyW + totalH * totalH)) + 6;

  return L.divIcon({
    className: '',
    html: `<div style="width:${diag}px;height:${diag}px;display:flex;align-items:center;justify-content:center;">
      <div style="transform:rotate(${bearing}deg);display:flex;flex-direction:column;align-items:center;gap:0;filter:drop-shadow(0 2px 5px rgba(0,0,0,.7));">
        <div style="width:0;height:0;
          border-left:${Math.round(arrowW/2)}px solid transparent;
          border-right:${Math.round(arrowW/2)}px solid transparent;
          border-bottom:${arrowH}px solid ${color};"></div>
        <div style="width:${bodyW}px;height:${bodyH}px;
          background:${color};
          border:2.5px solid rgba(255,255,255,.92);
          border-top:none;
          border-radius:0 0 3px 3px;"></div>
      </div>
    </div>`,
    iconSize: [diag, diag],
    iconAnchor: [diag / 2, diag / 2],
  });
}

function bodyH_fromWidth(w: number): number {
  // Approximate machine length: chenillette ~3.5m, ratio h/w ≈ 1.5
  return Math.round(w * 1.5);
}

/**
 * Drague aspiratrice icon for papillonnage dredging.
 *
 * Shape (unrotated, bow pointing North):
 *
 *   [•MÉLANGEUR•]   ← suction head (wide, rounded, cyan)
 *        ║           ← dredge arm / ladder
 *   [══BARGE══]     ← main pontoon (rectangle, color-coded)
 *        ▪           ← stern spud marker
 *
 * The GPS anchor is at the centre of the barge body.
 * The entire shape rotates around that point.
 */
function dragueIcon(bearing: number, color: string) {
  // --- dimensions (px) ---
  const bargeW  = 38;
  const bargeH  = 18;
  const armW    = 10;
  const armH    = 16;
  const headW   = 28;
  const headH   = 10;
  const spudW   = 6;
  const spudH   = 7;

  // The SVG height is chosen so the BARGE CENTRE lands at SVG centre Y.
  // Barge centre from the top: headH + armH + bargeH/2
  const bargeCentreFromTop = headH + armH + bargeH / 2; // = 35
  const svgH = bargeCentreFromTop * 2;                   // = 70 (spud gets clipped slightly, that's fine)
  const svgW = Math.max(bargeW, headW) + 2;              // = 40

  const cx = svgW / 2;

  // Y coordinates
  const headY  = 0;
  const armY   = headH;
  const bargeY = headH + armH;
  const spudY  = bargeY + bargeH;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">
    <!-- Tête d'aspiration / mélangeur -->
    <rect x="${cx - headW/2}" y="${headY}" width="${headW}" height="${headH}" rx="5" ry="5"
      fill="#22d3ee" stroke="white" stroke-width="1.5"/>
    <circle cx="${cx}" cy="${headY + 1}" r="4" fill="white" opacity=".6"/>
    <!-- Bras / échelle -->
    <rect x="${cx - armW/2}" y="${armY}" width="${armW}" height="${armH}"
      fill="#0891b2" stroke="white" stroke-width="1"/>
    <!-- Coque de la barge -->
    <rect x="${cx - bargeW/2}" y="${bargeY}" width="${bargeW}" height="${bargeH}" rx="4" ry="4"
      fill="${color}" stroke="white" stroke-width="2.5"/>
    <!-- Piquet arrière (spud) -->
    <rect x="${cx - spudW/2}" y="${spudY + 1}" width="${spudW}" height="${spudH}" rx="1.5" ry="1.5"
      fill="#164e63" stroke="rgba(255,255,255,.5)" stroke-width="1"/>
  </svg>`;

  // The bounding square must fit the shape after rotation
  const diag = Math.ceil(Math.sqrt(svgW * svgW + svgH * svgH)) + 8;

  return L.divIcon({
    className: '',
    html: `<div style="width:${diag}px;height:${diag}px;display:flex;align-items:center;justify-content:center;">
      <div style="transform:rotate(${bearing}deg);filter:drop-shadow(0 2px 6px rgba(0,0,0,.75));">
        ${svg}
      </div>
    </div>`,
    iconSize:   [diag, diag],
    iconAnchor: [diag / 2, diag / 2],
  });
}

/** Fit the map to cover all historical OBB polygons on first load (only when no active session). */
function FitWorkArea({ data, active }: { data: [number, number][][]; active: boolean }) {
  const map = useMap();
  const fittedRef = useRef(false);
  useEffect(() => {
    if (active || fittedRef.current || data.length === 0) return;
    const allPts = data.flat();
    if (allPts.length < 2) return;
    const lats = allPts.map(p => p[0]);
    const lngs = allPts.map(p => p[1]);
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 19, animate: false });
    fittedRef.current = true;
  }, [data, active, map]);
  return null;
}

function AutoCenter({ pos, follow }: { pos: [number, number] | null; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (follow && pos) map.panTo(pos, { animate: true });
  }, [pos, follow, map]);
  return null;
}

function JumpTo({ pos }: { pos: [number, number] | null }) {
  const map = useMap();
  const lastKeyRef = useRef('');
  useEffect(() => {
    if (!pos) { lastKeyRef.current = ''; return; }
    const key = `${pos[0].toFixed(6)},${pos[1].toFixed(6)}`;
    if (key === lastKeyRef.current) return; // same coordinates — don't re-jump
    lastKeyRef.current = key;
    map.setView(pos, Math.max(map.getZoom(), 17), { animate: true });
  }, [pos, map]);
  return null;
}

function DrawHandler({ active, onPoint, onDrag }: {
  active: boolean;
  onPoint: (lat: number, lng: number) => void;
  onDrag: () => void;
}) {
  useMapEvents({
    click(e) { if (active) onPoint(e.latlng.lat, e.latlng.lng); },
    dragstart() { onDrag(); },
  });
  return null;
}

export interface ChantierZone {
  id: string;
  nom: string;
  polygons: { lat: number; lng: number }[][];
  color: string;
  progress: number | null;
}

interface Props {
  gpsPoints:                GpsPoint[];
  currentPos:               GpsPoint | null;
  drawMode:                 boolean;
  drawPoints:               { lat: number; lng: number }[];
  onDrawPoint:              (lat: number, lng: number) => void;
  followGps:                boolean;
  onDisableFollow:          () => void;
  chantierZones:            ChantierZone[];
  selectedZoneId:           string;
  onZoneClick:              (id: string) => void;
  showZones:                boolean;
  satellite:                'ign' | 'esri' | 'osm';
  workColor:                string;
  largeurM:                 number;
  smoothAlpha:              number;
  sessionActive:            boolean;
  jumpToPos:                [number, number] | null;
  liveSessions:             LiveSession[];
  mySessionId:              string;
  historicalTrails:         { points: GpsPoint[]; color: string; sessionId?: string; volumeM3?: number; profondeurM?: number; isSelected?: boolean }[];
  currentVolumeM3?:         number;
  isDragage?:               boolean;
  onHistoricalTrailClick?:  (sessionId: string) => void;
  salarieName?:             string;
}

function liveIcon(label: string) {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <div style="width:20px;height:20px;border-radius:50%;background:#f97316;border:3px solid white;box-shadow:0 0 0 4px rgba(249,115,22,.35);"></div>
      <div style="background:rgba(249,115,22,.9);color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;white-space:nowrap;">${label}</div>
    </div>`,
    iconSize: [20, 36], iconAnchor: [10, 10],
  });
}

export default function SuiviMap({
  gpsPoints, currentPos, drawMode, drawPoints, onDrawPoint,
  followGps, onDisableFollow, chantierZones, selectedZoneId, onZoneClick,
  showZones, satellite, workColor, largeurM, smoothAlpha,
  sessionActive, jumpToPos, liveSessions, mySessionId, historicalTrails,
  isDragage, onHistoricalTrailClick, salarieName = 'Hugo', currentVolumeM3,
}: Props) {

  const center: [number, number] = currentPos
    ? [currentPos.lat, currentPos.lng]
    : [50.4, 2.8];

  const drawnArea = drawPoints.length >= 3 ? areaM2(drawPoints) : 0;

  const tiles: Record<string, { url: string; attr: string }> = {
    ign: {
      url:  'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      attr: '&copy; <a href="https://www.ign.fr">IGN</a> – Géoplateforme',
    },
    esri: {
      url:  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attr: '&copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics',
    },
    osm: {
      url:  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr: '&copy; <a href="https://openstreetmap.org">OSM</a>',
    },
  };
  const { url: tileUrl, attr: tileAttr } = tiles[satellite as string] ?? tiles.ign;

  const smoothed = useMemo(
    () => smoothPoints(gpsPoints, smoothAlpha),
    [gpsPoints, smoothAlpha],
  );

  const trail = useMemo(
    () => smoothed.map(p => [p.lat, p.lng] as [number, number]),
    [smoothed],
  );

  // Historical trails — all sessions share one global axis (no rotation discrepancies),
  // width = largeurM so adjacent strips are exactly side-by-side without overlap.
  const historicalRendered = useMemo(() => {
    const smoothedTrails = historicalTrails.map(t => ({
      ...t,
      sm: smoothPoints(t.points, smoothAlpha),
    }));

    // Aligned OBBs only for the selected chantier — mixing sessions from different chantiers
    // (hundreds of km apart) breaks the shared-axis packing logic (globalMed ends up at the
    // wrong chantier, displacing rectangles to the wrong geographic location).
    const selectedTrails = smoothedTrails.filter(t => t.isSelected);
    const alignedObbs = selectedTrails.length > 0
      ? sessionOBBsAligned(selectedTrails.map(t => ({ points: t.sm })), largeurM)
      : [];
    const obbByOriginalIndex = new Map<number, typeof alignedObbs[0]>();
    let selIdx = 0;
    smoothedTrails.forEach((t, i) => { if (t.isSelected) obbByOriginalIndex.set(i, alignedObbs[selIdx++]); });

    return smoothedTrails.map(({ color, sessionId, volumeM3: vol, profondeurM: depth, isSelected, sm }, i) => {
      const obb = obbByOriginalIndex.get(i) ?? null;
      if (obb) {
        return { kind: 'obb' as const, color, sessionId, isSelected, data: obb.polygon.map(p => [p.lat, p.lng] as [number, number]), hullArea: obb.areaM2, vol, depth: depth ?? 0 };
      }
      return { kind: 'line' as const, color, sessionId, isSelected, data: sm.map(p => [p.lat, p.lng] as [number, number]), hullArea: 0, vol, depth: depth ?? 0 };
    });
  }, [historicalTrails, smoothAlpha, largeurM]);

  // OBB of current GPS cloud — clean rectangle for display of active work zone
  const obbResult = useMemo(() => {
    if (smoothed.length < 4) return null;
    return orientedBoundingBoxM2(smoothed);
  }, [smoothed]);

  // ── View mode (Sessions / Total hull / Depth gradient) ───────────────
  const [viewMode, setViewMode] = useState<'sessions' | 'total' | 'depth'>('sessions');

  const maxDepthM = useMemo(() => {
    if (!isDragage) return 0;
    return Math.max(0.5, ...historicalTrails.map(t => t.profondeurM ?? 0));
  }, [isDragage, historicalTrails]);

  const totalHullData = useMemo(() => {
    if (!isDragage) return null;
    // Use OBB corners (already clean rectangles) → convexHull gives the combined outline
    const allPts = historicalRendered
      .filter(h => h.kind === 'obb')
      .flatMap(h => (h.data as [number, number][]).map(([lat, lng]) => ({ lat, lng })));
    if (allPts.length < 3) return null;
    const hull = convexHull(allPts);
    if (hull.length < 3) return null;
    const totalArea = areaM2(hull);
    const totalVol  = historicalTrails.reduce((s, t) => s + (t.volumeM3 ?? 0), 0);
    return { positions: hull.map(p => [p.lat, p.lng] as [number, number]), totalArea, totalVol };
  }, [isDragage, historicalRendered, historicalTrails]);

  const activeObbArea = obbResult?.areaM2 ?? 0;

  // Bearing of the machine: angle from the last two smoothed GPS points
  const lastBearingRef = useRef(0);
  const machineBearing = useMemo(() => {
    if (smoothed.length < 2) return lastBearingRef.current;
    const p1 = smoothed[smoothed.length - 2];
    const p2 = smoothed[smoothed.length - 1];
    if (distanceM(p1.lat, p1.lng, p2.lat, p2.lng) < 1) return lastBearingRef.current;
    const b = bearingDeg(p1, p2);
    lastBearingRef.current = b;
    return b;
  }, [smoothed]);

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={center}
        zoom={17}
        className="w-full h-full"
        zoomControl={false}
        preferCanvas={true}
      >
        <TileLayer key={satellite} url={tileUrl} attribution={tileAttr} maxZoom={20} />

        <AutoCenter pos={currentPos ? [currentPos.lat, currentPos.lng] : null} follow={followGps} />
        <JumpTo pos={jumpToPos} />
        <FitWorkArea
          data={historicalRendered.filter(h => h.kind === 'obb' && h.isSelected).map(h => h.data as [number,number][])}
          active={sessionActive}
        />
        <DrawHandler active={drawMode} onPoint={onDrawPoint} onDrag={onDisableFollow} />

        {/* Chantier zones */}
        {showZones && chantierZones.flatMap(z => {
          const validPolygons = z.polygons.filter(p => p.length >= 3);
          if (validPolygons.length === 0) return [];
          const allPoints = validPolygons.flat();
          const c = centroid(allPoints);
          const isSelected = z.id === selectedZoneId;
          return [
            ...validPolygons.map((poly, pi) => (
              <Polygon
                key={`zone-${z.id}-${pi}`}
                positions={poly.map(p => [p.lat, p.lng] as [number, number])}
                color={z.color}
                fillColor={z.color}
                fillOpacity={isSelected ? 0.35 : 0.22}
                weight={isSelected ? 3.5 : 2.5}
                eventHandlers={{ click: () => onZoneClick(z.id) }}
              />
            )),
            <Marker key={`label-${z.id}`} position={[c.lat, c.lng]}
              icon={zoneLabel(z.nom, z.color, z.progress)} />,
          ];
        })}

        {/* Historical trails from past sessions — OBB rectangles or polyline fallback */}
        {viewMode !== 'total' && historicalRendered.map((h, si) => {
          const clickable = !!(h.sessionId && onHistoricalTrailClick);
          const handlers = clickable
            ? { click: (e: L.LeafletMouseEvent) => { L.DomEvent.stopPropagation(e); onHistoricalTrailClick!(h.sessionId!); } }
            : undefined;
          if (h.kind === 'obb') {
            const hc = viewMode === 'depth' ? depthColor(h.depth, maxDepthM) : h.color;
            return (
              <Polygon
                key={`h-${si}`}
                positions={h.data}
                color={hc}
                fillColor={hc}
                fillOpacity={clickable ? 0.45 : 0.30}
                weight={clickable ? 2 : 1.5}
                opacity={clickable ? 0.85 : 0.65}
                eventHandlers={handlers}
                className={clickable ? 'cursor-pointer' : undefined}
              >
                {h.hullArea >= 50 && (
                  <Tooltip permanent direction="center" offset={[0, 0]} className="hull-label">
                    <div style={{ textAlign: 'center', lineHeight: 1.4 }}>
                      {formatArea(h.hullArea)}
                      {(h.vol ?? 0) > 0 && <><br />{h.vol!.toFixed(1)} m³</>}
                      {viewMode === 'depth' && h.depth > 0 && <><br />{h.depth.toFixed(2)} m</>}
                    </div>
                  </Tooltip>
                )}
              </Polygon>
            );
          }
          // kind === 'line': fallback polyline when OBB cannot be computed (< 4 pts)
          return h.data.length > 1 && (
            <Polyline
              key={`h-${si}-line`}
              positions={h.data as [number, number][]}
              color={h.color}
              weight={clickable ? 5 : 3}
              opacity={clickable ? 0.75 : 0.5}
              eventHandlers={handlers}
              className={clickable ? 'cursor-pointer' : undefined}
            />
          );
        })}

        {/* Work trail — OBB rectangle (clean zone) + dashed GPS trace */}
        {isDragage
          ? <>
              {obbResult && (
                <Polygon
                  positions={obbResult.polygon.map(p => [p.lat, p.lng] as [number, number])}
                  color={workColor}
                  fillColor={workColor}
                  fillOpacity={0.35}
                  weight={2}
                  opacity={0.80}
                >
                  {activeObbArea >= 50 && (
                    <Tooltip permanent direction="center" offset={[0, 0]} className="hull-label">
                      <div style={{ textAlign: 'center', lineHeight: 1.4 }}>
                        {formatArea(activeObbArea)}
                        {(currentVolumeM3 ?? 0) > 0 && <><br />{currentVolumeM3!.toFixed(1)} m³</>}
                      </div>
                    </Tooltip>
                  )}
                </Polygon>
              )}
              {trail.length > 1 && (
                <Polyline positions={trail} color={workColor} weight={1.5} opacity={0.40} dashArray="3 6" />
              )}
            </>
          : obbResult && largeurM > 0
            ? <>
                <Polygon
                  positions={obbResult.polygon.map(p => [p.lat, p.lng] as [number, number])}
                  color={workColor}
                  fillColor={workColor}
                  fillOpacity={0.45}
                  weight={1.5}
                  opacity={0.75}
                >
                  {activeObbArea >= 50 && (
                    <Tooltip permanent direction="center" offset={[0, 0]} className="hull-label">
                      {formatArea(activeObbArea)}
                    </Tooltip>
                  )}
                </Polygon>
                {trail.length > 1 && (
                  <Polyline positions={trail} color={workColor} weight={1.5} opacity={0.35} dashArray="3 6" />
                )}
              </>
            : trail.length > 1 && (
                <Polyline positions={trail} color={workColor} weight={4} opacity={0.85} />
              )
        }

        {/* Total hull — all sessions merged */}
        {isDragage && viewMode === 'total' && totalHullData && (
          <Polygon
            positions={totalHullData.positions}
            color="#3b82f6"
            fillColor="#3b82f6"
            fillOpacity={0.30}
            weight={2}
            opacity={0.85}
          >
            <Tooltip permanent direction="center" offset={[0, 0]} className="hull-label">
              <div style={{ textAlign: 'center', lineHeight: 1.4 }}>
                {formatArea(totalHullData.totalArea)}
                {totalHullData.totalVol > 0 && <><br />{totalHullData.totalVol.toFixed(1)} m³</>}
              </div>
            </Tooltip>
          </Polygon>
        )}

        {/* Draw polygon */}
        {drawPoints.length >= 3 && (
          <Polygon
            positions={drawPoints.map(p => [p.lat, p.lng] as [number, number])}
            color="#3b82f6"
            fillColor="#3b82f6"
            fillOpacity={0.2}
            weight={2}
          />
        )}
        {drawMode && drawPoints.map((p, i) => (
          <Marker key={i} position={[p.lat, p.lng]} icon={drawIcon} />
        ))}

        {/* Live other-operator GPS trails */}
        {liveSessions
          .filter(s => s.sessionId !== mySessionId && s.recentTrack && s.recentTrack.length > 1)
          .map(s => (
            <Polyline
              key={`trail-${s.sessionId}`}
              positions={s.recentTrack!.map(p => [p.lat, p.lng] as [number, number])}
              color="#f97316"
              weight={3}
              opacity={0.65}
              dashArray="4 4"
            />
          ))
        }

        {/* Live other-operator markers */}
        {liveSessions
          .filter(s => s.sessionId !== mySessionId)
          .map(s => (
            <Marker key={s.sessionId} position={[s.lat, s.lng]}
              icon={liveIcon(s.operateur === 'salarie' ? salarieName : 'Patron')} />
          ))
        }

        {/* Current GPS position — machine icon during session, simple dot otherwise */}
        {currentPos && (
          sessionActive && smoothed.length >= 2
            ? <Marker
                position={[currentPos.lat, currentPos.lng]}
                icon={isDragage
                  ? dragueIcon(machineBearing, workColor)
                  : machineIcon(machineBearing, largeurM, workColor)}
              />
            : <Marker
                position={[currentPos.lat, currentPos.lng]}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="width:18px;height:18px;border-radius:50%;background:#22c55e;border:3px solid white;box-shadow:0 0 0 4px rgba(34,197,94,.3);"></div>`,
                  iconSize: [18, 18], iconAnchor: [9, 9],
                })}
              />
        )}
      </MapContainer>

      {/* Area overlay in draw mode */}
      {drawMode && drawnArea > 0 && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[1000]
          bg-blue-600 text-white text-sm font-bold px-4 py-2 rounded-xl shadow-lg">
          {formatArea(drawnArea)}
        </div>
      )}

      {/* View mode toggle — drague only */}
      {isDragage && (
        <div className="absolute top-2 left-2 z-[1000] flex flex-col gap-1">
          {(['sessions', 'total', 'depth'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`text-xs px-2 py-1 rounded-lg font-semibold shadow backdrop-blur-sm transition
                ${viewMode === mode ? 'bg-blue-600 text-white' : 'bg-black/50 text-white/80 hover:bg-black/70'}`}
            >
              {mode === 'sessions' ? 'Sessions' : mode === 'total' ? 'Total' : 'Profondeur'}
            </button>
          ))}
        </div>
      )}

      {/* Depth legend */}
      {isDragage && viewMode === 'depth' && maxDepthM > 0 && (
        <div className="absolute bottom-8 left-2 z-[1000] bg-black/70 text-white text-xs rounded-lg px-3 py-2 backdrop-blur-sm">
          <div className="font-bold mb-1">Profondeur curée</div>
          <div style={{ background: 'linear-gradient(to right, #bfdbfe, #1e3a8a)', width: 100, height: 10, borderRadius: 3 }} />
          <div className="flex justify-between mt-1 opacity-80">
            <span>0 m</span>
            <span>{maxDepthM.toFixed(1)} m</span>
          </div>
        </div>
      )}
    </div>
  );
}
