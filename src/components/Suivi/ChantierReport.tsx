import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { format } from 'date-fns';
import type { Chantier } from '../../types';
import type { SuiviSession } from '../../types/suivi';
import { fetchAllChantierSessions } from '../../hooks/useSuiviSessions';
import { alignedRectsBySession, type AlignedRect } from '../../lib/alignedVolumes';
import { formatDuration } from '../../lib/geo';
import { INCIDENT_LABELS, HIST_PALETTE } from './incidentUtils';

type MachineParams = { vitesseMaxKmh: number; largeurTravailM: number; smoothAlpha: number };

const SECTIONS = [
  { key: 'summary',   label: 'Synthèse du chantier' },
  { key: 'plan',      label: 'Plan des zones travaillées' },
  { key: 'daily',     label: 'Récapitulatif par journée' },
  { key: 'sessions',  label: 'Tableau des sessions' },
  { key: 'incidents', label: 'Incidents' },
] as const;

const COLUMNS = [
  { key: 'date',       label: 'Date / heure' },
  { key: 'operateur',  label: 'Opérateur' },
  { key: 'duree',      label: 'Durée' },
  { key: 'volume',     label: 'Volume (m³)' },
  { key: 'debit',      label: 'Débit (m³/h)' },
  { key: 'largeur',    label: 'Largeur de travail (m)' },
  { key: 'avancement', label: 'Avancement (m)' },
  { key: 'incidents',  label: 'Incidents' },
] as const;

const SUMMARY_ITEMS = [
  { key: 'sessions',  label: 'Nombre de sessions' },
  { key: 'heures',    label: 'Heures effectives' },
  { key: 'volume',    label: 'Volume total' },
  { key: 'debit',     label: 'Débit moyen' },
  { key: 'largeur',   label: 'Largeur moyenne' },
  { key: 'avancement', label: 'Avancement cumulé' },
  { key: 'incidents', label: 'Incidents' },
  { key: 'budget',    label: 'Budget (si défini)' },
  { key: 'dates',     label: 'Dates première / dernière session' },
] as const;

type SectionKey = typeof SECTIONS[number]['key'];
type SummaryKey = typeof SUMMARY_ITEMS[number]['key'];
type ColumnKey = typeof COLUMNS[number]['key'];

const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmt1 = (n: number) => n.toFixed(1);

interface Row {
  s: SuiviSession;
  vol: number;
  debit: number;
  largeur: number | null;
  avancement: number | null;
  netH: number;
  incMin: number;
}

function buildRows(sessions: SuiviSession[], rects: Map<string, AlignedRect>): Row[] {
  return sessions.map(s => {
    const rect = rects.get(s.id);
    const incMin = s.incidents?.reduce((a, i) => a + i.dureeMinutes, 0) ?? 0;
    const netH = Math.max(0, s.dureeMinutes - incMin) / 60;
    const vol = rect?.volumeM3 ?? s.volumeM3 ?? 0;
    return {
      s, vol,
      debit: netH > 0 && vol > 0 ? vol / netH : 0,
      largeur: rect ? rect.lengthM : null,
      avancement: rect ? rect.measuredWidthM : null,
      netH, incMin,
    };
  });
}

function planMap(sessions: SuiviSession[], rectMap: Map<string, AlignedRect>): string {
  const zones = sessions
    .map((s, i) => {
      const rect = rectMap.get(s.id);
      if (!rect) return null;
      const color = HIST_PALETTE[i % HIST_PALETTE.length];
      const label = `${format(new Date(s.dateDebut), 'dd/MM HH:mm')} · ${fmt1(rect.volumeM3 ?? s.volumeM3 ?? 0)} m³`;
      return { color, label, poly: rect.polygon };
    })
    .filter((z): z is { color: string; label: string; poly: [number, number][] } => z !== null);
  if (zones.length === 0) return '';
  const json = JSON.stringify(zones).replace(/</g, '\\u003c');
  return `<div id="plan" style="height:440px;border-radius:8px;overflow:hidden"></div>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var zones = ${json};
  var map = L.map('plan', { zoomControl: true });
  L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.ign.fr">IGN</a> – Géoplateforme'
  }).addTo(map);
  var group = L.featureGroup(zones.map(function(z){
    return L.polygon(z.poly, { color: z.color, fillColor: z.color, fillOpacity: 0.4, weight: 2 }).bindTooltip(z.label);
  })).addTo(map);
  map.fitBounds(group.getBounds(), { padding: [20, 20] });
})();
</script>`;
}

