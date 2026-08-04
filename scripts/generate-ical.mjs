/**
 * Fetches chantiers from Firestore REST API and generates a calendar.ics file.
 * Run: node scripts/generate-ical.mjs [output-path]
 */
import { writeFileSync } from 'fs';

const API_KEY  = 'AIzaSyDt4gTL-KqWyBPC2777wH4s-t6cAmGoEwY';
const PROJECT  = 'ets-vandaele';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ── Firestore REST parsing ──────────────────────────────────────────────────

function parseField(field) {
  if (!field) return undefined;
  if ('stringValue'  in field) return field.stringValue;
  if ('integerValue' in field) return parseInt(field.integerValue);
  if ('doubleValue'  in field) return field.doubleValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('nullValue'    in field) return null;
  if ('arrayValue'   in field) return (field.arrayValue.values ?? []).map(parseField);
  return undefined;
}

function parseDoc(doc) {
  const id     = doc.name.split('/').pop();
  const fields = {};
  for (const [k, v] of Object.entries(doc.fields ?? {}))
    fields[k] = parseField(v);
  return { id, ...fields };
}

async function fetchChantiers() {
  const all = [];
  let pageToken = '';
  do {
    const url = `${BASE_URL}/chantiers?pageSize=200&key=${API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`Firestore ${res.status}: ${await res.text()}`);
    const data = await res.json();
    (data.documents ?? []).forEach(d => all.push(parseDoc(d)));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return all;
}

// ── iCal helpers ────────────────────────────────────────────────────────────

function iCalDate(dateStr) {
  // YYYY-MM-DD → YYYYMMDD
  return dateStr.replace(/-/g, '');
}

function iCalDatePlusOne(dateStr) {
  // iCal DTEND for all-day events is exclusive (day after last day)
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function iCalTimestamp(isoStr) {
  // ISO string → iCal UTC timestamp
  if (!isoStr) return new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  return isoStr.replace(/[-:.]/g, '').slice(0, 15) + 'Z';
}

function esc(str) {
  return (str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// iCal line folding: max 75 octets per line
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let offset = 0;
  while (offset < bytes.length) {
    const chunk = offset === 0 ? 75 : 74;
    parts.push(bytes.slice(offset, offset + chunk).toString('utf8'));
    offset += chunk;
  }
  return parts.join('\r\n ');
}

// ── iCal generation ─────────────────────────────────────────────────────────

const TYPE_LABELS = {
  curage_aspiration:        'Curage aspiration',
  curage_mecanique:         'Curage mécanique',
  broyage_chenillette_sans: 'Broyage chenillette',
  broyage_chenillette_avec: 'Broyage chenillette',
  broyage_forestier:        'Broyage forestier',
  deboisement:              'Déboisement',
  terrassement:             'Terrassement',
  faucardage:               'Faucardage',
  defenses_berges:          'Défenses de berges',
  location:                 'Location',
};

function buildEvent(c) {
  const isPotentiel = c.status === 'potentiel';
  const isArchived  = c.status === 'refuse' || c.status === 'annule';
  if (isArchived) return null;

  const status  = isPotentiel ? 'TENTATIVE' : 'CONFIRMED';
  const summary = `${c.nom}${isPotentiel ? ' (potentiel)' : ''}`;

  const desc = [];
  if (c.client)         desc.push(`Client : ${c.client}`);
  if (c.type)           desc.push(`Type : ${TYPE_LABELS[c.type] ?? c.type}`);
  if (c.chiffreAffaire > 0) {
    const ca = c.nombreAnnees > 1
      ? Math.round(c.chiffreAffaire / c.nombreAnnees)
      : c.chiffreAffaire;
    desc.push(`CA : ${ca.toLocaleString('fr-FR')} €${c.nombreAnnees > 1 ? `/an (contrat ${c.nombreAnnees} ans)` : ''}`);
  }
  if (c.nombrePersonnes) desc.push(`Personnes : ${c.nombrePersonnes}`);
  if (c.etat)           desc.push(`État : ${c.etat === 'a_venir' ? 'À venir' : c.etat === 'en_cours' ? 'En cours' : 'Terminé'}`);
  if (c.notes)          desc.push(`Notes : ${c.notes}`);

  const lines = [
    'BEGIN:VEVENT',
    `UID:${c.id}@ets-vandaele`,
    `DTSTAMP:${iCalTimestamp(new Date().toISOString())}`,
    `LAST-MODIFIED:${iCalTimestamp(c.updatedAt)}`,
    `DTSTART;VALUE=DATE:${iCalDate(c.dateDebut)}`,
    `DTEND;VALUE=DATE:${iCalDatePlusOne(c.dateFin)}`,
    `SUMMARY:${esc(summary)}`,
    desc.length ? `DESCRIPTION:${esc(desc.join('\n'))}` : null,
    c.lieu ? `LOCATION:${esc(c.lieu)}` : null,
    `STATUS:${status}`,
    'END:VEVENT',
  ].filter(Boolean);

  return lines.map(fold).join('\r\n');
}

function generateIcal(chantiers) {
  const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';

  const events = chantiers
    .map(buildEvent)
    .filter(Boolean);

  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ETS Vandaele//Plan de Charge//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:ETS Vandaele',
    'X-WR-CALDESC:Chantiers ETS Vandaele',
    'X-WR-TIMEZONE:Europe/Paris',
    // Suggest refresh every 30 min
    'REFRESH-INTERVAL;VALUE=DURATION:PT30M',
    'X-PUBLISHED-TTL:PT30M',
    `X-WR-LAST-MODIFIED:${now}`,
  ];

  return [...header, ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

// ── Main ────────────────────────────────────────────────────────────────────

const outPath = process.argv[2] ?? 'dist/calendar.ics';

const chantiers = await fetchChantiers();
const ical      = generateIcal(chantiers);
writeFileSync(outPath, ical, 'utf8');
console.log(`✓ ${outPath} — ${chantiers.length} chantiers`);
