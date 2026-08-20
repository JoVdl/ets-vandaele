import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GpsPoint } from '../../types/suivi';
import { areaM2, formatArea, centroid, swathRects, smoothPoints, distanceM } from '../../lib/geo';
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

function AutoCenter({ pos, follow }: { pos: [number, number] | null; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (follow && pos) map.setView(pos, map.getZoom(), { animate: true });
  }, [pos, follow, map]);
  return null;
}

function JumpTo({ pos }: { pos: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (pos) map.setView(pos, Math.max(map.getZoom(), 17), { animate: true });
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
  gpsPoints:        GpsPoint[];
  currentPos:       GpsPoint | null;
  drawMode:         boolean;
  drawPoints:       { lat: number; lng: number }[];
  onDrawPoint:      (lat: number, lng: number) => void;
  followGps:        boolean;
  onDisableFollow:  () => void;
  chantierZones:    ChantierZone[];
  selectedZoneId:   string;
  onZoneClick:      (id: string) => void;
  showZones:        boolean;
  satellite:        'ign' | 'esri' | 'osm';
  workColor:        string;
  largeurM:         number;
  smoothAlpha:      number;
  sessionActive:    boolean;
  jumpToPos:        [number, number] | null;
  liveSessions:     LiveSession[];
  mySessionId:      string;
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
  sessionActive, jumpToPos, liveSessions, mySessionId,
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

  const rects = useMemo(
    () => swathRects(smoothed, largeurM / 2),
    [smoothed, largeurM],
  );

  const trail = useMemo(
    () => smoothed.map(p => [p.lat, p.lng] as [number, number]),
    [smoothed],
  );

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

        {/* Work trail — swath rectangles or polyline */}
        {largeurM > 0
          ? rects.map((rect, i) => (
              <Polygon
                key={i}
                positions={rect}
                color={workColor}
                fillColor={workColor}
                fillOpacity={0.55}
                weight={0}
                stroke={false}
              />
            ))
          : trail.length > 1 && (
              <Polyline positions={trail} color={workColor} weight={4} opacity={0.85} />
            )
        }

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

        {/* Live other-operator markers */}
        {liveSessions
          .filter(s => s.sessionId !== mySessionId)
          .map(s => (
            <Marker key={s.sessionId} position={[s.lat, s.lng]}
              icon={liveIcon(s.operateur === 'salarie' ? 'Salarié' : 'Patron')} />
          ))
        }

        {/* Current GPS position — machine icon during session, simple dot otherwise */}
        {currentPos && (
          sessionActive && smoothed.length >= 2
            ? <Marker
                position={[currentPos.lat, currentPos.lng]}
                icon={machineIcon(machineBearing, largeurM, workColor)}
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
    </div>
  );
}
