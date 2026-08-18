import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GpsPoint } from '../../types/suivi';
import { areaM2, formatArea, centroid, swathRects, smoothPoints } from '../../lib/geo';
import type { LiveSession } from '../../hooks/useLiveSessions';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const currentIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:18px;height:18px;border-radius:50%;
    background:#22c55e;border:3px solid white;
    box-shadow:0 0 0 4px rgba(34,197,94,.3);
  "></div>`,
  iconSize: [18, 18], iconAnchor: [9, 9],
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

function AutoCenter({ pos, follow }: { pos: [number, number] | null; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (follow && pos) map.setView(pos, map.getZoom(), { animate: true });
  }, [pos, follow, map]);
  return null;
}

function DrawHandler({ active, onPoint }: { active: boolean; onPoint: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) { if (active) onPoint(e.latlng.lat, e.latlng.lng); },
  });
  return null;
}

export interface ChantierZone {
  id: string;
  nom: string;
  polygons: { lat: number; lng: number }[][];
  color: string;
}

interface Props {
  gpsPoints:     GpsPoint[];
  currentPos:    GpsPoint | null;
  drawMode:      boolean;
  drawPoints:    { lat: number; lng: number }[];
  onDrawPoint:   (lat: number, lng: number) => void;
  followGps:     boolean;
  chantierZones: ChantierZone[];
  showZones:     boolean;
  satellite:     'ign' | 'esri' | 'osm';
  workColor:     string;
  largeurM:      number;
  smoothAlpha:   number;
  liveSessions:  LiveSession[];  // other operators (patron view)
  mySessionId:   string;         // exclude own session from live markers
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
  followGps, chantierZones, showZones, satellite,
  workColor, largeurM, smoothAlpha, liveSessions, mySessionId,
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
  const tileKey = satellite as string;
  const { url: tileUrl, attr: tileAttr } = tiles[tileKey] ?? tiles.ign;

  // Smooth GPS points for display
  const smoothed = useMemo(
    () => smoothPoints(gpsPoints, smoothAlpha),
    [gpsPoints, smoothAlpha],
  );

  // Swath rectangles (one per GPS segment)
  const rects = useMemo(
    () => swathRects(smoothed, largeurM / 2),
    [smoothed, largeurM],
  );

  // Fallback polyline when no width
  const trail = useMemo(
    () => smoothed.map(p => [p.lat, p.lng] as [number, number]),
    [smoothed],
  );

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={center}
        zoom={17}
        className="w-full h-full"
        zoomControl={false}
        preferCanvas={true}
      >
        <TileLayer key={satellite ? 'sat' : 'osm'} url={tileUrl} attribution={tileAttr} maxZoom={20} />

        <AutoCenter pos={currentPos ? [currentPos.lat, currentPos.lng] : null} follow={followGps} />
        <DrawHandler active={drawMode} onPoint={onDrawPoint} />

        {/* Chantier zones permanentes */}
        {showZones && chantierZones.flatMap(z => {
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
                fillOpacity={0.22}
                weight={2.5}
              />
            )),
            <Marker key={`label-${z.id}`} position={[c.lat, c.lng]} icon={zoneLabel(z.nom, z.color)} />,
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

        {/* Current GPS position */}
        {currentPos && (
          <Marker position={[currentPos.lat, currentPos.lng]} icon={currentIcon} />
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