export function buildHtml(args: {
  chantier: Chantier; sessions: SuiviSession[]; rows: Row[]; rects: Map<string, AlignedRect>;
  sections: Set<SectionKey>; columns: Set<ColumnKey>; summaryItems: Set<SummaryKey>;
}): string {
  const { chantier, sessions, rows, rects, sections, columns, summaryItems } = args;
  const total = rows.reduce((a, r) => a + r.vol, 0);
  const totalMin = sessions.reduce((a, s) => a + s.dureeMinutes, 0);
  const incMin = rows.reduce((a, r) => a + r.incMin, 0);
  const incCount = sessions.reduce((a, s) => a + (s.incidents?.length ?? 0), 0);
  const advTotal = rows.reduce((a, r) => a + (r.avancement ?? 0), 0);
  const largeurs = rows.map(r => r.largeur).filter((x): x is number => x != null);
  const largeurMoy = largeurs.length ? largeurs.reduce((a, b) => a + b, 0) / largeurs.length : null;
  const debits = rows.map(r => r.debit).filter(d => d > 0);
  const debitMoy = debits.length ? debits.reduce((a, b) => a + b, 0) / debits.length : null;
  const first = sessions[0], last = sessions[sessions.length - 1];
  const budgetH = chantier.dureeEstimeeH ?? 0;

  const parts: string[] = [];

  if (sections.has('summary')) {
    const kpi = (label: string, value: string) =>
      `<div class="kpi"><div class="v">${value}</div><div class="l">${esc(label)}</div></div>`;
    const cards: string[] = [];
    if (summaryItems.has('sessions'))   cards.push(kpi('Sessions', String(sessions.length)));
    if (summaryItems.has('heures'))     cards.push(kpi('Heures effectives', formatDuration(totalMin)));
    if (summaryItems.has('volume'))     cards.push(kpi('Volume total', `${fmt1(total)} m³`));
    if (summaryItems.has('debit'))      cards.push(kpi('Débit moyen', debitMoy != null ? `${fmt1(debitMoy)} m³/h` : '—'));
    if (summaryItems.has('largeur'))    cards.push(kpi('Largeur moyenne', largeurMoy != null ? `${fmt1(largeurMoy)} m` : '—'));
    if (summaryItems.has('avancement')) cards.push(kpi('Avancement cumulé', advTotal > 0 ? `${advTotal.toFixed(0)} m` : '—'));
    if (summaryItems.has('incidents'))  cards.push(kpi('Incidents', `${incCount} · ${incMin} min`));
    if (summaryItems.has('budget') && budgetH > 0) cards.push(kpi('Budget', `${formatDuration(totalMin)} / ${budgetH} h`));
    const dates = summaryItems.has('dates')
      ? `<p class="muted">Première session : ${first ? esc(format(new Date(first.dateDebut), 'dd/MM/yyyy')) : '—'} · Dernière : ${last ? esc(format(new Date(last.dateDebut), 'dd/MM/yyyy')) : '—'}</p>`
      : '';
    parts.push(`<h2>Synthèse</h2>${cards.length ? `<div class="kpis">${cards.join('')}</div>` : ''}${dates}`);
  }

  if (sections.has('plan')) {
    const map = planMap(sessions, rects);
    parts.push(`<h2>Plan des zones travaillées</h2>${map || '<p class="muted">Aucune zone calculée (chantier non drague ou sessions sans trace GPS).</p>'}`);
  }

  if (sections.has('daily')) {
    const byDay = new Map<string, Row[]>();
    for (const r of rows) {
      const k = format(new Date(r.s.dateDebut), 'yyyy-MM-dd');
      byDay.set(k, [...(byDay.get(k) ?? []), r]);
    }
    const lines = [...byDay.entries()].map(([k, list]) => {
      const vol = list.reduce((a, r) => a + r.vol, 0);
      const dur = list.reduce((a, r) => a + r.s.dureeMinutes, 0);
      const adv = list.reduce((a, r) => a + (r.avancement ?? 0), 0);
      const wl = list.map(r => r.largeur).filter((x): x is number => x != null);
      const w = wl.length ? wl.reduce((a, b) => a + b, 0) / wl.length : null;
      return `<tr><td>${esc(format(new Date(k), 'dd/MM/yyyy'))}</td><td>${list.length}</td><td>${formatDuration(dur)}</td>
        <td>${fmt1(vol)}</td><td>${w != null ? fmt1(w) : '—'}</td><td>${adv > 0 ? adv.toFixed(0) : '—'}</td></tr>`;
    }).join('');
    parts.push(`<h2>Récapitulatif par journée</h2><table><thead><tr><th>Jour</th><th>Sessions</th><th>Durée</th><th>Volume (m³)</th><th>Largeur (m)</th><th>Avancement (m)</th></tr></thead><tbody>${lines}</tbody></table>`);
  }

  if (sections.has('sessions')) {
    const cols = COLUMNS.filter(c => columns.has(c.key));
    const head = cols.map(c => `<th>${esc(c.label)}</th>`).join('');
    const body = rows.map(r => {
      const cells = cols.map(c => {
        switch (c.key) {
          case 'date':       return `<td>${esc(format(new Date(r.s.dateDebut), 'dd/MM/yy HH:mm'))}</td>`;
          case 'operateur':  return `<td>${r.s.operateur === 'patron' ? 'Patron' : 'Salarié'}</td>`;
          case 'duree':      return `<td>${formatDuration(r.s.dureeMinutes)}</td>`;
          case 'volume':     return `<td>${r.vol > 0 ? fmt1(r.vol) : '—'}</td>`;
          case 'debit':      return `<td>${r.debit > 0 ? fmt1(r.debit) : '—'}</td>`;
          case 'largeur':    return `<td>${r.largeur != null ? fmt1(r.largeur) : '—'}</td>`;
          case 'avancement': return `<td>${r.avancement != null && r.avancement > 0 ? r.avancement.toFixed(0) : '—'}</td>`;
          case 'incidents':  return `<td>${r.s.incidents?.length ? `${r.s.incidents.length} · ${r.incMin} min` : '—'}</td>`;
        }
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    parts.push(`<h2>Tableau des sessions</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
  }

  if (sections.has('incidents')) {
    const items = sessions.flatMap(s => (s.incidents ?? []).map(i => ({ s, i })))
      .sort((a, b) => new Date(a.i.ts).getTime() - new Date(b.i.ts).getTime());
    const lines = items.length === 0
      ? '<p class="muted">Aucun incident.</p>'
      : `<table><thead><tr><th>Date / heure</th><th>Type</th><th>Durée</th><th>Note</th></tr></thead><tbody>${items.map(({ i }) =>
          `<tr><td>${esc(format(new Date(i.ts), 'dd/MM/yy HH:mm'))}</td><td>${esc((INCIDENT_LABELS as Record<string, string>)[i.type] ?? i.type)}</td><td>${i.dureeMinutes} min</td><td>${esc(i.note ?? '')}</td></tr>`).join('')}</tbody></table>`;
    parts.push(`<h2>Incidents</h2>${lines}`);
  }

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rapport — ${esc(chantier.nom)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:0;padding:24px;background:#fff}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:24px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  .muted{color:#64748b;font-size:12px}
  .kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
  .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px}
  .kpi .v{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums} .kpi .l{font-size:11px;color:#64748b}
  table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
  th,td{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left} th{background:#f8fafc;font-weight:600}
  .wrap{overflow-x:auto}
  @media print{ .noprint{display:none} body{padding:0} }
</style></head><body>
<div class="noprint" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px">
  <span class="muted">Sur iPhone : Partager → Imprimer → PDF</span>
  <button onclick="window.print()" style="padding:8px 14px;border-radius:8px;border:0;background:#0891b2;color:#fff;font-weight:600">Imprimer / PDF</button>
</div>
<h1>${esc(chantier.nom)}</h1>
<p class="muted">${chantier.lieu ? esc(chantier.lieu) + ' · ' : ''}Rapport généré le ${esc(format(new Date(), 'dd/MM/yyyy'))}</p>
${parts.map(p => `<div class="wrap">${p}</div>`).join('\n')}
</body></html>`;
}

export default function ChantierReport({ chantier, machineParams, onClose }: {
  chantier: Chantier;
  machineParams: MachineParams;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<SuiviSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<Set<SectionKey>>(() => new Set(SECTIONS.map(s => s.key)));
  const [columns, setColumns] = useState<Set<ColumnKey>>(() => new Set(COLUMNS.map(c => c.key)));
  const [summaryItems, setSummaryItems] = useState<Set<SummaryKey>>(() => new Set(SUMMARY_ITEMS.map(i => i.key)));

  useEffect(() => {
    let cancelled = false;
    fetchAllChantierSessions(chantier.id)
      .then(list => { if (!cancelled) setSessions(list); })
      .catch(() => { if (!cancelled) setError('Impossible de charger les sessions (connexion ?).'); });
    return () => { cancelled = true; };
  }, [chantier.id]);

  const rects = useMemo(() => sessions
    ? alignedRectsBySession(sessions, [chantier], {
        vitesseMaxKmh: machineParams.vitesseMaxKmh,
        largeurM:      machineParams.largeurTravailM,
        smoothAlpha:   machineParams.smoothAlpha,
      })
    : new Map<string, AlignedRect>(), [sessions, chantier, machineParams]);

  const rows = useMemo(() => sessions ? buildRows(sessions, rects) : [], [sessions, rects]);

  const toggle = <T extends string>(set: Set<T>, key: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  // Written straight into a same-origin window opened by the tap: printing works from it on iOS
  const generate = () => {
    if (!sessions) return;
    const html = buildHtml({ chantier, sessions, rows, rects, sections, columns, summaryItems });
    const w = window.open('', '_blank');
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
      return;
    }
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `rapport-${chantier.nom.replace(/\s+/g, '-')}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const check = (checked: boolean) => (
    <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-cyan-600 border-cyan-500' : 'border-slate-600'}`}>
      {checked && <span className="text-white text-[10px] leading-none">✓</span>}
    </span>
  );

  return createPortal(
    <div className="fixed inset-0 z-[500] bg-slate-950 flex flex-col">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-white/[0.07] flex-shrink-0">
        <button onClick={onClose} className="p-1.5 -ml-1 text-slate-400 hover:text-white active:scale-95 transition-all">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm truncate">Rapport du chantier</p>
          <p className="text-slate-500 text-[10px] truncate">{chantier.nom}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-5" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {!sessions && !error && <p className="text-slate-500 text-sm">Chargement de toutes les sessions…</p>}

        {sessions && (
          <>
            <p className="text-slate-400 text-xs">
              {sessions.length} session{sessions.length > 1 ? 's' : ''} depuis le début · {fmt1(rows.reduce((a, r) => a + r.vol, 0))} m³
            </p>

            <section>
              <h3 className="text-slate-300 text-xs font-semibold uppercase tracking-wide mb-2">Sections du rapport</h3>
              <div className="space-y-1.5">
                {SECTIONS.map(sec => (
                  <button key={sec.key} onClick={() => toggle(sections, sec.key, setSections)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.04] text-left text-sm text-slate-200">
                    {check(sections.has(sec.key))}{sec.label}
                  </button>
                ))}
              </div>
            </section>

            {sections.has('summary') && (
              <section>
                <h3 className="text-slate-300 text-xs font-semibold uppercase tracking-wide mb-2">Éléments de la synthèse</h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {SUMMARY_ITEMS.map(item => (
                    <button key={item.key} onClick={() => toggle(summaryItems, item.key, setSummaryItems)}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] text-left text-xs text-slate-200">
                      {check(summaryItems.has(item.key))}{item.label}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3 className="text-slate-300 text-xs font-semibold uppercase tracking-wide mb-2">Colonnes du tableau des sessions</h3>
              <div className="grid grid-cols-2 gap-1.5">
                {COLUMNS.map(col => (
                  <button key={col.key} onClick={() => toggle(columns, col.key, setColumns)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] text-left text-xs text-slate-200">
                    {check(columns.has(col.key))}{col.label}
                  </button>
                ))}
              </div>
            </section>

            <button onClick={generate} disabled={sections.size === 0}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-cyan-600 text-white font-semibold text-sm disabled:opacity-40">
              <Printer size={16} /> Générer le rapport
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
