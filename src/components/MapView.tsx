import { useEffect, useRef } from 'react';
import type { Chantier } from '../types';
import { CHANTIER_TYPES } from '../lib/constants';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Props {
  chantiers: Chantier[];
  onClickChantier: (c: Chantier) => void;
}

// Lazy-load Leaflet only when map mounts (avoids SSR issues and keeps bundle lean)
export default function MapView({ chantiers, onClickChantier }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let destroyed = false;

    import('leaflet').then(L => {
      if (destroyed || !containerRef.current) return;

      // Leaflet default icon fix for bundlers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });

      // Default center on France if no chantiers located
      const withCoords = chantiers.filter(c => c.latitude && c.longitude);
      const center: [number, number] = withCoords.length
        ? [
            withCoords.reduce((s, c) => s + c.latitude!, 0) / withCoords.length,
            withCoords.reduce((s, c) => s + c.longitude!, 0) / withCoords.length,
          ]
        : [46.5, 2.3];

      const map = L.map(containerRef.current!).setView(center, withCoords.length ? 8 : 6);
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 150);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(map);

      // Add markers
      for (const c of withCoords) {
        const meta = CHANTIER_TYPES[c.type];
        const isPotentiel = c.status === 'potentiel';

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
          <path d="M14 1C7.37 1 2 6.37 2 13c0 8.5 12 22 12 22S26 21.5 26 13C26 6.37 20.63 1 14 1Z"
            fill="${meta.color}" stroke="white" stroke-width="2" opacity="${isPotentiel ? 0.6 : 1}"/>
          ${isPotentiel ? `<circle cx="14" cy="13" r="5" fill="white" opacity="0.6"/>` : `<circle cx="14" cy="13" r="5" fill="white"/>`}
        </svg>`;

        const icon = L.divIcon({
          html: svg,
          iconSize: [28, 36],
          iconAnchor: [14, 36],
          popupAnchor: [0, -36],
          className: '',
        });

        const dateStr = `${format(new Date(c.dateDebut), 'd MMM', { locale: fr })} – ${format(new Date(c.dateFin), 'd MMM yyyy', { locale: fr })}`;
        const popup = `
          <div style="min-width:180px;font-family:sans-serif">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <div style="width:10px;height:10px;border-radius:50%;background:${meta.color};flex-shrink:0"></div>
              <strong style="font-size:13px">${c.nom}</strong>
            </div>
            ${c.client ? `<div style="font-size:11px;color:#64748b">${c.client}</div>` : ''}
            <div style="font-size:11px;color:#64748b;margin-top:2px">${dateStr}</div>
            ${c.chiffreAffaire ? `<div style="font-size:11px;font-weight:600;color:#1e293b;margin-top:2px">${c.chiffreAffaire.toLocaleString('fr-FR')} €</div>` : ''}
            <div style="margin-top:6px">
              <span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;background:${meta.color};color:white">
                ${meta.label}
              </span>
              <span style="display:inline-block;margin-left:4px;padding:2px 8px;border-radius:12px;font-size:10px;background:${isPotentiel ? '#f1f5f9' : '#dcfce7'};color:${isPotentiel ? '#64748b' : '#166534'}">
                ${isPotentiel ? 'Potentiel' : 'Confirmé'}
              </span>
            </div>
            <button
              style="margin-top:8px;width:100%;padding:4px;background:#2563eb;color:white;border:none;border-radius:6px;font-size:11px;cursor:pointer"
              onclick="window.__mapEditChantier('${c.id}')">
              Modifier
            </button>
          </div>`;

        L.marker([c.latitude!, c.longitude!], { icon })
          .bindPopup(popup)
          .addTo(map);
      }

      // Register global callback for popup edit button
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__mapEditChantier = (id: string) => {
        const found = chantiers.find(c => c.id === id);
        if (found) onClickChantier(found);
      };

      // Fit bounds if we have markers
      if (withCoords.length > 1) {
        map.fitBounds(
          withCoords.map(c => [c.latitude!, c.longitude!] as [number, number]),
          { padding: [40, 40] }
        );
      }
    });

    return () => {
      destroyed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  // Run once on mount; chantier data updates handled by key prop in parent
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const withCoords = chantiers.filter(c => c.latitude && c.longitude);

  return (
    <div className="flex-1 flex flex-col relative">
      {withCoords.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-white/90 rounded-xl shadow-lg px-6 py-4 text-center max-w-xs">
            <p className="text-sm font-medium text-slate-700 mb-1">Aucun chantier géolocalisé</p>
            <p className="text-xs text-slate-400">
              Ouvrez un chantier et cliquez sur <strong>📍</strong> pour le géocoder automatiquement depuis son nom / adresse.
            </p>
          </div>
        </div>
      )}
      <div ref={containerRef} className="flex-1" style={{ minHeight: 400 }} />
      {withCoords.length > 0 && (
        <div className="absolute bottom-4 left-4 z-[1000] bg-white rounded-lg shadow-lg px-3 py-2 text-xs text-slate-500">
          {withCoords.length} / {chantiers.length} chantiers géolocalisés
        </div>
      )}
    </div>
  );
}
