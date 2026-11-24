import type { Materiel } from '../types/materiel';

type Seed = Omit<Materiel, 'id' | 'journal' | 'taches' | 'suiviDepuis'>;

// Starting data for the excavators, from manufacturer and specification sites. Sources disagree on some
// figures (noted in specs); photos are added in the app.
export const PELLES_DE_DEPART: Seed[] = [
  {
    nom: 'Kubota KH 35', famille: 'pelle', marque: 'Kubota', modele: 'KH 35', annee: 1984,
    etat: 'operationnel',
    specs: {
      'Poids': '≈ 1,35 t',
      'Longueur de transport': '3,33 m',
      'Largeur de transport': '0,98 m',
      'Hauteur de transport': '2,12 m (une source indique 2,25 m)',
      'Largeur des chenilles': '230 mm',
      'Profondeur de fouille': '2,25 m',
      'Portée maximale': '3,7 m',
      'Moteur': 'D850 (modèle abandonné)',
    },
  },
  {
    nom: 'JCB 8026 CTS', famille: 'pelle', marque: 'JCB', modele: '8026 CTS (« 802.6 »)', annee: 2007,
    etat: 'operationnel',
    specs: {
      'Poids en ordre de marche': '2 867 kg (ISO 6016)',
      'Poids de transport': '≈ 2,7 t',
      'Longueur de transport': '4,08 m',
      'Hauteur de transport': '2,40 m',
      'Largeur hors tout': '1,55 m',
      'Largeur des chenilles': '250 mm',
      'Profondeur de fouille': '≈ 3,05 m',
      'Portée maximale': '4,77 m',
      'Hauteur de déversement': '3,22 m',
      'Puissance': '18,4 kW (25 ch)',
    },
  },
  {
    nom: 'Schaeff HR 32', famille: 'pelle', marque: 'Schaeff (Terex)', modele: 'HR 32',
    etat: 'operationnel',
    specs: {
      'Poids': '≈ 7,5 t (une source indique 2,4 t, probablement erronée)',
      'Longueur de transport': '4,16 m',
      'Largeur de transport': '2,33 m',
      'Hauteur de transport': '4,34 m',
      'Largeur des chenilles': '450 mm',
      'Capacité du godet': '0,335 m³',
      'Profondeur de fouille': '≈ 4 m',
      'Portée au sol': '≈ 7 m',
      'Moteur': 'Deutz BF4M2011, 54 kW',
    },
  },
  {
    nom: 'Komatsu PC160LC-7', famille: 'pelle', marque: 'Komatsu', modele: 'PC160LC-7', annee: 2007,
    etat: 'operationnel',
    specs: {
      'Poids en ordre de marche': '≈ 16,5 à 17,1 t (selon configuration)',
      'Longueur de transport': '8,60 m',
      'Largeur de transport': '3,30 m',
      'Hauteur de transport': '2,50 m',
      'Garde au sol': '440 mm',
      'Rayon de rotation arrière': '2,44 m',
      'Profondeur de fouille': '≈ 6,3 m',
      'Portée au sol': '≈ 9,2 m',
      'Puissance nette': '82 kW (111 ch)',
    },
  },
];

// Dredges.
export const DRAGUES_DE_DEPART: Seed[] = [
  {
    nom: 'Drague diesel', famille: 'drague', etat: 'operationnel',
    specs: {
      'Motorisation': 'Diesel',
      'Remarque': 'Marque, modèle, année et caractéristiques à compléter',
    },
  },
];

// Transport: tractors, trucks and tipping equipment. Missing figures are noted in specs.
export const TRANSPORT_DE_DEPART: Seed[] = [
  {
    nom: 'Renault 155-54 TZ', famille: 'transport', marque: 'Renault', modele: '155-54 TZ',
    etat: 'operationnel',
    specs: {
      'Puissance': '≈ 145 ch (108 kW)',
      'Poids': '≈ 5 626 kg',
      'Moteur': 'MWM TD226-B6, 6,2 L',
      'Boîte': '16 AV / 16 AR, mécanique',
      'Relevage arrière': '≈ 8 681 kg',
    },
  },
  {
    nom: 'Iseki TA 537', famille: 'transport', marque: 'Iseki', modele: 'TA 537',
    etat: 'operationnel',
    specs: {
      'Puissance': '37 ch (27 kW)',
      'Poids': '≈ 1 534 kg',
      'Moteur': 'Isuzu 4JD1, 2,04 L',
      'Transmission': '4x4, 16 AV, mécanique synchronisée',
      'Relevage arrière': '≈ 1 799 kg',
    },
  },
  {
    nom: 'Volvo FH500 + semi porte-engin TRAX', famille: 'transport', marque: 'Volvo', modele: 'FH500',
    etat: 'non_utilisable',
    specs: {
      'Puissance': '≈ 500 ch (368 kW)',
      'Poids à vide': '≈ 7,9 à 8,5 t (tracteur)',
      'PTRA': '44 t (ensemble)',
      'Remarque': 'Porte-engin : charge utile et dimensions à confirmer auprès du carrossier',
    },
  },
  {
    nom: 'Benne TP Decroix', famille: 'transport', marque: 'Decroix', modele: 'Benne TP',
    etat: 'operationnel',
    specs: {
      'Remarque': 'Caractéristiques non trouvées : charge utile, dimensions et poids à compléter',
    },
  },
  {
    nom: 'Chenillette LH420', famille: 'transport', modele: 'LH420',
    etat: 'operationnel',
    specs: {
      'Largeur': '3,30 m',
      'Remarque': 'Poids, dimensions et puissance à compléter',
    },
  },
  {
    nom: 'Petite benne tracteur', famille: 'transport', modele: 'Benne tractée',
    etat: 'operationnel',
    specs: {
      'Remarque': 'Caractéristiques à compléter',
    },
  },
];
