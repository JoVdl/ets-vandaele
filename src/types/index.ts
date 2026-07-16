export type ChantierType =
  | 'curage_aspiration'
  | 'curage_mecanique'
  | 'broyage_chenillette_sans'
  | 'broyage_chenillette_avec'
  | 'broyage_forestier'
  | 'deboisement'
  | 'terrassement'
  | 'faucardage'
  | 'defenses_berges'
  | 'location';

export type TypeRouleau = '700kg';

export type ChantierStatus = 'potentiel' | 'confirme' | 'refuse' | 'annule';
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

  // Période d'intervention préconisée
  periodePreconiseeDebut?: string; // 'YYYY-MM-DD'
  periodePreconiseeFin?: string;   // 'YYYY-MM-DD'

  // Localisation géographique
  adresse?: string;
  latitude?: number;
  longitude?: number;

  chiffreAffaire: number;   // CA total du contrat
  nombreAnnees?: number;    // si contrat pluriannuel (CA affiché = chiffreAffaire / nombreAnnees)
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
  rouleaux?: number; // nb de rouleaux 700kg (location)

  // Matériel spécifique
  chenillette?: boolean;
  bateauFaucardeur?: boolean;
  drague?: boolean;
  telesco?: boolean;

  // Personnel
  nombrePersonnes?: number;

  // Présence du patron requise sur ce chantier (défaut : true)
  // Si false, le salarié peut y être seul → pas de conflit patron avec un autre chantier simultané
  patronRequis?: boolean;

  // Dates verrouillées : exclues de la réorganisation automatique
  datesVerrouillees?: boolean;

  // Curage aspiration
  pellePrepaBassin?: '8t' | '16t';
  nombreJoursPrepa?: number;

  createdAt: string;
  updatedAt: string;
}
