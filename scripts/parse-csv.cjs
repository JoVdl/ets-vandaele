const fs = require('fs');

const CSV_PATH = '/root/.claude/uploads/b326c18d-41a7-47bc-a78c-66658c984834/e7e0176c-Plan_de_charge_ETS_VANDAELE__Plan_de_charge.csv';

// ── CSV parser (handles quoted fields) ─────────────────────────────────────
function parseRow(line) {
  const fields = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  fields.push(cur.trim());
  return fields;
}

const lines = fs.readFileSync(CSV_PATH, 'utf8').split(/\r?\n/);
const rows  = lines.map(parseRow);

// ── Helpers ─────────────────────────────────────────────────────────────────
const isDateCell = v => /^\d{2}-\d{2}-\d{4}$/.test(v);
const isMoney    = v => /€/.test(v || '');
const SKIP_RE    = /^(Semaine|EN ATTENTE|Contrat|Congé|Location|Restauration PH|Entretien PH|2028\s*-)/i;

function ddmmyyyy(v) {          // "02-03-2026" → "2026-03-02"
  const [d, m, y] = v.split('-');
  return `${y}-${m}-${d}`;
}

function addDays(iso, n) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Detect chantier type from name ──────────────────────────────────────────
function detectType(nom) {
  const n = nom.toLowerCase();
  if (/curage.*aspiration|aspiration.*curage|drague/.test(n))  return 'curage_aspiration';
  if (/curage/.test(n))                                         return 'curage_mecanique';
  if (/broyage.*forest|forest.*broyage/.test(n))               return 'broyage_forestier';
  if (/broyage/.test(n))                                        return 'broyage_chenillette_sans';
  if (/faucard/.test(n))                                        return 'faucardage';
  if (/terrassement/.test(n))                                   return 'terrassement';
  if (/berge|enrochement|tressage|défense|defense/.test(n))    return 'defenses_berges';
  return 'terrassement'; // default
}

// ── Pass 1 : build date blocks ───────────────────────────────────────────────
// A "date row" has ≥ 10 cells matching DD-MM-YYYY
const blocks = [];   // { dates: string[21], dataRows: string[][] }
let curDates = null;
let curData  = [];

for (const row of rows) {
  const nDates = row.slice(0, 21).filter(isDateCell).length;
  if (nDates >= 10) {
    if (curDates) blocks.push({ dates: curDates, dataRows: curData });
    curDates = row.slice(0, 21);
    curData  = [];
  } else if (curDates) {
    const hasContent = row.slice(0, 21).some(v => v && !isMoney(v) && !SKIP_RE.test(v));
    if (hasContent) curData.push(row);
  }
}
if (curDates) blocks.push({ dates: curDates, dataRows: curData });

// ── Pass 2 : extract raw entries from each block ─────────────────────────────
const rawEntries = [];  // { nom, dateDebut, dateFin, caRaw? }

for (const { dates, dataRows } of blocks) {
  for (const row of dataRows) {
    let col = 0;
    while (col < 21) {
      const val = row[col];
      if (!val || isMoney(val) || SKIP_RE.test(val)) { col++; continue; }

      // Find next non-empty entry in date columns
      let nextCol = 21;
      for (let c = col + 1; c < 21; c++) {
        if (row[c] && !isMoney(row[c]) && !SKIP_RE.test(row[c])) {
          nextCol = c;
          break;
        }
      }
      const endCol = nextCol - 1;

      const startDate = dates[col]   ? ddmmyyyy(dates[col])   : null;
      const endDate   = dates[endCol] ? ddmmyyyy(dates[endCol]) : null;

      if (startDate && endDate) {
        // Grab first money value in metadata columns (col 21+) of this row
        const caRaw = row.slice(21).find(isMoney) || '';
        rawEntries.push({ nom: val, dateDebut: startDate, dateFin: endDate, caRaw });
      }

      col = nextCol;
    }
  }
}

// ── Pass 3 : merge adjacent / overlapping same-name entries ─────────────────
rawEntries.sort((a, b) => a.dateDebut.localeCompare(b.dateDebut));

const merged = [];
for (const e of rawEntries) {
  // Look for existing entry with same name where dates are adjacent (gap ≤ 7 days)
  const prev = merged.find(m =>
    m.nom === e.nom && addDays(m.dateFin, 7) >= e.dateDebut
  );
  if (prev) {
    if (e.dateFin > prev.dateFin) prev.dateFin = e.dateFin;
    if (!prev.caRaw && e.caRaw)   prev.caRaw = e.caRaw;
  } else {
    merged.push({ ...e });
  }
}

// ── Pass 4 : parse EN ATTENTE section (no date rows, treated as potentiel) ──
// These appear after the main calendar, rows 84-86
const waitEntries = [];
let inWait = false;
for (const row of rows) {
  if (/EN ATTENTE/i.test(row[0])) { inWait = true; continue; }
  if (!inWait) continue;
  // Each wait row: Name,,,,,,,Name,,,,,,,"CA",...
  const val = row[0];
  if (!val || isMoney(val) || SKIP_RE.test(val)) continue;
  const caRaw = row.find(isMoney) || '';
  waitEntries.push({ nom: val, caRaw, status: 'potentiel' });
}

// ── Pass 5 : build final Firestore documents ──────────────────────────────────
function parseCA(raw) {
  return Math.round(parseFloat((raw || '0').replace(/[€\s]/g, '').replace(',', '.')) || 0);
}

const now = new Date().toISOString();

const chantiers = merged.map((e, i) => ({
  id: `import_${i}`,
  nom:            e.nom,
  type:           detectType(e.nom),
  status:         'confirme',
  dateDebut:      e.dateDebut,
  dateFin:        e.dateFin,
  chiffreAffaire: parseCA(e.caRaw),
  devisSigne:     true,
  acomptePaye:    false,
  createdAt:      now,
  updatedAt:      now,
}));

// Add EN ATTENTE (assign rough dates = today + offset)
const today = new Date().toISOString().slice(0, 10);
waitEntries.forEach((e, i) => {
  chantiers.push({
    id: `wait_${i}`,
    nom:            e.nom,
    type:           detectType(e.nom),
    status:         'potentiel',
    dateDebut:      today,
    dateFin:        addDays(today, 4),
    chiffreAffaire: parseCA(e.caRaw),
    devisSigne:     false,
    acomptePaye:    false,
    createdAt:      now,
    updatedAt:      now,
  });
});

fs.writeFileSync('/home/user/ets-vandaele/src/data/seedData.json', JSON.stringify(chantiers, null, 2));
console.log(`✓ ${chantiers.length} chantiers générés`);
chantiers.forEach(c => console.log(`  [${c.status}] ${c.nom} | ${c.dateDebut} → ${c.dateFin} | ${c.chiffreAffaire}€`));
