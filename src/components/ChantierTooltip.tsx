import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { MapPin, Users, User, Calendar, Euro, Lock, HardHat, CheckCheck, CircleAlert } from 'lucide-react';
import cenLogoUrl from '../assets/cen-logo.png';
import type { Chantier } from '../types';
import { CHANTIER_TYPES } from '../lib/constants';
import { countWorkingDays, caAnnuel } from '../lib/workingDays';
import { getEffectiveEtat, ETAT_LABELS, ETAT_COLORS } from '../lib/etat';
import {
  ExcavatorIcon, DumperIcon, TractoBenneIcon, BullIcon,
  CheniletteIcon, BateauFaucardeurIcon, DragueIcon, TelescoIcon,
} from './EquipmentIcons';
import { getTransfertInfo } from '../lib/geo';

interface Props {
  chantier: Chantier;
  x: number; // page X of mouse
  y: number; // page Y of mouse
  /** Si fourni, le transfert est calculé depuis ce chantier et non depuis le dépôt */
  fromChantier?: Chantier;
}

// ── OSM tile math ────────────────────────────────────────────────────────────

function latLonToTileFrac(lat: number, lon: number, zoom: number) {
  const n  = 2 ** zoom;
  const tx = (lon + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const ty = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return { tx, ty };
}

const TILE_SZ = 256;
const MAP_W   = 200;
const MAP_H   = 130;
const ZOOM    = 13;

function TileMap({ lat, lon }: { lat: number; lon: number }) {
  const { tx, ty } = latLonToTileFrac(lat, lon, ZOOM);
  const txi = Math.floor(tx);
  const tyi = Math.floor(ty);
  const ox  = (tx - txi) * TILE_SZ; // pixel offset of center within its tile
  const oy  = (ty - tyi) * TILE_SZ;

  // 3×3 grid so we never hit an edge
  const tiles: Array<{ x: number; y: number; dx: number; dy: number }> = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      tiles.push({ x: txi + dx, y: tyi + dy, dx, dy });

  return (
    <div style={{ width: MAP_W, height: MAP_H, overflow: 'hidden', position: 'relative', borderRadius: 6, flexShrink: 0 }}>
      {tiles.map(t => (
        <img
          key={`${t.dx},${t.dy}`}
          src={`https://tile.openstreetmap.org/${ZOOM}/${t.x}/${t.y}.png`}
          style={{
            position: 'absolute',
            width: TILE_SZ, height: TILE_SZ,
            left: MAP_W / 2 - ox + t.dx * TILE_SZ,
            top:  MAP_H / 2 - oy + t.dy * TILE_SZ,
            imageRendering: 'auto',
          }}
          alt=""
        />
      ))}
      {/* Attribution */}
      <div style={{ position: 'absolute', bottom: 0, right: 0, fontSize: 8, background: 'rgba(255,255,255,0.7)', padding: '1px 3px', color: '#555' }}>
        © OSM
      </div>
      {/* Marker */}
      <div style={{
        position: 'absolute',
        left: MAP_W / 2,
        top:  MAP_H / 2,
        transform: 'translate(-50%, -100%)',
        fontSize: 18,
        lineHeight: 1,
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
        pointerEvents: 'none',
      }}>📍</div>
    </div>
  );
}

// ── Equipment summary ────────────────────────────────────────────────────────

function EquipSummary({ c }: { c: Chantier }) {
  const items: Array<{ icon: React.ReactNode; label: string }> = [];
  if (c.pelles?.length) c.pelles.forEach(t => items.push({ icon: <ExcavatorIcon size={11}/>, label: t }));
  if (c.dumpers)        items.push({ icon: <DumperIcon size={11}/>,           label: `Dumper ×${c.dumpers}` });
  if (c.tractoBennes)   items.push({ icon: <TractoBenneIcon size={11}/>,      label: `TB ×${c.tractoBennes}` });
  if (c.bulls)          items.push({ icon: <BullIcon size={11}/>,             label: `Bull ×${c.bulls}` });
  if (c.chenillette)    items.push({ icon: <CheniletteIcon size={11}/>,      label: 'Chenillette' });
  if (c.bateauFaucardeur) items.push({ icon: <BateauFaucardeurIcon size={11}/>, label: 'Bateau fauc.' });
  if (c.drague)         items.push({ icon: <DragueIcon size={11}/>,          label: 'Drague' });
  if (c.telesco)        items.push({ icon: <TelescoIcon size={11}/>,         label: 'Télesco' });
  if (c.transfertTracteur) items.push({ icon: <span style={{fontSize:11}}>🚜</span>, label: 'Transfert tracteur' });
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-slate-100 rounded text-[10px] text-slate-600">
          {it.icon} {it.label}
        </span>
      ))}
    </div>
  );
}

