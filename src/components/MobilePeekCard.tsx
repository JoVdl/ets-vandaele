import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Calendar, MapPin, Euro, Users, User, Lock, Pencil, CheckCheck, CircleAlert } from 'lucide-react';
import cenLogoUrl from '../assets/cen-logo.png';
import type { Chantier } from '../types';
import { CHANTIER_TYPES } from '../lib/constants';
import { countWorkingDays, caAnnuel } from '../lib/workingDays';

interface Props {
  chantier: Chantier;
  onClose: () => void;
  onEdit: () => void;
}

export default function MobilePeekCard({ chantier: c, onClose, onEdit }: Props) {
  const meta        = CHANTIER_TYPES[c.type];
  const isPotentiel = c.status === 'potentiel';
  const isArchived  = c.status === 'refuse' || c.status === 'annule';
  const isPast      = !isPotentiel && !isArchived && new Date(c.dateFin) < new Date();
  const nb          = c.nombrePersonnes ?? 1;
  const wd          = countWorkingDays(new Date(c.dateDebut), new Date(c.dateFin));
  const nAns        = c.nombreAnnees ?? 1;
  const caAn        = caAnnuel(c.chiffreAffaire, c.nombreAnnees);
  const caParJour   = wd > 0 && caAn > 0 ? Math.round(caAn / wd) : 0;

  const dateStr = `${format(new Date(c.dateDebut), 'd MMM', { locale: fr })} → ${format(new Date(c.dateFin), 'd MMM yyyy', { locale: fr })}`;

  const equip: string[] = [];
  c.pelles?.forEach(p => equip.push(p));
  if (c.dumpers)        equip.push(`Dumper ×${c.dumpers}`);
  if (c.tractoBennes)   equip.push(`TB ×${c.tractoBennes}`);
  if (c.bulls)          equip.push(`Bull ×${c.bulls}`);
  if (c.chenillette)    equip.push('Chenillette');
  if (c.bateauFaucardeur) equip.push('Bateau fauc.');
  if (c.drague)         equip.push('Drague');
  if (c.telesco)        equip.push('Télesco');

  return (
    <>
      {/* Invisible backdrop — closes the card on outside tap */}
      <div className="fixed inset-0 z-[8999]" onClick={onClose} />

      {/* Peek card */}
      <div className="fixed bottom-0 left-0 right-0 z-[9000] bg-white rounded-t-2xl shadow-2xl">
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>

        {/* Colored accent line */}
        <div className="h-1 mx-4 rounded-full" style={{ backgroundColor: meta.color }} />

        <div className="px-4 pt-3 pb-2">
          {/* Type + status + lock */}
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: meta.color }} />
            <span className="text-[10px] text-slate-400">{meta.label}</span>
            <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${
              isArchived  ? 'bg-slate-100 text-slate-400' :
              isPotentiel ? 'bg-slate-100 text-slate-500' :
                            'bg-green-50 text-green-700'
            }`}>
              {c.status === 'refuse' ? 'Refusé' : c.status === 'annule' ? 'Annulé' : isPotentiel ? 'Potentiel' : 'Confirmé'}
            </span>
            {c.datesVerrouillees && (
              <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                <Lock size={9}/> Verrouillé
              </span>
            )}
          </div>

          {/* Name */}
          <p className="font-semibold text-slate-800 text-base leading-tight mb-1">{c.nom}</p>

          {/* Client */}
          {c.client && (
            <div className="flex items-center gap-1.5 mb-1.5">
              {c.client.toUpperCase().includes('CEN') && (
                <img src={cenLogoUrl} alt="CEN" style={{ height: 13, width: 'auto' }} />
              )}
              <p className="text-xs text-slate-500">{c.client}</p>
            </div>
          )}

          {/* Dates */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
            <Calendar size={12} className="flex-shrink-0" />
            <span>{dateStr}</span>
            {wd > 0 && (
              <span className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-medium text-slate-500 flex-shrink-0">
                {wd} j ouvrés
              </span>
            )}
          </div>

          {/* Lieu */}
          {(c.lieu || c.adresse) && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <MapPin size={12} className="flex-shrink-0" />
              <span className="truncate">{c.lieu || c.adresse}</span>
            </div>
          )}

          {/* CA */}
          {c.chiffreAffaire > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1">
              <Euro size={12} className="flex-shrink-0" />
              <span>{c.chiffreAffaire.toLocaleString('fr-FR')} €</span>
              {nAns > 1 && (
                <span className="text-[10px] font-normal text-indigo-500 px-1 py-0.5 bg-indigo-50 rounded">contrat {nAns} ans</span>
              )}
              {caParJour > 0 && (
                <span className="text-[10px] font-normal text-slate-400">({caParJour.toLocaleString('fr-FR')} €/j)</span>
              )}
            </div>
          )}

          {/* Personnel */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
            {nb >= 2 ? <Users size={12} /> : <User size={12} />}
            <span>{nb} personne{nb > 1 ? 's' : ''}</span>
          </div>

          {/* Equipment chips */}
          {equip.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {equip.map((it, i) => (
                <span key={i} className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] text-slate-600">{it}</span>
              ))}
            </div>
          )}

          {/* Facturation */}
          {isPast && (
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              {/* Statut facture */}
              <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                c.factureFaite ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-500'
              }`}>
                {c.factureFaite
                  ? <><CheckCheck size={11}/> Facture envoyée</>
                  : <><CircleAlert size={11}/> Facture non envoyée</>
                }
              </span>
              {/* Statut paiement */}
              {(() => {
                const total = caAn;
                const paye  = c.montantPaye ?? 0;
                const pct   = total > 0 && paye > 0 ? Math.round(paye / total * 100) : null;
                return (
                  <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    paye > 0 ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {paye > 0
                      ? <><CheckCheck size={11}/> {paye.toLocaleString('fr-FR')} €{pct !== null ? ` (${pct}%)` : ''}</>
                      : <><CircleAlert size={11}/> Non payé</>
                    }
                  </span>
                );
              })()}
            </div>
          )}

          {/* Recommended period */}
          {c.periodePreconiseeDebut && c.periodePreconiseeFin && (
            <div className="text-[10px] text-slate-400 border-t border-slate-50 pt-1 mb-2">
              Préconisée : {format(new Date(c.periodePreconiseeDebut), 'd MMM', { locale: fr })} → {format(new Date(c.periodePreconiseeFin), 'd MMM yyyy', { locale: fr })}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1 pb-4">
            <button
              onClick={onClose}
              className="w-24 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 rounded-xl active:bg-slate-200 transition-colors">
              Fermer
            </button>
            <button
              onClick={onEdit}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl active:bg-blue-700 transition-colors">
              <Pencil size={14}/> Modifier
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
