import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Play, Pause, Square, MapPin, Wifi, WifiOff, LocateFixed,
  ChevronUp, ChevronDown, History, Settings, Ruler, Trash2, Check, X, LogOut,
  BarChart2, Home, Navigation, Satellite, Map as MapIcon, Layers, SlidersHorizontal, Radio, Wrench,
  AlertTriangle, CalendarDays, Camera,
} from 'lucide-react';
import SuiviMap, { type ChantierZone } from './SuiviMap';
import SessionDetailView from './SessionDetailView';
import { useGps } from '../../hooks/useGps';
import { useSuiviSessions } from '../../hooks/useSuiviSessions';
import { useChantiers } from '../../hooks/useChantiers';
import { CHANTIER_TYPES } from '../../lib/constants';
import {
  areaM2, formatArea, formatDistance, formatDuration, centroid,
  avgSpeedKmh, instantSpeedKmh, totalDistanceM, distanceM, stripAreaM2, stripVolumeM3WithSegments, filterGpsTrack,
} from '../../lib/geo';
import {
  type MachineParams, defaultParams, loadMachineParams, saveMachineParams,
} from '../../lib/machineParams';
import { useChantierParams } from '../../hooks/useChantierParams';
import {
  pushLiveSession, clearLiveSession, useLiveSessions,
} from '../../hooks/useLiveSessions';
import { saveActiveSession, loadActiveSession, clearActiveSession } from '../../lib/suiviOffline';
import { clearSession, loadSuiviConfig } from '../../lib/suiviConfig';
import { writeChantierEvent, listenChantierEvents, getDeviceId } from '../../lib/chantierEvents';
import { showNotification, notificationsEnabled, setNotificationsEnabled, requestAndEnable, notificationApiAvailable } from '../../lib/notifications';
import { registerFcmToken } from '../../lib/fcm';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { PinRole, SuiviSession, SuiviIncident, IncidentType } from '../../types/suivi';
import type { Chantier } from '../../types';
import { INCIDENT_LABELS, HIST_PALETTE, SessionTimeline, GlobalTimeline } from './incidentUtils';
import ChantierDetailView from './ChantierDetailView';
import CalendarView from './CalendarView';
import CameraView from './CameraView';

interface Props {
  role: PinRole;
  onLogout: () => void;
}

