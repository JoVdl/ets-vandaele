export interface MachineParams {
  largeurTravailM: number;      // working width / rayon d'arc papillonnage (0 = not tracked)
  vitesseMaxKmh:  number;       // max speed for outlier filtering
  recouvrementPct: number;      // strip overlap % (reduces effective width)
  smoothAlpha:    number;       // EMA smoothing factor (0=none, 1=max)
  profondeurDragageM: number;   // dredge depth per pass in metres (0 = not dragage)
  nbPassesParPosition: number;  // papillonnage: left-right sweeps before advancing (default 1)
}

/** Default params per chantier type. */
export const MACHINE_DEFAULTS: Record<string, MachineParams> = {
  broyage_chenillette_sans: { largeurTravailM: 2.3, vitesseMaxKmh: 8,  recouvrementPct: 10, smoothAlpha: 0.35, profondeurDragageM: 0, nbPassesParPosition: 1 },
  broyage_chenillette_avec: { largeurTravailM: 2.3, vitesseMaxKmh: 8,  recouvrementPct: 10, smoothAlpha: 0.35, profondeurDragageM: 0, nbPassesParPosition: 1 },
  broyage_forestier:        { largeurTravailM: 1.8, vitesseMaxKmh: 6,  recouvrementPct: 15, smoothAlpha: 0.35, profondeurDragageM: 0, nbPassesParPosition: 1 },
  faucardage:               { largeurTravailM: 3.0, vitesseMaxKmh: 6,  recouvrementPct: 10, smoothAlpha: 0.30, profondeurDragageM: 0, nbPassesParPosition: 1 },
  deboisement:              { largeurTravailM: 0,   vitesseMaxKmh: 10, recouvrementPct: 0,  smoothAlpha: 0.25, profondeurDragageM: 0, nbPassesParPosition: 1 },
  curage_mecanique:         { largeurTravailM: 0,   vitesseMaxKmh: 12, recouvrementPct: 0,  smoothAlpha: 0.25, profondeurDragageM: 0, nbPassesParPosition: 1 },
  curage_aspiration:        { largeurTravailM: 0,   vitesseMaxKmh: 12, recouvrementPct: 0,  smoothAlpha: 0.25, profondeurDragageM: 0, nbPassesParPosition: 1 },
  terrassement:             { largeurTravailM: 0,   vitesseMaxKmh: 15, recouvrementPct: 0,  smoothAlpha: 0.20, profondeurDragageM: 0, nbPassesParPosition: 1 },
  defenses_berges:          { largeurTravailM: 0,   vitesseMaxKmh: 10, recouvrementPct: 0,  smoothAlpha: 0.25, profondeurDragageM: 0, nbPassesParPosition: 1 },
  location:                 { largeurTravailM: 0,   vitesseMaxKmh: 60, recouvrementPct: 0,  smoothAlpha: 0.20, profondeurDragageM: 0, nbPassesParPosition: 1 },
};

/**
 * Default params for suction dredger (drague aspiratrice — papillonnage).
 *
 * Papillonnage motion: barge pivots on a stern spud, side cables swing it
 * left-right in arcs.  It advances ~40 cm between positions.
 * Each left-right pass removes ~50 cm of silt.
 *
 *  largeurTravailM = arc sweep width (≈ boom radius × 2).  6 m is typical
 *  for a small aspiratrice with a ~3 m boom, covering 3 m each side.
 *  nbPassesParPosition = number of left-right sweeps per 40 cm advance.
 */
export const DRAGAGE_DEFAULTS: MachineParams = {
  largeurTravailM:     6.0,  // rayon d'arc × 2 ≈ 3 m chaque côté
  vitesseMaxKmh:       3,    // déplacement lent sur l'eau
  recouvrementPct:     0,
  smoothAlpha:         0.45, // lissage fort : mouvements lents + eau
  profondeurDragageM:  0.5,  // épaisseur de vase par passe
  nbPassesParPosition: 1,    // nb balayages G-D avant avancement de 40 cm
};

const FALLBACK: MachineParams = { largeurTravailM: 2.3, vitesseMaxKmh: 10, recouvrementPct: 10, smoothAlpha: 0.30, profondeurDragageM: 0, nbPassesParPosition: 1 };

export function defaultParams(chantierType?: string, drague?: boolean): MachineParams {
  if (drague) return { ...DRAGAGE_DEFAULTS };
  return chantierType && MACHINE_DEFAULTS[chantierType]
    ? { ...MACHINE_DEFAULTS[chantierType] }
    : { ...FALLBACK };
}

const STORAGE_KEY = 'suivi_machine_params';

export function loadMachineParams(chantierType?: string): MachineParams {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MachineParams;
  } catch { /* ignore */ }
  return defaultParams(chantierType);
}

export function saveMachineParams(p: MachineParams): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}
