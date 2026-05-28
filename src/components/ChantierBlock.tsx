import { useRef, useCallback } from 'react';
import type { Chantier } from '../types';
import { CHANTIER_TYPES, DAY_WIDTH } from '../lib/constants';
import { CheckCircle2, Clock } from 'lucide-react';

interface Props {
  chantier: Chantier;
  left: number;
  width: number;
  onMoveEnd: (id: string, deltadays: number) => void;
  onResizeEnd: (id: string, deltaDays: number) => void;
  onClick: (chantier: Chantier) => void;
}

export default function ChantierBlock({ chantier, left, width, onMoveEnd, onResizeEnd, onClick }: Props) {
  const meta = CHANTIER_TYPES[chantier.type];
  const isPotentiel = chantier.status === 'potentiel';

  const dragRef = useRef<{ startX: number; mode: 'move' | 'resize' } | null>(null);
  const currentLeft = useRef(left);
  const currentWidth = useRef(width);
  const blockRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent, mode: 'move' | 'resize') => {
    e.stopPropagation();
    if (mode === 'resize') e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, mode };
    currentLeft.current = left;
    currentWidth.current = width;
  }, [left, width]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !blockRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    if (dragRef.current.mode === 'move') {
      const newLeft = currentLeft.current + dx;
      blockRef.current.style.left = `${newLeft}px`;
    } else {
      const newWidth = Math.max(DAY_WIDTH, currentWidth.current + dx);
      blockRef.current.style.width = `${newWidth}px`;
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const deltaDays = Math.round(dx / DAY_WIDTH);

    if (dragRef.current.mode === 'move') {
      if (deltaDays !== 0) {
        onMoveEnd(chantier.id, deltaDays);
      } else {
        // Reset visual position
        if (blockRef.current) blockRef.current.style.left = `${left}px`;
      }
    } else {
      if (deltaDays !== 0) {
        onResizeEnd(chantier.id, deltaDays);
      } else {
        if (blockRef.current) blockRef.current.style.width = `${width}px`;
      }
    }
    dragRef.current = null;
  }, [chantier.id, left, width, onMoveEnd, onResizeEnd]);

  const handleClick = useCallback(() => {
    if (dragRef.current === null) onClick(chantier);
  }, [chantier, onClick]);

  const caFormatted = chantier.chiffreAffaire
    ? `${chantier.chiffreAffaire.toLocaleString('fr-FR')} €`
    : '';

  return (
    <div
      ref={blockRef}
      className="gantt-block absolute top-1 rounded-lg overflow-hidden shadow-sm border"
      style={{
        left,
        width: Math.max(width, 4),
        height: 'calc(100% - 8px)',
        backgroundColor: isPotentiel ? '#f8fafc' : meta.color,
        borderColor: meta.color,
        borderStyle: isPotentiel ? 'dashed' : 'solid',
        opacity: isPotentiel ? 0.85 : 1,
        zIndex: 10,
      }}
      onPointerDown={e => handlePointerDown(e, 'move')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
    >
      {/* Main content */}
      <div
        className="h-full px-2 flex items-center gap-1.5 overflow-hidden"
        style={{ color: isPotentiel ? meta.color : 'white' }}
      >
        {/* Status icon */}
        <div className="flex-shrink-0">
          {chantier.status === 'confirme' ? (
            <CheckCircle2 size={11} style={{ opacity: 0.9 }} />
          ) : (
            <Clock size={11} style={{ opacity: 0.7 }} />
          )}
        </div>

        {/* Text */}
        <span className="text-xs font-semibold truncate leading-none">
          {chantier.nom}
        </span>

        {caFormatted && width > 100 && (
          <span className="text-xs opacity-75 truncate ml-auto flex-shrink-0 hidden lg:block">
            {caFormatted}
          </span>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="resize-handle absolute right-0 top-0 h-full w-2 flex items-center justify-center"
        style={{ cursor: 'ew-resize' }}
        onPointerDown={e => { e.stopPropagation(); handlePointerDown(e, 'resize'); }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="h-4 w-0.5 rounded-full"
          style={{ backgroundColor: isPotentiel ? meta.color : 'rgba(255,255,255,0.5)' }}
        />
      </div>
    </div>
  );
}
