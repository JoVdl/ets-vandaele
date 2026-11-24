export type FamilleMateriel = 'pelle' | 'transport' | 'compactage' | 'drague' | 'autre';
export type EtatMateriel = 'operationnel' | 'maintenance' | 'panne' | 'non_utilisable';

export const FAMILLES: Record<FamilleMateriel, { label: string; color: string }> = {
  pelle:      { label: 'Pelles', color: '#f59e0b' },
  transport:  { label: 'Transport (tracteurs, dumpers, bennes)', color: '#38bdf8' },
  compactage: { label: 'Compactage', color: '#a78bfa' },
  drague:     { label: 'Dragues', color: '#22d3ee' },
  autre:      { label: 'Autres', color: '#94a3b8' },
};

export const ETATS: Record<EtatMateriel, { label: string; color: string }> = {
  operationnel: { label: 'Opérationnel', color: 'bg-emerald-700 text-emerald-100' },
  maintenance:  { label: 'Maintenance', color: 'bg-amber-700 text-amber-100' },
  panne:        { label: 'Panne', color: 'bg-red-700 text-red-100' },
  non_utilisable: { label: 'Non utilisable (à remettre en état)', color: 'bg-slate-600 text-slate-100' },
};

export interface MaterielJournal {
  id: string;
  date: string;               // ISO
  type: 'utilisation' | 'entretien' | 'reparation';
  heures?: number;            // for utilisation
  chantierId?: string;
  chantierNom?: string;
  note?: string;
}

export interface MaterielTache {
  id: string;
  texte: string;
  bloquant: boolean;
  fait: boolean;
}

export interface Materiel {
  id: string;
  nom: string;
  famille: FamilleMateriel;
  marque?: string;
  modele?: string;
  annee?: number;
  photoUrl?: string;
  photoPath?: string;
  photoCrop?: { x: number; y: number; w: number; h: number }; // fractions of the photo (0–1), 4:3 frame
  etat: EtatMateriel;
  heuresInitiales?: number;   // approximate hour meter given at start of tracking
  suiviDepuis: string;        // ISO date: tracking start
  specs?: Record<string, string>; // poids, largeur, etc.
  journal: MaterielJournal[];
  taches: MaterielTache[];
}
