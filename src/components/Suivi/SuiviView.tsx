import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Play, Pause, Square, MapPin, Wifi, WifiOff, LocateFixed,
  ChevronUp, ChevronDown, History, Settings, Ruler, Trash2, Check, X, LogOut,
  BarChart2, Home, Navigation, Satellite, Map as MapIcon, Layers, SlidersHorizontal, Radio,
} from 'lucide-react';
import SuiviMap, { type ChantierZone } from './SuiviMap';
import SessionDetailView from './SessionDetailView';
import { useGps } from '../../hooks/useGps';
import { useSuiviSessions } from '../../hooks/useSuiviSessions';
import { useChantiers } from '../../hooks/useChantiers';
import { CHANTIER_TYPES } from '../../lib/constants';
import {
  areaM2, formatArea, formatDistance, formatDuration,
  avgSpeedKmh, instantSpeedKmh, totalDistanceM, distanceM, stripAreaM2,
} from '../../lib/geo';
import {
  type MachineParams, defaultParams, loadMachineParams, saveMachineParams,
} from '../../lib/machineParams';
import {
  pushLiveSession, clearLiveSession, useLiveSessions,
} from '../../hooks/useLiveSessions';
import { saveActiveSession, loadActiveSession, clearActiveSession } from '../../lib/suiviOffline';
import { clearSession } from '../../lib/suiviConfig';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { PinRole, SuiviSession } from '../../types/suivi';
import type { Chantier } from '../../types';

interface Props {
  role: PinRole;
  onLogout: () => void;
}

type View = 'map' | 'live' | 'history' | 'analytics' | 'settings';

const TYPE_LABELS: Record<string, string> = {
  curage_aspiration:         'Curage aspiration',
  curage_mecanique:          'Curage mécanique',
  broyage_chenillette_sans:  'Broyage chenillette',
  broyage_chenillette_avec:  'Broyage chenillette + ramassage',
  broyage_forestier:         'Broyage forestier',
  deboisement:               'Déboisement',
  terrassement:              'Terrassement',
  faucardage:                'Faucardage',
  defenses_berges:           'Défenses de berges',
  location:                  'Location',
};

