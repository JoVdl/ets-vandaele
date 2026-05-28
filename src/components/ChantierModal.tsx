import React, { useState, useEffect } from 'react';
import { Dialog } from '@headlessui/react';
import { X, Trash2, CheckCircle } from 'lucide-react';
import type { Chantier, ChantierType, TypePelle } from '../types';
import { CHANTIER_TYPES } from '../lib/constants';
import { format } from 'date-fns';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  chantier?: Chantier | null;
  defaultDateDebut?: string;
  onSave: (data: Omit<Chantier, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onDelete?: () => void;
  onConfirm?: () => void;
}

const PELLES_ALL: TypePelle[] = ['1.5t', '3t', '8t', '16t'];

const emptyForm = (): Omit<Chantier, 'id' | 'createdAt' | 'updatedAt'> => ({
  nom: '',
  client: '',
  lieu: '',
  type: 'curage_mecanique',
  status: 'potentiel',
  dateDebut: format(new Date(), 'yyyy-MM-dd'),
  dateFin: format(new Date(), 'yyyy-MM-dd'),
  chiffreAffaire: 0,
  devisSigne: false,
  acomptePaye: false,
  montantAcompte: 0,
  notes: '',
  pelles: [],
  dumpers: 0,
  tractoBennes: 0,
  bulls: 0,
  chenillette: false,
  bateauFaucardeur: false,
  drague: false,
  telesco: false,
  nombrePersonnes: 1,
  pellePrepaBassin: '8t',
  nombreJoursPrepa: 0,
});

