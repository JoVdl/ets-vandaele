import { useRef, useCallback } from 'react';
import type { Chantier } from '../types';
import { CHANTIER_TYPES } from '../lib/constants';
import { CheckCircle2, Clock, Users, User, AlertTriangle, Lock } from 'lucide-react';
import cenLogoUrl from '../assets/cen-logo.png';
import { countWorkingDays } from '../lib/workingDays';
import {
  ExcavatorIcon, DumperIcon, TractoBenneIcon, BullIcon,
  CheniletteIcon, BateauFaucardeurIcon, DragueIcon, TelescoIcon, RouleauIcon,
} from './EquipmentIcons';

interface Props {
  chantier: Chantier;
  left: number;
  width: number;
  dayWidth: number;
  onMoveEnd: (id: string, deltaDays: number) => void;
  onResizeEnd: (id: string, deltaDays: number) => void;
  onClick: (chantier: Chantier) => void;
  onHover?: (chantier: Chantier, x: number, y: number) => void;
  onUnhover?: () => void;
  outOfPreconisee?: boolean;
}

interface EquipChip {
  icon: React.ReactNode;
  label?: string;
  key: string;
}

function buildEquipChips(c: Chantier): EquipChip[] {
  const chips: EquipChip[] = [];
  if (c.pelles?.length) {
    c.pelles.forEach((t, i) =>
      chips.push({ key: `p${i}`, icon: <ExcavatorIcon size={12}/>, label: t })
    );
  }
  if (c.dumpers && c.dumpers > 0) {
    for (let i = 0; i < Math.min(c.dumpers, 3); i++)
      chips.push({ key: `d${i}`, icon: <DumperIcon size={12}/>, label: c.dumpers > 1 && i === 0 ? `×${c.dumpers}` : undefined });
    if (c.dumpers > 1) chips.splice(1); // keep only first chip with count label
  }
  if (c.tractoBennes && c.tractoBennes > 0) {
    chips.push({ key: 'tb', icon: <TractoBenneIcon size={12}/>, label: c.tractoBennes > 1 ? `×${c.tractoBennes}` : undefined });
  }
  if (c.bulls && c.bulls > 0) {
    chips.push({ key: 'bull', icon: <BullIcon size={12}/>, label: c.bulls > 1 ? `×${c.bulls}` : undefined });
  }
  if (c.rouleaux && c.rouleaux > 0) {
    chips.push({ key: 'rl', icon: <RouleauIcon size={12}/>, label: c.rouleaux > 1 ? `×${c.rouleaux}` : undefined });
  }
  if (c.chenillette) chips.push({ key: 'ch', icon: <CheniletteIcon size={12}/> });
  if (c.bateauFaucardeur) chips.push({ key: 'bf', icon: <BateauFaucardeurIcon size={12}/> });
  if (c.drague) chips.push({ key: 'dr', icon: <DragueIcon size={12}/> });
  if (c.telesco) chips.push({ key: 'tl', icon: <TelescoIcon size={12}/> });
  return chips;
}