export default function SuiviView({ role, onLogout }: Props) {
  const { chantiers, updateChantier } = useChantiers();
  const { sessions, saveSession, syncing } = useSuiviSessions();
  const { liveSessions } = useLiveSessions();
  const [view, setView] = useState<View>('map');
  const [selectedSession, setSelectedSession] = useState<SuiviSession | null>(null);

  // Unique session ID (stable across re-renders, reset on new session start)
  const sessionIdRef = useRef<string>(`${role}-${Date.now()}`);

  // ── Session state ──────────────────────────────────────────────────────
  const [sessionActive, setSessionActive]   = useState(false);
  const [sessionPaused, setSessionPaused]   = useState(false);
  const [sessionStart, setSessionStart]     = useState<Date | null>(null);
  const [elapsed, setElapsed]               = useState(0);
  const [selectedChantierId, setSelectedChantierId] = useState('');
  const [showChantierPicker, setShowChantierPicker] = useState(false);
  const [pickerSearch, setPickerSearch]     = useState('');
  const [panelOpen, setPanelOpen]           = useState(true);
  const [followGps, setFollowGps]           = useState(true);

  // ── Draw mode ──────────────────────────────────────────────────────────
  const [drawMode, setDrawMode]     = useState(false);
  const [drawPoints, setDrawPoints] = useState<{ lat: number; lng: number }[]>([]);
  const [drawSaved, setDrawSaved]   = useState<number | null>(null);

  // ── Map display options ────────────────────────────────────────────────
  type TileMode = 'ign' | 'esri' | 'osm';
  const TILE_CYCLE: TileMode[] = ['ign', 'esri', 'osm'];
  const [tileMode, setTileMode]       = useState<TileMode>('ign');
  const [showZones, setShowZones]     = useState(true);
  const [showMachinePanel, setShowMachinePanel] = useState(false);

  // ── Screen Wake Lock (keeps screen on during active session) ──────────
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    if (!sessionActive || sessionPaused) {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      return;
    }
    navigator.wakeLock?.request('screen')
      .then(wl => { wakeLockRef.current = wl; })
      .catch(() => {}); // Not available in all browsers
    return () => { wakeLockRef.current?.release().catch(() => {}); };
  }, [sessionActive, sessionPaused]);

  // ── Machine params ─────────────────────────────────────────────────────
  const [machineParams, setMachineParamsState] = useState<MachineParams>(() => loadMachineParams());

  // ── GPS ────────────────────────────────────────────────────────────────
  const { points: gpsPoints, currentPos, error: gpsError, accuracy, resetPoints, addPoints } =
    useGps(sessionActive && !sessionPaused);

  // ── Nearby chantier detection ──────────────────────────────────────────
  const [nearbyChantier, setNearbyChantier] = useState<{ c: Chantier; dist: number } | null>(null);

  useEffect(() => {
    if (sessionActive || selectedChantierId || !currentPos) { setNearbyChantier(null); return; }
    const candidates = chantiers.filter(c =>
      c.status !== 'refuse' && c.status !== 'annule' && c.latitude && c.longitude
    );
    let nearest: Chantier | null = null;
    let nearestDist = Infinity;
    for (const c of candidates) {
      const d = distanceM(currentPos.lat, currentPos.lng, c.latitude!, c.longitude!);
      if (d < nearestDist) { nearestDist = d; nearest = c; }
    }
    if (nearest && nearestDist < 500) {
      setNearbyChantier({ c: nearest, dist: Math.round(nearestDist) });
    } else {
      setNearbyChantier(null);
    }
  }, [currentPos, sessionActive, selectedChantierId, chantiers]);

  // ── Online/offline ─────────────────────────────────────────────────────
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online',  on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // ── Timer ──────────────────────────────────────────────────────────────
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (sessionActive && !sessionPaused) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sessionActive, sessionPaused]);

  // ── Crash recovery ─────────────────────────────────────────────────────
  const crashSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!sessionActive || !selectedChantierId) return;
    const chantier = chantiers.find(c => c.id === selectedChantierId);
    crashSaveRef.current = setInterval(() => {
      if (chantier) {
        saveActiveSession({
          chantierId:  chantier.id,
          chantierNom: chantier.nom,
          operateur:   role,
          dateDebut:   sessionStart?.toISOString() ?? new Date().toISOString(),
          points:      gpsPoints,
        });
      }
    }, 30_000);
    return () => { if (crashSaveRef.current) clearInterval(crashSaveRef.current); };
  }, [sessionActive, selectedChantierId, gpsPoints, chantiers, role, sessionStart]);

  useEffect(() => {
    const saved = loadActiveSession();
    if (saved && saved.points?.length > 0) {
      const restore = confirm(`Session précédente récupérée (${saved.chantierNom}) — continuer ?`);
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

  // ── Speed-outlier filter (GPS glitches above machine max speed) ───────
  const filteredPoints = useMemo(() => {
    const maxKmh = machineParams.vitesseMaxKmh;
    return gpsPoints.filter((pt, i) => {
      if (i === 0) return true;
      const prev = gpsPoints[i - 1];
      const dt = (pt.ts - prev.ts) / 1000;
      if (dt <= 0) return false;
      const speedKmh = (distanceM(prev.lat, prev.lng, pt.lat, pt.lng) / dt) * 3.6;
      return speedKmh <= maxKmh * 2; // 2× tolerance before rejecting
    });
  }, [gpsPoints, machineParams.vitesseMaxKmh]);

  // ── Computed metrics ───────────────────────────────────────────────────
  const distM    = totalDistanceM(filteredPoints);
  const areaM    = machineParams.largeurTravailM > 0
    ? stripAreaM2(filteredPoints, machineParams.largeurTravailM, machineParams.recouvrementPct)
    : 0;
  const speedNow = filteredPoints.length >= 2
    ? instantSpeedKmh(filteredPoints[filteredPoints.length - 2], filteredPoints[filteredPoints.length - 1])
    : 0;
  const speedAvg  = avgSpeedKmh(filteredPoints);
  const elapsedH  = elapsed / 3600;
  const rendement = elapsedH > 0 && areaM > 0 ? areaM / elapsedH : 0;

  const selectedChantier = chantiers.find(c => c.id === selectedChantierId);
  const progress = selectedChantier?.surface && areaM > 0
    ? Math.min(100, (areaM / selectedChantier.surface) * 100)
    : null;

  // ── Temps restant estimé ───────────────────────────────────────────────
  const tempsRestantMin = useMemo(() => {
    if (!selectedChantier?.surface || areaM <= 0 || rendement <= 0) return null;
    const restantM2 = selectedChantier.surface - areaM;
    if (restantM2 <= 0) return 0;
    return (restantM2 / rendement) * 60; // minutes
  }, [selectedChantier, areaM, rendement]);

  // ── Live Firestore streaming (every 30s during active session) ─────────
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!sessionActive || sessionPaused || !currentPos) {
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
      return;
    }
    const push = () => {
      if (!currentPos || !selectedChantier) return;
      pushLiveSession(sessionIdRef.current, {
        operateur:    role,
        chantierId:   selectedChantier.id,
        chantierNom:  selectedChantier.nom,
        lat:          currentPos.lat,
        lng:          currentPos.lng,
        accuracy:     accuracy,
        speedKmh:     speedNow,
        areaM,
        distM,
        rendementM2h: rendement,
        progressPct:  progress,
        dureeMinutes: Math.round(elapsed / 60),
      });
    };
    push(); // push immediately
    liveIntervalRef.current = setInterval(push, 30_000);
    return () => { if (liveIntervalRef.current) clearInterval(liveIntervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionActive, sessionPaused, currentPos]);

  // ── Reset machine params when chantier type changes
  useEffect(() => {
    if (!selectedChantier) return;
    const p = defaultParams(selectedChantier.type);
    setMachineParamsState(p);
    saveMachineParams(p);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChantier?.type]);

  // ── Work trail color (from chantier type) ─────────────────────────────
  const workColor = selectedChantier
    ? (CHANTIER_TYPES[selectedChantier.type]?.color ?? '#22c55e')
    : '#22c55e';

  // ── Chantier zones for map ────────────────────────────────────────────
  const chantierZones = useMemo<ChantierZone[]>(() =>
    chantiers
      .filter(c => c.polygon && c.polygon.length > 0 && c.status !== 'refuse' && c.status !== 'annule')
      .map(c => ({
        id:       c.id,
        nom:      c.nom,
        polygons: c.polygon!,
        color:    CHANTIER_TYPES[c.type]?.color ?? '#64748B',
      })),
    [chantiers],
  );

  // ── Analytics ─────────────────────────────────────────────────────────
  const analytics = useMemo(() => {
    const totalH   = sessions.reduce((a, s) => a + s.dureeMinutes / 60, 0);
    const totalM2  = sessions.reduce((a, s) => a + s.surfaceCoveredM2, 0);
    const totalKm  = sessions.reduce((a, s) => a + s.distanceM / 1000, 0);
    const patronH  = sessions.filter(s => s.operateur === 'patron').reduce((a, s) => a + s.dureeMinutes / 60, 0);
    const salarieH = sessions.filter(s => s.operateur === 'salarie').reduce((a, s) => a + s.dureeMinutes / 60, 0);

    // By chantier
    const byChan: Record<string, { nom: string; minutes: number; m2: number; count: number }> = {};
    for (const s of sessions) {
      if (!byChan[s.chantierId]) byChan[s.chantierId] = { nom: s.chantierNom, minutes: 0, m2: 0, count: 0 };
      byChan[s.chantierId].minutes += s.dureeMinutes;
      byChan[s.chantierId].m2 += s.surfaceCoveredM2;
      byChan[s.chantierId].count++;
    }
    const topChantiers = Object.values(byChan).sort((a, b) => b.minutes - a.minutes).slice(0, 6);

    // Avg rendement (sessions with surface)
    const withSurface = sessions.filter(s => s.surfaceCoveredM2 > 0 && s.dureeMinutes > 0);
    const avgRendement = withSurface.length
      ? withSurface.reduce((a, s) => a + s.rendementM2h, 0) / withSurface.length
      : 0;

    // Last 30 days
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = sessions.filter(s => new Date(s.dateDebut).getTime() > cutoff);
    const recentH = recent.reduce((a, s) => a + s.dureeMinutes / 60, 0);

    return { totalH, totalM2, totalKm, patronH, salarieH, topChantiers, avgRendement, recentH, recentCount: recent.length };
  }, [sessions]);

  // ── Session controls ───────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    if (!selectedChantierId) { setShowChantierPicker(true); return; }
    sessionIdRef.current = `${role}-${Date.now()}`;
    resetPoints();
    setElapsed(0);
    setSessionStart(new Date());
    setSessionActive(true);
    setSessionPaused(false);
  }, [selectedChantierId, role, resetPoints]);

  const handlePause = useCallback(() => setSessionPaused(p => !p), []);

  const handleStop = useCallback(async () => {
    if (!selectedChantier) return;
    setSessionActive(false);
    setSessionPaused(false);
    clearActiveSession();
    clearLiveSession(sessionIdRef.current);
    await saveSession({
      chantierId:   selectedChantier.id,
      chantierNom:  selectedChantier.nom,
      operateur:    role,
      dateDebut:    sessionStart?.toISOString() ?? new Date().toISOString(),
      dateFin:      new Date().toISOString(),
      dureeMinutes: Math.round(elapsed / 60),
      gpsPoints,
      notes: '',
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
  const handleDrawSave  = async () => {
    const area = areaM2(drawPoints);
    setDrawSaved(area);
    setDrawMode(false);
    if (selectedChantierId) {
      const existing = selectedChantier?.polygon ?? [];
      const newPolygons = [...existing, drawPoints];
      const totalSurface = newPolygons.reduce((sum, poly) => sum + areaM2(poly), 0);
      await updateChantier(selectedChantierId, {
        polygon: newPolygons,
        surface: Math.round(totalSurface),
      }).catch(() => {/* offline — ignore */});
    }
    setDrawPoints([]);
  };

  const handleDeleteLastZone = async () => {
    if (!selectedChantierId || !selectedChantier?.polygon?.length) return;
    const newPolygons = selectedChantier.polygon.slice(0, -1);
    const totalSurface = newPolygons.reduce((sum, poly) => sum + areaM2(poly), 0);
    await updateChantier(selectedChantierId, {
      polygon: newPolygons,
      surface: newPolygons.length > 0 ? Math.round(totalSurface) : 0,
    }).catch(() => {});
  };

  const formatTime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  };

  const handleLogout = () => {
    clearSession();
    location.hash = '';
    onLogout();
  };

  // ── Chantier picker list ───────────────────────────────────────────────
  const pickerList = useMemo(() => {
    const active = chantiers.filter(c => c.status !== 'refuse' && c.status !== 'annule');
    const q = pickerSearch.toLowerCase().trim();
    return q ? active.filter(c =>
      c.nom.toLowerCase().includes(q) ||
      (c.lieu ?? '').toLowerCase().includes(q) ||
      (c.client ?? '').toLowerCase().includes(q)
    ) : active;
  }, [chantiers, pickerSearch]);

  // ────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-slate-900 flex flex-col" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-slate-800 flex-shrink-0 z-10">

        {/* Home */}
        <a href="#" onClick={() => { clearSession(); onLogout(); }}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 flex-shrink-0">
          <Home size={15} />
        </a>

        {/* Chantier picker */}
        <button onClick={() => setShowChantierPicker(true)}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
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

        {/* Wake lock indicator — screen stays on during session */}
        {sessionActive && !sessionPaused && wakeLockRef.current && (
          <span className="text-[10px] text-amber-400" title="Écran maintenu allumé">🔆</span>
        )}
        {online ? <Wifi size={14} className="text-green-500" /> : <WifiOff size={14} className="text-orange-400" />}

        <button onClick={() => setView(v => v === 'history' ? 'map' : 'history')}
          className={`p-1.5 rounded-lg ${view === 'history' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
          <History size={16} />
        </button>
        {role === 'patron' && (
          <button onClick={() => setView(v => v === 'live' ? 'map' : 'live')}
            className={`p-1.5 rounded-lg relative ${view === 'live' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
            <Radio size={16} />
            {liveSessions.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
            )}
          </button>
        )}
        {role === 'patron' && (
          <button onClick={() => setView(v => v === 'analytics' ? 'map' : 'analytics')}
            className={`p-1.5 rounded-lg ${view === 'analytics' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
            <BarChart2 size={16} />
          </button>
        )}
        {role === 'patron' && (
          <button onClick={() => setView(v => v === 'settings' ? 'map' : 'settings')}
            className={`p-1.5 rounded-lg ${view === 'settings' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
            <Settings size={16} />
          </button>
        )}
        <button onClick={handleLogout} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300">
          <LogOut size={15} />
        </button>
      </div>

      {/* ── Map view ────────────────────────────────────────────────────── */}
      {view === 'map' && (
        <>
          <div className="flex-1 relative overflow-hidden">
            <SuiviMap
              gpsPoints={filteredPoints}
              currentPos={currentPos}
              drawMode={drawMode}
              drawPoints={drawPoints}
              onDrawPoint={handleDrawPoint}
              followGps={followGps}
              chantierZones={chantierZones}
              showZones={showZones}
              satellite={tileMode}
              workColor={workColor}
              largeurM={machineParams.largeurTravailM}
              smoothAlpha={machineParams.smoothAlpha}
              liveSessions={liveSessions}
              mySessionId={sessionIdRef.current}
            />

            {/* Map control buttons */}
            <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2">
              <button onClick={() => setFollowGps(f => !f)}
                className={`p-2.5 rounded-xl shadow-lg transition-colors ${
                  followGps ? 'bg-green-600 text-white' : 'bg-slate-800/90 text-slate-400'
                }`}>
                <LocateFixed size={18} />
              </button>
              <button
                onClick={() => setTileMode(m => TILE_CYCLE[(TILE_CYCLE.indexOf(m) + 1) % TILE_CYCLE.length])}
                className="p-2.5 rounded-xl shadow-lg bg-slate-800/90 transition-colors"
                title={tileMode === 'ign' ? 'IGN France' : tileMode === 'esri' ? 'ESRI Global' : 'OSM'}>
                {tileMode === 'osm'
                  ? <MapIcon size={18} className="text-slate-400" />
                  : <Satellite size={18} className={tileMode === 'ign' ? 'text-green-400' : 'text-cyan-400'} />
                }
              </button>
              <button onClick={() => setShowZones(z => !z)}
                className={`p-2.5 rounded-xl shadow-lg transition-colors ${
                  showZones ? 'bg-slate-800/90 text-amber-400' : 'bg-slate-800/90 text-slate-500'
                }`}
                title={showZones ? 'Masquer les zones' : 'Afficher les zones'}>
                <Layers size={18} />
              </button>
            </div>

            {/* Nearby chantier suggestion */}
            {nearbyChantier && (
              <div className="absolute top-3 left-3 right-16 z-[1000] bg-slate-900/95 border border-green-500/40 rounded-xl px-3 py-2 flex items-center gap-2">
                <Navigation size={13} className="text-green-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold truncate">{nearbyChantier.c.nom}</p>
                  <p className="text-slate-400 text-[10px]">à {nearbyChantier.dist} m</p>
                </div>
                <button
                  onClick={() => { setSelectedChantierId(nearbyChantier.c.id); setNearbyChantier(null); }}
                  className="flex-shrink-0 text-xs bg-green-600 text-white px-2.5 py-1 rounded-lg font-semibold">
                  Sélectionner
                </button>
                <button onClick={() => setNearbyChantier(null)} className="text-slate-500 p-0.5">
                  <X size={13} />
                </button>
              </div>
            )}

            {/* Draw mode toolbar */}
            {drawMode && (
              <div className={`absolute z-[1000] flex items-center gap-2 bg-slate-900/90 rounded-xl px-3 py-2 ${nearbyChantier ? 'top-14' : 'top-3'} left-3 right-20`}>
                <Ruler size={14} className="text-blue-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-white text-xs">
                    {drawPoints.length === 0 ? 'Touchez la carte pour tracer' : `${drawPoints.length} points`}
                  </span>
                  {selectedChantier?.polygon && selectedChantier.polygon.length > 0 && (
                    <span className="text-slate-400 text-[10px] ml-1.5">
                      ({selectedChantier.polygon.length} zone{selectedChantier.polygon.length > 1 ? 's' : ''} existante{selectedChantier.polygon.length > 1 ? 's' : ''})
                    </span>
                  )}
                </div>
                {drawPoints.length >= 3 && (
                  <button onClick={handleDrawSave} className="p-1 rounded-lg bg-green-600 text-white" title="Valider cette zone">
                    <Check size={14} />
                  </button>
                )}
                <button onClick={() => { setDrawMode(false); handleDrawClear(); }}
                  className="p-1 rounded-lg bg-slate-700 text-slate-300">
                  <X size={14} />
                </button>
                {drawPoints.length > 0 && (
                  <button onClick={handleDrawClear} className="p-1 rounded-lg bg-slate-700 text-slate-400" title="Recommencer cette zone">
                    <Trash2 size={14} />
                  </button>
                )}
                {selectedChantier?.polygon && selectedChantier.polygon.length > 0 && drawPoints.length === 0 && (
                  <button onClick={handleDeleteLastZone} className="p-1 rounded-lg bg-red-800 text-red-300" title="Supprimer la dernière zone">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )}

            {gpsError && (
              <div className="absolute top-3 left-3 right-3 z-[1000] bg-red-900/90 text-red-300 text-xs px-3 py-2 rounded-xl">
                {gpsError}
              </div>
            )}
          </div>

          {/* ── Bottom panel ──────────────────────────────────────────── */}
          <div className="flex-shrink-0 bg-slate-900 border-t border-slate-800">
            <button onClick={() => setPanelOpen(p => !p)}
              className="w-full flex justify-center py-1.5 text-slate-600 hover:text-slate-400">
              {panelOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>

            {panelOpen && (
              <>
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

                {sessionActive && (
                  <div className="grid grid-cols-3 gap-0 px-2 py-2 border-b border-slate-800">
                    <Metric label="Distance" value={formatDistance(distM)} small />
                    {progress != null && <Metric label="Avancement" value={`${Math.round(progress)} %`} small />}
                    {selectedChantier?.surface && (
                      <Metric label="Surface tot." value={formatArea(selectedChantier.surface)} small />
                    )}
                    {tempsRestantMin != null && tempsRestantMin > 0 && (
                      <Metric label="Temps restant" value={formatDuration(tempsRestantMin)} small />
                    )}
                    {tempsRestantMin === 0 && (
                      <Metric label="Terminé !" value="✓" small />
                    )}
                    {drawSaved != null && <Metric label="Zone mesurée" value={formatArea(drawSaved)} small />}
                  </div>
                )}

                {progress != null && sessionActive && (
                  <div className="px-3 pb-2">
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full transition-all duration-1000"
                        style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 px-3 pb-3 pt-1">
                  <button
                    onClick={() => { setDrawMode(d => !d); if (!drawMode) handleDrawClear(); }}
                    className={`p-3 rounded-xl transition-colors ${
                      drawMode ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}>
                    <Ruler size={18} />
                  </button>
                  <button
                    onClick={() => setShowMachinePanel(true)}
                    className="p-3 rounded-xl bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                    title="Paramètres machine">
                    <SlidersHorizontal size={18} />
                  </button>

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
                <WifiOff size={12} /> Synchronisation…
              </div>
            )}
            {sessions.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">Aucune session enregistrée</p>
            ) : (
              <div className="space-y-2">
                {sessions.map(s => (
                  <button key={s.id} onClick={() => setSelectedSession(s)}
                    className="w-full text-left bg-slate-800 rounded-2xl p-3 hover:bg-slate-700 transition-colors active:scale-[0.99]">
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
                      <SmallStat label="Durée"    value={formatDuration(s.dureeMinutes)} />
                      <SmallStat label="Surface"  value={formatArea(s.surfaceCoveredM2)} />
                      <SmallStat label="Rend."    value={`${Math.round(s.rendementM2h)} m²/h`} />
                      <SmallStat label="Distance" value={formatDistance(s.distanceM)} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Live view (patron only) ─────────────────────────────────────── */}
      {view === 'live' && role === 'patron' && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-3">
            <div className="flex items-center gap-2 mb-3">
              <Radio size={15} className="text-orange-400" />
              <h2 className="text-white font-bold text-base">Sessions en cours</h2>
              {liveSessions.length > 0 && (
                <span className="ml-auto text-xs bg-orange-500 text-white px-2 py-0.5 rounded-full font-semibold">
                  {liveSessions.length}
                </span>
              )}
            </div>

            {liveSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center mb-3">
                  <Radio size={24} className="text-slate-600" />
                </div>
                <p className="text-slate-400 text-sm font-medium">Aucune session active</p>
                <p className="text-slate-600 text-xs mt-1">Les sessions démarrées apparaîtront ici</p>
              </div>
            ) : (
              <div className="space-y-3">
                {liveSessions
                  .filter(s => s.sessionId !== sessionIdRef.current)
                  .map(s => {
                    const minsAgo = Math.round((Date.now() - new Date(s.lastUpdate).getTime()) / 60000);
                    return (
                      <div key={s.sessionId} className="bg-slate-800 rounded-2xl overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                          <div className="w-3 h-3 rounded-full bg-orange-500 animate-pulse flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold truncate">{s.chantierNom}</p>
                            <p className="text-slate-400 text-[10px]">
                              {s.operateur === 'salarie' ? 'Salarié' : 'Patron'}
                              {minsAgo > 0 ? ` · il y a ${minsAgo} min` : ' · maintenant'}
                            </p>
                          </div>
                          {s.progressPct != null && (
                            <span className="flex-shrink-0 text-xs font-bold text-orange-400 tabular-nums">
                              {Math.round(s.progressPct)} %
                            </span>
                          )}
                        </div>

                        {/* Progress bar */}
                        {s.progressPct != null && (
                          <div className="px-3 pb-2">
                            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-orange-500 rounded-full transition-all"
                                style={{ width: `${Math.min(100, s.progressPct)}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Metrics grid */}
                        <div className="grid grid-cols-4 gap-0 border-t border-slate-700/60 px-1 py-2">
                          <div className="text-center py-1">
                            <p className="text-white text-sm font-bold tabular-nums">{s.speedKmh.toFixed(1)}</p>
                            <p className="text-slate-500 text-[9px] uppercase tracking-wide">km/h</p>
                          </div>
                          <div className="text-center py-1">
                            <p className="text-white text-sm font-bold tabular-nums">{formatArea(s.areaM)}</p>
                            <p className="text-slate-500 text-[9px] uppercase tracking-wide">Surface</p>
                          </div>
                          <div className="text-center py-1">
                            <p className="text-white text-sm font-bold tabular-nums">{Math.round(s.rendementM2h).toLocaleString('fr-FR')}</p>
                            <p className="text-slate-500 text-[9px] uppercase tracking-wide">m²/h</p>
                          </div>
                          <div className="text-center py-1">
                            <p className="text-white text-sm font-bold tabular-nums">{formatDuration(s.dureeMinutes)}</p>
                            <p className="text-slate-500 text-[9px] uppercase tracking-wide">Durée</p>
                          </div>
                        </div>

                        {/* GPS accuracy & distance */}
                        <div className="flex items-center gap-3 px-3 pb-3 text-[10px] text-slate-500">
                          {s.accuracy != null && (
                            <span>GPS ±{Math.round(s.accuracy)} m</span>
                          )}
                          <span>Distance : {formatDistance(s.distM)}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Analytics view (patron only) ────────────────────────────────── */}
      {view === 'analytics' && role === 'patron' && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-3 space-y-4">
            <h2 className="text-white font-bold text-base">Analytiques</h2>

            {sessions.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">Aucune donnée disponible</p>
            ) : (
              <>
                {/* Global stats */}
                <div>
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-2">Global ({sessions.length} sessions)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <AnalyticCard label="Heures totales" value={`${analytics.totalH.toFixed(1)} h`} />
                    <AnalyticCard label="Surface totale" value={formatArea(analytics.totalM2)} />
                    <AnalyticCard label="Distance totale" value={formatDistance(analytics.totalKm * 1000)} />
                    {analytics.avgRendement > 0 && (
                      <AnalyticCard label="Rendement moyen" value={`${Math.round(analytics.avgRendement).toLocaleString('fr-FR')} m²/h`} />
                    )}
                  </div>
                </div>

                {/* 30 jours */}
                <div>
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-2">30 derniers jours</p>
                  <div className="grid grid-cols-2 gap-2">
                    <AnalyticCard label="Sessions" value={`${analytics.recentCount}`} />
                    <AnalyticCard label="Heures" value={`${analytics.recentH.toFixed(1)} h`} />
                  </div>
                </div>

                {/* Répartition patron / salarié */}
                {(analytics.patronH > 0 || analytics.salarieH > 0) && (
                  <div>
                    <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-2">Répartition opérateur</p>
                    <div className="bg-slate-800 rounded-2xl p-3 space-y-2">
                      {analytics.patronH > 0 && (
                        <OperatorBar
                          label="Patron"
                          hours={analytics.patronH}
                          total={analytics.totalH}
                          color="bg-blue-500"
                        />
                      )}
                      {analytics.salarieH > 0 && (
                        <OperatorBar
                          label="Salarié"
                          hours={analytics.salarieH}
                          total={analytics.totalH}
                          color="bg-green-500"
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Top chantiers */}
                {analytics.topChantiers.length > 0 && (
                  <div>
                    <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-2">Par chantier</p>
                    <div className="space-y-1.5">
                      {analytics.topChantiers.map(c => (
                        <div key={c.nom} className="bg-slate-800 rounded-xl px-3 py-2.5 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">{c.nom}</p>
                            <p className="text-slate-500 text-[10px]">{c.count} session{c.count > 1 ? 's' : ''}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-white text-sm font-semibold tabular-nums">
                              {(c.minutes / 60).toFixed(1)} h
                            </p>
                            {c.m2 > 0 && (
                              <p className="text-slate-400 text-[10px]">{formatArea(c.m2)}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Settings view (patron only) ──────────────────────────────────── */}
      {view === 'settings' && role === 'patron' && <SettingsPanel />}

      {/* ── Machine params panel ────────────────────────────────────────── */}
      {showMachinePanel && (
        <MachineParamsPanel
          params={machineParams}
          chantierType={selectedChantier?.type}
          onClose={() => setShowMachinePanel(false)}
          onChange={p => { setMachineParamsState(p); saveMachineParams(p); }}
        />
      )}

      {/* ── Session detail overlay ──────────────────────────────────────── */}
      {selectedSession && (
        <SessionDetailView
          session={selectedSession}
          chantierZones={chantierZones}
          workColor={selectedSession.chantierId === selectedChantierId
            ? workColor
            : '#22c55e'}
          onClose={() => setSelectedSession(null)}
        />
      )}

      {/* ── Chantier picker modal ────────────────────────────────────────── */}
      {showChantierPicker && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end">
          <div className="w-full bg-slate-900 rounded-t-3xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
              <h3 className="text-white font-bold">Choisir un chantier</h3>
              <button onClick={() => { setShowChantierPicker(false); setPickerSearch(''); }}
                className="text-slate-400 p-1">
                <X size={20} />
              </button>
            </div>
            {/* Search */}
            <div className="px-4 py-2 border-b border-slate-800 flex-shrink-0">
              <input
                type="text"
                placeholder="Rechercher…"
                value={pickerSearch}
                onChange={e => setPickerSearch(e.target.value)}
                className="w-full bg-slate-800 text-white text-sm rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-green-500 placeholder-slate-500"
              />
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {pickerList.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-6">Aucun chantier trouvé</p>
              ) : (
                pickerList.map(c => (
                  <button key={c.id}
                    onClick={() => { setSelectedChantierId(c.id); setShowChantierPicker(false); setPickerSearch(''); }}
                    className={`w-full text-left px-4 py-3 rounded-xl mb-1 transition-colors ${
                      c.id === selectedChantierId ? 'bg-green-800 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    <p className="font-medium text-sm">{c.nom}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {TYPE_LABELS[c.type] ?? c.type}
                      {c.lieu ? ` · ${c.lieu}` : ''}
                      {c.surface ? ` · ${formatArea(c.surface)}` : ''}
                      {c.latitude && c.longitude && currentPos
                        ? ` · ${(() => { const d = distanceM(currentPos.lat, currentPos.lng, c.latitude, c.longitude); return d >= 1000 ? `${(d/1000).toFixed(1)} km` : `${Math.round(d)} m`; })()} `
                        : ''}
                    </p>
                  </button>
                ))
              )}
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

function AnalyticCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-800 rounded-2xl px-4 py-3">
      <p className="text-white text-xl font-bold tabular-nums">{value}</p>
      <p className="text-slate-400 text-xs mt-0.5">{label}</p>
    </div>
  );
}

function OperatorBar({ label, hours, total, color }: { label: string; hours: number; total: number; color: string }) {
  const pct = total > 0 ? (hours / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400 tabular-nums">{hours.toFixed(1)} h · {Math.round(pct)} %</span>
      </div>
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function MachineParamsPanel({
  params, chantierType, onClose, onChange,
}: {
  params: MachineParams;
  chantierType?: string;
  onClose: () => void;
  onChange: (p: MachineParams) => void;
}) {
  const [local, setLocal] = useState<MachineParams>({ ...params });
  const set = <K extends keyof MachineParams>(k: K, v: MachineParams[K]) =>
    setLocal(p => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end">
      <div className="w-full bg-slate-900 rounded-t-3xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
          <h3 className="text-white font-bold">Paramètres machine</h3>
          <button onClick={onClose} className="text-slate-400 p-1"><X size={20} /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-5">

          {chantierType && (
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-xs">Type de chantier</span>
              <button
                onClick={() => {
                  const d = defaultParams(chantierType);
                  setLocal(d);
                }}
                className="text-xs text-green-400 hover:text-green-300">
                Réinitialiser défauts
              </button>
            </div>
          )}

          <div>
            <label className="text-slate-400 text-xs uppercase tracking-wide block mb-2">
              Largeur de travail (m)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range" min="0" max="8" step="0.1"
                value={local.largeurTravailM}
                onChange={e => set('largeurTravailM', parseFloat(e.target.value))}
                className="flex-1 accent-green-500"
              />
              <span className="text-white font-bold tabular-nums w-12 text-right">
                {local.largeurTravailM === 0 ? '—' : `${local.largeurTravailM.toFixed(1)} m`}
              </span>
            </div>
            <p className="text-slate-500 text-[10px] mt-1">
              0 = pas de suivi de surface par bandes
            </p>
          </div>

          <div>
            <label className="text-slate-400 text-xs uppercase tracking-wide block mb-2">
              Vitesse max GPS (km/h)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range" min="2" max="60" step="1"
                value={local.vitesseMaxKmh}
                onChange={e => set('vitesseMaxKmh', parseInt(e.target.value))}
                className="flex-1 accent-green-500"
              />
              <span className="text-white font-bold tabular-nums w-14 text-right">
                {local.vitesseMaxKmh} km/h
              </span>
            </div>
            <p className="text-slate-500 text-[10px] mt-1">
              Points GPS au-delà de cette vitesse sont ignorés
            </p>
          </div>

          <div>
            <label className="text-slate-400 text-xs uppercase tracking-wide block mb-2">
              Recouvrement des passes (%)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range" min="0" max="40" step="5"
                value={local.recouvrementPct}
                onChange={e => set('recouvrementPct', parseInt(e.target.value))}
                className="flex-1 accent-green-500"
              />
              <span className="text-white font-bold tabular-nums w-12 text-right">
                {local.recouvrementPct} %
              </span>
            </div>
            {local.largeurTravailM > 0 && (
              <p className="text-slate-500 text-[10px] mt-1">
                Largeur effective : {(local.largeurTravailM * (1 - local.recouvrementPct / 100)).toFixed(2)} m
              </p>
            )}
          </div>

          <div>
            <label className="text-slate-400 text-xs uppercase tracking-wide block mb-2">
              Lissage GPS
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range" min="0" max="0.9" step="0.05"
                value={local.smoothAlpha}
                onChange={e => set('smoothAlpha', parseFloat(e.target.value))}
                className="flex-1 accent-green-500"
              />
              <span className="text-white font-bold tabular-nums w-14 text-right">
                {local.smoothAlpha === 0 ? 'Aucun' :
                 local.smoothAlpha < 0.3 ? 'Léger' :
                 local.smoothAlpha < 0.6 ? 'Moyen' : 'Fort'}
              </span>
            </div>
            <p className="text-slate-500 text-[10px] mt-1">
              Réduit le zigzag du tracé, recommandé : Moyen en marais
            </p>
          </div>

        </div>
        <div className="px-4 pb-6 pt-2 flex-shrink-0 border-t border-slate-800">
          <button
            onClick={() => { onChange(local); onClose(); }}
            className="w-full h-12 rounded-xl bg-green-600 text-white font-bold hover:bg-green-500 transition-colors">
            Appliquer
          </button>
        </div>
      </div>
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
            Code salarié
          </label>
          <input type="number" placeholder="ex: 1234" value={salaryPin}
            onChange={e => setSalaryPin(e.target.value.slice(0, 6))}
            className="w-full bg-slate-700 text-white rounded-xl px-3 py-2.5 text-base tracking-widest outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="text-slate-400 text-xs uppercase tracking-wide block mb-1">
            Code patron
          </label>
          <input type="number" placeholder="ex: 0000" value={patronPin}
            onChange={e => setPatronPin(e.target.value.slice(0, 6))}
            className="w-full bg-slate-700 text-white rounded-xl px-3 py-2.5 text-base tracking-widest outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <button onClick={handleSave} disabled={saving || salaryPin.length < 4 || patronPin.length < 4}
          className="w-full h-12 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40 hover:bg-green-500 transition-colors">
          {saved ? '✓ Enregistré' : saving ? 'Enregistrement…' : 'Enregistrer les codes'}
        </button>
      </div>
      <div className="bg-slate-800 rounded-2xl p-4">
        <p className="text-slate-400 text-xs">
          Le code patron donne accès au Plan de Charge, à l'historique complet et aux analytiques.
          Le code salarié donne accès au suivi uniquement.
        </p>
      </div>
    </div>
  );
}
