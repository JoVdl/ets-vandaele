import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog } from '@headlessui/react';
import { X, Trash2, CheckCircle, MapPin, Loader2, AlertTriangle, Lock, LockOpen, HardHat } from 'lucide-react';
import type { Chantier, ChantierType, ChantierStatus, TypePelle } from '../types';
import { CHANTIER_TYPES } from '../lib/constants';
import { format } from 'date-fns';
import { geocode, geocodeSearch, extractLocation, type GeoResult } from '../lib/geocoder';
import { nextWorkingDay, prevWorkingDay, addWorkingDays, countWorkingDays } from '../lib/workingDays';

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
  dateDebut: format(nextWorkingDay(new Date()), 'yyyy-MM-dd'),
  dateFin: format(nextWorkingDay(new Date()), 'yyyy-MM-dd'),
  periodePreconiseeDebut: '',
  periodePreconiseeFin: '',
  adresse: '',
  latitude: undefined,
  longitude: undefined,
  chiffreAffaire: 0,
  nombreAnnees: 1,
  devisSigne: false,
  acomptePaye: false,
  montantAcompte: 0,
  notes: '',
  pelles: [],
  dumpers: 0,
  tractoBennes: 0,
  bulls: 0,
  rouleaux: 0,
  chenillette: false,
  bateauFaucardeur: false,
  drague: false,
  telesco: false,
  nombrePersonnes: 1,
  patronRequis: true,
  pellePrepaBassin: '8t',
  nombreJoursPrepa: 0,
  datesVerrouillees: false,
});

function isOutOfPreconisee(form: ReturnType<typeof emptyForm>): boolean {
  if (!form.periodePreconiseeDebut || !form.periodePreconiseeFin) return false;
  return form.dateDebut < form.periodePreconiseeDebut || form.dateFin > form.periodePreconiseeFin;
}