// ── Main tooltip ─────────────────────────────────────────────────────────────

export default function ChantierTooltip({ chantier: c, x, y, fromChantier }: Props) {
  const ref  = useRef<HTMLDivElement>(null);
  const meta = CHANTIER_TYPES[c.type];
  const isPotentiel = c.status === 'potentiel';
  const isArchived  = c.status === 'refuse' || c.status === 'annule';
  const etat        = getEffectiveEtat(c);
  const isPast      = !isPotentiel && !isArchived && etat === 'termine';
  const nb   = c.nombrePersonnes ?? 1;
  const hasMap = !!(c.latitude && c.longitude);

  const dateStr = `${format(new Date(c.dateDebut), 'd MMM', { locale: fr })} → ${format(new Date(c.dateFin), 'd MMM yyyy', { locale: fr })}`;
  const wd = countWorkingDays(new Date(c.dateDebut), new Date(c.dateFin));
  const nAns = c.nombreAnnees ?? 1;
  const caAn = caAnnuel(c.chiffreAffaire, c.nombreAnnees);
  const caParJour = wd > 0 && caAn > 0 ? Math.round(caAn / wd) : 0;
  const isMultiYear = nAns > 1;

  // Reposition after mount so it stays on screen
  useEffect(() => {
    if (!ref.current) return;
    const el   = ref.current;
    const rect = el.getBoundingClientRect();
    const vpW  = window.innerWidth;
    const vpH  = window.innerHeight;

    let left = x + 16;
    let top  = y - 10;

    if (left + rect.width  > vpW - 8) left = x - rect.width - 16;
    if (top  + rect.height > vpH - 8) top  = vpH - rect.height - 8;
    if (top < 8) top = 8;

    el.style.left = `${left}px`;
    el.style.top  = `${top}px`;
    el.style.opacity = '1';
  }, [x, y]);

  const tooltip = (
    <div
      ref={ref}
      className="fixed z-[9999] pointer-events-none opacity-0 transition-opacity duration-100"
      style={{ top: y, left: x + 16, maxWidth: hasMap ? 440 : 260 }}
    >
      <div className="bg-white rounded-xl shadow-2xl border border-slate-100 overflow-hidden text-sm">
        {/* Header bar */}
        <div className="h-1" style={{ backgroundColor: meta.color }} />

        <div className="flex gap-0">
          {/* Info panel */}
          <div className="px-3 py-2.5 flex-1 min-w-0" style={{ maxWidth: 230 }}>
            {/* Type + status */}
            <div className="flex items-center gap-1.5 mb-1">
              <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: meta.color }} />
              <span className="text-[10px] text-slate-400">{meta.label}</span>
              <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${
                isArchived  ? 'bg-slate-100 text-slate-400 line-through' :
                isPotentiel ? 'bg-slate-100 text-slate-500' :
                              'bg-green-50 text-green-700'
              }`}>
                {c.status === 'refuse' ? 'Refusé' : c.status === 'annule' ? 'Annulé' : isPotentiel ? 'Potentiel' : 'Confirmé'}
              </span>
              {!isArchived && !isPotentiel && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${ETAT_COLORS[etat].bg} ${ETAT_COLORS[etat].text} ${ETAT_COLORS[etat].border}`}>
                  {ETAT_LABELS[etat]}
                </span>
              )}
              {c.datesVerrouillees && (
                <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700" title="Dates verrouillées — exclues de la réorganisation">
                  <Lock size={9}/> Verrouillé
                </span>
              )}
            </div>

            {/* Name */}
            <p className="font-semibold text-slate-800 text-sm leading-tight">{c.nom}</p>
            {c.client && (
              <div className="flex items-center gap-1.5 mt-0.5">
                {c.client.toUpperCase().includes('CEN') && (
                  <img src={cenLogoUrl} alt="CEN" style={{ height: 14, width: 'auto' }} />
                )}
                <p className="text-xs text-slate-500">{c.client}</p>
              </div>
            )}

            {/* Dates */}
            <div className="flex items-center gap-1 mt-1.5 text-xs text-slate-500 flex-wrap">
              <Calendar size={11} className="flex-shrink-0"/>
              <span>{dateStr}</span>
              {wd > 0 && (
                <span className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-medium text-slate-500 flex-shrink-0">
                  {wd} j ouvrés
                </span>
              )}
            </div>

            {/* Lieu */}
            {(c.lieu || c.adresse) && (
              <div className="flex items-center gap-1 mt-0.5 text-xs text-slate-500">
                <MapPin size={11} className="flex-shrink-0"/>
                <span className="truncate">{c.lieu || c.adresse}</span>
              </div>
            )}

            {/* CA */}
            {c.chiffreAffaire > 0 && (
              <div className="flex items-center gap-1.5 mt-0.5 text-xs font-semibold text-slate-700">
                <Euro size={11} className="flex-shrink-0"/>
                {c.chiffreAffaire.toLocaleString('fr-FR')} €
                {isMultiYear && (
                  <span className="text-[10px] font-normal text-indigo-500 px-1 py-0.5 bg-indigo-50 rounded">contrat {nAns} ans</span>
                )}
                {caParJour > 0 && (
                  <span className="text-[10px] font-normal text-slate-400">
                    ({caParJour.toLocaleString('fr-FR')} €/j)
                  </span>
                )}
              </div>
            )}

            {/* Personnel */}
            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-500 flex-wrap">
              {nb >= 2 ? <Users size={11}/> : <User size={11}/>}
              <span>{nb} personne{nb > 1 ? 's' : ''}</span>
              {c.patronRequis === false
                ? <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-slate-100 text-slate-400 text-[9px]"><HardHat size={9}/> sans patron</span>
                : <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-orange-50 text-orange-600 text-[9px]"><HardHat size={9}/> patron requis</span>
              }
            </div>

            {/* Equipment */}
            <EquipSummary c={c} />

            {/* Facturation */}
            {isPast && (
              <div className={`mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium border-t border-slate-50 pt-1.5 ${
                c.datePaiement     ? 'text-green-700'
                : c.factureFaite  ? 'text-amber-600'
                :                   'text-red-500'
              }`}>
                {c.datePaiement
                  ? <><CheckCheck size={11}/> Payé le {c.datePaiement}</>
                  : c.factureFaite
                    ? <><CheckCheck size={11}/> Facture envoyée — paiement en attente</>
                    : <><CircleAlert size={11}/> Facture non envoyée</>
                }
              </div>
            )}

            {/* Période préconisée */}
            {c.periodePreconiseeDebut && c.periodePreconiseeFin && (
              <div className="mt-1.5 text-[10px] text-slate-400 border-t border-slate-50 pt-1">
                Préconisée : {format(new Date(c.periodePreconiseeDebut), 'd MMM', { locale: fr })} → {format(new Date(c.periodePreconiseeFin), 'd MMM yyyy', { locale: fr })}
              </div>
            )}

            {/* Transfert tracteur */}
            {c.transfertTracteur && c.latitude && c.longitude && (() => {
              const from = fromChantier?.latitude && fromChantier?.longitude
                ? { lat: fromChantier.latitude, lon: fromChantier.longitude, label: fromChantier.nom }
                : undefined;
              const info = getTransfertInfo(c.latitude, c.longitude, from);
              return (
                <div className="mt-1.5 border-t border-slate-50 pt-1.5 space-y-0.5">
                  <div className="text-[10px] text-orange-600 font-medium flex items-center gap-1">
                    <span>🚜</span>
                    <span>Depuis {info.fromLabel} — {info.distKm} km</span>
                  </div>
                  <div className="text-[10px] text-orange-500 flex items-center gap-2 pl-1">
                    <span>↗ Aller : {info.aller}</span>
                    {info.retour && <span>↙ Retour : {info.retour}</span>}
                  </div>
                </div>
              );
            })()}
            {c.transfertTracteur && (!c.latitude || !c.longitude) && (
              <div className="mt-1 text-[10px] text-orange-400 italic">
                🚜 Transfert tracteur — localisation manquante pour calculer le temps
              </div>
            )}
          </div>

          {/* Mini map */}
          {hasMap && (
            <div className="flex-shrink-0 p-1.5 pl-0">
              <TileMap lat={c.latitude!} lon={c.longitude!} />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(tooltip, document.body);
}
