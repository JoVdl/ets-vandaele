import { Camera } from 'lucide-react';

export type Crop = { x: number; y: number; w: number; h: number };

// Shows a photo in a 4:3 frame, cropped by fractions. Works for any image URL (no pixel access needed).
export function PhotoView({ src, crop, className = '' }: { src?: string; crop?: Crop; className?: string }) {
  if (!src) return (
    <div className={`aspect-[4/3] bg-slate-800 flex items-center justify-center ${className}`}>
      <Camera size={18} className="text-slate-600" />
    </div>
  );
  if (!crop) return (
    <div className={`aspect-[4/3] bg-slate-800 overflow-hidden ${className}`}>
      <img src={src} alt="" className="w-full h-full object-cover" />
    </div>
  );
  return (
    <div className={`aspect-[4/3] bg-slate-800 overflow-hidden relative ${className}`}>
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
