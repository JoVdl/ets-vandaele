import { useState, useCallback } from 'react';
import {
  startOfMonth, endOfMonth, addMonths, subMonths,
} from 'date-fns';
import {
  Plus, ChevronLeft, ChevronRight, Calendar, BarChart2,
  TrendingUp, AlertCircle,
} from 'lucide-react';
import { useChantiers } from '../hooks/useChantiers';
import GanttChart from './GanttChart';
import ChantierModal from './ChantierModal';
import type { Chantier } from '../types';
import { CHANTIER_TYPES, MONTH_FR } from '../lib/constants';

type ZoomLevel = 1 | 2 | 3 | 6;

export default function PlanDeCharge() {
  const { chantiers, loading, error, addChantier, updateChantier, deleteChantier, confirmChantier } = useChantiers();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [zoom, setZoom] = useState<ZoomLevel>(2); // months visible
  const [modal, setModal] = useState<{ open: boolean; chantier: Chantier | null; defaultDate?: string }>({
    open: false, chantier: null,
  });
  const [filterStatus, setFilterStatus] = useState<'all' | 'confirme' | 'potentiel'>('all');

  const periodStart = startOfMonth(currentMonth);
  const periodEnd = endOfMonth(addMonths(currentMonth, zoom - 1));

  const filtered = chantiers.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false;
    // Show chantiers that overlap with the period
    const cs = new Date(c.dateDebut);
    const ce = new Date(c.dateFin);
    return cs <= periodEnd && ce >= periodStart;
  });

  // Stats
  const confirmes = chantiers.filter(c => c.status === 'confirme');
  const potentiels = chantiers.filter(c => c.status === 'potentiel');
  const caConfirme = confirmes.reduce((s, c) => s + (c.chiffreAffaire ?? 0), 0);
  const caPotentiel = potentiels.reduce((s, c) => s + (c.chiffreAffaire ?? 0), 0);

  const openNew = (defaultDate?: string) =>
    setModal({ open: true, chantier: null, defaultDate });

  const openEdit = (c: Chantier) =>
    setModal({ open: true, chantier: c });

  const closeModal = () =>
    setModal({ open: false, chantier: null });

  const handleSave = async (data: Omit<Chantier, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (modal.chantier) {
      await updateChantier(modal.chantier.id, data);
    } else {
      await addChantier(data);
    }
  };

  const handleDelete = async () => {
    if (modal.chantier) await deleteChantier(modal.chantier.id);
  };

  const handleConfirm = async () => {
    if (modal.chantier) await confirmChantier(modal.chantier.id);
  };

  const handleMove = useCallback(async (id: string, newStart: string, newEnd: string) => {
    await updateChantier(id, { dateDebut: newStart, dateFin: newEnd });
  }, [updateChantier]);

  const handleResize = useCallback(async (id: string, newEnd: string) => {
    await updateChantier(id, { dateFin: newEnd });
  }, [updateChantier]);

  const prevPeriod = () => setCurrentMonth(m => subMonths(m, zoom));
  const nextPeriod = () => setCurrentMonth(m => addMonths(m, zoom));
  const goToday = () => setCurrentMonth(new Date());

  const periodLabel = zoom === 1
    ? `${MONTH_FR[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`
    : `${MONTH_FR[periodStart.getMonth()]} – ${MONTH_FR[periodEnd.getMonth()]} ${periodEnd.getFullYear()}`;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500">
        <AlertCircle size={40} className="text-red-400" />
        <p className="font-medium">Erreur de connexion Firebase</p>
        <p className="text-sm text-center max-w-sm">{error}</p>
        <p className="text-xs text-slate-400">Vérifiez votre fichier .env et la configuration Firebase</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0">
        {/* Title bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <BarChart2 size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-800">Plan de charge</h1>
              <p className="text-xs text-slate-400">ETS Vandaele</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
              {(['all', 'confirme', 'potentiel'] as const).map(s => (
                <button key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1.5 font-medium transition-colors ${
                    filterStatus === s
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}>
                  {s === 'all' ? 'Tous' : s === 'confirme' ? 'Confirmés' : 'Potentiels'}
                </button>
              ))}
            </div>

            <button
              onClick={() => openNew()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={15} />
              Nouveau chantier
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-6 px-6 py-2.5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full" />
            <span className="text-xs text-slate-500">{confirmes.length} confirmés</span>
            <span className="text-xs font-semibold text-slate-700">
              {caConfirme.toLocaleString('fr-FR')} €
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-slate-300 rounded-full border border-slate-400 border-dashed" />
            <span className="text-xs text-slate-500">{potentiels.length} potentiels</span>
            <span className="text-xs font-semibold text-slate-400">
              {caPotentiel.toLocaleString('fr-FR')} €
            </span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <TrendingUp size={13} className="text-green-500" />
            <span className="text-xs text-slate-500">CA total potentiel :</span>
            <span className="text-xs font-bold text-slate-700">
              {(caConfirme + caPotentiel).toLocaleString('fr-FR')} €
            </span>
          </div>
        </div>

        {/* Navigation + Zoom */}
        <div className="flex items-center gap-3 px-6 py-2 border-t border-slate-100">
          <div className="flex items-center gap-1">
            <button onClick={prevPeriod} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
              <ChevronLeft size={16} className="text-slate-600" />
            </button>
            <button onClick={goToday} className="px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1">
              <Calendar size={12} />
              Aujourd'hui
            </button>
            <button onClick={nextPeriod} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
              <ChevronRight size={16} className="text-slate-600" />
            </button>
          </div>

          <span className="text-sm font-semibold text-slate-700 min-w-[200px]">
            {periodLabel}
          </span>

          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-slate-400 mr-1">Zoom :</span>
            {([1, 2, 3, 6] as ZoomLevel[]).map(z => (
              <button key={z}
                onClick={() => setZoom(z)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  zoom === z ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}>
                {z === 1 ? '1 mois' : z === 2 ? '2 mois' : z === 3 ? '3 mois' : '6 mois'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Gantt chart */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm">Chargement...</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <GanttChart
            chantiers={filtered}
            periodStart={periodStart}
            periodEnd={periodEnd}
            onMoveChantier={handleMove}
            onResizeChantier={handleResize}
            onClickChantier={openEdit}
            onClickDay={openNew}
          />
        </div>
      )}

      {/* Legend */}
      <div className="bg-white border-t border-slate-100 px-6 py-2 flex flex-wrap gap-3 flex-shrink-0">
        {Object.entries(CHANTIER_TYPES).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: v.color }} />
            <span className="text-xs text-slate-500">{v.label}</span>
          </div>
        ))}
      </div>

      {/* Modal */}
      <ChantierModal
        isOpen={modal.open}
        onClose={closeModal}
        chantier={modal.chantier}
        defaultDateDebut={modal.defaultDate}
        onSave={handleSave}
        onDelete={modal.chantier ? handleDelete : undefined}
        onConfirm={modal.chantier?.status === 'potentiel' ? handleConfirm : undefined}
      />
    </div>
  );
}
