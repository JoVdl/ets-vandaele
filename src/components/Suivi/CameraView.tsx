import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Camera, WifiOff } from 'lucide-react';

const SNAPSHOT_URL = 'https://camerasnapshot-fh3lbsjeka-ew.a.run.app';

type State = 'loading' | 'ok' | 'error';

interface Props {
  onClose: () => void;
}

export default function CameraView({ onClose }: Props) {
  const [imgSrc, setImgSrc]         = useState<string | null>(null);
  const [state, setState]           = useState<State>('loading');
  const [errorMsg, setErrorMsg]     = useState<string>('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchSnapshot = useCallback(async () => {
    setState('loading');
    try {
      const resp = await fetch(`${SNAPSHOT_URL}?_t=${Date.now()}`);
      if (!resp.ok) {
        let errMsg = `HTTP ${resp.status}`;
        try {
          const text = await resp.text();
          if (text.trim().startsWith('{')) {
            const j = JSON.parse(text) as { error?: string };
            errMsg = j.error ?? errMsg;
          }
        } catch {}
        setErrorMsg(errMsg);
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

  // Fetch once on mount — no auto-refresh to save camera battery
  useEffect(() => {
    fetchSnapshot();
    return () => {
      setImgSrc(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [fetchSnapshot]);

  return (
    <div
      className="flex-shrink-0 flex flex-col bg-black/95 border-t border-white/10"
      style={{ height: 'clamp(160px, 45vw, 280px)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0 border-b border-white/[0.07]">
        <Camera size={13} className="text-slate-400 flex-shrink-0" />
        <span className="flex-1 text-white text-xs font-semibold">Caméra chantier</span>
        {lastUpdate && (
          <span className="text-slate-500 text-[10px]">
            {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
        <button
          onClick={fetchSnapshot}
          disabled={state === 'loading'}
          className="p-1.5 text-slate-400 hover:text-white active:scale-95 transition-all disabled:opacity-40"
          title="Rafraîchir"
        >
          <RefreshCw size={13} className={state === 'loading' ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-white active:scale-95 transition-all"
          title="Masquer"
        >
          <X size={15} />
        </button>
      </div>

      {/* Image area */}
      <div className="flex-1 flex items-center justify-center bg-slate-950 relative overflow-hidden">
        {imgSrc && (
          <img
            src={imgSrc}
            alt="Snapshot caméra"
            className="w-full h-full object-contain"
          />
        )}

        {state === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950">
            <RefreshCw size={22} className="text-slate-500 animate-spin" />
            <p className="text-slate-500 text-xs">Chargement snapshot…</p>
          </div>
        )}

        {state === 'error' && !imgSrc && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 text-center">
            <WifiOff size={24} className="text-slate-600" />
            <p className="text-slate-400 text-xs font-semibold">Caméra inaccessible</p>
            <p className="text-slate-600 text-[10px] max-w-xs break-all">{errorMsg}</p>
            <button
              onClick={fetchSnapshot}
              className="mt-1 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 active:scale-95 transition-all"
            >
              Réessayer
            </button>
          </div>
        )}

        {state === 'error' && imgSrc && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/70 rounded-full px-3 py-1 flex items-center gap-1.5">
            <WifiOff size={10} className="text-amber-400" />
            <span className="text-amber-400 text-[10px]">Mise à jour échouée — image précédente</span>
          </div>
        )}
      </div>
    </div>
  );
}
