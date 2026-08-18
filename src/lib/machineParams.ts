export interface MachineParams {
  largeurTravailM: number;   // working width (0 = surface not applicable)
  vitesseMaxKmh:  number;    // max speed for outlier filtering
  recouvrementPct: number;   // strip overlap % (reduces effective width)
  smoothAlpha:    number;    // EMA smoothing factor (0=none, 1=max)
}

/** Default params per chantier type. */
export const MACHINE_DEFAULTS: Record<string, MachineParams> = {
  broyage_chenillette_sans: { largeurTravailM: 2.3, vitesseMaxKmh: 8,  recouvrementPct: 10, smoothAlpha: 0.35 },
  broyage_chenillette_avec: { largeurTravailM: 2.3, vitesseMaxKmh: 8,  recouvrementPct: 10, smoothAlpha: 0.35 },
  broyage_forestier:        { largeurTravailM: 1.8, vitesseMaxKmh: 6,  recouvrementPct: 15, smoothAlpha: 0.35 },
  faucardage:               { largeurTravailM: 3.0, vitesseMaxKmh: 6,  recouvrementPct: 10, smoothAlpha: 0.30 },
  deboisement:              { largeurTravailM: 0,   vitesseMaxKmh: 10, recouvrementPct: 0,  smoothAlpha: 0.25 },
  curage_mecanique:         { largeurTravailM: 0,   vitesseMaxKmh: 12, recouvrementPct: 0,  smoothAlpha: 0.25 },
  curage_aspiration:        { largeurTravailM: 0,   vitesseMaxKmh: 12, recouvrementPct: 0,  smoothAlpha: 0.25 },
  terrassement:             { largeurTravailM: 0,   vitesseMaxKmh: 15, recouvrementPct: 0,  smoothAlpha: 0.20 },
  defenses_berges:          { largeurTravailM: 0,   vitesseMaxKmh: 10, recouvrementPct: 0,  smoothAlpha: 0.25 },
  location:                 { largeurTravailM: 0,   vitesseMaxKmh: 60, recouvrementPct: 0,  smoothAlpha: 0.20 },
};

const FALLBACK: MachineParams = { largeurTravailM: 2.3, vitesseMaxKmh: 10, recouvrementPct: 10, smoothAlpha: 0.30 };

export function defaultParams(chantierType?: string): MachineParams {
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