export default function ChantierModal({ isOpen, onClose, chantier, defaultDateDebut, onSave, onDelete, onConfirm }: Props) {
  const [form, setForm] = useState(emptyForm());

  useEffect(() => {
    if (chantier) {
      const { id, createdAt, updatedAt, ...rest } = chantier;
      setForm({ ...emptyForm(), ...rest });
    } else {
      const f = emptyForm();
      if (defaultDateDebut) { f.dateDebut = defaultDateDebut; f.dateFin = defaultDateDebut; }
      setForm(f);
    }
  }, [chantier, defaultDateDebut, isOpen]);

  const meta = CHANTIER_TYPES[form.type];

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const togglePelle = (p: TypePelle) => {
    const cur = form.pelles ?? [];
    set('pelles', cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
    onClose();
  };

  const pelleOptions = meta.pellesOptions ?? PELLES_ALL;

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <Dialog.Title className="text-lg font-semibold text-slate-800">
              {chantier ? 'Modifier le chantier' : 'Nouveau chantier'}
            </Dialog.Title>
            <div className="flex items-center gap-2">
              {chantier?.status === 'potentiel' && onConfirm && (
                <button
                  type="button"
                  onClick={() => { onConfirm(); onClose(); }}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 font-medium transition-colors"
                >
                  <CheckCircle size={15} /> Valider
                </button>
              )}
              {chantier && onDelete && (
                <button
                  type="button"
                  onClick={() => { if (confirm('Supprimer ce chantier ?')) { onDelete(); onClose(); } }}
                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
            {/* Nom & Client */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Nom du chantier *</span>
                <input required value={form.nom} onChange={e => set('nom', e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Client</span>
                <input value={form.client ?? ''} onChange={e => set('client', e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            </div>

            {/* Lieu */}
            <label className="block">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Lieu</span>
              <input value={form.lieu ?? ''} onChange={e => set('lieu', e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>

            {/* Type & Status */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Type de chantier</span>
                <select value={form.type} onChange={e => set('type', e.target.value as ChantierType)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  {Object.entries(CHANTIER_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Statut</span>
                <select value={form.status} onChange={e => set('status', e.target.value as 'potentiel' | 'confirme')}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="potentiel">Potentiel</option>
                  <option value="confirme">Confirmé / Signé</option>
                </select>
              </label>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Date début</span>
                <input type="date" required value={form.dateDebut} onChange={e => set('dateDebut', e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Date fin</span>
                <input type="date" required value={form.dateFin} onChange={e => set('dateFin', e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            </div>

            {/* Financier */}
            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">CA (€)</span>
                <input type="number" min="0" value={form.chiffreAffaire} onChange={e => set('chiffreAffaire', Number(e.target.value))}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="flex items-center gap-3 mt-5 cursor-pointer">
                <input type="checkbox" checked={form.devisSigne} onChange={e => set('devisSigne', e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-600" />
                <span className="text-sm text-slate-600">Devis signé</span>
              </label>
              <label className="flex items-center gap-3 mt-5 cursor-pointer">
                <input type="checkbox" checked={form.acomptePaye} onChange={e => set('acomptePaye', e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-600" />
                <span className="text-sm text-slate-600">Acompte payé</span>
              </label>
            </div>

            {form.acomptePaye && (
              <label className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Montant acompte (€)</span>
                <input type="number" min="0" value={form.montantAcompte ?? 0} onChange={e => set('montantAcompte', Number(e.target.value))}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            )}

            {/* Matériel & Personnel */}
            <div className="border border-slate-100 rounded-xl p-4 bg-slate-50 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Matériel & Personnel</p>

              {/* Pelles */}
              {meta.hasPelles && (
                <div>
                  <p className="text-sm text-slate-600 mb-1.5">Pelles :</p>
                  <div className="flex flex-wrap gap-2">
                    {pelleOptions.map(p => (
                      <button key={p} type="button"
                        onClick={() => togglePelle(p as TypePelle)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          (form.pelles ?? []).includes(p as TypePelle)
                            ? 'bg-slate-700 text-white border-slate-700'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                        }`}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Engins avec compteur */}
              <div className="grid grid-cols-3 gap-2">
                {meta.hasDumper && (
                  <label className="block">
                    <span className="text-xs text-slate-500">Dumpers</span>
                    <input type="number" min="0" max="10" value={form.dumpers ?? 0}
                      onChange={e => set('dumpers', Number(e.target.value))}
                      className="mt-0.5 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white" />
                  </label>
                )}
                {meta.hasTracto && (
                  <label className="block">
                    <span className="text-xs text-slate-500">Tracto-bennes</span>
                    <input type="number" min="0" max="10" value={form.tractoBennes ?? 0}
                      onChange={e => set('tractoBennes', Number(e.target.value))}
                      className="mt-0.5 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white" />
                  </label>
                )}
                {meta.hasBull && (
                  <label className="block">
                    <span className="text-xs text-slate-500">Bulls</span>
                    <input type="number" min="0" max="10" value={form.bulls ?? 0}
                      onChange={e => set('bulls', Number(e.target.value))}
                      className="mt-0.5 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white" />
                  </label>
                )}
              </div>

              {/* Matériels booléens */}
              <div className="flex flex-wrap gap-3">
                {meta.hasChenillette && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.chenillette ?? false}
                      onChange={e => set('chenillette', e.target.checked)}
                      className="w-4 h-4 rounded accent-blue-600" />
                    <span className="text-sm text-slate-600">Chenillette</span>
                  </label>
                )}
                {meta.hasBateau && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.bateauFaucardeur ?? false}
                      onChange={e => set('bateauFaucardeur', e.target.checked)}
                      className="w-4 h-4 rounded accent-blue-600" />
                    <span className="text-sm text-slate-600">Bateau faucardeur</span>
                  </label>
                )}
                {meta.hasDrague && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.drague ?? false}
                      onChange={e => set('drague', e.target.checked)}
                      className="w-4 h-4 rounded accent-blue-600" />
                    <span className="text-sm text-slate-600">Drague</span>
                  </label>
                )}
                {meta.hasTelesco && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.telesco ?? false}
                      onChange={e => set('telesco', e.target.checked)}
                      className="w-4 h-4 rounded accent-blue-600" />
                    <span className="text-sm text-slate-600">Télesco</span>
                  </label>
                )}
              </div>

              {/* Curage aspiration spécifique */}
              {meta.hasPrepBassin && (
                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-200">
                  <label className="block">
                    <span className="text-xs text-slate-500">Pelle prépa bassin</span>
                    <select value={form.pellePrepaBassin ?? '8t'}
                      onChange={e => set('pellePrepaBassin', e.target.value as '8t' | '16t')}
                      className="mt-0.5 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
                      <option value="8t">8t</option>
                      <option value="16t">16t</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs text-slate-500">Jours de prépa</span>
                    <input type="number" min="0" value={form.nombreJoursPrepa ?? 0}
                      onChange={e => set('nombreJoursPrepa', Number(e.target.value))}
                      className="mt-0.5 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white" />
                  </label>
                </div>
              )}

              {/* Personnes */}
              <label className="block">
                <span className="text-xs text-slate-500">Nombre de personnes</span>
                <input type="number" min="1" max="20" value={form.nombrePersonnes ?? 1}
                  onChange={e => set('nombrePersonnes', Number(e.target.value))}
                  className="mt-0.5 w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white" />
              </label>
            </div>

            {/* Notes */}
            <label className="block">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Notes</span>
              <textarea rows={2} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </label>
          </form>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              Annuler
            </button>
            <button
              onClick={handleSubmit as unknown as React.MouseEventHandler}
              className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              {chantier ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