export default function ChantierBlock({
  chantier, left, width, dayWidth, onMoveEnd, onResizeEnd, onClick, onHover, onUnhover, outOfPreconisee,
}: Props) {
  const meta        = CHANTIER_TYPES[chantier.type];
  const isPotentiel = chantier.status === 'potentiel';
  const isArchived  = chantier.status === 'refuse' || chantier.status === 'annule';

  const dragRef   = useRef<{ startX: number; mode: 'move' | 'resize' } | null>(null);
  const blockRef  = useRef<HTMLDivElement>(null);
  const initLeft  = useRef(left);
  const initWidth = useRef(width);

  const handlePointerDown = useCallback((e: React.PointerEvent, mode: 'move' | 'resize') => {
    e.stopPropagation();
    if (mode === 'resize') e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current  = { startX: e.clientX, mode };
    initLeft.current  = left;
    initWidth.current = width;
  }, [left, width]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !blockRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    if (dragRef.current.mode === 'move') {
      blockRef.current.style.left = `${initLeft.current + dx}px`;
    } else {
      blockRef.current.style.width = `${Math.max(dayWidth, initWidth.current + dx)}px`;
    }
  }, [dayWidth]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx    = e.clientX - dragRef.current.startX;
    const delta = Math.round(dx / dayWidth);
    if (dragRef.current.mode === 'move') {
      if (delta !== 0) onMoveEnd(chantier.id, delta);
      else if (blockRef.current) blockRef.current.style.left = `${left}px`;
    } else {
      if (delta !== 0) onResizeEnd(chantier.id, delta);
      else if (blockRef.current) blockRef.current.style.width = `${width}px`;
    }
    dragRef.current = null;
  }, [chantier.id, left, width, dayWidth, onMoveEnd, onResizeEnd]);

  const handleClick = useCallback(() => {
    if (!dragRef.current) onClick(chantier);
  }, [chantier, onClick]);

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) return;
    const { pageX, pageY } = e;
    hoverTimer.current = setTimeout(() => onHover?.(chantier, pageX, pageY), 250);
  }, [chantier, onHover]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) { onUnhover?.(); return; }
    // Update position live (passed fresh to parent via state, avoid stale coords)
    onHover?.(chantier, e.pageX, e.pageY);
  }, [chantier, onHover, onUnhover]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    onUnhover?.();
  }, [onUnhover]);

  const showText    = width > 20;
  const showIcons   = width > 50;
  const showCA      = width > 130 && chantier.chiffreAffaire > 0;
  const nb          = chantier.nombrePersonnes ?? 1;
  const wd          = countWorkingDays(new Date(chantier.dateDebut), new Date(chantier.dateFin));
  const caParJour   = wd > 0 && chantier.chiffreAffaire > 0 ? Math.round(chantier.chiffreAffaire / wd) : 0;
  const showCaPerDay = width > 200 && caParJour > 0;
  const chips     = buildEquipChips(chantier);

  const bg    = isArchived ? '#f1f5f9' : isPotentiel ? 'white' : meta.color;
  const fg    = isArchived ? '#94a3b8' : isPotentiel ? meta.color : 'white';
  const alpha = isArchived ? 0.6 : isPotentiel ? 0.85 : 1;

  return (
    <div
      ref={blockRef}
      className="gantt-block absolute top-1 rounded-md border select-none"
      style={{
        left,
        width: Math.max(width, 4),
        height: 'calc(100% - 8px)',
        backgroundColor: bg,
        borderColor: isArchived ? '#cbd5e1' : outOfPreconisee ? '#F97316' : meta.color,
        borderStyle: isPotentiel || isArchived ? 'dashed' : 'solid',
        borderWidth: outOfPreconisee ? 2 : 1.5,
        opacity: alpha,
        zIndex: 10,
        boxShadow: isPotentiel || isArchived ? 'none' : '0 1px 3px rgba(0,0,0,0.18)',
        overflow: 'hidden',
      }}
      onPointerDown={e => handlePointerDown(e, 'move')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="h-full flex items-center gap-1 px-1.5 overflow-hidden" style={{ color: fg }}>

        {/* Out-of-recommended-period warning */}
        {outOfPreconisee && showText && (
          <div className="flex-shrink-0" title="Hors période préconisée">
            <AlertTriangle size={10} style={{ color: isPotentiel ? '#F97316' : '#FED7AA' }} />
          </div>
        )}

        {/* Status icon */}
        {showText && !outOfPreconisee && (
          <div className="flex-shrink-0 opacity-80">
            {chantier.datesVerrouillees
              ? <Lock size={10} style={{ color: isPotentiel ? '#F59E0B' : undefined }} />
              : chantier.status === 'confirme'
                ? <CheckCircle2 size={10} />
                : <Clock size={10} />}
          </div>
        )}

        {/* Nom */}
        {showText && (
          <span className={`text-xs font-semibold truncate leading-none flex-shrink min-w-0 ${isArchived ? 'line-through' : ''}`}>
            {chantier.nom}
          </span>
        )}

        {/* CA */}
        {showCA && (
          <span className="text-[10px] opacity-75 ml-1 flex-shrink-0 font-medium">
            {chantier.chiffreAffaire.toLocaleString('fr-FR')} €
            {showCaPerDay && (
              <span className="opacity-70 ml-0.5">· {caParJour.toLocaleString('fr-FR')} €/j</span>
            )}
          </span>
        )}

        {/* CEN logo */}
        {showIcons && chantier.client?.toUpperCase().includes('CEN') && (
          <img
            src={cenLogoUrl}
            alt="CEN"
            title="Conservatoire d'Espaces Naturels"
            style={{ height: 12, width: 'auto', flexShrink: 0, opacity: isPotentiel ? 0.7 : 0.9,
              filter: isPotentiel ? 'none' : 'brightness(0) invert(1)' }}
          />
        )}

        {/* Right zone: personnel + equipment */}
        {showIcons && (
          <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
            {/* Personnel */}
            <div className="flex items-center gap-0.5 opacity-85"
              title={`${nb} personne${nb > 1 ? 's' : ''}`}>
              {nb >= 2 ? <Users size={11}/> : <User size={11}/>}
              {nb > 1 && <span className="text-[9px] font-bold leading-none">{nb}</span>}
            </div>

            {/* Equipment chips (max 3 to avoid overflow) */}
            {chips.slice(0, 3).map(chip => (
              <div key={chip.key} className="flex items-center gap-0.5 opacity-90">
                <span className="leading-none">{chip.icon}</span>
                {chip.label && (
                  <span className="text-[8px] font-bold leading-none">{chip.label}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="resize-handle absolute right-0 top-0 h-full w-2 flex items-center justify-center z-20"
        style={{ cursor: 'ew-resize' }}
        onPointerDown={e => { e.stopPropagation(); handlePointerDown(e, 'resize'); }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={e => e.stopPropagation()}
      >
        <div className="h-4 w-0.5 rounded-full opacity-50"
          style={{ backgroundColor: isPotentiel ? meta.color : 'white' }} />
      </div>
    </div>
  );
}
