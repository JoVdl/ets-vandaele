import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, Polygon, Tooltip, useMap } from 'react-leaflet';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import type { SuiviSession } from '../../types/suivi';
import type { AlignedRect } from '../../lib/alignedVolumes';
import { HIST_PALETTE } from './incidentUtils';
import EditableZone from './EditableZone';
import { overlapM2 } from '../../lib/alignedVolumes';

function FitAll({ bounds }: { bounds: [[number, number], [number, number]] | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [30, 30] });
  }, [map, bounds]);
  return null;
}

// All past sessions of a chantier on one map, so zones can be arranged relative to each other.
export default function ZoneEditor({ sessions, rectOf, isEditable, onSave, onClose }: {
  sessions: SuiviSession[];
  rectOf: (s: SuiviSession) => AlignedRect | undefined;
  isEditable: (id: string) => boolean;
  onSave: (id: string, corners: [number, number][] | null) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = useMemo(() => sessions
    .map((s, i) => ({ s, i, rect: rectOf(s) }))
    .filter((x): x is { s: SuiviSession; i: number; rect: AlignedRect } => !!x.rect), [sessions, rectOf]);
  const bounds = useMemo<[[number, number], [number, number]] | null>(() => {
    const pts = items.flatMap(x => x.rect.polygon);
    if (pts.length === 0) return null;
    return [
      [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1]))],
      [Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))],
    ];
  }, [items]);
  const selected = items.find(x => x.s.id === selectedId) ?? null;
  const selectedEditable = !!selected && isEditable(selected.s.id);
  const overlapping = selected ? items.filter(x => x.s.id !== selected.s.id).reduce((a, x) => a + overlapM2(selected.rect.polygon, x.rect.polygon), 0) : 0;
  const handleChange = useCallback(
    (c: [number, number][]) => { if (selectedId) onSave(selectedId, c); },
    [selectedId, onSave],
  );

  return createPortal(
    <div className="fixed inset-0 z-[500] bg-slate-950 flex flex-col">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-white/[0.07] flex-shrink-0">
        <button onClick={onClose} className="p-1.5 -ml-1 text-slate-400 hover:text-white"><ArrowLeft size={20} /></button>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm">Zones de travail</p>
          <p className="text-slate-500 text-[10px]">Touche une zone, puis carrés : coins · barres : côtés · rond : déplacer</p>
        </div>
      </div>
      <div className="flex-1 relative">
        <MapContainer center={[0, 0]} zoom={17} style={{ height: '100%', width: '100%' }} zoomControl>
          <TileLayer
            url="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
            attribution="© IGN"
            maxZoom={20}
          />
          <FitAll bounds={bounds} />
          {items.map(({ s, i, rect }) => {
            const color = HIST_PALETTE[i % HIST_PALETTE.length];
            const active = s.id === selectedId;
            return (
              <Polygon
                key={s.id}
                positions={rect.polygon}
                color={color}
                fillColor={color}
                fillOpacity={active ? 0.45 : 0.22}
                weight={active ? 3 : 1.5}
                eventHandlers={{ click: () => setSelectedId(s.id) }}
              >
                <Tooltip sticky>{format(new Date(s.dateDebut), 'dd/MM HH:mm')} · {rect.volumeM3 != null ? `${rect.volumeM3.toFixed(0)} m³` : ''}</Tooltip>
              </Polygon>
            );
          })}
          {selected && selectedEditable && (
            <EditableZone corners={selected.rect.polygon} onChange={handleChange} />
          )}
        </MapContainer>
      </div>
      <div className="flex-shrink-0 px-3 py-2 border-t border-white/[0.07] space-y-2">
        <div className="flex gap-1.5 overflow-x-auto">
          {items.map(({ s, i }) => (
            <button key={s.id} onClick={() => setSelectedId(s.id)}
              className={`px-2 py-1 rounded-lg text-[11px] whitespace-nowrap ${s.id === selectedId ? 'bg-cyan-600 text-white' : 'bg-white/[0.06] text-slate-300'}`}>
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: HIST_PALETTE[i % HIST_PALETTE.length] }} />
              {format(new Date(s.dateDebut), 'dd/MM HH:mm')}
            </button>
          ))}
        </div>
        {selected && (
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>{selectedEditable ? 'Session passée : modifiable' : 'Session en cours : non modifiable'}{overlapping > 0 && <b className="text-red-400"> · chevauchement {overlapping.toFixed(0)} m²</b>}</span>
            {selectedEditable && selected.s.zoneOverride && (
              <button onClick={() => onSave(selected.s.id, null)} className="px-2 py-1 rounded bg-white/[0.08] flex items-center gap-1"><RotateCcw size={11} />Rétablir</button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
