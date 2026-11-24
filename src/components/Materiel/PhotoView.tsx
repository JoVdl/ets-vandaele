import { Camera } from 'lucide-react';

// aspect: width ÷ height of the frame the crop was made in (older crops were 4:3).
export type Crop = { x: number; y: number; w: number; h: number; aspect?: number };

const DEFAULT_ASPECT = 3 / 4;

// Shows a photo in a portrait frame, cropped by fractions. Works for any image URL (no pixel access needed).
export function PhotoView({ src, crop, fill = false, className = '' }: { src?: string; crop?: Crop; fill?: boolean; className?: string }) {
  const frame = fill ? 'h-full w-full' : '';
  const aspect = crop?.aspect ?? (crop ? 4 / 3 : DEFAULT_ASPECT);
  const style = fill ? undefined : { aspectRatio: String(aspect) };
  if (!src) return (
    <div className={`${frame} bg-slate-800 flex items-center justify-center ${className}`} style={style}>
      <Camera size={18} className="text-slate-600" />
    </div>
  );
  if (!crop) return (
    <div className={`${frame} bg-slate-800 overflow-hidden ${className}`} style={style}>
      <img src={src} alt="" className="w-full h-full object-cover" />
    </div>
  );
  return (
    <div className={`${frame} bg-slate-800 overflow-hidden relative ${className}`} style={style}>
      <img src={src} alt="" draggable={false} className="absolute max-w-none"
        style={{
          width: `${100 / crop.w}%`,
          height: `${100 / crop.h}%`,
          left: `${-(crop.x / crop.w) * 100}%`,
          top: `${-(crop.y / crop.h) * 100}%`,
        }} />
    </div>
  );
}
