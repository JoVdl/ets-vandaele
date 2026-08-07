import { useState } from 'react';
import { X, ChevronUp, ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { ChantierType } from '../types';
import { CHANTIER_TYPES } from '../lib/constants';
import type { ReorgSettings } from '../lib/reorgSettings';

const ALL_TYPES = Object.keys(CHANTIER_TYPES) as ChantierType[];

interface Props {
  settings: ReorgSettings;
  onSave: (s: ReorgSettings) => void;
  onClose: () => void;
}

export default function ReorgSettingsModal({ settings, onSave, onClose }: Props) {
  const [priorities, setPriorities] = useState<ChantierType[]>(settings.typePriorities);

  const unprioritized = ALL_TYPES.filter(t => !priorities.includes(t));

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...priorities];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setPriorities(next);
  };

  const remove = (idx: number) => {
    setPriorities(p => p.filter((_, i) => i !== idx));
  };

  const add = (type: ChantierType) => {
    setPriorities(p => [...p, type]);
  };

  const handleSave = () => {
    onSave({ typePriorities: priorities });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100">
          <div className="flex-1">
            <h2 className="text-base font-bold text-slate-800">Paramètres de réorganisation</h2>
            <p className="text-xs text-slate-400 mt-0.5">Définissez l'ordre de priorité des types de chantier</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Prioritized list */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Priorités (dans l'ordre)
            </p>

            {priorities.length === 0 ? (
              <div className="text-center py-6 border-2 border-dashed border-slate-200 rounded-xl">
                <p className="text-sm text-slate-400">Aucune priorité définie</p>
                <p className="text-xs text-slate-300 mt-1">Ajoutez des types ci-dessous</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {priorities.map((type, idx) => {
                  const meta = CHANTIER_TYPES[type];
                  return (
                    <div key={type}
                      className="flex items-center gap-2 px-3 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm">
                      {/* Priority badge */}
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                        style={{ backgroundColor: meta.color }}>
                        {idx + 1}
                      </span>

                      {/* Color dot */}
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: meta.color }} />

                      {/* Label */}
                      <span className="flex-1 text-sm font-medium text-slate-700 min-w-0 truncate">
                        {meta.label}
                      </span>

                      {/* Controls */}
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => move(idx, -1)} disabled={idx === 0}
                          className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 disabled:opacity-20 transition-colors">
                          <ChevronUp size={14} />
                        </button>
                        <button onClick={() => move(idx, 1)} disabled={idx === priorities.length - 1}
                          className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 disabled:opacity-20 transition-colors">
                          <ChevronDown size={14} />
                        </button>
                        <button onClick={() => remove(idx)}
                          className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-400 transition-colors ml-0.5">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Unprioritized types */}
          {unprioritized.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Autres types <span className="font-normal normal-case text-slate-400">(ordre EDF standard)</span>
              </p>
              <div className="space-y-1.5">
                {unprioritized.map(type => {
                  const meta = CHANTIER_TYPES[type];
                  return (
                    <div key={type}
                      className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl">
                      <span className="w-2 h-2 rounded-full flex-shrink-0 opacity-50" style={{ backgroundColor: meta.color }} />
                      <span className="flex-1 text-sm text-slate-400 truncate">{meta.label}</span>
                      <button onClick={() => add(type)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium text-slate-500 hover:text-white hover:bg-blue-500 border border-slate-200 hover:border-blue-500 transition-all flex-shrink-0">
                        <Plus size={11} /> Prioriser
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Explanation */}
          <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
            <p className="text-xs text-blue-700 leading-relaxed">
              <strong>Comment ça fonctionne :</strong> les types en haut de la liste sont planifiés en premier,
              quelle que soit leur date de début. À l'intérieur de chaque groupe prioritaire,
              l'ordre EDF (deadline la plus proche) s'applique.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
          {priorities.length > 0 && (
            <button onClick={() => setPriorities([])}
              className="px-3 py-2 text-sm text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors">
              Réinitialiser
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
            Annuler
          </button>
          <button onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors">
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
}
