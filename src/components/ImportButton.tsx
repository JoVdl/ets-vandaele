import { useState } from 'react';
import { collection, addDoc, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Upload, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import seedData from '../data/seedData.json';

type State = 'idle' | 'loading' | 'done' | 'error';

export default function ImportButton() {
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');

  const handleImport = async () => {
    if (!confirm(`Importer ${seedData.length} chantiers depuis le plan de charge Sheets ?\n\nCela n'écrasera pas les chantiers existants.`)) return;

    setState('loading');
    try {
      // Check if already imported
      const snap = await getDocs(collection(db, 'chantiers'));
      if (snap.size > 0) {
        const ok = confirm(`La base contient déjà ${snap.size} chantier(s). Importer quand même ?`);
        if (!ok) { setState('idle'); return; }
      }

      let count = 0;
      for (const c of seedData) {
        const { id, ...data } = c;
        await addDoc(collection(db, 'chantiers'), data);
        count++;
      }

      setState('done');
      setMessage(`${count} chantiers importés avec succès`);
      setTimeout(() => setState('idle'), 4000);
    } catch (err: unknown) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Erreur inconnue');
      setTimeout(() => setState('idle'), 5000);
    }
  };

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-500 bg-slate-100 rounded-lg">
        <Loader size={14} className="animate-spin" />
        Importation...
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-green-700 bg-green-50 rounded-lg">
        <CheckCircle size={14} />
        {message}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 bg-red-50 rounded-lg">
        <AlertCircle size={14} />
        {message}
      </div>
    );
  }

  return (
    <button
      onClick={handleImport}
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors font-medium"
    >
      <Upload size={14} />
      Importer Sheets
    </button>
  );
}
