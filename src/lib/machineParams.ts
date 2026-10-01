export interface MachineParams {
  largeurTravailM: number;     // working width (0 = surface not applicable)
  vitesseMaxKmh:  number;      // max speed for outlier filtering
  recouvrementPct: number;     // strip overlap % (reduces effective width)
  smoothAlpha:    number;      // EMA smoothing factor (0=none, 1=max)
  profondeurDragageM: number;  // dredge depth in metres (0 = not dragage)
}

/** Default params per chantier type. */
export const MACHINE_DEFAULTS: Record<string, MachineParams> = {
  broyage_chenillette_sans: { largeurTravailM: 2.3, vitesseMaxKmh: 8,  recouvrementPct: 10, smoothAlpha: 0.35, profondeurDragageM: 0 },
  broyage_chenillette_avec: { largeurTravailM: 2.3, vitesseMaxKmh: 8,  recouvrementPct: 10, smoothAlpha: 0.35, profondeurDragageM: 0 },
  broyage_forestier:        { largeurTravailM: 1.8, vitesseMaxKmh: 6,  recouvrementPct: 15, smoothAlpha: 0.35, profondeurDragageM: 0 },
  faucardage:               { largeurTravailM: 3.0, vitesseMaxKmh: 6,  recouvrementPct: 10, smoothAlpha: 0.30, profondeurDragageM: 0 },
  deboisement:              { largeurTravailM: 0,   vitesseMaxKmh: 10, recouvrementPct: 0,  smoothAlpha: 0.25, profondeurDragageM: 0 },
  curage_mecanique:         { largeurTravailM: 0,   vitesseMaxKmh: 12, recouvrementPct: 0,  smoothAlpha: 0.25, profondeurDragageM: 0 },
  curage_aspiration:        { largeurTravailM: 0,   vitesseMaxKmh: 12, recouvrementPct: 0,  smoothAlpha: 0.25, profondeurDragageM: 0 },
  terrassement:             { largeurTravailM: 0,   vitesseMaxKmh: 15, recouvrementPct: 0,  smoothAlpha: 0.20, profondeurDragageM: 0 },
  defenses_berges:          { largeurTravailM: 0,   vitesseMaxKmh: 10, recouvrementPct: 0,  smoothAlpha: 0.25, profondeurDragageM: 0 },
  location:                 { largeurTravailM: 0,   vitesseMaxKmh: 60, recouvrementPct: 0,  smoothAlpha: 0.20, profondeurDragageM: 0 },
};

/** Default params for suction dredger (drague aspiratrice). */
export const DRAGAGE_DEFAULTS: MachineParams = {
  largeurTravailM:    0.4,   // tête d'aspiration ~40 cm
  vitesseMaxKmh:      3,     // déplacement lent sur l'eau
  recouvrementPct:    0,
  smoothAlpha:        0.45,  // lissage fort : déplacements lents et eau
  profondeurDragageM: 0.5,   // profondeur cible initiale
};

const FALLBACK: MachineParams = { largeurTravailM: 2.3, vitesseMaxKmh: 10, recouvrementPct: 10, smoothAlpha: 0.30, profondeurDragageM: 0 };

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
