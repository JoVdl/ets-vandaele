import { useState, useEffect, useCallback, useRef } from 'react';
import { X, RefreshCw, Camera, WifiOff } from 'lucide-react';

const SNAPSHOT_URL =
  'https://europe-west1-ets-vandaele.cloudfunctions.net/cameraSnapshot';
const REFRESH_INTERVAL_MS = 30_000;

type State = 'idle' | 'loading' | 'ok' | 'error';

interface Props {
  onClose: () => void;
}

export default function CameraView({ onClose }: Props) {
  const [imgSrc, setImgSrc]     = useState<string | null>(null);
  const [state, setState]       = useState<State>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSnapshot = useCallback(async () => {
    setState('loading');
    try {
      const resp = await fetch(`${SNAPSHOT_URL}?_t=${Date.now()}`);
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({})) as { error?: string };
        setErrorMsg(j.error ?? `HTTP ${resp.status}`);
        setState('error');
        return;
      }
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      setImgSrc(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
      setLastUpdate(new Date());
      setState('ok');
    } catch (err) {
      setErrorMsg(String(err));
      setState('error');
    }
  }, []);

  useEffect(() => {
    fetchSnapshot();
    intervalRef.current = setInterval(fetchSnapshot, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setImgSrc(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [fetchSnapshot]);

  return (
    <div className="fixed inset-0 z-[400] bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5 flex-shrink-0 bg-black/80">
        <Camera size={16} className="text-slate-400" />
        <p className="flex-1 text-white text-sm font-semibold">Caméra chantier</p>
        {lastUpdate && (
          <span className="text-slate-500 text-[10px]">
            {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
        <button
          onClick={fetchSnapshot}
          disabled={state === 'loading'}
          className="p-1.5 text-slate-400 hover:text-white active:scale-95 transition-all disabled:opacity-40"
        >
          <RefreshCw size={16} className={state === 'loading' ? 'animate-spin' : ''} />
        </button>
        <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white active:scale-95 transition-all">
          <X size={18} />
        </button>
      </div>

      {/* Image area */}
      <div className="flex-1 flex items-center justify-center bg-slate-950 relative overflow-hidden">
        {imgSrc && (
          <img
            src={imgSrc}
            alt="Snapshot caméra"
            className="max-w-full max-h-full object-contain"
            style={{ imageRendering: 'auto' }}
          />
        )}

        {state === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/80">
            <RefreshCw size={28} className="text-slate-500 animate-spin" />
            <p className="text-slate-500 text-sm">Chargement snapshot…</p>
          </div>
        )}

        {state === 'error' && !imgSrc && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 text-center">
            <WifiOff size={36} className="text-slate-600" />
            <p className="text-slate-400 text-sm font-semibold">Caméra inaccessible</p>
            <p className="text-slate-600 text-xs">{errorMsg}</p>
            <button
              onClick={fetchSnapshot}
              className="mt-2 px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 active:scale-95 transition-all"
            >
              Réessayer
            </button>
          </div>
        )}

        {state === 'error' && imgSrc && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/70 rounded-full px-3 py-1 flex items-center gap-1.5">
            <WifiOff size={11} className="text-amber-400" />
            <span className="text-amber-400 text-[10px]">Mise à jour échouée — image précédente affichée</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-3 py-2 bg-black/80 flex items-center justify-between">
        <span className="text-slate-600 text-[10px]">Rafraîchissement auto toutes les 30 s</span>
        <span className="text-slate-700 text-[10px]">UID : 95270000SOYFJBFR</span>
      </div>
    </div>
  );
}
