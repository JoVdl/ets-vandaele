import { useState } from 'react';
import type { SuiviSession, IncidentType } from '../../types/suivi';

export const INCIDENT_LABELS: Record<IncidentType, string> = {
  bouchon_avant_pompe: 'Bouchon avant pompe',
  bouchon_apres_pompe: 'Bouchon après pompe',
  deplacement_cables:  'Déplacement câbles',
  ajout_tuyaux:        'Ajout de tuyaux',
  panne_mecanique:     'Panne mécanique',
  autre:               'Autre',
};

export const INCIDENT_COLORS: Record<IncidentType, string> = {
  bouchon_avant_pompe: '#f97316',
  bouchon_apres_pompe: '#ef4444',
  deplacement_cables:  '#a855f7',
  ajout_tuyaux:        '#3b82f6',
  panne_mecanique:     '#eab308',
  autre:               '#6b7280',
};

export const HIST_PALETTE = ['#06b6d4', '#8b5cf6', '#f97316', '#ec4899', '#14b8a6', '#f59e0b', '#a3e635'];

// ── SessionTimeline ────────────────────────────────────────────────────────────

export function SessionTimeline({ session }: { session: SuiviSession }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const totalMin = session.dureeMinutes;
  if (totalMin <= 0) return null;

  const sessionStartMs = new Date(session.dateDebut).getTime();

  const segments = (session.incidents ?? []).map((inc, i) => {
    const incEndMs   = new Date(inc.ts).getTime();
    const incStartMs = incEndMs - inc.dureeMinutes * 60_000;
    const startPct   = Math.max(0, ((incStartMs - sessionStartMs) / (totalMin * 60_000)) * 100);
    const widthPct   = Math.min(100 - startPct, (inc.dureeMinutes / totalMin) * 100);
    return { inc, startPct, widthPct, i };
  });

  return (
    <div className="mt-2.5">
      <div
        className="relative h-2 rounded-full overflow-hidden"
        style={{ background: '#16a34a66' }}
        onClick={() => setActiveIdx(null)}
      >
        {segments.map(seg => (
          <button
            key={seg.i}
            onClick={e => { e.stopPropagation(); setActiveIdx(activeIdx === seg.i ? null : seg.i); }}
            className="absolute top-0 h-full rounded-sm min-w-[3px] transition-opacity hover:opacity-90 active:opacity-75"
            style={{
              left:            `${seg.startPct}%`,
              width:           `${Math.max(seg.widthPct, 2)}%`,
              backgroundColor: INCIDENT_COLORS[seg.inc.type],
            }}
          />
        ))}
      </div>
      {activeIdx !== null && segments[activeIdx] && (
        <div className="mt-1 px-2 py-1 bg-slate-800/90 border border-white/[0.12] rounded-lg text-[10px] text-slate-200 flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: INCIDENT_COLORS[segments[activeIdx].inc.type] }}
          />
          <span className="font-semibold">{INCIDENT_LABELS[segments[activeIdx].inc.type]}</span>
          <span className="text-slate-400">·</span>
          <span>{segments[activeIdx].inc.dureeMinutes} min</span>
        </div>
      )}
    </div>
  );
}

// ── GlobalTimeline ─────────────────────────────────────────────────────────────

export function GlobalTimeline({ sessions }: { sessions: SuiviSession[] }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const ordered = [...sessions].sort(
    (a, b) => new Date(a.dateDebut).getTime() - new Date(b.dateDebut).getTime(),
  );
  const totalMin = ordered.reduce((a, s) => a + s.dureeMinutes, 0);
  if (totalMin <= 0) return null;

  interface GlobalSeg { key: string; color: string; startPct: number; widthPct: number; label: string }
  const overlays: GlobalSeg[] = [];
  const dividers: number[] = [];
  let cursor = 0;

  for (let si = 0; si < ordered.length; si++) {
    const s = ordered[si];
    const sessionStartMs = new Date(s.dateDebut).getTime();

    for (const inc of (s.incidents ?? [])) {
      const incEndMs   = new Date(inc.ts).getTime();
      const incStartMs = incEndMs - inc.dureeMinutes * 60_000;
      const offsetMin  = Math.max(0, (incStartMs - sessionStartMs) / 60_000);
      const startPct   = ((cursor + offsetMin) / totalMin) * 100;
      const widthPct   = (inc.dureeMinutes / totalMin) * 100;
      overlays.push({
        key:      `${s.id}-${inc.ts}`,
        color:    INCIDENT_COLORS[inc.type],
        startPct: Math.min(startPct, ((cursor + s.dureeMinutes) / totalMin) * 100 - 0.5),
        widthPct: Math.max(widthPct, 0.5),
        label:    `${INCIDENT_LABELS[inc.type]} · ${inc.dureeMinutes} min`,
      });
    }

    cursor += s.dureeMinutes;
    if (si < ordered.length - 1) dividers.push((cursor / totalMin) * 100);
  }

  const usedTypes = Array.from(new Set(
    ordered.flatMap(s => (s.incidents ?? []).map(i => i.type))
  ));

  return (
    <div className="mt-2" onClick={() => setActiveKey(null)}>
      <div
        className="relative h-3 rounded-full overflow-hidden"
        style={{ background: '#16a34a55' }}
      >
        {dividers.map((pct, i) => (
          <div key={i} className="absolute top-0 bottom-0 w-px bg-black/50 pointer-events-none" style={{ left: `${pct}%` }} />
        ))}
        {overlays.map(seg => (
          <button
            key={seg.key}
            onClick={e => { e.stopPropagation(); setActiveKey(activeKey === seg.key ? null : seg.key); }}
            className="absolute top-0 h-full min-w-[3px] rounded-sm transition-opacity hover:opacity-90 active:opacity-75"
            style={{
              left:            `${seg.startPct}%`,
              width:           `${seg.widthPct}%`,
              backgroundColor: seg.color,
            }}
          />
        ))}
      </div>
      {activeKey !== null && overlays.find(s => s.key === activeKey) && (
        <div className="mt-1 px-2 py-1 bg-slate-800/90 border border-white/[0.12] rounded-lg text-[10px] text-slate-200 flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: overlays.find(s => s.key === activeKey)!.color }}
          />
          {overlays.find(s => s.key === activeKey)!.label}
        </div>
      )}
      {usedTypes.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
          {usedTypes.map(t => (
            <span key={t} className="flex items-center gap-1 text-[9px] text-slate-400">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: INCIDENT_COLORS[t] }} />
              {INCIDENT_LABELS[t]}
            </span>
          ))}
          <span className="flex items-center gap-1 text-[9px] text-slate-400">
            <span className="inline-block w-2 h-2 rounded-full bg-green-600/70" />
            Curage
          </span>
        </div>
      )}
    </div>
  );
}
