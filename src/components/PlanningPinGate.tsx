import { useState, useEffect } from 'react';
import { CalendarDays, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { loadSuiviConfig, savePlanningSession } from '../lib/suiviConfig';

interface Props {
  onUnlock: () => void;
}

export default function PlanningPinGate({ onUnlock }: Props) {
  const [pin, setPin]         = useState('');
  const [show, setShow]       = useState(false);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (pin.length < 4) return;
    setLoading(true);
    setError('');
    try {
      const cfg = await loadSuiviConfig();
      if (pin === cfg.patronPin) {
        savePlanningSession();
        onUnlock();
      } else {
        setError('Code incorrect');
        setPin('');
      }
    } catch {
      setError('Erreur de connexion — vérifiez votre réseau');
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (digit: string) => {
    if (pin.length < 6) setPin(p => p + digit);
  };

  useEffect(() => {
    if (error) { const t = setTimeout(() => setError(''), 2000); return () => clearTimeout(t); }
  }, [error]);

  return (
    <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center gap-8 px-6">

      {/* Back */}
      <a href="#" className="absolute top-5 left-5 flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors text-sm">
        <ArrowLeft size={16} /> Accueil
      </a>

      {/* Logo */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg">
          <CalendarDays size={32} className="text-white" />
        </div>
        <div className="text-center">
          <h1 className="text-white text-2xl font-bold">Plan de Charge</h1>
          <p className="text-slate-400 text-sm mt-1">ETS Vandaele — Accès patron</p>
        </div>
      </div>

      {/* PIN display */}
      <div className="flex gap-3">
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <div key={i}
            className={`w-12 h-12 rounded-xl border-2 flex items-center justify-center text-xl font-bold transition-colors ${
              i < pin.length
                ? 'border-blue-500 bg-blue-500/20 text-white'
                : 'border-slate-600 bg-slate-800 text-slate-600'
            }`}>
            {i < pin.length ? (show ? pin[i] : '●') : ''}
          </div>
        ))}
        <button onClick={() => setShow(s => !s)} className="w-12 h-12 flex items-center justify-center text-slate-500 hover:text-slate-300 transition-colors">
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-500/20 border border-red-500/40 rounded-xl text-red-400 text-sm text-center">
          {error}
        </div>
      )}

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-3 w-64">
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d) => (
          <button key={d} disabled={d === ''}
            onClick={() => {
              if (d === '⌫') { setPin(p => p.slice(0, -1)); return; }
              if (d) handleKey(d);
            }}
            className={`h-16 rounded-2xl text-2xl font-semibold transition-all active:scale-95 ${
              d === '' ? 'invisible' :
              d === '⌫' ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' :
              'bg-slate-700 text-white hover:bg-slate-600'
            }`}>
            {d}
          </button>
        ))}
      </div>

      {/* Confirm */}
      <button
        onClick={handleSubmit}
        disabled={pin.length < 4 || loading}
        className="w-64 h-14 rounded-2xl bg-blue-600 text-white text-lg font-semibold disabled:opacity-40 hover:bg-blue-500 active:scale-95 transition-all">
        {loading ? 'Vérification…' : 'Entrer'}
      </button>
    </div>
  );
}
