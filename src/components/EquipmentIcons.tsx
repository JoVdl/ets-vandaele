// Inline SVG equipment icons — all designed for 14–16 px rendering

interface IconProps { size?: number; className?: string }

export function ExcavatorIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 20" fill="currentColor" className={className}>
      {/* tracks */}
      <rect x="0" y="14" width="14" height="4" rx="2"/>
      {/* cab body */}
      <rect x="1" y="8" width="10" height="7"/>
      {/* cab window */}
      <rect x="2" y="5" width="6" height="4" rx="0.5"/>
      {/* boom arm */}
      <path d="M11,7 L20,1 L22,4 L12,9 Z"/>
      {/* bucket */}
      <path d="M20,1 L24,2 L22,6 L18,5 Z"/>
    </svg>
  );
}

export function DumperIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 18" fill="currentColor" className={className}>
      {/* cab */}
      <path d="M0,7 L7,7 L7,13 L0,13 Z"/>
      <path d="M1,4 L6,4 L7,7 L0,7 Z"/>
      {/* tilted dump body */}
      <path d="M6,3 L21,5 L21,12 L6,12 Z"/>
      {/* wheels */}
      <circle cx="4" cy="16" r="2.5"/>
      <circle cx="17" cy="16" r="2.5"/>
    </svg>
  );
}

export function TractoBenneIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 18" fill="currentColor" className={className}>
      {/* cab */}
      <path d="M0,5 L8,5 L8,13 L0,13 Z"/>
      <path d="M1,3 L7,3 L8,5 L0,5 Z"/>
      {/* trailer */}
      <rect x="7" y="6" width="19" height="7" rx="0.5"/>
      {/* wheels */}
      <circle cx="4" cy="16" r="2.5"/>
      <circle cx="13" cy="16" r="2.5"/>
      <circle cx="21" cy="16" r="2.5"/>
    </svg>
  );
}

export function BullIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 18" fill="currentColor" className={className}>
      {/* blade */}
      <rect x="0" y="5" width="3" height="8" rx="0.5"/>
      {/* tracks */}
      <rect x="2" y="12" width="18" height="4" rx="2"/>
      {/* body */}
      <rect x="4" y="5" width="14" height="8" rx="0.5"/>
      {/* cab */}
      <rect x="8" y="2" width="8" height="6" rx="0.5"/>
      {/* ripper at back */}
      <path d="M20,10 L24,10 L24,16 L22,16 L22,13 L20,13 Z"/>
    </svg>
  );
}

export function CheniletteIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 18" fill="currentColor" className={className}>
      {/* tracks */}
      <rect x="0" y="11" width="22" height="5" rx="2.5"/>
      {/* compact body */}
      <rect x="1" y="5" width="14" height="7" rx="0.5"/>
      {/* cutter head front */}
      <path d="M14,5 L21,7 L21,11 L14,11 Z"/>
      <circle cx="21" cy="9" r="2"/>
    </svg>
  );
}

export function BateauFaucardeurIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 16" fill="currentColor" className={className}>
      {/* hull */}
      <path d="M1,9 L23,9 L21,14 L3,14 Z"/>
      {/* cabin */}
      <rect x="4" y="5" width="8" height="5" rx="0.5"/>
      {/* mast */}
      <line x1="7" y1="1" x2="7" y2="6" stroke="currentColor" strokeWidth="1.5"/>
      {/* faucardeuse arm at bow */}
      <path d="M16,9 L22,6 L23,8 L17,10 Z"/>
      <circle cx="22" cy="7" r="1.5"/>
    </svg>
  );
}

export function DragueIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 18" fill="currentColor" className={className}>
      {/* hull (barge, flat) */}
      <path d="M0,10 L24,10 L22,15 L2,15 Z"/>
      {/* crane tower */}
      <rect x="8" y="3" width="3" height="8"/>
      {/* crane arm */}
      <path d="M9,3 L22,6 L21,8 L8,4 Z"/>
      {/* bucket chain hanging */}
      <line x1="21" y1="7" x2="21" y2="13" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2,1"/>
      <path d="M19,12 L23,12 L22,15 L20,15 Z"/>
    </svg>
  );
}

export function TelescoIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 18" fill="currentColor" className={className}>
      {/* body */}
      <rect x="0" y="8" width="16" height="7" rx="1"/>
      {/* cab */}
      <rect x="0" y="4" width="8" height="6" rx="0.5"/>
      {/* telescopic boom */}
      <path d="M10,7 L26,1 L26,3 L10,9 Z"/>
      {/* forks */}
      <line x1="24" y1="2" x2="26" y2="2" stroke="currentColor" strokeWidth="2"/>
      <line x1="24" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2"/>
      {/* wheels */}
      <circle cx="4" cy="17" r="2"/>
      <circle cx="12" cy="17" r="2"/>
    </svg>
  );
}