type View = 'map' | 'live' | 'history' | 'analytics' | 'calendar' | 'settings';

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
  const { sessions, saveSession, deleteSession, updateSession, syncing } = useSuiviSessions();
  const { liveSessions } = useLiveSessions();
  const [view, setView] = useState<View>('map');
  const [selectedSession, setSelectedSession] = useState<SuiviSession | null>(null);
  const [restoredBanner, setRestoredBanner]   = useState<string | null>(null); // chantier nom
  const [autoPausedByZone, setAutoPausedByZone] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showChantierDetail, setShowChantierDetail] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [salarieName, setSalarieName] = useState('Hugo');
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [sessionIncidents, setSessionIncidents]   = useState<SuiviIncident[]>([]);
  const [confirmStop, setConfirmStop] = useState(false);

  // Use role as the Firestore document ID — guarantees exactly one live document
  // per role (patron / salarie) regardless of refreshes or tabs.
  const sessionIdRef = useRef<string>(role);
  const deviceId = useRef(getDeviceId()).current;

  // ── Session state ──────────────────────────────────────────────────────
  const [sessionActive, setSessionActive]   = useState(false);
  const [sessionPaused, setSessionPaused]   = useState(false);
  const [sessionStart, setSessionStart]     = useState<Date | null>(null);
  const [elapsed, setElapsed]               = useState(0);

  // ── Page visibility — GPS pauses in background, timer keeps going ──────
  const [isHidden, setIsHidden] = useState(() =>
    typeof document !== 'undefined' ? document.hidden : false
  );
  const [selectedChantierId, setSelectedChantierId] = useState(() => {
    try { return localStorage.getItem('lastSelectedChantierId') ?? ''; } catch { return ''; }
  });
  const [showChantierPicker, setShowChantierPicker] = useState(false);
  const [pickerSearch, setPickerSearch]     = useState('');
  const [recentChantierIds, setRecentChantierIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('recentChantierIds') ?? '[]'); } catch { return []; }
  });
  const [panelOpen, setPanelOpen]           = useState(true);
  // Don't auto-follow GPS when a chantier is already selected — let JumpTo center on it instead
  const [followGps, setFollowGps] = useState(() => {
    try { return !localStorage.getItem('lastSelectedChantierId'); } catch { return true; }
  });
  const [showMachineEdit, setShowMachineEdit] = useState(false);
  const [liveJump, setLiveJump] = useState<[number, number] | null>(null);
  const [clientFilter, setClientFilter]     = useState<string | null>(() => {
    try { return localStorage.getItem('suiviClientFilter') ?? null; } catch { return null; }
  });

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

  // Firestore-synced params: persists across sessions, shared between patron and salarié
  const { chantierParams, paramsLoaded, saveChantierParams } = useChantierParams(selectedChantierId || null);

  // Depth segments: tracks profondeurDragageM × nbPasses changes during an active dragage session
  const [depthSegments, setDepthSegments] = useState<{ fromTs: number; profondeurM: number }[]>([]);

  // ── GPS ────────────────────────────────────────────────────────────────
  const { points: gpsPoints, currentPos, error: gpsError, accuracy, resetPoints, addPoints, addPoint } =
    useGps(sessionActive && !sessionPaused && !isHidden);

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
    if (sessionActive && !sessionPaused && !isHidden) {
      timerRef.current = setInterval(() => {
        // Always derive elapsed from start timestamp — survives background
        if (sessionStart) setElapsed(Math.round((Date.now() - sessionStart.getTime()) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sessionActive, sessionPaused, isHidden, sessionStart]);

  // ── Auto-pause / auto-resume when GPS leaves or returns to work zone ───
  const farCountRef  = useRef(0);
  const nearCountRef = useRef(0);
  useEffect(() => {
    if (!sessionActive || !currentPos || !selectedChantier) return;

    // Build list of reference points: polygon vertices or chantier lat/lng
    const refPoints: { lat: number; lng: number }[] = selectedChantier.polygon?.flat() ?? [];
    if (refPoints.length === 0) {
      if (selectedChantier.latitude && selectedChantier.longitude) {
        refPoints.push({ lat: selectedChantier.latitude, lng: selectedChantier.longitude });
      } else return;
    }

    const minDist = Math.min(...refPoints.map(p => distanceM(currentPos.lat, currentPos.lng, p.lat, p.lng)));

    if (!sessionPaused) {
      // Active → detect leaving zone (need 2 min before triggering)
      if (elapsed < 120) { farCountRef.current = 0; return; }
      if (minDist > 500) {
        farCountRef.current++;
        if (farCountRef.current >= 4) {
          setSessionPaused(true);
          setAutoPausedByZone(true);
          farCountRef.current = 0;
          nearCountRef.current = 0;
        }
      } else {
        farCountRef.current = 0;
      }
    } else if (autoPausedByZone) {
      // Paused by zone → detect return (< 200 m for 3 consecutive reads)
      if (minDist < 200) {
        nearCountRef.current++;
        if (nearCountRef.current >= 3) {
          setSessionPaused(false);
          setAutoPausedByZone(false);
          nearCountRef.current = 0;
          farCountRef.current = 0;
        }
      } else {
        nearCountRef.current = 0;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPos]);

  // ── Session autosave (every 10s + on hide/pagehide) ───────────────────
  const saveActiveRef = useCallback(() => {
    const chantier = chantiers.find(c => c.id === selectedChantierId);
    if (!sessionActive || !chantier) return;
    saveActiveSession({
      chantierId:  chantier.id,
      chantierNom: chantier.nom,
      operateur:   role,
      dateDebut:   sessionStart?.toISOString() ?? new Date().toISOString(),
      points:      gpsPoints,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionActive, selectedChantierId, chantiers, role, sessionStart, gpsPoints]);

  // Periodic autosave every 10 s
  useEffect(() => {
    if (!sessionActive) return;
    const t = setInterval(saveActiveRef, 10_000);
    return () => clearInterval(t);
  }, [sessionActive, saveActiveRef]);

  // Visibility tracking + save on hide + timer resync on return
  useEffect(() => {
    const onVisibility = () => {
      const hidden = document.hidden;
      setIsHidden(hidden);
      if (hidden) {
        // Going to background — save immediately
        saveActiveRef();
      } else {
        // Returning to foreground — resync elapsed from start timestamp
        setSessionStart(prev => {
          if (prev) setElapsed(Math.round((Date.now() - prev.getTime()) / 1000));
          return prev;
        });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', saveActiveRef);
    window.addEventListener('beforeunload', saveActiveRef);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', saveActiveRef);
      window.removeEventListener('beforeunload', saveActiveRef);
    };
  }, [saveActiveRef]);

  useEffect(() => {
    loadSuiviConfig().then(cfg => { if (cfg.salarieName) setSalarieName(cfg.salarieName); });
  }, []);

  // Auto-restore on mount (no confirm — silent restore with dismissable banner)
  useEffect(() => {
    const saved = loadActiveSession();
    if (saved && saved.points?.length > 0) {
      setSelectedChantierId(saved.chantierId);
      setSessionStart(new Date(saved.dateDebut));
      addPoints(saved.points);
      setElapsed(Math.round((Date.now() - new Date(saved.dateDebut).getTime()) / 1000));
      setSessionActive(true);
      setRestoredBanner(saved.chantierNom);
      setTimeout(() => setRestoredBanner(null), 4000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cumulative stats per chantier (for map labels + history cards) ────
  const chantierCumul = useMemo(() => {
    const map: Record<string, {
      totalCoveredM2: number; sessionCount: number;
      totalMinutes: number; rendementSum: number; rendementCount: number;
    }> = {};
    for (const s of sessions) {
      if (!map[s.chantierId]) map[s.chantierId] = {
        totalCoveredM2: 0, sessionCount: 0, totalMinutes: 0, rendementSum: 0, rendementCount: 0,
      };
      map[s.chantierId].totalCoveredM2 += s.surfaceCoveredM2;
      map[s.chantierId].sessionCount++;
      map[s.chantierId].totalMinutes += s.dureeMinutes;
      if (s.rendementM2h > 0 && s.surfaceCoveredM2 > 0) {
        map[s.chantierId].rendementSum += s.rendementM2h;
        map[s.chantierId].rendementCount++;
      }
    }
    return map;
  }, [sessions]);

  const chantierProgress = useMemo(() => {
    const result: Record<string, number> = {};
    for (const c of chantiers) {
      if (!c.surface || c.surface <= 0) continue;
      const covered = chantierCumul[c.id]?.totalCoveredM2 ?? 0;
      result[c.id] = Math.min(100, Math.round((covered / c.surface) * 100));
    }
    return result;
  }, [chantiers, chantierCumul]);

  // ── GPS filter: speed outliers + anchor drift (dragage) ─────────────
  const filteredPoints = useMemo(() => {
    const dragueMode = !!chantiers.find(c => c.id === selectedChantierId)?.drague;
    const speedTol   = dragueMode ? 1.6 : 2.0;
    // Dragage: reject if point is > max(10 × workWidth, 150 m) from rolling centroid
    // — generous enough for real papillonnage, blocks operator walking 300+ m to shore
    const driftM     = dragueMode
      ? Math.max(machineParams.largeurTravailM * 10, 150)
      : Infinity;
    return filterGpsTrack(gpsPoints, machineParams.vitesseMaxKmh, speedTol, driftM);
  }, [gpsPoints, machineParams.vitesseMaxKmh, machineParams.largeurTravailM, chantiers, selectedChantierId]);

  // ── Computed metrics ───────────────────────────────────────────────────
  const distM    = totalDistanceM(filteredPoints);
  const areaM    = machineParams.largeurTravailM > 0
    ? stripAreaM2(filteredPoints, machineParams.largeurTravailM, machineParams.recouvrementPct)
    : 0;
  const speedNow = filteredPoints.length >= 2
    ? instantSpeedKmh(filteredPoints[filteredPoints.length - 2], filteredPoints[filteredPoints.length - 1])
    : 0;
  const speedAvg  = avgSpeedKmh(filteredPoints);
  // Net elapsed time = total elapsed minus incident time (incidents are included in total duration)
  const tempsPerduMinLive = sessionIncidents.reduce((a, i) => a + i.dureeMinutes, 0);
  const elapsedH    = elapsed / 3600;
  const netElapsedH = Math.max(0, elapsedH - tempsPerduMinLive / 60);
  const rendement = netElapsedH > 0 && areaM > 0 ? areaM / netElapsedH : 0;

  const selectedChantier = chantiers.find(c => c.id === selectedChantierId);
  const progress = selectedChantier?.surface && areaM > 0
    ? Math.min(100, (areaM / selectedChantier.surface) * 100)
    : null;

  // ── Pre-computed stats for selected chantier panel ───────────────────
  const selectedChantierStats = useMemo(() => {
    if (!selectedChantier) return null;
    const cumul = chantierCumul[selectedChantier.id];
    if (!cumul || cumul.sessionCount === 0) return null;
    const covered      = cumul.totalCoveredM2;
    const surface      = selectedChantier.surface ?? 0;
    const pct          = surface > 0 ? Math.min(100, Math.round((covered / surface) * 100)) : null;
    const remaining    = surface > 0 ? Math.max(0, surface - covered) : null;
    const rendMoyen    = cumul.rendementCount > 0 ? Math.round(cumul.rendementSum / cumul.rendementCount) : null;
    const tempsRestant = remaining != null && remaining > 0 && rendMoyen != null && rendMoyen > 0
      ? Math.round((remaining / rendMoyen) * 60) : null;
    return {
      covered, surface, pct, remaining, rendMoyen, tempsRestant,
      totalMinutes: cumul.totalMinutes,
      sessionCount: cumul.sessionCount,
    };
  }, [selectedChantier, chantierCumul]);

  // ── Temps restant estimé ───────────────────────────────────────────────
  const tempsRestantMin = useMemo(() => {
    if (!selectedChantier?.surface || areaM <= 0 || rendement <= 0) return null;
    const restantM2 = selectedChantier.surface - areaM;
    if (restantM2 <= 0) return 0;
    return (restantM2 / rendement) * 60; // minutes
  }, [selectedChantier, areaM, rendement]);

  // ── Live Firestore streaming (every 30s during active session) ─────────
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const livePushRef     = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!sessionActive || sessionPaused || !currentPos) {
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
      return;
    }
    const push = () => {
      if (!currentPos || !selectedChantier) return;
      // Decimate filteredPoints to max 300 for Firestore payload
      const pts = filteredPoints;
      const step = pts.length > 300 ? Math.ceil(pts.length / 300) : 1;
      const track = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(p => ({ lat: p.lat, lng: p.lng }));
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
        dureeMinutes: sessionStart ? Math.round((Date.now() - sessionStart.getTime()) / 60_000) : Math.round(elapsed / 60),
        ...(isDragage && volumeM3 > 0 && { volumeM3, debitM3h }),
        paused:       sessionPaused,
        recentTrack:  track,
        ...(sessionIncidents.length > 0 && { incidents: sessionIncidents }),
        dateDebut: sessionStart?.toISOString(),
      });
    };
    livePushRef.current = push;
    push(); // push immediately
    liveIntervalRef.current = setInterval(push, 30_000);
    return () => { if (liveIntervalRef.current) clearInterval(liveIntervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionActive, sessionPaused, currentPos]);

  // Push immédiat au démarrage de session (avant que le GPS soit prêt)
  // — le patron voit la session apparaître sans attendre le premier fix GPS
  useEffect(() => {
    if (!sessionActive || !selectedChantier) return;
    const ch = selectedChantier;
    const lat = currentPos?.lat ?? ch.latitude ?? 0;
    const lng = currentPos?.lng ?? ch.longitude ?? 0;
    pushLiveSession(sessionIdRef.current, {
      operateur:    role,
      chantierId:   ch.id,
      chantierNom:  ch.nom,
      lat, lng,
      accuracy:     currentPos?.acc ?? null,
      speedKmh:     0,
      areaM:        0,
      distM:        0,
      rendementM2h: 0,
      progressPct:  null,
      dureeMinutes: 0,
      paused:       false,
      recentTrack:  [],
      dateDebut:    sessionStart?.toISOString() ?? new Date().toISOString(),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionActive]);

  // Push immédiat quand un incident est ajouté — pas d'attente des 30s
  useEffect(() => {
    if (sessionIncidents.length > 0 && livePushRef.current) {
      livePushRef.current();
    }
  }, [sessionIncidents]);

  // Auto-sélectionner le chantier du salarié quand le patron ouvre l'appli
  // sans chantier sélectionné et qu'une session live est en cours
  useEffect(() => {
    if (role !== 'patron' || sessionActive || selectedChantierId) return;
    const ls = liveSessions.find(s => s.sessionId !== sessionIdRef.current);
    if (ls) {
      setSelectedChantierId(ls.chantierId);
      setFollowGps(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSessions]);

  // ── Dragage mode (drague aspiratrice) ────────────────────────────────────
  const isDragage = !!selectedChantier?.drague;

  // ── Dragage: volume and débit (papillonnage: depth-weighted per GPS segment) ─
  const profondeur = machineParams.profondeurDragageM;
  const nbPasses   = Math.max(1, machineParams.nbPassesParPosition ?? 1);
  const volumeM3   = isDragage && profondeur > 0
    ? (depthSegments.length > 0
        ? stripVolumeM3WithSegments(filteredPoints, machineParams.largeurTravailM, machineParams.recouvrementPct, depthSegments)
        : areaM * profondeur * nbPasses)
    : 0;
  const debitM3h   = netElapsedH > 0 && volumeM3 > 0 ? volumeM3 / netElapsedH : 0;

  // ── Live viewer : session d'un autre device sur le chantier sélectionné ───
  const otherLive = !sessionActive && selectedChantierId
    ? (liveSessions.find(ls => ls.chantierId === selectedChantierId && ls.sessionId !== sessionIdRef.current) ?? null)
    : null;

  // Centre la carte sur la position live quand une session apparaît/change d'opérateur
  useEffect(() => {
    if (otherLive) {
      setLiveJump([otherLive.lat, otherLive.lng]);
      setFollowGps(false);
    } else {
      setLiveJump(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherLive?.sessionId]);

  // Persist last selected chantier for auto-restore on next launch
  useEffect(() => {
    if (selectedChantierId) {
      try { localStorage.setItem('lastSelectedChantierId', selectedChantierId); } catch {}
    }
  }, [selectedChantierId]);

  // ── Notifications : écoute des événements Firestore de l'autre appareil ──
  // Le listener est toujours actif ; showNotification vérifie la permission
  // au moment de l'événement (permet d'activer les notifs sans recharger).
  useEffect(() => {
    const since = new Date();
    const unsub = listenChantierEvents(since, deviceId, ev => {
      const who = ev.operateur === 'salarie' ? salarieName : 'Patron';
      switch (ev.type) {
        case 'session_start':
          showNotification(`▶️ Session démarrée`, `${ev.chantierNom} — ${who}`);
          break;
        case 'session_pause':
          showNotification(`⏸️ Session en pause`, `${ev.chantierNom} — ${who}`);
          break;
        case 'session_resume':
          showNotification(`▶️ Session reprise`, `${ev.chantierNom} — ${who}`);
          break;
        case 'session_end':
          showNotification(
            `🏁 Session terminée`,
            ev.dureeSessionMin
              ? `${ev.chantierNom} — ${formatDuration(ev.dureeSessionMin)} (${who})`
              : `${ev.chantierNom} — ${who}`,
          );
          break;
        case 'incident':
          showNotification(
            `⚠️ Incident — ${ev.chantierNom}`,
            ev.incidentLabel
              ? `${ev.incidentLabel}${ev.incidentDureeMin ? ` · ${ev.incidentDureeMin} min` : ''} (${who})`
              : who,
          );
          break;
      }
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salarieName, deviceId]);

  // ── Register FCM token (background push notifications) ───────────────────
  useEffect(() => { registerFcmToken().catch(() => {}); }, []);

  // ── Load machine params: Firestore (shared/persisted) → type defaults ────
  // Fires when chantier switches or when remote params update (other device changed them).
  useEffect(() => {
    if (!selectedChantier || !paramsLoaded) return;
    const p = chantierParams ?? defaultParams(selectedChantier.type, selectedChantier.drague ?? false);
    setMachineParamsState(p);
    saveMachineParams(p);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChantier?.id, chantierParams, paramsLoaded]);

  // ── Track effective depth changes during an active dragage session ─────
  useEffect(() => {
    if (!sessionActive || !isDragage) return;
    const effectiveDepth = machineParams.profondeurDragageM * Math.max(1, machineParams.nbPassesParPosition ?? 1);
    if (effectiveDepth <= 0) return;
    setDepthSegments(prev => {
      if (prev.length > 0 && prev[prev.length - 1].profondeurM === effectiveDepth) return prev;
      return [...prev, { fromTs: Date.now(), profondeurM: effectiveDepth }];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineParams.profondeurDragageM, machineParams.nbPassesParPosition, sessionActive, isDragage]);

  // ── Dragage: bridge GPS gap when returning from background ───────────────
  // Add current position as a trail point so the covered area during background
  // is included in surface/volume calculations.
  const prevHiddenRef = useRef(false);
  useEffect(() => {
    const wasHidden = prevHiddenRef.current;
    prevHiddenRef.current = isHidden;
    if (wasHidden && !isHidden && sessionActive && !sessionPaused && isDragage && currentPos) {
      addPoint({ lat: currentPos.lat, lng: currentPos.lng, ts: Date.now(), acc: currentPos.acc });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHidden]);

  // ── Work trail color (from chantier type) ─────────────────────────────
  const workColor = selectedChantier
    ? (CHANTIER_TYPES[selectedChantier.type]?.color ?? '#22c55e')
    : '#22c55e';

  // ── Chantier zones for map ────────────────────────────────────────────
  // Center map on selected chantier when it changes (zone centroid or lat/lng)
  const jumpToPos = useMemo<[number, number] | null>(() => {
    if (!selectedChantierId) return null;
    const c = chantiers.find(ch => ch.id === selectedChantierId);
    if (!c) return null;
    if (c.polygon && c.polygon.length > 0) {
      const all = c.polygon.flat();
      if (all.length > 0) {
        const ctr = centroid(all);
        return [ctr.lat, ctr.lng];
      }
    }
    if (c.latitude && c.longitude) return [c.latitude, c.longitude];
    // Fallback: first GPS point from any session of this chantier
    for (const s of sessions) {
      if (s.chantierId === selectedChantierId && s.gpsPoints.length > 0) {
        return [s.gpsPoints[0].lat, s.gpsPoints[0].lng];
      }
    }
    return null;
  }, [selectedChantierId, chantiers, sessions]);

  // Historical GPS trails for all chantiers — selected chantier gets distinct colors + sessionId
  const historicalTrails = useMemo(() => {
    const chanMap: Record<string, Chantier> = {};
    for (const c of chantiers) chanMap[c.id] = c;

    const selSorted = sessions
      .filter(s => s.chantierId === selectedChantierId && s.gpsPoints.length > 1)
      .sort((a, b) => new Date(a.dateDebut).getTime() - new Date(b.dateDebut).getTime());
    const selIdxMap = new Map(selSorted.map((s, i) => [s.id, i]));

    return sessions
      .filter(s => s.gpsPoints.length > 1)
      .map(s => {
        const c = chanMap[s.chantierId];
        const isChantierDrague = c?.drague ?? false;
        const pts = isChantierDrague
          ? filterGpsTrack(s.gpsPoints, machineParams.vitesseMaxKmh, 1.6, 150)
          : s.gpsPoints;
        const profondeurM = (s.profondeurDragageM ?? 0) * Math.max(1, s.nbPassesParPosition ?? 1);
        if (s.chantierId === selectedChantierId) {
          const idx   = selIdxMap.get(s.id) ?? 0;
          const color = HIST_PALETTE[idx % HIST_PALETTE.length];
          return { points: pts, color, sessionId: s.id, volumeM3: s.volumeM3, profondeurM };
        }
        const color = c ? (CHANTIER_TYPES[c.type]?.color ?? '#22c55e') : '#22c55e';
        return { points: pts, color, sessionId: s.id, volumeM3: s.volumeM3, profondeurM };
      });
  }, [sessions, chantiers, selectedChantierId, machineParams.vitesseMaxKmh]);

  const chantierZones = useMemo<ChantierZone[]>(() =>
    chantiers
      .filter(c => c.polygon && c.polygon.length > 0 && c.status !== 'refuse' && c.status !== 'annule')
      .map(c => ({
        id:       c.id,
        nom:      c.nom,
        polygons: c.polygon!,
        color:    CHANTIER_TYPES[c.type]?.color ?? '#64748B',
        progress: chantierProgress[c.id] ?? null,
      })),
    [chantiers, chantierProgress],
  );

  // ── Chantier dashboard stats (filtered to selectedChantierId) ────────────
  const chantierDashStats = useMemo(() => {
    if (!selectedChantierId) return null;
    const ss = sessions.filter(s => s.chantierId === selectedChantierId);
    if (ss.length === 0) return { sessions: ss, totalVolumeM3: 0, totalMinutes: 0, avgDebitM3h: 0, totalIncidentMin: 0, totalIncidentCount: 0 };

    const totalVolumeM3    = ss.reduce((a, s) => a + (s.volumeM3 ?? 0), 0);
    const totalMinutes     = ss.reduce((a, s) => a + s.dureeMinutes, 0);
    const totalIncidentMin = ss.reduce((a, s) => a + (s.incidents?.reduce((b, i) => b + i.dureeMinutes, 0) ?? 0), 0);
    const totalIncidentCount = ss.reduce((a, s) => a + (s.incidents?.length ?? 0), 0);
    const debits = ss.filter(s => (s.debitM3h ?? 0) > 0).map(s => s.debitM3h!);
    const avgDebitM3h = debits.length > 0 ? debits.reduce((a, b) => a + b, 0) / debits.length : 0;

    return { sessions: ss, totalVolumeM3, totalMinutes, avgDebitM3h, totalIncidentMin, totalIncidentCount };
  }, [sessions, selectedChantierId]);

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
    const ch = chantiers.find(c => c.id === selectedChantierId);
    resetPoints();
    setElapsed(0);
    setSessionStart(new Date());
    setSessionActive(true);
    setSessionPaused(false);
    setSessionIncidents([]);
    // Initialise depth tracking for dragage sessions
    if (ch?.drague) {
      const effDepth = machineParams.profondeurDragageM * Math.max(1, machineParams.nbPassesParPosition ?? 1);
      setDepthSegments(effDepth > 0 ? [{ fromTs: Date.now(), profondeurM: effDepth }] : []);
    } else {
      setDepthSegments([]);
    }
    if (ch) {
      writeChantierEvent({ type: 'session_start', chantierId: ch.id, chantierNom: ch.nom, operateur: role, deviceId, salarieNom: salarieName });
    }
  }, [selectedChantierId, role, resetPoints, chantiers, deviceId]);

  const handlePause = useCallback(() => {
    setSessionPaused(p => {
      const pausing = !p;
      const ch = chantiers.find(c => c.id === selectedChantierId);
      if (ch) {
        writeChantierEvent({
          type: pausing ? 'session_pause' : 'session_resume',
          chantierId: ch.id, chantierNom: ch.nom, operateur: role, deviceId, salarieNom: salarieName,
        });
      }
      return pausing;
    });
    setAutoPausedByZone(false);
    farCountRef.current = 0;
  }, [chantiers, selectedChantierId, role, deviceId]);

  const handleStop = useCallback(async () => {
    if (!selectedChantier) return;
    setConfirmStop(false);
    setSessionActive(false);
    setSessionPaused(false);
    clearActiveSession();
    clearLiveSession(sessionIdRef.current);
    const dureeMin = sessionStart ? Math.round((Date.now() - sessionStart.getTime()) / 60_000) : Math.round(elapsed / 60);
    writeChantierEvent({
      type: 'session_end',
      chantierId: selectedChantier.id,
      chantierNom: selectedChantier.nom,
      operateur: role,
      deviceId,
      salarieNom: salarieName,
      dureeSessionMin: dureeMin,
    });
    await saveSession({
      chantierId:           selectedChantier.id,
      chantierNom:          selectedChantier.nom,
      operateur:            role,
      dateDebut:            sessionStart?.toISOString() ?? new Date().toISOString(),
      dateFin:              new Date().toISOString(),
      dureeMinutes:         dureeMin,
      gpsPoints,
      notes:                '',
      // Pass pre-computed values so the save uses the same formula as the live display
      // (stripAreaM2 on filtered points, not shoelace on raw gpsPoints)
      surfaceCoveredM2:     areaM > 0 ? areaM : undefined,
      rendementM2h:         rendement > 0 ? rendement : undefined,
      // Dragage fields
      ...(isDragage && volumeM3 > 0 && {
        volumeM3,
        debitM3h:            debitM3h > 0 ? debitM3h : undefined,
        profondeurDragageM:  profondeur > 0 ? profondeur : undefined,
        ...(nbPasses > 1 && { nbPassesParPosition: nbPasses }),
      }),
      // Incidents logged during session
      ...(sessionIncidents.length > 0 && { incidents: sessionIncidents }),
      // Depth segments for accurate variable-depth volume (dragage)
      ...(depthSegments.length > 1 && { depthSegments }),
    });
    resetPoints();
    setElapsed(0);
    setSessionStart(null);
    setSessionIncidents([]);
    setDepthSegments([]);
  }, [selectedChantier, saveSession, role, sessionStart, elapsed, gpsPoints, resetPoints, areaM, rendement, deviceId]);

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
  const clientList = useMemo(() => {
    const set = new Set<string>();
    chantiers.forEach(c => { if (c.client) set.add(c.client); });
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [chantiers]);

  const pickerList = useMemo(() => {
    let active = chantiers.filter(c => c.status !== 'refuse' && c.status !== 'annule');
    if (clientFilter) active = active.filter(c => c.client === clientFilter);
    const q = pickerSearch.toLowerCase().trim();
    return q ? active.filter(c =>
      c.nom.toLowerCase().includes(q) ||
      (c.lieu ?? '').toLowerCase().includes(q) ||
      (c.client ?? '').toLowerCase().includes(q)
    ) : active;
  }, [chantiers, pickerSearch, clientFilter]);

  // ────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-slate-900 flex flex-col" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900/75 backdrop-blur-xl border-b border-white/[0.07] flex-shrink-0 z-10">

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
          {clientFilter && !selectedChantier && (
            <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-indigo-700/80 text-indigo-200 text-[9px] font-bold uppercase tracking-wide">
              {clientFilter}
            </span>
          )}
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
        <button onClick={() => setView(v => v === 'calendar' ? 'map' : 'calendar')}
          className={`p-1.5 rounded-lg ${view === 'calendar' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
          <CalendarDays size={16} />
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
        {role === 'patron' && (
          <button
            onClick={() => setShowCamera(c => !c)}
            className={`p-1.5 rounded-lg active:scale-95 transition-all ${showCamera ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
            title={showCamera ? 'Masquer la caméra' : 'Afficher la caméra'}
          >
            <Camera size={16} />
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
              onDisableFollow={() => setFollowGps(false)}
              chantierZones={chantierZones}
              selectedZoneId={selectedChantierId}
              onZoneClick={id => { setSelectedChantierId(id); setShowChantierPicker(false); setFollowGps(false); }}
              jumpToPos={liveJump ?? jumpToPos}
              showZones={showZones}
              satellite={tileMode}
              workColor={workColor}
              largeurM={machineParams.largeurTravailM}
              smoothAlpha={machineParams.smoothAlpha}
              sessionActive={sessionActive}
              liveSessions={liveSessions}
              mySessionId={sessionIdRef.current}
              historicalTrails={historicalTrails}
              isDragage={isDragage}
              currentVolumeM3={volumeM3}
              onHistoricalTrailClick={sessionId => {
                const s = sessions.find(ss => ss.id === sessionId);
                if (s) setSelectedSession(s);
              }}
              salarieName={salarieName}
            />

            {/* Map control buttons */}
            <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2">
              <button onClick={() => setFollowGps(true)}
                className={`p-2.5 rounded-xl shadow-lg transition-colors ${
                  followGps ? 'bg-green-600 text-white shadow-lg shadow-green-600/30' : 'bg-black/50 backdrop-blur-md border border-white/[0.12] text-slate-400'
                }`}
                title="Centrer sur ma position">
                <LocateFixed size={18} />
              </button>
              <button
                onClick={() => setTileMode(m => TILE_CYCLE[(TILE_CYCLE.indexOf(m) + 1) % TILE_CYCLE.length])}
                className="p-2.5 rounded-xl shadow-lg bg-black/50 backdrop-blur-md border border-white/[0.12] transition-colors"
                title={tileMode === 'ign' ? 'IGN France' : tileMode === 'esri' ? 'ESRI Global' : 'OSM'}>
                {tileMode === 'osm'
                  ? <MapIcon size={18} className="text-slate-400" />
                  : <Satellite size={18} className={tileMode === 'ign' ? 'text-green-400' : 'text-cyan-400'} />
                }
              </button>
              <button onClick={() => setShowZones(z => !z)}
                className={`p-2.5 rounded-xl shadow-lg transition-colors ${
                  showZones ? 'bg-black/50 backdrop-blur-md border border-white/[0.12] text-amber-400' : 'bg-black/50 backdrop-blur-md border border-white/[0.12] text-slate-500'
                }`}
                title={showZones ? 'Masquer les zones' : 'Afficher les zones'}>
                <Layers size={18} />
              </button>
            </div>

            {/* Nearby chantier suggestion */}
            {nearbyChantier && (
              <div className="absolute top-3 left-3 right-16 z-[1000] bg-black/60 backdrop-blur-xl border border-green-500/30 rounded-xl px-3 py-2 flex items-center gap-2">
                <Navigation size={13} className="text-green-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold truncate">{nearbyChantier.c.nom}</p>
                  <p className="text-slate-400 text-[10px]">à {nearbyChantier.dist} m</p>
                </div>
                <button
                  onClick={() => { setSelectedChantierId(nearbyChantier.c.id); setNearbyChantier(null); setFollowGps(false); }}
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
              <div className={`absolute z-[1000] flex items-center gap-2 bg-black/60 backdrop-blur-xl border border-blue-500/20 rounded-xl px-3 py-2 ${nearbyChantier ? 'top-14' : 'top-3'} left-3 right-20`}>
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
              <div className="absolute top-3 left-3 right-3 z-[1000] bg-red-950/75 backdrop-blur-xl border border-red-400/25 text-red-300 text-xs px-3 py-2 rounded-xl">
                {gpsError}
              </div>
            )}

            {/* Session active but GPS paused (app was in background) */}
            {sessionActive && !sessionPaused && isHidden === false && gpsPoints.length === 0 && sessionStart && elapsed > 10 && (
              <div className="absolute top-3 left-3 right-3 z-[1000] bg-black/60 backdrop-blur-xl border border-amber-400/30 rounded-xl px-3 py-2 flex items-center gap-2">
                <span className="text-amber-300 text-xs flex-1">
                  📍 GPS reprend — {formatTime(elapsed)} de session en cours
                </span>
              </div>
            )}

            {/* Auto-paused due to leaving work zone */}
            {autoPausedByZone && (
              <div className="absolute bottom-4 left-3 right-3 z-[1000] bg-red-950/80 backdrop-blur-xl border border-red-400/30 rounded-xl px-3 py-2 flex items-center gap-2">
                <span className="text-red-300 text-xs flex-1">
                  ⏸ Session auto-pausée — vous avez quitté la zone de travail (+ 500 m)
                </span>
                <button
                  onClick={() => { setSessionPaused(false); setAutoPausedByZone(false); farCountRef.current = 0; }}
                  className="text-[10px] text-red-300 border border-red-500/50 rounded-lg px-2 py-1 flex-shrink-0 font-semibold">
                  Reprendre
                </button>
                <button onClick={() => setAutoPausedByZone(false)} className="text-red-500 flex-shrink-0">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Restored session banner */}
            {!autoPausedByZone && restoredBanner && (
              <div className="absolute bottom-4 left-3 right-3 z-[1000] bg-amber-950/80 backdrop-blur-xl border border-amber-400/30 rounded-xl px-3 py-2 flex items-center gap-2">
                <span className="text-amber-300 text-xs flex-1">
                  ↩ Session restaurée : <strong>{restoredBanner}</strong>
                </span>
                <button
                  onClick={() => {
                    setSessionActive(false);
                    setSessionPaused(false);
                    setElapsed(0);
                    setSessionStart(null);
                    clearActiveSession();
                    setRestoredBanner(null);
                  }}
                  className="text-[10px] text-amber-400 border border-amber-500/50 rounded-lg px-2 py-1 flex-shrink-0">
                  Annuler
                </button>
                <button onClick={() => setRestoredBanner(null)} className="text-amber-500 flex-shrink-0">
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Camera panel: sibling of map div so it sits above Leaflet's z-index stacking */}
          {showCamera && <CameraView onClose={() => setShowCamera(false)} />}

          {/* ── Bottom panel ──────────────────────────────────────────── */}
          <div className="flex-shrink-0 bg-slate-900/80 backdrop-blur-xl border-t border-white/[0.07]">
            <button onClick={() => setPanelOpen(p => !p)}
              className="w-full flex justify-center py-1.5 text-slate-600 hover:text-slate-400">
              {panelOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>

            {panelOpen && (
              <>
                {/* Chantier stats panel — visible when a chantier is selected but not in session, and no other live session */}
                {!sessionActive && selectedChantier && !otherLive && (
                  <div className="border-b border-white/[0.07] px-2 pb-3 pt-1">
                    <div className="flex items-center gap-1.5 mb-2 px-1">
                      <span className="text-slate-500 text-[10px] uppercase tracking-wide truncate flex-1">
                        {selectedChantier.nom}
                        {selectedChantier.type ? ` · ${TYPE_LABELS[selectedChantier.type] ?? selectedChantier.type}` : ''}
                      </span>
                      {isDragage && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-cyan-900 text-cyan-300 text-[9px] font-semibold uppercase tracking-wide">
                          Drague
                        </span>
                      )}
                      <button
                        onClick={() => setShowMachineEdit(true)}
                        className="flex-shrink-0 p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700 transition-colors"
                        title="Changer le type de machine"
                      >
                        <Wrench size={12} />
                      </button>
                    </div>

                    {selectedChantierStats ? (
                      isDragage ? (
                        /* ── Dragage stats : heures + volume + budget ── */
                        (() => {
                          const budgetH  = selectedChantier.dureeEstimeeH ?? 0;
                          const totalH   = selectedChantierStats.totalMinutes / 60;
                          const bPct     = budgetH > 0 ? Math.min(100, (totalH / budgetH) * 100) : null;
                          return (
                            <>
                              <div className="grid grid-cols-3 gap-1 mb-1.5">
                                <Metric label="Sessions" value={`${selectedChantierStats.sessionCount}`} small />
                                <Metric label="Volume tot." value={`${(chantierDashStats?.totalVolumeM3 ?? 0).toFixed(0)} m³`} small />
                                <Metric label="Heures eff." value={`${totalH.toFixed(1)} h`} small />
                              </div>
                              {bPct !== null && (
                                <>
                                  <div className="h-1.5 bg-white/[0.08] rounded-full overflow-hidden mb-1 mx-1">
                                    <div className={`h-full rounded-full transition-all ${bPct >= 90 ? 'bg-red-500' : bPct >= 70 ? 'bg-amber-400' : 'bg-green-500'}`}
                                      style={{ width: `${bPct}%` }} />
                                  </div>
                                  <div className="flex justify-between px-1">
                                    <span className={`text-[10px] ${bPct >= 90 ? 'text-red-400' : bPct >= 70 ? 'text-amber-400' : 'text-green-400'}`}>
                                      {bPct.toFixed(0)} %
                                    </span>
                                    <span className="text-slate-500 text-[10px]">{totalH.toFixed(1)} h / {budgetH} h vendues</span>
                                  </div>
                                </>
                              )}
                            </>
                          );
                        })()
                      ) : (
                        /* ── Surface-based stats (non-dragage) ── */
                        <>
                          <div className="grid grid-cols-4 gap-1 mb-2">
                            {selectedChantier.surface && selectedChantier.surface > 0 && (
                              <Metric label="Surface tot." value={formatArea(selectedChantier.surface)} />
                            )}
                            <Metric label="Couverte" value={formatArea(selectedChantierStats.covered)} />
                            {selectedChantierStats.pct != null && (
                              <Metric label="Effectué" value={`${selectedChantierStats.pct} %`} />
                            )}
                            <Metric label="Sessions" value={`${selectedChantierStats.sessionCount}`} />
                          </div>
                          {selectedChantierStats.pct != null && (
                            <div className="h-1.5 bg-white/[0.08] rounded-full overflow-hidden mb-2 mx-1">
                              <div className={`h-full rounded-full transition-all ${
                                selectedChantierStats.pct >= 80 ? 'bg-green-500'
                                  : selectedChantierStats.pct >= 40 ? 'bg-amber-400' : 'bg-orange-500'
                              }`} style={{ width: `${selectedChantierStats.pct}%` }} />
                            </div>
                          )}
                          <div className="grid grid-cols-3 gap-1">
                            <Metric label="Temps passé" value={formatDuration(selectedChantierStats.totalMinutes)} small />
                            {selectedChantierStats.rendMoyen != null && (
                              <Metric label="Rend. moyen" value={`${selectedChantierStats.rendMoyen.toLocaleString('fr-FR')} m²/h`} small />
                            )}
                            {selectedChantierStats.remaining != null && selectedChantierStats.remaining > 0 && (
                              <Metric label="Restant" value={formatArea(selectedChantierStats.remaining)} small />
                            )}
                            {selectedChantierStats.pct === 100 && (
                              <Metric label="Statut" value="Terminé ✓" small />
                            )}
                            {selectedChantierStats.tempsRestant != null && selectedChantierStats.tempsRestant > 0 && (
                              <Metric label="Tps restant" value={formatDuration(selectedChantierStats.tempsRestant)} small />
                            )}
                          </div>
                        </>
                      )
                    ) : (
                      isDragage ? (
                        <div className="grid grid-cols-2 gap-1">
                          {(selectedChantier.dureeEstimeeH ?? 0) > 0 && (
                            <Metric label="Budget" value={`${selectedChantier.dureeEstimeeH} h vendues`} small />
                          )}
                          <Metric label="Sessions" value="0 · Pas encore démarré" small />
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-1">
                          {selectedChantier.surface && selectedChantier.surface > 0 && (
                            <Metric label="Surface totale" value={formatArea(selectedChantier.surface)} small />
                          )}
                          <Metric label="Sessions" value="0" small />
                        </div>
                      )
                    )}
                  </div>
                )}

                {/* ── Live viewer — session active sur un autre device ── */}
                {otherLive && !sessionActive && (() => {
                  const minsAgo = Math.round((Date.now() - new Date(otherLive.lastUpdate).getTime()) / 60_000);
                  return (
                    <div className="border-b border-white/[0.07] px-2 pb-3 pt-2">
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse flex-shrink-0" />
                        <span className="text-orange-300 text-xs font-semibold flex-1">
                          {otherLive.operateur === 'salarie' ? salarieName : 'Patron'} — session en cours
                          {otherLive.paused && ' (pause)'}
                        </span>
                        <div className="flex flex-col items-end gap-0.5">
                          {otherLive.dateDebut && (
                            <span className="text-slate-400 text-[10px]">
                              déb. {format(new Date(otherLive.dateDebut), 'HH:mm', { locale: fr })}
                            </span>
                          )}
                          <span className="text-slate-500 text-[10px]">
                            {minsAgo > 0 ? `màj il y a ${minsAgo} min` : 'maintenant'}
                          </span>
                        </div>
                      </div>
                      {isDragage ? (
                        <div className="grid grid-cols-4 gap-1">
                          <Metric label="Durée" value={formatDuration(otherLive.dureeMinutes)} small />
                          <Metric label="Volume" value={(otherLive.volumeM3 ?? 0) > 0 ? `${otherLive.volumeM3!.toFixed(1)} m³` : '—'} small />
                          <Metric label="Débit" value={(otherLive.debitM3h ?? 0) > 0 ? `${otherLive.debitM3h!.toFixed(1)}` : '—'} sub="m³/h" small />
                          <Metric label="Distance" value={formatDistance(otherLive.distM)} small />
                        </div>
                      ) : (
                        <div className="grid grid-cols-4 gap-1">
                          <Metric label="Durée" value={formatDuration(otherLive.dureeMinutes)} small />
                          <Metric label="Surface" value={formatArea(otherLive.areaM)} small />
                          <Metric label="Rendement" value={`${Math.round(otherLive.rendementM2h)}`} sub="m²/h" small />
                          <Metric label="Avancement" value={otherLive.progressPct != null ? `${Math.round(otherLive.progressPct)} %` : '—'} small />
                        </div>
                      )}
                      {otherLive.incidents && otherLive.incidents.length > 0 && (
                        <div className="mt-2 px-1">
                          <div className="flex items-center gap-1 mb-1">
                            <AlertTriangle size={10} className="text-amber-400 flex-shrink-0" />
                            <span className="text-amber-400 text-[9px] font-semibold">
                              {otherLive.incidents.length} incident{otherLive.incidents.length > 1 ? 's' : ''} · {otherLive.incidents.reduce((a, i) => a + i.dureeMinutes, 0)} min perdues
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {otherLive.incidents.map((inc, i) => (
                              <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-900/60 text-amber-300 text-[9px] border border-amber-700/40">
                                <AlertTriangle size={8} />
                                {format(new Date(inc.ts), 'HH:mm', { locale: fr })} · {INCIDENT_LABELS[inc.type]} · {inc.dureeMinutes} min
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {sessionActive && !isDragage && (
                  <div className="grid grid-cols-4 gap-0 border-b border-white/[0.07] px-2 pb-3">
                    <Metric label="Durée" value={formatTime(elapsed)} />
                    <Metric label="Vitesse" value={`${speedNow.toFixed(1)} km/h`}
                      sub={`moy ${speedAvg.toFixed(1)}`} />
                    <Metric label="Surface" value={formatArea(areaM)} />
                    <Metric label="Rendement" value={`${Math.round(rendement).toLocaleString('fr-FR')}`}
                      sub="m²/h" />
                  </div>
                )}

                {sessionActive && isDragage && (
                  <div className="grid grid-cols-4 gap-0 border-b border-white/[0.07] px-2 pb-2 pt-1">
                    <Metric label="Durée" value={formatTime(elapsed)} small />
                    <Metric label="Heures" value={`${(elapsed / 3600).toFixed(1)} h`} small />
                    <Metric label="Volume" value={volumeM3 > 0 ? `${volumeM3.toFixed(1)} m³` : profondeur > 0 ? '0 m³' : '—'}
                      sub={profondeur > 0 ? `${profondeur} m` : undefined} small />
                    <Metric label="Débit" value={debitM3h > 0 ? `${debitM3h.toFixed(1)}` : '—'}
                      sub="m³/h" small />
                  </div>
                )}

                {sessionActive && (
                  <div className="grid grid-cols-3 gap-0 px-2 py-2 border-b border-white/[0.07]">
                    <Metric label="Distance" value={formatDistance(distM)} small />
                    {!isDragage && progress != null && <Metric label="Avancement" value={`${Math.round(progress)} %`} small />}
                    {!isDragage && selectedChantier?.surface && (
                      <Metric label="Surface tot." value={formatArea(selectedChantier.surface)} small />
                    )}
                    {isDragage && profondeur > 0 && (
                      <Metric label="Profondeur" value={`${profondeur.toFixed(2)} m`} small />
                    )}
                    {isDragage && (
                      <Metric
                        label={sessionIncidents.length > 0 ? `${sessionIncidents.length} incident${sessionIncidents.length > 1 ? 's' : ''}` : 'Incidents'}
                        value={tempsPerduMinLive > 0 ? `${tempsPerduMinLive} min` : '—'}
                        small />
                    )}
                    {!isDragage && tempsRestantMin != null && tempsRestantMin > 0 && (
                      <Metric label="Temps restant" value={formatDuration(tempsRestantMin)} small />
                    )}
                    {!isDragage && tempsRestantMin === 0 && (
                      <Metric label="Terminé !" value="✓" small />
                    )}
                    {drawSaved != null && <Metric label="Zone mesurée" value={formatArea(drawSaved)} small />}
                  </div>
                )}

                {progress != null && sessionActive && (
                  <div className="px-3 pb-2">
                    <div className="h-2 bg-white/[0.08] rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full transition-all duration-1000 shadow-sm shadow-green-400/60"
                        style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 px-3 pb-3 pt-1">
                  {/* Left tools — hidden when confirming stop to make room */}
                  {!confirmStop && (
                    <>
                      <button
                        onClick={() => { setDrawMode(d => !d); if (!drawMode) handleDrawClear(); }}
                        className={`p-3 rounded-xl transition-colors ${
                          drawMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'bg-white/[0.08] border border-white/[0.10] text-slate-400 hover:bg-white/[0.14] hover:text-slate-200'
                        }`}>
                        <Ruler size={18} />
                      </button>
                      <button
                        onClick={() => setShowMachinePanel(true)}
                        className="p-3 rounded-xl bg-white/[0.08] border border-white/[0.10] text-slate-400 hover:bg-white/[0.14] hover:text-slate-200 transition-colors"
                        title="Paramètres machine">
                        <SlidersHorizontal size={18} />
                      </button>
                      {/* Incident button — moved here, away from Stop */}
                      {sessionActive && isDragage && (
                        <button onClick={() => setShowIncidentModal(true)}
                          className="relative p-3 rounded-xl bg-amber-700/60 border border-amber-600/40 text-amber-300 hover:bg-amber-600/70 active:scale-95 transition-all">
                          <AlertTriangle size={18} />
                          {sessionIncidents.length > 0 && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                              {sessionIncidents.length}
                            </span>
                          )}
                        </button>
                      )}
                    </>
                  )}

                  <div className="flex-1 flex items-center gap-2 justify-center">
                    {!sessionActive && otherLive ? (
                      /* Viewer: session active sur un autre device — bouton centrage */
                      <button
                        onClick={() => { setLiveJump([otherLive.lat, otherLive.lng]); setFollowGps(false); }}
                        className="flex-1 flex items-center justify-center gap-2 h-14 rounded-2xl bg-orange-900/60 border border-orange-600/40 text-orange-300 font-bold text-sm hover:bg-orange-800/70 active:scale-95 transition-all">
                        <Radio size={18} className="animate-pulse" />
                        Localiser sur la carte
                      </button>
                    ) : !sessionActive ? (
                      <button onClick={handleStart}
                        className="flex-1 flex items-center justify-center gap-2 h-14 rounded-2xl bg-green-600 text-white text-base font-bold hover:bg-green-500 active:scale-95 transition-all shadow-lg shadow-green-600/30">
                        <Play size={20} fill="currentColor" />
                        Démarrer
                      </button>
                    ) : confirmStop ? (
                      /* ── Stop confirmation ── */
                      <div className="flex-1 flex items-center gap-2">
                        <span className="text-white text-sm font-semibold flex-shrink-0">Terminer la session ?</span>
                        <div className="flex gap-2 ml-auto">
                          <button
                            onClick={() => setConfirmStop(false)}
                            className="h-11 px-4 rounded-xl bg-white/[0.10] border border-white/[0.12] text-slate-200 font-semibold text-sm hover:bg-white/[0.16] active:scale-95 transition-all">
                            Annuler
                          </button>
                          <button
                            onClick={handleStop}
                            className="h-11 px-4 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-500 active:scale-95 transition-all shadow-lg shadow-red-600/30">
                            Terminer
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button onClick={handlePause}
                          className={`flex-1 h-14 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm transition-all active:scale-95 ${
                            sessionPaused ? 'bg-green-600 text-white hover:bg-green-500 shadow-lg shadow-green-600/30' : 'bg-white/[0.10] border border-white/[0.10] text-white hover:bg-white/[0.16]'
                          }`}>
                          {sessionPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} />}
                          {sessionPaused ? 'Reprendre' : 'Pause'}
                        </button>
                        <button onClick={() => setConfirmStop(true)}
                          className="w-14 h-14 rounded-2xl bg-red-600 text-white flex items-center justify-center hover:bg-red-500 active:scale-95 transition-all shadow-lg shadow-red-600/30">
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

      {/* ── History / Chantier dashboard view ───────────────────────────── */}
      {view === 'history' && (
        <div className="flex-1 overflow-y-auto">
          {selectedChantierId && selectedChantier ? (
            /* ── Chantier dashboard ── */
            <div className="px-3 py-3 space-y-3">

              {/* Header */}
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-white font-bold text-base truncate">{selectedChantier.nom}</h2>
                    {isDragage && (
                      <span className="px-1.5 py-0.5 rounded-full bg-cyan-900 text-cyan-300 text-[9px] font-semibold uppercase tracking-wide">Drague</span>
                    )}
                  </div>
                  {selectedChantier.lieu && (
                    <p className="text-slate-500 text-xs mt-0.5">{selectedChantier.lieu}</p>
                  )}
                </div>
                {syncing && <WifiOff size={13} className="text-orange-400 flex-shrink-0 mt-1" />}
              </div>

              {/* ── Global stats ── */}
              {chantierDashStats && chantierDashStats.sessions.length > 0 && (
                <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-3">
                  <button
                    onClick={() => setShowChantierDetail(true)}
                    className="w-full flex items-center justify-between mb-2 group">
                    <p className="text-slate-500 text-[10px] uppercase tracking-wide">Cumul chantier</p>
                    <span className="text-[10px] text-slate-600 group-hover:text-slate-400 transition-colors">Détail →</span>
                  </button>
                  {isDragage ? (
                    <div className="grid grid-cols-4 gap-1 mb-2">
                      <SmallStat label="Sessions" value={`${chantierDashStats.sessions.length}`} />
                      <SmallStat label="Volume tot." value={`${chantierDashStats.totalVolumeM3.toFixed(1)} m³`} />
                      <SmallStat label="Rend. moyen" value={chantierDashStats.avgDebitM3h > 0 ? chantierDashStats.avgDebitM3h.toFixed(1) : '—'} sub="m³/h" />
                      <SmallStat label="Temps total" value={formatDuration(chantierDashStats.totalMinutes)} />
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1 mb-2">
                      <SmallStat label="Sessions" value={`${chantierDashStats.sessions.length}`} />
                      <SmallStat label="Temps total" value={formatDuration(chantierDashStats.totalMinutes)} />
                      <SmallStat label="Surface tot." value={formatArea(chantierCumul[selectedChantierId]?.totalCoveredM2 ?? 0)} />
                    </div>
                  )}
                  {isDragage && chantierDashStats.totalIncidentCount > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <AlertTriangle size={11} className="text-amber-400 flex-shrink-0" />
                      <span className="text-amber-400 text-[10px]">
                        {chantierDashStats.totalIncidentCount} incident{chantierDashStats.totalIncidentCount > 1 ? 's' : ''} · {chantierDashStats.totalIncidentMin} min perdues
                      </span>
                    </div>
                  )}
                  {isDragage && chantierDashStats.sessions.length > 0 && (
                    <GlobalTimeline sessions={chantierDashStats.sessions} />
                  )}
                </div>
              )}

              {/* ── Session en cours (own active session on this chantier) ── */}
              {sessionActive && selectedChantierId && (
                <div className="bg-green-950/40 border border-green-700/40 rounded-2xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <p className="text-green-300 text-xs font-semibold uppercase tracking-wide">Session en cours</p>
                    {sessionPaused && <span className="text-amber-400 text-[10px]">(en pause)</span>}
                    {isHidden && <span className="text-slate-500 text-[10px]">(en arrière-plan)</span>}
                  </div>
                  {isDragage ? (
                    <div className="grid grid-cols-4 gap-1">
                      <SmallStat label="Écoulé" value={formatTime(elapsed)} />
                      <SmallStat label="Perdu" value={tempsPerduMinLive > 0 ? `${tempsPerduMinLive} min` : '—'} />
                      <SmallStat label="Volume" value={volumeM3 > 0 ? `${volumeM3.toFixed(1)} m³` : '0 m³'} />
                      <SmallStat label="Rendement" value={debitM3h > 0 ? `${debitM3h.toFixed(1)}` : '—'} sub="m³/h" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-1">
                      <SmallStat label="Écoulé" value={formatTime(elapsed)} />
                      <SmallStat label="Surface" value={formatArea(areaM)} />
                      <SmallStat label="Vitesse" value={`${speedNow.toFixed(1)} km/h`} />
                      <SmallStat label="Rendement" value={`${Math.round(rendement)}`} sub="m²/h" />
                    </div>
                  )}
                  {tempsPerduMinLive > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {sessionIncidents.map((inc, i) => (
                        <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-900/60 text-amber-300 text-[9px] border border-amber-700/40">
                          <AlertTriangle size={8} /> {INCIDENT_LABELS[inc.type] ?? inc.type} · {inc.dureeMinutes} min
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Live session d'un autre opérateur (vue patron) ── */}
              {role === 'patron' && (() => {
                const liveForThisChantier = liveSessions.filter(
                  ls => ls.chantierId === selectedChantierId && ls.sessionId !== sessionIdRef.current
                );
                if (liveForThisChantier.length === 0) return null;
                return liveForThisChantier.map(ls => {
                  const minsAgo = Math.round((Date.now() - new Date(ls.lastUpdate).getTime()) / 60000);
                  return (
                    <div key={ls.sessionId} className="bg-orange-950/40 border border-orange-700/40 rounded-2xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                        <p className="text-orange-300 text-xs font-semibold uppercase tracking-wide">
                          {ls.operateur === 'salarie' ? salarieName : 'Patron'} — en cours
                        </p>
                        <span className="ml-auto text-slate-500 text-[10px]">
                          {minsAgo > 0 ? `màj il y a ${minsAgo} min` : 'maintenant'}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        <SmallStat label="Durée" value={formatDuration(ls.dureeMinutes ?? 0)} />
                        <SmallStat label="Volume" value={ls.areaM != null && ls.areaM > 0 ? `${ls.areaM.toFixed(1)} m²` : '—'} />
                        <SmallStat label="Rend." value={ls.rendementM2h != null && ls.rendementM2h > 0 ? `${Math.round(ls.rendementM2h)}` : '—'} sub="m²/h" />
                        <SmallStat label="Vitesse" value={ls.speedKmh != null ? `${ls.speedKmh.toFixed(1)}` : '—'} sub="km/h" />
                      </div>
                    </div>
                  );
                });
              })()}

              {/* ── Sessions passées ── */}
              {chantierDashStats && (
                <>
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide px-1">
                    {chantierDashStats.sessions.length === 0 ? 'Aucune session passée' : `${chantierDashStats.sessions.length} session${chantierDashStats.sessions.length > 1 ? 's' : ''} passée${chantierDashStats.sessions.length > 1 ? 's' : ''}`}
                  </p>
                  <div className="space-y-2">
                    {chantierDashStats.sessions.map(s => {
                      const incMin = s.incidents?.reduce((a, i) => a + i.dureeMinutes, 0) ?? 0;
                      return (
                        <div key={s.id} className="bg-white/[0.05] border border-white/[0.08] rounded-2xl overflow-hidden">
                          <button onClick={() => setSelectedSession(s)}
                            className="w-full text-left p-3 hover:bg-white/[0.05] transition-colors active:scale-[0.99]">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-slate-300 text-xs font-semibold">
                                  {format(new Date(s.dateDebut), 'dd MMM yyyy – HH:mm', { locale: fr })}
                                </p>
                                <p className="text-slate-500 text-[10px] mt-0.5">
                                  {s.operateur === 'patron' ? 'Patron' : salarieName}
                                  {s.profondeurDragageM != null ? ` · ${s.profondeurDragageM.toFixed(2)} m prof.` : ''}
                                </p>
                              </div>
                              {s.pendingSync && (
                                <span className="flex-shrink-0 text-[10px] px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded-full">Hors-ligne</span>
                              )}
                            </div>

                            {isDragage ? (
                              <div className="grid grid-cols-4 gap-1">
                                <SmallStat label="Durée" value={formatDuration(s.dureeMinutes)} />
                                <SmallStat label="Perdu" value={incMin > 0 ? `${incMin} min` : '—'} />
                                <SmallStat label="Volume" value={s.volumeM3 != null && s.volumeM3 > 0 ? `${s.volumeM3.toFixed(1)} m³` : '—'} />
                                <SmallStat label="Rend." value={s.debitM3h != null && s.debitM3h > 0 ? `${s.debitM3h.toFixed(1)}` : '—'} sub="m³/h" />
                              </div>
                            ) : (
                              <div className="grid grid-cols-4 gap-1">
                                <SmallStat label="Durée" value={formatDuration(s.dureeMinutes)} />
                                <SmallStat label="Surface" value={formatArea(s.surfaceCoveredM2)} />
                                <SmallStat label="Rend." value={`${Math.round(s.rendementM2h)}`} sub="m²/h" />
                                <SmallStat label="Vit. moy" value={s.vitesseMoyenneKmh > 0 ? `${s.vitesseMoyenneKmh.toFixed(1)}` : '—'} sub="km/h" />
                              </div>
                            )}

                            {s.incidents && s.incidents.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {s.incidents.map((inc, i) => (
                                  <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-900/60 text-amber-300 text-[9px] border border-amber-700/40">
                                    <AlertTriangle size={8} /> {INCIDENT_LABELS[inc.type] ?? inc.type} · {inc.dureeMinutes} min
                                  </span>
                                ))}
                              </div>
                            )}
                            {isDragage && <SessionTimeline session={s} />}
                            {isDragage && incMin > 0 && (
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <AlertTriangle size={10} className="text-amber-400 flex-shrink-0" />
                                <span className="text-amber-400 text-[10px]">
                                  {s.incidents!.length} incident{s.incidents!.length > 1 ? 's' : ''} · {incMin} min perdues
                                </span>
                              </div>
                            )}
                          </button>

                          {/* Delete row */}
                          {confirmDeleteId === s.id ? (
                            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-red-950/60 border-t border-red-800/40">
                              <span className="text-red-400 text-xs">Supprimer cette session ?</span>
                              <div className="flex gap-2">
                                <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1 rounded-lg bg-white/[0.08] text-slate-300 text-xs">Annuler</button>
                                <button onClick={async () => { await deleteSession(s.id); setConfirmDeleteId(null); }} className="px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-semibold">Confirmer</button>
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDeleteId(s.id)} className="w-full flex items-center justify-center gap-1.5 py-1.5 text-slate-600 hover:text-red-400 text-xs border-t border-white/[0.05] transition-colors">
                              <Trash2 size={11} /> Supprimer
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ) : (
            /* ── All sessions list (no chantier selected) ── */
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
                  {sessions.map(s => {
                    const chan = chantiers.find(c => c.id === s.chantierId);
                    return (
                      <div key={s.id} className="bg-white/[0.05] border border-white/[0.08] rounded-2xl overflow-hidden">
                        <button onClick={() => setSelectedSession(s)}
                          className="w-full text-left p-3 hover:bg-white/[0.05] transition-colors active:scale-[0.99]">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-white text-sm font-semibold truncate">{s.chantierNom}</p>
                              <p className="text-slate-400 text-[10px] mt-0.5">
                                {format(new Date(s.dateDebut), 'dd MMM yyyy – HH:mm', { locale: fr })}
                                {' · '}{s.operateur === 'patron' ? 'Patron' : salarieName}
                                {chan?.type ? ` · ${TYPE_LABELS[chan.type] ?? chan.type}` : ''}
                              </p>
                            </div>
                            {s.pendingSync && (
                              <span className="flex-shrink-0 text-[10px] px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded-full">Hors-ligne</span>
                            )}
                          </div>
                          <div className="grid grid-cols-4 gap-1 mb-1.5">
                            <SmallStat label="Durée" value={formatDuration(s.dureeMinutes)} />
                            {s.volumeM3 != null && s.volumeM3 > 0 ? (
                              <>
                                <SmallStat label="Volume" value={`${s.volumeM3.toFixed(1)} m³`} />
                                <SmallStat label="Débit" value={s.debitM3h != null && s.debitM3h > 0 ? `${s.debitM3h.toFixed(1)}` : '—'} sub="m³/h" />
                              </>
                            ) : (
                              <>
                                <SmallStat label="Surface" value={formatArea(s.surfaceCoveredM2)} />
                                <SmallStat label="Rend." value={`${Math.round(s.rendementM2h)}`} sub="m²/h" />
                              </>
                            )}
                            <SmallStat label="Vit. moy" value={s.vitesseMoyenneKmh > 0 ? `${s.vitesseMoyenneKmh.toFixed(1)}` : '—'} sub="km/h" />
                          </div>
                          {s.incidents && s.incidents.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {s.incidents.map((inc, i) => (
                                <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-900/60 text-amber-300 text-[9px] border border-amber-700/40">
                                  <AlertTriangle size={8} /> {INCIDENT_LABELS[inc.type] ?? inc.type} · {inc.dureeMinutes} min
                                </span>
                              ))}
                            </div>
                          )}
                        </button>
                        {confirmDeleteId === s.id ? (
                          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-red-950/60 border-t border-red-800/40">
                            <span className="text-red-400 text-xs">Supprimer cette session ?</span>
                            <div className="flex gap-2">
                              <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1 rounded-lg bg-white/[0.08] text-slate-300 text-xs">Annuler</button>
                              <button onClick={async () => { await deleteSession(s.id); setConfirmDeleteId(null); }} className="px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-semibold">Confirmer</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(s.id)} className="w-full flex items-center justify-center gap-1.5 py-1.5 text-slate-600 hover:text-red-400 text-xs border-t border-white/[0.05] transition-colors">
                            <Trash2 size={11} /> Supprimer
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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
                <div className="w-14 h-14 rounded-2xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center mb-3">
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
                      <div key={s.sessionId} className="bg-white/[0.05] border border-white/[0.08] rounded-2xl overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                          <div className="w-3 h-3 rounded-full bg-orange-500 animate-pulse flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold truncate">{s.chantierNom}</p>
                            <p className="text-slate-400 text-[10px]">
                              {s.operateur === 'salarie' ? salarieName : 'Patron'}
                              {s.dateDebut ? ` · déb. ${format(new Date(s.dateDebut), 'HH:mm', { locale: fr })}` : ''}
                              {minsAgo > 0 ? ` · màj il y a ${minsAgo} min` : ' · maintenant'}
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
                            <div className="h-1.5 bg-white/[0.08] rounded-full overflow-hidden">
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
                        <div className="flex items-center gap-3 px-3 pb-2 text-[10px] text-slate-500">
                          {s.accuracy != null && (
                            <span>GPS ±{Math.round(s.accuracy)} m</span>
                          )}
                          <span>Distance : {formatDistance(s.distM)}</span>
                        </div>

                        {/* Incidents */}
                        {s.incidents && s.incidents.length > 0 && (
                          <div className="border-t border-slate-700/60 px-3 pb-3 pt-2">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <AlertTriangle size={11} className="text-amber-400 flex-shrink-0" />
                              <span className="text-amber-400 text-[10px] font-semibold">
                                {s.incidents.length} incident{s.incidents.length > 1 ? 's' : ''} · {s.incidents.reduce((a, i) => a + i.dureeMinutes, 0)} min perdues
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {s.incidents.map((inc, i) => (
                                <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-900/60 text-amber-300 text-[9px] border border-amber-700/40">
                                  <AlertTriangle size={8} />
                                  {format(new Date(inc.ts), 'HH:mm', { locale: fr })} · {INCIDENT_LABELS[inc.type]} · {inc.dureeMinutes} min
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
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
                    <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-3 space-y-2">
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
                          label={salarieName}
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
                        <div key={c.nom} className="bg-white/[0.05] border border-white/[0.08] rounded-xl px-3 py-2.5 flex items-center gap-3">
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
      {view === 'calendar' && (
        <CalendarView
          sessions={sessions}
          chantiers={chantiers}
          salarieName={salarieName}
          onSessionClick={s => setSelectedSession(s)}
        />
      )}

      {view === 'settings' && role === 'patron' && <SettingsPanel />}

      {/* ── Machine params panel ────────────────────────────────────────── */}
      {showMachinePanel && (
        <MachineParamsPanel
          params={machineParams}
          chantierType={selectedChantier?.type}
          isDragage={isDragage}
          sessionActive={sessionActive}
          sessionAreaM={areaM}
          onClose={() => setShowMachinePanel(false)}
          onChange={p => { setMachineParamsState(p); saveMachineParams(p); saveChantierParams(p); }}
        />
      )}

      {/* ── Camera overlay ──────────────────────────────────────────────── */}

      {/* ── Chantier detail overlay ─────────────────────────────────────── */}
      {showChantierDetail && selectedChantier && chantierDashStats && (
        <ChantierDetailView
          chantier={selectedChantier}
          sessions={chantierDashStats.sessions}
          isDragage={isDragage}
          salarieName={salarieName}
          onClose={() => setShowChantierDetail(false)}
          onSessionClick={s => { setShowChantierDetail(false); setSelectedSession(s); }}
        />
      )}

      {/* ── Session detail overlay ──────────────────────────────────────── */}
      {selectedSession && (
        <SessionDetailView
          session={sessions.find(s => s.id === selectedSession.id) ?? selectedSession}
          chantier={chantiers.find(c => c.id === selectedSession.chantierId)}
          chantierCumul={chantierCumul}
          chantierZones={chantierZones}
          machineParams={machineParams}
          workColor={selectedSession.chantierId === selectedChantierId
            ? workColor
            : '#22c55e'}
          salarieName={salarieName}
          onUpdateIncidents={async (incidents) => {
            await updateSession(selectedSession.id, { incidents });
          }}
          onClose={() => setSelectedSession(null)}
        />
      )}

      {/* ── Incident modal ──────────────────────────────────────────────── */}
      {showIncidentModal && (
        <IncidentModal
          onClose={() => setShowIncidentModal(false)}
          onAdd={inc => {
            setSessionIncidents(prev => [...prev, inc]);
            setShowIncidentModal(false);
            if (selectedChantier) {
              writeChantierEvent({
                type: 'incident',
                chantierId: selectedChantier.id,
                chantierNom: selectedChantier.nom,
                operateur: role,
                deviceId,
                salarieNom: salarieName,
                incidentLabel: INCIDENT_LABELS[inc.type as IncidentType] ?? inc.type,
                incidentDureeMin: inc.dureeMinutes,
              });
            }
          }}
        />
      )}

      {/* ── Machine type edit modal ─────────────────────────────────────── */}
      {showMachineEdit && selectedChantier && (
        <MachineTypeEdit
          chantier={selectedChantier}
          onClose={() => setShowMachineEdit(false)}
          onSave={async (type, drague) => {
            await updateChantier(selectedChantier.id, { type, drague }).catch(() => {});
            setShowMachineEdit(false);
          }}
        />
      )}

      {/* ── Chantier picker modal ────────────────────────────────────────── */}
      {showChantierPicker && (
        <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-end">
          <div className="w-full bg-slate-900/90 backdrop-blur-2xl rounded-t-3xl max-h-[80vh] flex flex-col border-t border-white/[0.08]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07] flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-white font-bold">Choisir un chantier</h3>
                {clientFilter && (
                  <button
                    onClick={() => { setClientFilter(null); try { localStorage.removeItem('suiviClientFilter'); } catch { /* */ } }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-600/80 border border-indigo-400/40 text-white text-[11px] font-semibold max-w-[140px] truncate"
                  >
                    <span className="truncate">{clientFilter}</span>
                    <X size={10} className="flex-shrink-0" />
                  </button>
                )}
              </div>
              <button onClick={() => { setShowChantierPicker(false); setPickerSearch(''); }}
                className="text-slate-400 p-1 flex-shrink-0">
                <X size={20} />
              </button>
            </div>
            {/* Client filter chips */}
            {clientList.length > 0 && (
              <div className="px-3 py-2 border-b border-white/[0.07] flex-shrink-0 flex gap-2 overflow-x-auto scrollbar-none">
                {clientList.map(cl => (
                  <button
                    key={cl}
                    onClick={() => {
                      const next = clientFilter === cl ? null : cl;
                      setClientFilter(next);
                      try {
                        if (next) localStorage.setItem('suiviClientFilter', next);
                        else localStorage.removeItem('suiviClientFilter');
                      } catch { /* */ }
                    }}
                    className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      clientFilter === cl
                        ? 'bg-indigo-600 border-indigo-400/50 text-white'
                        : 'bg-white/[0.07] border-white/[0.10] text-slate-300 hover:bg-white/[0.14]'
                    }`}
                  >
                    {cl}
                  </button>
                ))}
              </div>
            )}
            {/* Search */}
            <div className="px-4 py-2 border-b border-white/[0.07] flex-shrink-0">
              <input
                type="text"
                placeholder="Rechercher…"
                value={pickerSearch}
                onChange={e => setPickerSearch(e.target.value)}
                className="w-full bg-white/[0.08] border border-white/[0.10] text-white text-sm rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-green-500/60 placeholder-slate-500"
              />
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {/* Recent chantiers — shown only when no search query */}
              {!pickerSearch && recentChantierIds.length > 0 && (() => {
                const recents = recentChantierIds
                  .map(id => chantiers.find(c => c.id === id))
                  .filter((c): c is Chantier => !!c && c.status !== 'refuse' && c.status !== 'annule' && (!clientFilter || c.client === clientFilter));
                if (recents.length === 0) return null;
                return (
                  <div className="mb-3">
                    <p className="text-slate-500 text-[10px] uppercase tracking-wide px-1 mb-1.5">Récents</p>
                    {recents.map(c => (
                      <button key={c.id}
                        onClick={() => {
                          setSelectedChantierId(c.id);
                          setShowChantierPicker(false);
                          setPickerSearch('');
                          setFollowGps(false);
                          setRecentChantierIds(prev => {
                            const next = [c.id, ...prev.filter(id => id !== c.id)].slice(0, 5);
                            localStorage.setItem('recentChantierIds', JSON.stringify(next));
                            return next;
                          });
                        }}
                        className={`w-full text-left px-4 py-2.5 rounded-xl mb-1 transition-colors flex items-center gap-2 ${
                          c.id === selectedChantierId ? 'bg-green-700/80 text-white border border-green-500/30' : 'bg-white/[0.06] border border-white/[0.08] text-slate-200 hover:bg-white/[0.12]'
                        }`}
                      >
                        <span className="text-slate-400 text-xs">↩</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{c.nom}</p>
                          <p className="text-xs text-slate-400">{TYPE_LABELS[c.type] ?? c.type}{c.lieu ? ` · ${c.lieu}` : ''}</p>
                        </div>
                        {chantierProgress[c.id] != null && (
                          <span className="text-xs text-slate-400 flex-shrink-0">{chantierProgress[c.id]}%</span>
                        )}
                      </button>
                    ))}
                    <div className="border-t border-white/[0.07] mt-2 mb-2" />
                    <p className="text-slate-500 text-[10px] uppercase tracking-wide px-1 mb-1.5">Tous les chantiers</p>
                  </div>
                );
              })()}

              {pickerList.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-6">Aucun chantier trouvé</p>
              ) : (
                pickerList.map(c => (
                  <button key={c.id}
                    onClick={() => {
                      setSelectedChantierId(c.id);
                      setShowChantierPicker(false);
                      setPickerSearch('');
                      setFollowGps(false);
                      setRecentChantierIds(prev => {
                        const next = [c.id, ...prev.filter(id => id !== c.id)].slice(0, 5);
                        localStorage.setItem('recentChantierIds', JSON.stringify(next));
                        return next;
                      });
                    }}
                    className={`w-full text-left px-4 py-3 rounded-xl mb-1 transition-colors ${
                      c.id === selectedChantierId ? 'bg-green-700/80 text-white border border-green-500/30' : 'bg-white/[0.05] border border-white/[0.07] text-slate-200 hover:bg-white/[0.10]'
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

function SmallStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white/[0.06] border border-white/[0.08] rounded-lg px-2 py-1.5 text-center">
      <p className="text-white text-xs font-semibold tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-slate-500 text-[9px] leading-none">{sub}</p>}
      <p className="text-slate-500 text-[10px] mt-0.5">{label}</p>
    </div>
  );
}

function AnalyticCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl px-4 py-3">
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
  params, chantierType, isDragage, sessionActive, sessionAreaM, onClose, onChange,
}: {
  params: MachineParams;
  chantierType?: string;
  isDragage?: boolean;
  sessionActive?: boolean;
  sessionAreaM?: number;
  onClose: () => void;
  onChange: (p: MachineParams) => void;
}) {
  const [local, setLocal] = useState<MachineParams>({ ...params });
  const set = <K extends keyof MachineParams>(k: K, v: MachineParams[K]) =>
    setLocal(p => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-end">
      <div className="w-full bg-slate-900/90 backdrop-blur-2xl rounded-t-3xl max-h-[80vh] flex flex-col border-t border-white/[0.08]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07] flex-shrink-0">
          <h3 className="text-white font-bold">
            {isDragage ? 'Paramètres drague aspiratrice' : 'Paramètres machine'}
          </h3>
          <button onClick={onClose} className="text-slate-400 p-1"><X size={20} /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-5">

          {chantierType && (
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-xs">Type de chantier</span>
              <button
                onClick={() => {
                  const d = defaultParams(chantierType, isDragage);
                  setLocal(d);
                }}
                className="text-xs text-green-400 hover:text-green-300">
                Réinitialiser défauts
              </button>
            </div>
          )}

          {/* Dragage params — shown only in dragage mode */}
          {isDragage && (
            <>
              <div className="bg-cyan-950/60 border border-cyan-700/30 rounded-xl px-3 py-2 text-[11px] text-cyan-400">
                Dragage par papillonnage — la drague balaie en arc de gauche à droite,
                avance ~40 cm, puis recommence. Volume = surface × profondeur/passe × nb passes.
              </div>

              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wide block mb-2">
                  Profondeur de vase par passe (m)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min="0.1" max="2" step="0.05"
                    value={local.profondeurDragageM}
                    onChange={e => set('profondeurDragageM', parseFloat(e.target.value))}
                    className="flex-1 accent-cyan-500"
                  />
                  <span className="text-white font-bold tabular-nums w-14 text-right">
                    {local.profondeurDragageM.toFixed(2)} m
                  </span>
                </div>
                <p className="text-slate-500 text-[10px] mt-1">
                  Épaisseur de vase enlevée à chaque passage (~0,5 m par défaut)
                </p>
              </div>

              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wide block mb-2">
                  Passes par position (papillonnage)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min="1" max="6" step="1"
                    value={local.nbPassesParPosition ?? 1}
                    onChange={e => set('nbPassesParPosition', parseInt(e.target.value))}
                    className="flex-1 accent-cyan-500"
                  />
                  <span className="text-white font-bold tabular-nums w-10 text-right">
                    {local.nbPassesParPosition ?? 1}×
                  </span>
                </div>
                <p className="text-slate-500 text-[10px] mt-1">
                  Nb de balayages G↔D avant d'avancer de 40 cm
                  {(local.nbPassesParPosition ?? 1) > 1 && (
                    <span className="text-cyan-500">
                      {' '}— profondeur totale {((local.profondeurDragageM ?? 0) * (local.nbPassesParPosition ?? 1)).toFixed(2)} m
                    </span>
                  )}
                </p>
              </div>

              {/* Live preview: volume calculé avec les nouveaux paramètres */}
              {sessionActive && (sessionAreaM ?? 0) > 0 && (() => {
                const previewVol = (sessionAreaM ?? 0) * (local.profondeurDragageM ?? 0) * Math.max(1, local.nbPassesParPosition ?? 1);
                return (
                  <div className="bg-cyan-900/40 border border-cyan-700/40 rounded-xl px-3 py-2.5">
                    <p className="text-cyan-400 text-[10px] uppercase tracking-wide mb-1">Aperçu — session en cours</p>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-white font-bold text-lg tabular-nums">{previewVol.toFixed(1)} m³</span>
                      <span className="text-cyan-400 text-[10px]">avec ces paramètres</span>
                    </div>
                    <p className="text-slate-500 text-[10px] mt-0.5">
                      {formatArea(sessionAreaM ?? 0)} × {(local.profondeurDragageM ?? 0).toFixed(2)} m × {Math.max(1, local.nbPassesParPosition ?? 1)} passe{(local.nbPassesParPosition ?? 1) > 1 ? 's' : ''}
                    </p>
                  </div>
                );
              })()}
            </>
          )}

          {!isDragage && (
            <>
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wide block mb-2">
                  Largeur de travail (m)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min="0" max="20" step="0.5"
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
            </>
          )}

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
        <div className="px-4 pb-6 pt-2 flex-shrink-0 border-t border-white/[0.07]">
          <button
            onClick={() => { onChange(local); onClose(); }}
            className="w-full h-12 rounded-xl bg-green-600 text-white font-bold hover:bg-green-500 transition-colors shadow-lg shadow-green-600/25">
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
}

function NotificationToggle() {
  const supported = notificationApiAvailable();
  const [status, setStatus] = useState<'granted' | 'denied' | 'default' | 'unsupported'>(
    !supported ? 'unsupported'
    : !('Notification' in window) ? 'default'
    : Notification.permission === 'granted' ? 'granted'
    : Notification.permission === 'denied' ? 'denied'
    : 'default',
  );
  const [enabled, setEnabled] = useState(() => notificationsEnabled());

  const handleToggle = async () => {
    if (!supported) return;
    if (enabled) {
      setNotificationsEnabled(false);
      setEnabled(false);
    } else {
      const result = await requestAndEnable();
      setStatus(result === 'unsupported' ? 'unsupported' : result);
      if (result === 'granted') {
        setEnabled(true);
        registerFcmToken().catch(() => {});
      }
    }
  };

  return (
    <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-white text-sm font-semibold">Notifications</p>
          <p className="text-slate-500 text-[11px] mt-0.5">
            {status === 'unsupported' ? 'Ajoutez l\'appli à l\'écran d\'accueil pour activer'
             : status === 'denied'    ? 'Bloquées — autorisez dans les réglages du navigateur'
             : enabled                ? 'Actives — démarrage, pause, incidents…'
                                      : 'Recevoir une alerte à chaque événement chantier'}
          </p>
        </div>
        <button
          onClick={handleToggle}
          disabled={status === 'unsupported' || status === 'denied'}
          className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-40 ${enabled ? 'bg-green-600' : 'bg-slate-700'}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : ''}`} />
        </button>
      </div>
      {status === 'denied' && (
        <p className="text-amber-400 text-[10px]">
          Autorisez les notifications dans les réglages du navigateur pour activer.
        </p>
      )}
    </div>
  );
}

function SettingsPanel() {
  const [salaryPin,   setSalaryPin]   = useState('');
  const [patronPin,   setPatronPin]   = useState('');
  const [salarieName, setSalarieName] = useState('Hugo');
  const [saved, setSaved]             = useState(false);
  const [saving, setSaving]           = useState(false);

  useEffect(() => {
    import('../../lib/suiviConfig').then(({ loadSuiviConfig }) => {
      loadSuiviConfig().then(cfg => { if (cfg.salarieName) setSalarieName(cfg.salarieName); });
    });
  }, []);

  const handleSave = async () => {
    if (salaryPin.length < 4 || patronPin.length < 4) return;
    setSaving(true);
    try {
      const { saveSuiviConfig } = await import('../../lib/suiviConfig');
      await saveSuiviConfig({ salaryPin, patronPin, salarieName: salarieName.trim() || 'Hugo' });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
      <h2 className="text-white font-bold text-base">Paramètres accès</h2>
      <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-4 space-y-4">
        <div>
          <label className="text-slate-400 text-xs uppercase tracking-wide block mb-1">
            Prénom du salarié
          </label>
          <input type="text" placeholder="ex: Hugo" value={salarieName}
            onChange={e => setSalarieName(e.target.value.slice(0, 30))}
            className="w-full bg-white/[0.08] border border-white/[0.10] text-white rounded-xl px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-green-500/60" />
        </div>
        <div>
          <label className="text-slate-400 text-xs uppercase tracking-wide block mb-1">
            Code salarié
          </label>
          <input type="number" placeholder="ex: 1234" value={salaryPin}
            onChange={e => setSalaryPin(e.target.value.slice(0, 6))}
            className="w-full bg-white/[0.08] border border-white/[0.10] text-white rounded-xl px-3 py-2.5 text-base tracking-widest outline-none focus:ring-2 focus:ring-green-500/60" />
        </div>
        <div>
          <label className="text-slate-400 text-xs uppercase tracking-wide block mb-1">
            Code patron
          </label>
          <input type="number" placeholder="ex: 0000" value={patronPin}
            onChange={e => setPatronPin(e.target.value.slice(0, 6))}
            className="w-full bg-white/[0.08] border border-white/[0.10] text-white rounded-xl px-3 py-2.5 text-base tracking-widest outline-none focus:ring-2 focus:ring-green-500/60" />
        </div>
        <button onClick={handleSave} disabled={saving || salaryPin.length < 4 || patronPin.length < 4}
          className="w-full h-12 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40 hover:bg-green-500 transition-colors">
          {saved ? '✓ Enregistré' : saving ? 'Enregistrement…' : 'Enregistrer les codes'}
        </button>
      </div>
      <NotificationToggle />
      <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-4">
        <p className="text-slate-400 text-xs">
          Le code patron donne accès au Plan de Charge, à l'historique complet et aux analytiques.
          Le code salarié donne accès au suivi uniquement.
        </p>
      </div>
    </div>
  );
}

// ── MachineTypeEdit ───────────────────────────────────────────────────────────

const MACHINE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'broyage_chenillette_sans',  label: 'Broyage chenillette' },
  { value: 'broyage_chenillette_avec',  label: 'Broyage chenillette + ramassage' },
  { value: 'broyage_forestier',         label: 'Broyage forestier' },
  { value: 'faucardage',                label: 'Faucardage' },
  { value: 'deboisement',               label: 'Déboisement' },
  { value: 'curage_mecanique',          label: 'Curage mécanique' },
  { value: 'curage_aspiration',         label: 'Curage aspiration' },
  { value: 'terrassement',              label: 'Terrassement' },
  { value: 'defenses_berges',           label: 'Défenses de berges' },
  { value: 'location',                  label: 'Location' },
];

function MachineTypeEdit({
  chantier,
  onClose,
  onSave,
}: {
  chantier: Chantier;
  onClose: () => void;
  onSave: (type: import('../../types').ChantierType, drague: boolean) => Promise<void>;
}) {
  const [type, setType] = useState<string>(chantier.type ?? 'broyage_chenillette_sans');
  const [drague, setDrague] = useState(!!chantier.drague);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(type as import('../../types').ChantierType, drague);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-end">
      <div className="w-full bg-slate-900/90 backdrop-blur-2xl rounded-t-3xl p-5 pb-8 border-t border-white/[0.08]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Wrench size={16} className="text-slate-400" />
            Type de machine
          </h3>
          <button onClick={onClose} className="text-slate-400 p-1"><X size={20} /></button>
        </div>

        <p className="text-slate-400 text-xs mb-3 truncate">{chantier.nom}</p>

        {/* Type select */}
        <label className="block text-slate-400 text-xs uppercase tracking-wide mb-1.5">Activité</label>
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          className="w-full bg-white/[0.08] border border-white/[0.10] text-white text-sm rounded-xl px-3 py-2.5 mb-4 outline-none focus:ring-2 focus:ring-green-500/60"
        >
          {MACHINE_TYPE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Drague toggle */}
        <button
          onClick={() => setDrague(d => !d)}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl mb-5 transition-colors border ${
            drague
              ? 'bg-cyan-900/50 border-cyan-700 text-cyan-300'
              : 'bg-slate-800 border-slate-700 text-slate-300'
          }`}
        >
          <div className="text-left">
            <p className="font-semibold text-sm">Drague aspiratrice</p>
            <p className="text-[11px] opacity-70 mt-0.5">Papillonnage — suivi de volume dragué</p>
          </div>
          <div className={`w-11 h-6 rounded-full relative transition-colors ${drague ? 'bg-cyan-500' : 'bg-slate-600'}`}>
            <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${drague ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </div>
        </button>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full h-12 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40 hover:bg-green-500 transition-colors"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

// ── Re-exports for backward compatibility ──────────────────────────────────────
export { INCIDENT_LABELS, INCIDENT_COLORS, SessionTimeline } from './incidentUtils';

const INCIDENT_OPTIONS: { value: IncidentType; label: string }[] = [
  { value: 'bouchon_avant_pompe', label: 'Bouchon avant pompe' },
  { value: 'bouchon_apres_pompe', label: 'Bouchon après pompe' },
  { value: 'deplacement_cables',  label: 'Déplacement de câbles' },
  { value: 'ajout_tuyaux',        label: 'Ajout de tuyaux' },
  { value: 'panne_mecanique',     label: 'Panne mécanique' },
  { value: 'autre',               label: 'Autre' },
];


// ── IncidentModal ──────────────────────────────────────────────────────────────

function IncidentModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (inc: SuiviIncident) => void;
}) {
  const [type, setType] = useState<IncidentType>('bouchon_avant_pompe');
  const [duree, setDuree] = useState(10);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-end">
      <div className="w-full bg-slate-900/90 backdrop-blur-2xl rounded-t-3xl p-5 pb-8 border-t border-white/[0.08]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-bold flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-400" />
            Déclarer un incident
          </h3>
          <button onClick={onClose} className="text-slate-400 p-1"><X size={20} /></button>
        </div>

        {/* Type */}
        <label className="block text-slate-400 text-xs uppercase tracking-wide mb-1.5">Type d'incident</label>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {INCIDENT_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => setType(o.value)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors border ${
                type === o.value
                  ? 'bg-amber-700/70 border-amber-500 text-amber-100'
                  : 'bg-white/[0.06] border-white/[0.08] text-slate-300 hover:bg-white/[0.10]'
              }`}>
              {type === o.value && <Check size={13} className="text-amber-300 flex-shrink-0" />}
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>

        {/* Duration */}
        <label className="block text-slate-400 text-xs uppercase tracking-wide mb-2">
          Durée estimée de l'arrêt
        </label>
        <div className="flex flex-wrap gap-2 mb-5">
          {[5, 10, 15, 20, 30, 45, 60].map(min => (
            <button
              key={min}
              onClick={() => setDuree(min)}
              className={`px-3 py-1.5 rounded-xl text-sm font-semibold transition-colors border ${
                duree === min
                  ? 'bg-amber-600 border-amber-500 text-white'
                  : 'bg-white/[0.06] border-white/[0.08] text-slate-300 hover:bg-white/[0.10]'
              }`}>
              {min < 60 ? `${min} min` : '1 h'}
            </button>
          ))}
        </div>

        <button
          onClick={() => onAdd({ type, dureeMinutes: duree, ts: new Date().toISOString() })}
          className="w-full h-12 rounded-xl bg-amber-600 text-white font-bold hover:bg-amber-500 transition-colors">
          Enregistrer l'incident
        </button>
      </div>
    </div>
  );
}
