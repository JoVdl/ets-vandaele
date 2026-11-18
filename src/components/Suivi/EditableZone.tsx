import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

type LL = [number, number];
const M = 111320;

// Editing handles: corners move one point; side handles stretch that side perpendicular to itself;
// the centre handle moves the whole zone.
export default function EditableZone({ corners, onChange }: { corners: LL[]; onChange: (c: LL[]) => void }) {
  const map = useMap();
  useEffect(() => {
    let cur: LL[] = corners.map(c => [c[0], c[1]] as LL);
    const lat0 = cur.reduce((a, p) => a + p[0], 0) / cur.length;
    const k = Math.cos(lat0 * Math.PI / 180) * M;
    const centre = (): LL => [
      cur.reduce((a, p) => a + p[0], 0) / cur.length,
      cur.reduce((a, p) => a + p[1], 0) / cur.length,
    ];
    const mid = (i: number): LL => {
      const a = cur[i], b = cur[(i + 1) % 4];
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    };
    const cornerIcon = L.divIcon({ className: '', html: '<div style="width:14px;height:14px;border-radius:3px;background:#fff;border:2px solid #f59e0b"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
    const sideIcon = L.divIcon({ className: '', html: '<div style="width:22px;height:10px;border-radius:3px;background:#f59e0b;border:2px solid #fff"></div>', iconSize: [22, 10], iconAnchor: [11, 5] });
    const centreIcon = L.divIcon({ className: '', html: '<div style="width:18px;height:18px;border-radius:50%;background:#f59e0b;border:2px solid #fff"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
    const poly = L.polygon(cur, { color: '#f59e0b', weight: 2, fillOpacity: 0.15, dashArray: '4 4' }).addTo(map);

    let centreMarker: L.Marker | null = null;
    const sides: L.Marker[] = [];
    const refresh = () => {
      poly.setLatLngs(cur);
      sides.forEach((m, i) => m.setLatLng(mid(i)));
      centreMarker?.setLatLng(centre());
    };
    const commit = () => onChange(cur.map(q => [q[0], q[1]] as LL));

    const corner = cur.map((p, i) => {
      const m = L.marker(p, { icon: cornerIcon, draggable: true }).addTo(map);
      m.on('drag', e => {
        const ll = (e.target as L.Marker).getLatLng();
        cur[i] = [ll.lat, ll.lng];
        refresh();
      });
      m.on('dragend', commit);
      return m;
    });

    for (let i = 0; i < 4; i++) {
      const m = L.marker(mid(i), { icon: sideIcon, draggable: true }).addTo(map);
      let last = mid(i);
      m.on('drag', e => {
        const ll = (e.target as L.Marker).getLatLng();
        // Movement of the handle, projected on the side's normal in metres
        const dx = (ll.lng - last[1]) * k, dy = (ll.lat - last[0]) * M;
        const a = cur[i], b = cur[(i + 1) % 4];
        const ex = (b[1] - a[1]) * k, ey = (b[0] - a[0]) * M;
        const len = Math.hypot(ex, ey);
        if (len < 1e-9) return;
        const nx = -ey / len, ny = ex / len;
        const s = dx * nx + dy * ny;
        const ddLat = (s * ny) / M, ddLng = (s * nx) / k;
        cur[i] = [a[0] + ddLat, a[1] + ddLng];
        cur[(i + 1) % 4] = [b[0] + ddLat, b[1] + ddLng];
        refresh();
        last = mid(i);
        m.setLatLng(last);
      });
      m.on('dragend', commit);
      sides.push(m);
    }

    centreMarker = L.marker(centre(), { icon: centreIcon, draggable: true }).addTo(map);
    let lastC = centre();
    centreMarker.on('drag', e => {
      const ll = (e.target as L.Marker).getLatLng();
      const dLat = ll.lat - lastC[0], dLng = ll.lng - lastC[1];
      cur = cur.map(q => [q[0] + dLat, q[1] + dLng] as LL);
      lastC = [ll.lat, ll.lng];
      refresh();
      corner.forEach((m, i) => m.setLatLng(cur[i]));
    });
    centreMarker.on('dragend', commit);

    const all: L.Marker[] = [...corner, ...sides, centreMarker];
    return () => {
      poly.remove();
      all.forEach(m => m.remove());
    };
  }, [map, corners, onChange]);
  return null;
}
