/**
 * Génère des sessions de dragage factices avec traces GPS réalistes
 * pour le chantier "Lac de la Gioule".
 *
 * Pattern : papillonnage (aspiration) — passes E-O parallèles séparées
 * de 40 cm, largeur de passe = 20 m, vitesse ~0.5 km/h, GPS 1 pt/2 s.
 *
 * Usage :
 *   node scripts/gen-gps-data.mjs           → crée les sessions
 *   node scripts/gen-gps-data.mjs --dry-run  → affiche sans écrire
 *   node scripts/gen-gps-data.mjs --delete   → supprime les sessions créées
 */

import { initializeApp }         from 'firebase/app';
import {
  getFirestore, collection, getDocs, addDoc, deleteDoc,
  doc, query, where,
} from 'firebase/firestore';

// ── Firebase config ───────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyDt4gTL-KqWyBPC2777wH4s-t6cAmGoEwY",
  authDomain:        "ets-vandaele.firebaseapp.com",
  projectId:         "ets-vandaele",
  storageBucket:     "ets-vandaele.firebasestorage.app",
  messagingSenderId: "1027752944412",
  appId:             "1:1027752944412:web:8242cf5452db79bac810d9",
};

const DRY_RUN = process.argv.includes('--dry-run');
const DELETE  = process.argv.includes('--delete');

// Marqueur pour identifier les sessions créées par ce script
const FAKE_NOTE = '__FAKE_GPS_SESSION__';

// ── Constantes dragage ────────────────────────────────────────────────────────
const LARGEUR_M       = 20;    // largeur de passe papillonnage (m)
const AVANCEMENT_M    = 0.40;  // avancement N-S entre deux passes (m)
const VITESSE_MPS     = 0.14;  // 0.5 km/h en m/s (déplacement de la drague)
const GPS_INTERVAL_S  = 10;    // 1 point GPS toutes les 10 s
const PROFONDEUR_M    = 0.40;  // épaisseur vase dragée par passe (m)

// ── Géodésie utilitaire ───────────────────────────────────────────────────────
const LAT_M = 1 / 111_000;
function lngM(lat) { return 1 / (111_000 * Math.cos(lat * Math.PI / 180)); }

function distM(a, b) {
  const dlat = (b.lat - a.lat) / LAT_M;
  const dlng = (b.lng - a.lng) / lngM((a.lat + b.lat) / 2);
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

function bbox(pts) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of pts) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Génère la trace GPS d'une session de dragage à l'intérieur d'un rectangle.
 *
 * @param lakePoly  [{lat,lng}] — 4 coins du lac (rectangle simplifié)
 * @param bandFrac  [0..1] fraction nord du lac déjà couverte au début de la session
 * @param dateDebut ISO string du début de la session
 * @param durationMin durée totale de la session en minutes
 */
function generateTrack(lakePoly, bandFrac, dateDebut, durationMin) {
  const bb = bbox(Array.isArray(lakePoly) ? lakePoly : [lakePoly]);

  // Dimensions du lac en mètres
  const lakeWidthM  = (bb.maxLng - bb.minLng) / lngM((bb.minLat + bb.maxLat) / 2);
  const lakeHeightM = (bb.maxLat - bb.minLat) / LAT_M;

  // Passe E-O sur 90 % de la largeur du lac
  const passLenM   = lakeWidthM * 0.90;
  const marginLng  = (bb.maxLng - bb.minLng) * 0.05;
  const startLng   = bb.minLng + marginLng;

  // Latitude de départ = bandFrac de la hauteur depuis le sud
  let curLat   = bb.minLat + lakeHeightM * bandFrac * LAT_M;
  let goingEast = true;

  const pts = [];
  let tMs       = new Date(dateDebut).getTime();
  const maxMs   = tMs + durationMin * 60 * 1000;
  const nPointsPerPass = Math.floor((passLenM / VITESSE_MPS) / GPS_INTERVAL_S);

  while (tMs < maxMs && curLat < bb.maxLat - 5 * LAT_M) {
    // ── Une passe E-O ──────────────────────────────────────────────
    for (let i = 0; i < nPointsPerPass; i++) {
      if (tMs >= maxMs) break;
      const frac = i / (nPointsPerPass - 1);
      const lng  = goingEast
        ? startLng + frac * passLenM * lngM(curLat)
        : startLng + (1 - frac) * passLenM * lngM(curLat);

      pts.push({
        lat: curLat + (Math.random() - 0.5) * 2 * LAT_M,
        lng: lng    + (Math.random() - 0.5) * 2 * lngM(curLat),
        ts:  tMs,
        spd: VITESSE_MPS + (Math.random() - 0.5) * 0.03,
        acc: 3 + Math.random() * 4,
      });
      tMs += GPS_INTERVAL_S * 1000;
    }

    // Avancement N (repositionnement ~8 s)
    curLat += AVANCEMENT_M * LAT_M;
    tMs    += 8_000;
    goingEast = !goingEast;
  }

  if (pts.length < 4) return null;

  // ── Stats ────────────────────────────────────────────────────────
  const totalDistM    = pts.reduce((acc, p, i) => i === 0 ? 0 : acc + distM(pts[i-1], p), 0);
  const passesActual  = Math.floor(pts.length / nPointsPerPass);
  const surfaceM2     = Math.max(passesActual, 1) * AVANCEMENT_M * passLenM;
  const durationH     = durationMin / 60;
  const volumeM3      = surfaceM2 * PROFONDEUR_M;
  const debitM3h      = volumeM3 / durationH;
  const rendementM2h  = surfaceM2 / durationH;

  // Latitude finale couverte (fraction du lac)
  const bandFracEnd = (curLat - bb.minLat) / (lakeHeightM * LAT_M);

  return {
    pts,
    bandFracEnd: Math.min(1, bandFracEnd),
    surfaceCoveredM2:  Math.round(surfaceM2),
    distanceM:         Math.round(totalDistM),
    vitesseMoyenneKmh: Math.round(VITESSE_MPS * 3.6 * 10) / 10,
    rendementM2h:      Math.round(rendementM2h),
    volumeM3:          Math.round(volumeM3 * 10) / 10,
    debitM3h:          Math.round(debitM3h * 10) / 10,
  };
}

