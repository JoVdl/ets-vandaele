import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GpsPoint } from '../../types/suivi';
import { areaM2, formatArea } from '../../lib/geo';

// Fix default icon paths broken by Vite
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
  iconSize:   [18, 18],
  iconAnchor: [9, 9],
});

const drawIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:14px;height:14px;border-radius:50%;
    background:#3b82f6;border:2px solid white;
    box-shadow:0 0 0 3px rgba(59,130,246,.4);
  "></div>`,
  iconSize:   [14, 14],
  iconAnchor: [7, 7],
});

// Re-centers map when GPS position changes
function AutoCenter({ pos, follow }: { pos: [number, number] | null; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (follow && pos) map.setView(pos, map.getZoom(), { animate: true });
  }, [pos, follow, map]);
  return null;
}

// Capture map clicks in draw mode
function DrawHandler({
  active,
  onPoint,
}: {
  active: boolean;
  onPoint: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (active) onPoint(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

interface Props {
  gpsPoints:     GpsPoint[];
  currentPos:    GpsPoint | null;
  drawMode:      boolean;
  drawPoints:    { lat: number; lng: number }[];
  onDrawPoint:   (lat: number, lng: number) => void;
  followGps:     boolean;
}

export default function SuiviMap({
  gpsPoints, currentPos, drawMode, drawPoints, onDrawPoint, followGps,
}: Props) {

  const trail = useMemo(
    () => gpsPoints.map(p => [p.lat, p.lng] as [number, number]),
    [gpsPoints],
  );

  const center: [number, number] = currentPos
    ? [currentPos.lat, currentPos.lng]
    : [50.4, 2.8];  // default: Hauts-de-France

  const drawnArea = drawPoints.length >= 3 ? areaM2(drawPoints) : 0;

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={center}
        zoom={17}
        className="w-full h-full"
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://openstreetmap.org">OSM</a>'
          maxZoom={20}
        />

        <AutoCenter pos={currentPos ? [currentPos.lat, currentPos.lng] : null} follow={followGps} />
        <DrawHandler active={drawMode} onPoint={onDrawPoint} />

        {/* GPS trail */}
        {trail.length > 1 && (
          <Polyline positions={trail} color="#22c55e" weight={4} opacity={0.85} />
        )}

        {/* Draw polygon */}
        {drawPoints.length >= 3 && (
          <Polygon
            positions={drawPoints.map(p => [p.lat, p.lng])}
            color="#3b82f6"
            fillColor="#3b82f6"
            fillOpacity={0.2}
            weight={2}
          />
        )}
        {drawMode && drawPoints.map((p, i) => (
          <Marker key={i} position={[p.lat, p.lng]} icon={drawIcon} />
        ))}

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
