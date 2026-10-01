export interface GpsPoint {
  lat: number;
  lng: number;
  ts: number;      // epoch ms
  spd?: number;    // m/s from GPS API
  acc?: number;    // accuracy in metres
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
  notes?: string;
  pendingSync?: boolean;       // stored offline, not yet in Firestore
}

export type PinRole = 'salarie' | 'patron';

export type SessionState = 'idle' | 'active' | 'paused' | 'area-draw';