export default function ChantierModal({ isOpen, onClose, chantier, defaultDateDebut, onSave, onDelete, onConfirm }: Props) {
  const [form, setForm]         = useState(emptyForm());
  const [geocoding, setGeocoding]       = useState(false);
  const [suggestions, setSuggestions]   = useState<GeoResult[]>([]);
  const [showSuggest, setShowSuggest]   = useState(false);
  const suggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (chantier) {
      const { id, createdAt, updatedAt, ...rest } = chantier;
      setForm({ ...emptyForm(), ...rest });
    } else {
      const f = emptyForm();
      if (defaultDateDebut) {
        const snapped = format(nextWorkingDay(new Date(defaultDateDebut + 'T00:00:00')), 'yyyy-MM-dd');
        f.dateDebut = snapped;
        f.dateFin   = snapped;
      }
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

  // Debounced address autocomplete
  const handleAddressInput = useCallback((value: string) => {
    set('adresse', value);
    set('latitude', undefined);
    set('longitude', undefined);
    if (suggestDebounce.current) clearTimeout(suggestDebounce.current);
    if (value.length < 2) { setSuggestions([]); setShowSuggest(false); return; }
    suggestDebounce.current = setTimeout(async () => {
      const results = await geocodeSearch(value);
      setSuggestions(results);
      setShowSuggest(results.length > 0);
    }, 380);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectSuggestion = useCallback((r: GeoResult) => {
    setForm(prev => ({ ...prev, adresse: r.shortName ?? r.displayName.split(',').slice(0, 2).join(',').trim(), latitude: r.lat, longitude: r.lon }));
    setSuggestions([]);
    setShowSuggest(false);
  }, []);

  // Manual geocode button (from nom/lieu)
  const handleGeocode = async () => {
    setGeocoding(true);
    const q = extractLocation(form.nom, form.adresse || form.lieu);
    const res = await geocode(q);
    if (res) {
      setForm(prev => ({
        ...prev,
        latitude: res.lat, longitude: res.lon,
        adresse: prev.adresse || res.displayName.split(',').slice(0, 2).join(',').trim(),
      }));
    }
    setGeocoding(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = { ...form };
    if (!clean.periodePreconiseeDebut) clean.periodePreconiseeDebut = undefined;
    if (!clean.periodePreconiseeFin)   clean.periodePreconiseeFin   = undefined;
    if (!clean.adresse) clean.adresse = undefined;

    // Auto-geocode from name if still no coordinates
    if (!clean.latitude && (clean.nom || clean.lieu)) {
      const q = extractLocation(clean.nom, clean.adresse || clean.lieu);
      const res = await geocode(q);
      if (res) {
        clean.latitude = res.lat;
        clean.longitude = res.lon;
        if (!clean.adresse) clean.adresse = res.displayName.split(',').slice(0, 2).join(',').trim();
      }
    }

    onSave(clean);
    onClose();
  };

  const pelleOptions = meta.pellesOptions ?? PELLES_ALL;
  const warn = isOutOfPreconisee(form);

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-[2000]">
      <div className="fixed inset-0 z-[2000] bg-black/40 backdrop-blur-sm" aria-hidden="true" />
      <div className="fixed inset-0 z-[2001] flex items-end sm:items-center p-0 sm:p-4">
        <Dialog.Panel className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] sm:max-h-[90vh] flex flex-col">
          {/* Drag handle — mobile only */}
          <div className="flex justify-center pt-2.5 pb-1 sm:hidden flex-shrink-0">
            <div className="w-10 h-1 bg-slate-200 rounded-full" />
          </div>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-100">
            <Dialog.Title className="text-lg font-semibold text-slate-800">
              {chantier ? 'Modifier le chantier' : 'Nouveau chantier'}
            </Dialog.Title>
            <div className="flex items-center gap-2">
              {chantier?.status === 'potentiel' && onConfirm && form.status === 'potentiel' && (
                <button type="button" onClick={() => { onConfirm(); onClose(); }}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 font-medium transition-colors">
                  <CheckCircle size={15} /> Valider
                </button>
              )}
              {chantier && onDelete && (
                <button type="button"
                  onClick={() => { if (confirm('Supprimer ce chantier ?')) { onDelete(); onClose(); } }}
                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 size={16} />
                </button>
              )}
              <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-4 py-3 sm:px-6 sm:py-4 space-y-3 sm:space-y-4">

            {/* Période hors préconisée warning */}
            {warn && (
              <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-orange-700 text-xs">
                <AlertTriangle size={14} />
                Ce chantier est en dehors de sa période d'intervention préconisée.
              </div>
            )}

            {/* Nom & Client */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

            {/* Lieu + Adresse/Localisation */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Lieu</span>
                <input value={form.lieu ?? ''} onChange={e => set('lieu', e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <div className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Adresse (géolocalisation)</span>
                <div className="mt-1 relative">
                  <div className="flex gap-1">
                    <input
                      value={form.adresse ?? ''}
                      onChange={e => handleAddressInput(e.target.value)}
                      onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
                      onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                      placeholder="Tapez une ville ou adresse…"
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button type="button" onClick={handleGeocode} disabled={geocoding}
                      title="Géocoder depuis le nom du chantier"
                      className="px-2 py-2 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors flex-shrink-0">
                      {geocoding ? <Loader2 size={15} className="animate-spin"/> : <MapPin size={15}/>}
                    </button>
                  </div>
                  {/* Autocomplete dropdown */}
                  {showSuggest && suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-8 z-50 mt-0.5 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                      {suggestions.map((s, i) => (
                        <button
                          key={i}
                          type="button"
                          onMouseDown={() => handleSelectSuggestion(s)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 border-b border-slate-50 last:border-0">
                          <span className="font-medium text-slate-700">{s.shortName}</span>
                          <span className="text-slate-400 ml-1 truncate block text-[10px]">{s.displayName.split(',').slice(0, 3).join(',')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {form.latitude && form.longitude && (
                  <p className="text-[10px] text-green-600 mt-0.5 flex items-center gap-0.5">
                    <MapPin size={9}/> {form.latitude.toFixed(4)}, {form.longitude.toFixed(4)}
                  </p>
                )}
              </div>
            </div>

            {/* Type & Status */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <select value={form.status} onChange={e => set('status', e.target.value as ChantierStatus)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="potentiel">Potentiel</option>
                  <option value="confirme">Confirmé / Signé</option>
                  <option value="refuse">Refusé</option>
                  <option value="annule">Annulé</option>
                </select>
              </label>
            </div>

            {/* Dates intervention */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Date début</span>
                <input type="date" required value={form.dateDebut}
                  onChange={e => {
                    if (!e.target.value) return;
                    const newStart = format(nextWorkingDay(new Date(e.target.value + 'T00:00:00')), 'yyyy-MM-dd');
                    // Preserve working-day duration when start changes
                    const dur = countWorkingDays(new Date(form.dateDebut), new Date(form.dateFin));
                    const newEnd = format(addWorkingDays(new Date(newStart + 'T00:00:00'), Math.max(0, dur - 1)), 'yyyy-MM-dd');
                    setForm(prev => ({ ...prev, dateDebut: newStart, dateFin: newEnd }));
                  }}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Durée (j. ouvrés)</span>
                <input
                  type="number" min="1" max="500"
                  value={countWorkingDays(new Date(form.dateDebut), new Date(form.dateFin))}
                  onChange={e => {
                    const dur = Math.max(1, Number(e.target.value));
                    const newEnd = format(addWorkingDays(new Date(form.dateDebut + 'T00:00:00'), dur - 1), 'yyyy-MM-dd');
                    set('dateFin', newEnd);
                  }}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Date fin</span>
                <input type="date" required value={form.dateFin}
                  onChange={e => {
                    if (!e.target.value) return;
                    set('dateFin', format(prevWorkingDay(new Date(e.target.value + 'T00:00:00')), 'yyyy-MM-dd'));
                  }}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            </div>

            {/* Verrouillage des dates */}
            <button
              type="button"
              onClick={() => set('datesVerrouillees', !form.datesVerrouillees)}
              className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg border text-sm transition-colors ${
                form.datesVerrouillees
                  ? 'bg-amber-50 border-amber-300 text-amber-800'
                  : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {form.datesVerrouillees
                ? <Lock size={14} className="text-amber-600 flex-shrink-0"/>
                : <LockOpen size={14} className="flex-shrink-0"/>}
              <span className="font-medium">
                {form.datesVerrouillees ? 'Dates verrouillées' : 'Verrouiller les dates'}
              </span>
              <span className="ml-auto text-xs opacity-60">
                {form.datesVerrouillees ? 'Exclues de la réorganisation' : 'La réorganisation peut déplacer ce chantier'}
              </span>
            </button>

            {/* Période préconisée */}
            <div className="border border-dashed border-slate-200 rounded-xl p-3 bg-slate-50/50 space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Période d'intervention préconisée (optionnel)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-slate-500">Du</span>
                  <input type="date" value={form.periodePreconiseeDebut ?? ''} onChange={e => set('periodePreconiseeDebut', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Au</span>
                  <input type="date" value={form.periodePreconiseeFin ?? ''} onChange={e => set('periodePreconiseeFin', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </label>
              </div>
            </div>

            {/* Financier */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">CA annuel (€)</span>
                  <input type="number" min="0" value={form.chiffreAffaire} onChange={e => set('chiffreAffaire', Number(e.target.value))}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Durée contrat (années)</span>
                  <input type="number" min="1" max="10" value={form.nombreAnnees ?? 1}
                    onChange={e => set('nombreAnnees', Math.max(1, Number(e.target.value)))}
                    className="mt-1 w-20 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </label>
              </div>
              <div className="flex gap-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.devisSigne} onChange={e => set('devisSigne', e.target.checked)}
                    className="w-4 h-4 rounded accent-blue-600" />
                  <span className="text-sm text-slate-600">Devis signé</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.acomptePaye} onChange={e => set('acomptePaye', e.target.checked)}
                    className="w-4 h-4 rounded accent-blue-600" />
                  <span className="text-sm text-slate-600">Acompte payé</span>
                </label>
              </div>
            </div>

            {form.acomptePaye && (
              <label className="block">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Montant acompte (€)</span>
                <input type="number" min="0" value={form.montantAcompte ?? 0} onChange={e => set('montantAcompte', Number(e.target.value))}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            )}

            {/* Matériel & Personnel */}
            <div className="border border-slate-100 rounded-xl p-3 sm:p-4 bg-slate-50 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Matériel & Personnel</p>

              {meta.hasPelles && (
                <div>
                  <p className="text-sm text-slate-600 mb-1.5">Pelles :</p>
                  <div className="flex flex-wrap gap-2">
                    {pelleOptions.map(p => (
                      <button key={p} type="button" onClick={() => togglePelle(p as TypePelle)}
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

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                {meta.hasRouleau && (
                  <label className="block">
                    <span className="text-xs text-slate-500">Rouleaux 700kg</span>
                    <input type="number" min="0" max="10" value={form.rouleaux ?? 0}
                      onChange={e => set('rouleaux', Number(e.target.value))}
                      className="mt-0.5 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white" />
                  </label>
                )}
              </div>

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

              {meta.hasPrepBassin && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-200">
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

              <label className="block">
                <span className="text-xs text-slate-500">Nombre de personnes</span>
                <input type="number" min="1" max="20" value={form.nombrePersonnes ?? 1}
                  onChange={e => set('nombrePersonnes', Number(e.target.value))}
                  className="mt-0.5 w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white" />
              </label>

              {/* Patron requis */}
              <button
                type="button"
                onClick={() => set('patronRequis', !(form.patronRequis ?? true))}
                className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg border text-sm transition-colors ${
                  (form.patronRequis ?? true)
                    ? 'bg-orange-50 border-orange-300 text-orange-800'
                    : 'bg-slate-50 border-slate-200 text-slate-400 hover:border-slate-300'
                }`}
              >
                <HardHat size={14} className={(form.patronRequis ?? true) ? 'text-orange-600 flex-shrink-0' : 'flex-shrink-0 opacity-40'} />
                <span className="font-medium">
                  {(form.patronRequis ?? true) ? 'Patron requis' : 'Patron non requis'}
                </span>
                <span className="ml-auto text-xs opacity-60">
                  {(form.patronRequis ?? true)
                    ? 'Ne peut pas se faire en simultané avec un autre chantier patron requis'
                    : 'Le salarié peut y être seul'}
                </span>
              </button>
            </div>

            {/* Notes */}
            <label className="block">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Notes</span>
              <textarea rows={2} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </label>
          </form>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-4 py-3 sm:px-6 sm:py-4 border-t border-slate-100">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              Annuler
            </button>
            <button onClick={handleSubmit as unknown as React.MouseEventHandler}
              className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              {chantier ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
