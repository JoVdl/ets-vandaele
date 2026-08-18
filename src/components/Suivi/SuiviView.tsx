import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, Pause, Square, MapPin, Wifi, WifiOff, LocateFixed,
  ChevronUp, ChevronDown, History, Settings, Ruler, Trash2, Check, X, LogOut
} from 'lucide-react';
import SuiviMap from './SuiviMap';
import { useGps } from '../../hooks/useGps';
import { useSuiviSessions } from '../../hooks/useSuiviSessions';
import { useChantiers } from '../../hooks/useChantiers';
import {
  areaM2, formatArea, formatDistance, formatDuration, avgSpeedKmh, instantSpeedKmh, totalDistanceM
} from '../../lib/geo';
import { saveActiveSession, loadActiveSession, clearActiveSession } from '../../lib/suiviOffline';
import { clearSession } from '../../lib/suiviConfig';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { PinRole } from '../../types/suivi';

interface Props {
  role: PinRole;
  onLogout: () => void;
}

type View = 'map' | 'history' | 'settings';

export default function SuiviView({ role, onLogout }: Props) {
  const { chantiers } = useChantiers();
  const { sessions, saveSession, syncing } = useSuiviSessions();
  const [view, setView] = useState<View>('map');

  // ── Session state ──────────────────────────────────────────────────────
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionPaused, setSessionPaused] = useState(false);
  const [sessionStart, setSessionStart]   = useState<Date | null>(null);
  const [elapsed, setElapsed]             = useState(0); // seconds
  const [selectedChantierId, setSelectedChantierId] = useState('');
  const [showChantierPicker, setShowChantierPicker] = useState(false);
  const [panelOpen, setPanelOpen]         = useState(true);
  const [followGps, setFollowGps]         = useState(true);

  // ── Draw mode (area measurement) ────────────────────────────────────────
  const [drawMode, setDrawMode]   = useState(false);
  const [drawPoints, setDrawPoints] = useState<{ lat: number; lng: number }[]>([]);
  const [drawSaved, setDrawSaved] = useState<number | null>(null); // saved area in m²

  // ── GPS ────────────────────────────────────────────────────────────────
  const { points: gpsPoints, currentPos, error: gpsError, accuracy, resetPoints, addPoints } = useGps(sessionActive && !sessionPaused);

  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online',  on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // ── Elapsed timer ──────────────────────────────────────────────────────
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (sessionActive && !sessionPaused) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sessionActive, sessionPaused]);

  // ── Crash recovery: auto-save points to localStorage ──────────────────
  const crashSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!sessionActive || !selectedChantierId) return;
    const chantier = chantiers.find(c => c.id === selectedChantierId);
    crashSaveRef.current = setInterval(() => {
      if (chantier) {
        saveActiveSession({
          chantierId:   chantier.id,
          chantierNom:  chantier.nom,
          operateur:    role,
          dateDebut:    sessionStart?.toISOString() ?? new Date().toISOString(),
          points:       gpsPoints,
        });
      }
    }, 30_000);
    return () => { if (crashSaveRef.current) clearInterval(crashSaveRef.current); };
  }, [sessionActive, selectedChantierId, gpsPoints, chantiers, role, sessionStart]);

  // ── Restore crashed session on mount ──────────────────────────────────
  useEffect(() => {
    const saved = loadActiveSession();
    if (saved && saved.points?.length > 0) {
      const restore = confirm(
        `Session précédente récupérée (${saved.chantierNom}) — continuer ?`
      );
      if (restore) {
        setSelectedChantierId(saved.chantierId);
        setSessionStart(new Date(saved.dateDebut));
        addPoints(saved.points);
        setElapsed(Math.round((Date.now() - new Date(saved.dateDebut).getTime()) / 1000));
        setSessionActive(true);
      } else {
        clearActiveSession();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Computed metrics ───────────────────────────────────────────────────
  const distM   = totalDistanceM(gpsPoints);
  const areaM   = areaM2(gpsPoints);
  const speedNow = gpsPoints.length >= 2
    ? instantSpeedKmh(gpsPoints[gpsPoints.length - 2], gpsPoints[gpsPoints.length - 1])
    : 0;
  const speedAvg = avgSpeedKmh(gpsPoints);
  const elapsedH = elapsed / 3600;
  const rendement = elapsedH > 0 ? areaM / elapsedH : 0;

  const selectedChantier = chantiers.find(c => c.id === selectedChantierId);
  const progress = selectedChantier?.surface && areaM > 0
    ? Math.min(100, (areaM / selectedChantier.surface) * 100)
    : null;

  // ── Session controls ───────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    if (!selectedChantierId) { setShowChantierPicker(true); return; }
    resetPoints();
    setElapsed(0);
    setSessionStart(new Date());
    setSessionActive(true);
    setSessionPaused(false);
  }, [selectedChantierId, resetPoints]);

  const handlePause = useCallback(() => setSessionPaused(p => !p), []);

  const handleStop = useCallback(async () => {
    if (!selectedChantier) return;
    setSessionActive(false);
    setSessionPaused(false);
    clearActiveSession();

    await saveSession({
      chantierId:   selectedChantier.id,
      chantierNom:  selectedChantier.nom,
      operateur:    role,
      dateDebut:    sessionStart?.toISOString() ?? new Date().toISOString(),
      dateFin:      new Date().toISOString(),
      dureeMinutes: Math.round(elapsed / 60),
      gpsPoints,
      notes:        '',
    });
    resetPoints();
    setElapsed(0);
    setSessionStart(null);
  }, [selectedChantier, saveSession, role, sessionStart, elapsed, gpsPoints, resetPoints]);

  // ── Draw mode ──────────────────────────────────────────────────────────
  const handleDrawPoint = useCallback((lat: number, lng: number) => {
    setDrawPoints(p => [...p, { lat, lng }]);
  }, []);

  const handleDrawClear = () => { setDrawPoints([]); setDrawSaved(null); };
  const handleDrawSave  = () => {
    const area = areaM2(drawPoints);
    setDrawSaved(area);
    setDrawMode(false);
    setDrawPoints([]);
  };

  // ── Format helpers ─────────────────────────────────────────────────────
  const formatTime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  };

  // ────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-slate-900 flex flex-col" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-slate-800 flex-shrink-0 z-10">

        {/* Chantier name / picker */}
        <button
          onClick={() => setShowChantierPicker(true)}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
        >
          <MapPin size={14} className="text-green-500 flex-shrink-0" />
          <span className="text-white text-sm font-semibold truncate">
            {selectedChantier ? selectedChantier.nom : 'Sélectionner un chantier'}
          </span>
          <ChevronDown size={13} className="text-slate-500 flex-shrink-0" />
        </button>

        {/* GPS accuracy */}
        <div className="flex items-center gap-1 text-xs">
          <div className={`w-2 h-2 rounded-full ${
            gpsError ? 'bg-red-500' :
            accuracy && accuracy < 10 ? 'bg-green-500' :
            accuracy && accuracy < 30 ? 'bg-yellow-500' : 'bg-orange-500'
          }`} />
          {accuracy != null && <span className="text-slate-400">{Math.round(accuracy)}m</span>}
        </div>

        {/* Online / offline */}
        {online ? <Wifi size={14} className="text-green-500" /> : <WifiOff size={14} className="text-orange-400" />}

        {/* Nav buttons */}
        <button onClick={() => setView(v => v === 'history' ? 'map' : 'history')}
          className={`p-1.5 rounded-lg ${view === 'history' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
          <History size={16} />
        </button>
        {role === 'patron' && (
          <button onClick={() => setView(v => v === 'settings' ? 'map' : 'settings')}
            className={`p-1.5 rounded-lg ${view === 'settings' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
            <Settings size={16} />
          </button>
        )}
        <button onClick={() => { clearSession(); onLogout(); }}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300">
          <LogOut size={15} />
        </button>
      </div>

      {/* ── Map view ────────────────────────────────────────────────────── */}
      {view === 'map' && (
        <>
          {/* Map fills available space */}
          <div className="flex-1 relative overflow-hidden">
            <SuiviMap
              gpsPoints={gpsPoints}
              currentPos={currentPos}
              drawMode={drawMode}
              drawPoints={drawPoints}
              onDrawPoint={handleDrawPoint}
              followGps={followGps}
            />

            {/* Follow GPS toggle */}
            <button
              onClick={() => setFollowGps(f => !f)}
              className={`absolute top-3 right-3 z-[1000] p-2.5 rounded-xl shadow-lg transition-colors ${
                followGps ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              <LocateFixed size={18} />
            </button>

            {/* Draw mode toolbar */}
            {drawMode && (
              <div className="absolute top-3 left-3 right-16 z-[1000] flex items-center gap-2 bg-slate-900/90 rounded-xl px-3 py-2">
                <Ruler size={14} className="text-blue-400 flex-shrink-0" />
                <span className="text-white text-xs flex-1">Touchez la carte pour tracer</span>
                {drawPoints.length >= 3 && (
                  <button onClick={handleDrawSave}
                    className="p-1 rounded-lg bg-green-600 text-white">
                    <Check size={14} />
                  </button>
                )}
                <button onClick={() => { setDrawMode(false); handleDrawClear(); }}
                  className="p-1 rounded-lg bg-slate-700 text-slate-300">
                  <X size={14} />
                </button>
                {drawPoints.length > 0 && (
                  <button onClick={handleDrawClear}
                    className="p-1 rounded-lg bg-slate-700 text-slate-400">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )}

            {/* GPS error */}
            {gpsError && (
              <div className="absolute top-3 left-3 right-3 z-[1000] bg-red-900/90 text-red-300 text-xs px-3 py-2 rounded-xl">
                {gpsError}
              </div>
            )}
          </div>

          {/* ── Bottom panel ──────────────────────────────────────────── */}
          <div className={`flex-shrink-0 bg-slate-900 border-t border-slate-800 transition-all duration-300 ${panelOpen ? '' : ''}`}>

            {/* Panel toggle */}
            <button onClick={() => setPanelOpen(p => !p)}
              className="w-full flex justify-center py-1.5 text-slate-600 hover:text-slate-400">
              {panelOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>

            {panelOpen && (
              <>
                {/* Metrics grid */}
                {sessionActive && (
                  <div className="grid grid-cols-4 gap-0 border-b border-slate-800 px-2 pb-3">
                    <Metric label="Durée" value={formatTime(elapsed)} />
                    <Metric label="Vitesse" value={`${speedNow.toFixed(1)} km/h`}
                      sub={`moy ${speedAvg.toFixed(1)}`} />
                    <Metric label="Surface" value={formatArea(areaM)} />
                    <Metric label="Rendement" value={`${Math.round(rendement).toLocaleString('fr-FR')}`}
                      sub="m²/h" />
                  </div>
                )}

                {/* Secondary metrics when active */}
                {sessionActive && (
                  <div className="grid grid-cols-3 gap-0 px-2 py-2 border-b border-slate-800">
                    <Metric label="Distance" value={formatDistance(distM)} small />
                    {progress != null && <Metric label="Avancement" value={`${Math.round(progress)} %`} small />}
                    {selectedChantier?.surface && (
                      <Metric label="Surface total" value={formatArea(selectedChantier.surface)} small />
                    )}
                    {drawSaved && <Metric label="Zone mesurée" value={formatArea(drawSaved)} small />}
                  </div>
                )}

                {/* Progress bar */}
                {progress != null && sessionActive && (
                  <div className="px-3 pb-2">
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all duration-1000"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Controls */}
                <div className="flex items-center gap-3 px-3 pb-3 pt-1">

                  {/* Measure area */}
                  <button
                    onClick={() => { setDrawMode(d => !d); if (!drawMode) handleDrawClear(); }}
                    className={`p-3 rounded-xl transition-colors ${
                      drawMode ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                    title="Mesurer une zone"
                  >
                    <Ruler size={18} />
                  </button>

                  {/* Session controls */}
                  <div className="flex-1 flex items-center gap-2 justify-center">
                    {!sessionActive ? (
                      <button onClick={handleStart}
                        className="flex-1 flex items-center justify-center gap-2 h-14 rounded-2xl bg-green-600 text-white text-base font-bold hover:bg-green-500 active:scale-95 transition-all">
                        <Play size={20} fill="currentColor" />
                        Démarrer
                      </button>
                    ) : (
                      <>
                        <button onClick={handlePause}
                          className={`flex-1 h-14 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm transition-all active:scale-95 ${
                            sessionPaused ? 'bg-green-600 text-white hover:bg-green-500' : 'bg-slate-700 text-white hover:bg-slate-600'
                          }`}>
                          {sessionPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} />}
                          {sessionPaused ? 'Reprendre' : 'Pause'}
                        </button>
                        <button onClick={handleStop}
                          className="w-14 h-14 rounded-2xl bg-red-600 text-white flex items-center justify-center hover:bg-red-500 active:scale-95 transition-all">
                          <Square size={20} fill="currentColor" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── History view ────────────────────────────────────────────────── */}
      {view === 'history' && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-3">
            <h2 className="text-white font-bold text-base mb-3">Historique des sessions</h2>

            {syncing && (
              <div className="text-xs text-orange-400 mb-2 flex items-center gap-1">
                <WifiOff size={12} /> Synchronisation en cours…
              </div>
            )}

            {sessions.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">Aucune session enregistrée</p>
            ) : (
              <div className="space-y-2">
                {sessions.map(s => (
                  <div key={s.id} className="bg-slate-800 rounded-2xl p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-semibold truncate">{s.chantierNom}</p>
                        <p className="text-slate-400 text-xs">
                          {format(new Date(s.dateDebut), 'dd MMM yyyy – HH:mm', { locale: fr })}
                          {s.operateur === 'patron' ? ' · Patron' : ' · Salarié'}
                        </p>
                      </div>
                      {s.pendingSync && (
                        <span className="flex-shrink-0 text-[10px] px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded-full">
                          En attente
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      <SmallStat label="Durée" value={formatDuration(s.dureeMinutes)} />
                      <SmallStat label="Surface" value={formatArea(s.surfaceCoveredM2)} />
                      <SmallStat label="Rend." value={`${Math.round(s.rendementM2h)} m²/h`} />
                      <SmallStat label="Vitesse" value={`${s.vitesseMoyenneKmh.toFixed(1)} km/h`} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Settings view (patron only) ──────────────────────────────────── */}
      {view === 'settings' && role === 'patron' && (
        <SettingsPanel />
      )}

      {/* ── Chantier picker modal ────────────────────────────────────────── */}
      {showChantierPicker && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end">
          <div className="w-full bg-slate-900 rounded-t-3xl max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <h3 className="text-white font-bold">Choisir un chantier</h3>
              <button onClick={() => setShowChantierPicker(false)} className="text-slate-400 p-1">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {chantiers
                .filter(c => c.status !== 'refuse' && c.status !== 'annule')
                .map(c => (
                  <button key={c.id}
                    onClick={() => { setSelectedChantierId(c.id); setShowChantierPicker(false); }}
                    className={`w-full text-left px-4 py-3 rounded-xl mb-1 transition-colors ${
                      c.id === selectedChantierId ? 'bg-green-800 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    <p className="font-medium text-sm">{c.nom}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {c.dateDebut} · {c.type}
                      {c.surface ? ` · ${formatArea(c.surface)}` : ''}
                    </p>
                  </button>
                ))
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Metric({ label, value, sub, small }: { label: string; value: string; sub?: string; small?: boolean }) {
  return (
    <div className="flex flex-col items-center px-1 py-1">
      <span className={`text-white font-bold tabular-nums ${small ? 'text-sm' : 'text-lg'}`}>{value}</span>
      {sub && <span className="text-slate-500 text-[10px]">{sub}</span>}
      <span className="text-slate-500 text-[10px] uppercase tracking-wide mt-0.5">{label}</span>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-700/50 rounded-lg px-2 py-1.5 text-center">
      <p className="text-white text-xs font-semibold tabular-nums">{value}</p>
      <p className="text-slate-500 text-[10px]">{label}</p>
    </div>
  );
}

function SettingsPanel() {
  const [salaryPin, setSalaryPin] = useState('');
  const [patronPin, setPatronPin] = useState('');
  const [saved, setSaved]         = useState(false);
  const [saving, setSaving]       = useState(false);

  const handleSave = async () => {
    if (salaryPin.length < 4 || patronPin.length < 4) return;
    setSaving(true);
    try {
      const { saveSuiviConfig } = await import('../../lib/suiviConfig');
      await saveSuiviConfig({ salaryPin, patronPin });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
      <h2 className="text-white font-bold text-base">Paramètres accès</h2>

      <div className="bg-slate-800 rounded-2xl p-4 space-y-4">
        <div>
          <label className="text-slate-400 text-xs uppercase tracking-wide block mb-1">
            Code salarié (accès suivi uniquement)
          </label>
          <input
            type="number"
            placeholder="ex: 1234"
            value={salaryPin}
            onChange={e => setSalaryPin(e.target.value.slice(0, 6))}
            className="w-full bg-slate-700 text-white rounded-xl px-3 py-2.5 text-base tracking-widest outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="text-slate-400 text-xs uppercase tracking-wide block mb-1">
            Code patron (accès historique + paramètres)
          </label>
          <input
            type="number"
            placeholder="ex: 0000"
            value={patronPin}
            onChange={e => setPatronPin(e.target.value.slice(0, 6))}
            className="w-full bg-slate-700 text-white rounded-xl px-3 py-2.5 text-base tracking-widest outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <button onClick={handleSave} disabled={saving || salaryPin.length < 4 || patronPin.length < 4}
          className="w-full h-12 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40 hover:bg-green-500 transition-colors">
          {saved ? '✓ Enregistré' : saving ? 'Enregistrement…' : 'Enregistrer les codes'}
        </button>
      </div>

      <div className="bg-slate-800 rounded-2xl p-4">
        <p className="text-slate-400 text-xs">
          Le salarié accède à la page en ajoutant <code className="text-green-400">#suivi</code> à l'URL de l'application.
          Il ne voit que le suivi en temps réel et son historique personnel.
        </p>
      </div>
    </div>
  );
}
