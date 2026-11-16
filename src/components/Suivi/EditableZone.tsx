import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

export default function EditableZone({ corners, onChange }: { corners: [number, number][]; onChange: (c: [number, number][]) => void }) {
  const map = useMap();
  useEffect(() => {
    let cur: [number, number][] = corners.map(c => [c[0], c[1]] as [number, number]);
    const centre = (): [number, number] => [
      cur.reduce((a, p) => a + p[0], 0) / cur.length,
      cur.reduce((a, p) => a + p[1], 0) / cur.length,
    ];
    const cornerIcon = L.divIcon({ className: '', html: '<div style="width:14px;height:14px;border-radius:3px;background:#fff;border:2px solid #f59e0b"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
    const centreIcon = L.divIcon({ className: '', html: '<div style="width:18px;height:18px;border-radius:50%;background:#f59e0b;border:2px solid #fff"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
    const poly = L.polygon(cur, { color: '#f59e0b', weight: 2, fillOpacity: 0.15, dashArray: '4 4' }).addTo(map);
    let centreMarker: L.Marker | null = null;
    const handles = cur.map((p, i) => {
      const m = L.marker(p, { icon: cornerIcon, draggable: true }).addTo(map);
      m.on('drag', e => {
        const ll = (e.target as L.Marker).getLatLng();
        cur[i] = [ll.lat, ll.lng];
        poly.setLatLngs(cur);
        centreMarker?.setLatLng(centre());
      });
      m.on('dragend', () => onChange(cur.map(q => [q[0], q[1]] as [number, number])));
      return m;
    });
    centreMarker = L.marker(centre(), { icon: centreIcon, draggable: true }).addTo(map);
    let last = centre();
    centreMarker.on('drag', e => {
      const ll = (e.target as L.Marker).getLatLng();
      const dLat = ll.lat - last[0], dLng = ll.lng - last[1];
      cur = cur.map(q => [q[0] + dLat, q[1] + dLng] as [number, number]);
      last = [ll.lat, ll.lng];
      poly.setLatLngs(cur);
      handles.forEach((h, i) => h.setLatLng(cur[i]));
    });
    centreMarker.on('dragend', () => onChange(cur.map(q => [q[0], q[1]] as [number, number])));
    const cm = centreMarker;
    return () => {
      poly.remove();
      handles.forEach(h => h.remove());
      cm.remove();
    };
  }, [map, corners, onChange]);
  return null;
}
