export interface GpsPoint {
  lat: number;
  lng: number;
  ts: number;      // epoch ms
  spd?: number;    // m/s from GPS API
  acc?: number;    // accuracy in metres
}

export type IncidentType =
  | 'bouchon_avant_pompe'
  | 'bouchon_apres_pompe'
  | 'deplacement_cables'
  | 'ajout_tuyaux'
  | 'panne_mecanique'
  | 'autre';

export interface SuiviIncident {
  type: IncidentType;
  dureeMinutes: number;  // 5–60 by 5
  ts: string;            // ISO timestamp when incident was logged
  note?: string;
}

export interface SuiviSession {
  id: string;
  chantierId: string;
  chantierNom: string;
  operateur: 'patron' | 'salarie';
  dateDebut: string;           // ISO
  dateFin?: string;            // ISO
  dureeMinutes: number;
  gpsPoints: GpsPoint[];
  surfaceCoveredM2: number;    // area of GPS trail polygon
  distanceM: number;
  vitesseMoyenneKmh: number;
  rendementM2h: number;        // m²/h
  // Dragage aspiratrice (papillonnage)
  volumeM3?: number;              // volume dragué (surface × profondeur × passes)
  debitM3h?: number;              // débit de dragage en m³/h
  profondeurDragageM?: number;    // épaisseur de vase par passe
  nbPassesParPosition?: number;   // nb balayages G-D avant avancement de 40 cm
  incidents?: SuiviIncident[]; // in-session incidents (bouchon, câbles, etc.)
  depthSegments?: { fromTs: number; profondeurM: number }[]; // depth per time segment (dragage)
  notes?: string;
  pendingSync?: boolean;       // stored offline, not yet in Firestore
  deletedAt?: string | null;   // ISO date when moved to the trash; null/absent = active
}

export type PinRole = 'salarie' | 'patron';

export type SessionState = 'idle' | 'active' | 'paused' | 'area-draw';
