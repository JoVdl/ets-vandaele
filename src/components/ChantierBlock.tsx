import { useRef, useCallback } from 'react';
import type { Chantier } from '../types';
import { CHANTIER_TYPES } from '../lib/constants';
import { CheckCircle2, Clock, Users, User } from 'lucide-react';

interface Props {
  chantier: Chantier;
  left: number;
  width: number;
  dayWidth: number;
  onMoveEnd: (id: string, deltaDays: number) => void;
  onResizeEnd: (id: string, deltaDays: number) => void;
  onClick: (chantier: Chantier) => void;
}

// ── Small equipment icon chips ─────────────────────────────────────────────
function equipIcons(c: Chantier, small: boolean): string[] {
  const icons: string[] = [];
  if (c.pelles?.length)        icons.push(...c.pelles.map(p => `🚜${p}`));
  if (c.dumpers && c.dumpers > 0)      icons.push(...Array(c.dumpers).fill('🚛'));
  if (c.tractoBennes && c.tractoBennes > 0) icons.push(...Array(c.tractoBennes).fill('🚚'));
  if (c.bulls && c.bulls > 0)          icons.push(...Array(c.bulls).fill('🏗️'));
  if (c.chenillette)           icons.push('🦾');
  if (c.drague)                icons.push('⛵');
  if (c.bateauFaucardeur)      icons.push('🚤');
  if (c.telesco)               icons.push('🏗️');
  return small ? icons.slice(0, 4) : icons;
}

export default function ChantierBlock({ chantier, left, width, dayWidth, onMoveEnd, onResizeEnd, onClick }: Props) {
  const meta        = CHANTIER_TYPES[chantier.type];
  const isPotentiel = chantier.status === 'potentiel';

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

  // ── Display decisions based on available width ──────────────────────────
  const showText    = width > 20;
  const showIcons   = width > 40;
  const showCA      = width > 120 && chantier.chiffreAffaire > 0;
  const nb          = chantier.nombrePersonnes ?? 1;
  const equip       = equipIcons(chantier, true);

  const bg    = isPotentiel ? 'white' : meta.color;
  const fg    = isPotentiel ? meta.color : 'white';
  const alpha = isPotentiel ? 0.8 : 1;

  return (
    <div
      ref={blockRef}
      className="gantt-block absolute top-1 rounded-md border select-none"
      style={{
        left,
        width: Math.max(width, 4),
        height: 'calc(100% - 8px)',
        backgroundColor: bg,
        borderColor: meta.color,
        borderStyle: isPotentiel ? 'dashed' : 'solid',
        borderWidth: 1.5,
        opacity: alpha,
        zIndex: 10,
        boxShadow: isPotentiel ? 'none' : '0 1px 3px rgba(0,0,0,0.18)',
        overflow: 'hidden',
      }}
      onPointerDown={e => handlePointerDown(e, 'move')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
    >
      <div className="h-full flex items-center gap-1 px-1.5 overflow-hidden" style={{ color: fg }}>

        {/* Status icon */}
        {showText && (
          <div className="flex-shrink-0 opacity-80">
            {chantier.status === 'confirme'
              ? <CheckCircle2 size={10} />
              : <Clock size={10} />}
          </div>
        )}

        {/* Nom */}
        {showText && (
          <span className="text-xs font-semibold truncate leading-none flex-shrink min-w-0">
            {chantier.nom}
          </span>
        )}

        {/* CA */}
        {showCA && (
          <span className="text-[10px] opacity-75 ml-1 flex-shrink-0 font-medium">
            {chantier.chiffreAffaire.toLocaleString('fr-FR')} €
          </span>
        )}

        {/* Icons zone — pushed to right */}
        {showIcons && (
          <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
            {/* Personnel */}
            <div className="flex items-center gap-0.5 opacity-85"
              title={`${nb} personne${nb > 1 ? 's' : ''}`}>
              {nb >= 2
                ? <Users  size={11} />
                : <User   size={11} />}
              {nb > 1 && <span className="text-[9px] font-bold leading-none">{nb}</span>}
            </div>

            {/* Équipement (emoji, max 3 pour ne pas déborder) */}
            {equip.slice(0, 3).map((ic, idx) => (
              <span key={idx} className="text-[10px] leading-none" title={ic}>
                {ic.startsWith('🚜') ? '🚜' : ic}
              </span>
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
