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
export type ChantierEtat = 'a_venir' | 'en_cours' | 'termine';
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

  // Surface de travail (m²) — mesurée sur la carte ou saisie manuellement
  surface?: number;

  // Durée estimée totale du chantier (h) — pour les chantiers facturés au temps plutôt qu'à la surface
  dureeEstimeeH?: number;

  // Polygones délimitant les zones de travail (plusieurs zones possibles par chantier)
  polygon?: { lat: number; lng: number }[][];

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

  // Facturation
  factureFaite?: boolean;       // facture envoyée au client
  dateFacture?: string;         // date d'envoi facture (YYYY-MM-DD)
  montantPaye?: number;         // montant effectivement encaissé (€)
  datePaiement?: string;        // date de réception du paiement (YYYY-MM-DD)

  // Dates verrouillées : exclues de la réorganisation automatique
  datesVerrouillees?: boolean;

  // État d'avancement (calculé auto depuis les dates si absent)
  etat?: ChantierEtat;

  // Degré de priorité pour la réorganisation (1 = urgente → 5 = peut attendre, défaut = 3)
  priorite?: 1 | 2 | 3 | 4 | 5;

  // Curage aspiration
  pellePrepaBassin?: '8t' | '16t';
  nombreJoursPrepa?: number;

  createdAt: string;
  updatedAt: string;
}
