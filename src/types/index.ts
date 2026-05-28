export type ChantierType =
  | 'curage_aspiration'
  | 'curage_mecanique'
  | 'broyage_chenillette_sans'
  | 'broyage_chenillette_avec'
  | 'broyage_forestier'
  | 'terrassement'
  | 'faucardage'
  | 'defenses_berges';

export type ChantierStatus = 'potentiel' | 'confirme';
export type TypePelle = '1.5t' | '3t' | '8t' | '16t';

export interface Chantier {
  id: string;
  nom: string;
  client?: string;
  lieu?: string;
  type: ChantierType;
  status: ChantierStatus;
  dateDebut: string; // 'YYYY-MM-DD'
  dateFin: string;   // 'YYYY-MM-DD'
  chiffreAffaire: number;
  devisSigne: boolean;
  acomptePaye: boolean;
  montantAcompte?: number;
  notes?: string;

  // Pelles
  pelles?: TypePelle[];

  // Engins supplémentaires (nombre)
  dumpers?: number;
  tractoBennes?: number;
  bulls?: number;

  // Matériel spécifique
  chenillette?: boolean;
  bateauFaucardeur?: boolean;
  drague?: boolean;
  telesco?: boolean;

  // Personnel
  nombrePersonnes?: number;

  // Curage aspiration
  pellePrepaBassin?: '8t' | '16t';
  nombreJoursPrepa?: number;

  createdAt: string;
  updatedAt: string;
}
