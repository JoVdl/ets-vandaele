import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Check } from 'lucide-react';

type Box = { x: number; y: number; w: number; h: number };
const ASPECT = 4 / 3;

// Crop box at fixed aspect, centred and as large as the image allows.
function initialBox(W: number, H: number): Box {
  let w = W, h = w / ASPECT;
  if (h > H) { h = H; w = h * ASPECT; }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

// Picks a photo's framing: drag the box to move it, drag a corner to resize (aspect kept).
export default function PhotoCropper({ file, onCancel, onDone }: {
  file: File;
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; start: Box; px: number; py: number } | null>(null);
  const url = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    const i = new Image();
    i.onload = () => { setImg(i); setBox(initialBox(i.naturalWidth, i.naturalHeight)); };
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  // Scale from image pixels to on-screen pixels
  const scale = useMemo(() => {
    if (!img) return 1;
    const maxW = Math.min(window.innerWidth - 32, 560);
    const maxH = window.innerHeight * 0.6;
    return Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  }, [img]);

  const onDown = (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => {
    if (!box) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, start: box, px: e.clientX, py: e.clientY };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !img) return;
    const dx = (e.clientX - d.px) / scale, dy = (e.clientY - d.py) / scale;
    const s = d.start;
    const W = img.naturalWidth, H = img.naturalHeight;
    if (d.mode === 'move') {
      setBox({ ...s, x: Math.min(Math.max(0, s.x + dx), W - s.w), y: Math.min(Math.max(0, s.y + dy), H - s.h) });
      return;
    }
    // Corner resize: the opposite corner stays fixed; width drives height to keep 4:3
    const fixedX = d.mode.includes('w') ? s.x + s.w : s.x;
    const fixedY = d.mode.includes('n') ? s.y + s.h : s.y;
    const signX = d.mode.includes('e') ? 1 : -1;
    const signY = d.mode.includes('s') ? 1 : -1;
    let w = Math.max(40, s.w + signX * dx);
    let h = w / ASPECT;
    if (signY * dy > 0 && s.h + signY * dy > h) { h = s.h + signY * dy; w = h * ASPECT; }
    let x = signX > 0 ? fixedX : fixedX - w;
    let y = signY > 0 ? fixedY : fixedY - h;
    x = Math.max(0, Math.min(x, W - w));
    y = Math.max(0, Math.min(y, H - h));
    w = Math.min(w, W - x, (H - y) * ASPECT);
    h = w / ASPECT;
    setBox({ x, y, w, h });
  };

  const onUp = () => { drag.current = null; };

  const confirm = () => {
    if (!img || !box) return;
    setBusy(true);
    const outW = Math.min(800, Math.round(box.w));
    const outH = Math.round(outW / ASPECT);
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setBusy(false); return; }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, outW, outH);
    onDone(canvas.toDataURL('image/jpeg', 0.85));
  };

  const ready = img && box;
  const dispW = img ? img.naturalWidth * scale : 0;
  const dispH = img ? img.naturalHeight * scale : 0;
  const handle = 'absolute w-5 h-5 bg-white border-2 border-amber-500 rounded-sm touch-none';

  return (
    <div className="fixed inset-0 z-[600] bg-black/85 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2.5 text-white">
        <button onClick={onCancel} className="p-1.5 text-slate-300"><X size={20} /></button>
        <p className="text-sm font-semibold">Recadrer la photo</p>
        <button onClick={confirm} disabled={!ready || busy} className="p-1.5 text-amber-400 disabled:opacity-40"><Check size={22} /></button>
      </div>
      <div className="flex-1 flex items-center justify-center px-4">
        {ready && (
          <div ref={wrapRef} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            className="relative select-none touch-none" style={{ width: dispW, height: dispH }}>
            <img src={url} alt="" draggable={false} className="absolute inset-0 w-full h-full pointer-events-none" />
            {/* dim outside the box */}
            <div className="absolute inset-0 bg-black/55 pointer-events-none" style={{
              clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${box.x * scale}px ${box.y * scale}px,${box.x * scale}px ${(box.y + box.h) * scale}px,${(box.x + box.w) * scale}px ${(box.y + box.h) * scale}px,${(box.x + box.w) * scale}px ${box.y * scale}px,${box.x * scale}px ${box.y * scale}px)`,
            }} />
            <div onPointerDown={onDown('move')} className="absolute border-2 border-amber-500 cursor-move touch-none"
              style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale }}>
              {(['nw', 'ne', 'sw', 'se'] as const).map(c => (
                <div key={c} onPointerDown={e => { e.stopPropagation(); onDown(c)(e); }} className={handle}
                  style={{
                    left: c.includes('w') ? -10 : undefined, right: c.includes('e') ? -10 : undefined,
                    top: c.includes('n') ? -10 : undefined, bottom: c.includes('s') ? -10 : undefined,
                    cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize',
                  }} />
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="text-center text-slate-400 text-[11px] pb-4 px-4">Glisse le cadre pour le placer, et un coin pour l'agrandir ou le réduire. Format 4:3.</p>
    </div>
  );
}