// ── Définition des sessions à créer ──────────────────────────────────────────
// 4 sessions passées, chacune sur une bande différente du lac
// Incidents typiques de dragage
const SESSION_TEMPLATES = [
  {
    dateDebut: '2026-10-14T07:30:00.000Z', durationMin: 480, operateur: 'salarie',
    incidents: [
      { type: 'bouchon_avant_pompe', dureeMinutes: 20, ts: '2026-10-14T09:45:00.000Z', note: 'Corps étranger dans la crépine' },
    ],
  },
  {
    dateDebut: '2026-10-15T07:15:00.000Z', durationMin: 510, operateur: 'patron',
    incidents: [],
  },
  {
    dateDebut: '2026-10-21T07:30:00.000Z', durationMin: 480, operateur: 'salarie',
    incidents: [
      { type: 'deplacement_cables',  dureeMinutes: 35, ts: '2026-10-21T10:00:00.000Z', note: 'Câble d\'alimentation trop court, rallonge posée' },
      { type: 'bouchon_apres_pompe', dureeMinutes: 15, ts: '2026-10-21T13:20:00.000Z' },
    ],
  },
  {
    dateDebut: '2026-10-22T07:45:00.000Z', durationMin: 450, operateur: 'salarie',
    incidents: [
      { type: 'ajout_tuyaux', dureeMinutes: 25, ts: '2026-10-22T11:30:00.000Z', note: 'Extension du tuyau de refoulement +50 m' },
    ],
  },
  {
    dateDebut: '2026-11-04T07:30:00.000Z', durationMin: 480, operateur: 'patron',
    incidents: [
      { type: 'panne_mecanique', dureeMinutes: 45, ts: '2026-11-04T10:15:00.000Z', note: 'Courroie de pompe cassée — remplacement' },
    ],
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const app = initializeApp(firebaseConfig);
  const db  = getFirestore(app);

  // ── Mode suppression ──────────────────────────────────────────────────────
  if (DELETE) {
    console.log('🗑  Suppression des sessions factices…');
    const snap = await getDocs(collection(db, 'suiviSessions'));
    let count = 0;
    for (const d of snap.docs) {
      if (d.data().notes === FAKE_NOTE) {
        await deleteDoc(doc(db, 'suiviSessions', d.id));
        console.log('   Supprimé :', d.id);
        count++;
      }
    }
    console.log(`✅ ${count} session(s) supprimée(s).`);
    process.exit(0);
  }

  // ── Trouver le chantier ───────────────────────────────────────────────────
  console.log('🔍 Lecture du chantier…');
  const chantiersSnap = await getDocs(collection(db, 'chantiers'));
  const chantier = chantiersSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .find(c => c.nom?.toLowerCase().includes('gioule') || c.nom?.toLowerCase().includes('giol'));

  if (!chantier) { console.error('❌ Chantier introuvable'); process.exit(1); }
  console.log(`✅ "${chantier.nom}" — lat=${chantier.latitude} lng=${chantier.longitude}`);

  // ── Construire un rectangle "lac" autour du centroïde ─────────────────────
  // On utilise le polygone s'il existe, sinon on fabrique un rectangle
  let lakePoly = chantier.polygon?.[0];
  if (!Array.isArray(lakePoly) || lakePoly.length < 3) {
    const lat = chantier.latitude  ?? 43.7685314;
    const lng = chantier.longitude ?? -0.2580817;
    // Lac fictif 250 m (E-O) × 120 m (N-S)
    const dLat = 60  * LAT_M;
    const dLng = 125 * lngM(lat);
    lakePoly = [
      { lat: lat - dLat, lng: lng - dLng },
      { lat: lat - dLat, lng: lng + dLng },
      { lat: lat + dLat, lng: lng + dLng },
      { lat: lat + dLat, lng: lng - dLng },
    ];
    console.log(`ℹ  Pas de polygone dessiné — rectangle fictif 250×120 m utilisé`);
    console.log(`   SW : (${lakePoly[0].lat.toFixed(6)}, ${lakePoly[0].lng.toFixed(6)})`);
    console.log(`   NE : (${lakePoly[2].lat.toFixed(6)}, ${lakePoly[2].lng.toFixed(6)})`);
  }

  // ── Génération et écriture des sessions ───────────────────────────────────
  console.log(`\n🌊 Génération de ${SESSION_TEMPLATES.length} sessions…\n`);
  let bandFrac = 0;  // fraction du lac couverte jusqu'ici

  for (let i = 0; i < SESSION_TEMPLATES.length; i++) {
    const tmpl   = SESSION_TEMPLATES[i];
    const result = generateTrack(lakePoly, bandFrac, tmpl.dateDebut, tmpl.durationMin);

    if (!result) { console.warn(`   ⚠️  Session ${i+1} : aucun point généré, ignorée`); continue; }

    // Durée nette = durée totale - temps incidents
    const incidentMin = tmpl.incidents.reduce((a, inc) => a + inc.dureeMinutes, 0);
    const dateFin = new Date(new Date(tmpl.dateDebut).getTime() + tmpl.durationMin * 60_000).toISOString();

    const session = {
      chantierId:          chantier.id,
      chantierNom:         chantier.nom,
      operateur:           tmpl.operateur,
      dateDebut:           tmpl.dateDebut,
      dateFin,
      dureeMinutes:        tmpl.durationMin,
      gpsPoints:           result.pts,
      surfaceCoveredM2:    result.surfaceCoveredM2,
      distanceM:           result.distanceM,
      vitesseMoyenneKmh:   result.vitesseMoyenneKmh,
      rendementM2h:        result.rendementM2h,
      volumeM3:            result.volumeM3,
      debitM3h:            result.debitM3h,
      profondeurDragageM:  PROFONDEUR_M,
      nbPassesParPosition: 1,
      incidents:           tmpl.incidents,
      notes:               FAKE_NOTE,
    };

    console.log(`Session ${i+1}/${SESSION_TEMPLATES.length} : ${tmpl.dateDebut.slice(0,10)}`);
    console.log(`  Opérateur : ${tmpl.operateur} | Durée : ${tmpl.durationMin} min`);
    console.log(`  Bande lac : ${(bandFrac*100).toFixed(0)}% → ${(result.bandFracEnd*100).toFixed(0)}%`);
    console.log(`  GPS pts   : ${result.pts.length}`);
    console.log(`  Surface   : ${result.surfaceCoveredM2} m² | Volume : ${result.volumeM3} m³ | Débit : ${result.debitM3h} m³/h`);
    console.log(`  Incidents : ${tmpl.incidents.length} (${incidentMin} min perdues)`);

    if (DRY_RUN) {
      console.log('  [dry-run] Non écrit\n');
    } else {
      const ref = await addDoc(collection(db, 'suiviSessions'), session);
      console.log(`  ✅ Créé : ${ref.id}\n`);
    }

    bandFrac = result.bandFracEnd;
  }

  const totalIncMin = SESSION_TEMPLATES.reduce((a, t) =>
    a + t.incidents.reduce((b, i) => b + i.dureeMinutes, 0), 0);
  const totalDurH   = SESSION_TEMPLATES.reduce((a, t) => a + t.durationMin, 0) / 60;
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Total : ${SESSION_TEMPLATES.length} sessions | ${totalDurH.toFixed(1)} h / 210 h vendues`);
  console.log(`Incidents cumulés : ${totalIncMin} min`);
  console.log(DRY_RUN ? '(dry-run — rien n\'a été écrit)' : '✅ Toutes les sessions créées.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
