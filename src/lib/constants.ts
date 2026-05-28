import type { ChantierType } from '../types';

export interface ChantierTypeMeta {
  label: string;
  color: string;       // hex for inline styles
  bgClass: string;     // tailwind bg class
  borderClass: string;
  textClass: string;
  defaultPersonnes: number;
  hasPelles: boolean;
  pellesOptions?: string[];
  hasDumper: boolean;
  hasTracto: boolean;
  hasBull: boolean;
  hasChenillette: boolean;
  hasBateau: boolean;
  hasDrague: boolean;
  hasTelesco: boolean;
  hasPrepBassin: boolean;
}

export const CHANTIER_TYPES: Record<ChantierType, ChantierTypeMeta> = {
  curage_aspiration: {
    label: 'Curage aspiration',
    color: '#3B82F6',
    bgClass: 'bg-blue-500',
    borderClass: 'border-blue-600',
    textClass: 'text-blue-800',
    defaultPersonnes: 1,
    hasPelles: true,
    pellesOptions: ['8t', '16t'],
    hasDumper: false,
    hasTracto: false,
    hasBull: false,
    hasChenillette: false,
    hasBateau: false,
    hasDrague: true,
    hasTelesco: true,
    hasPrepBassin: true,
  },
  curage_mecanique: {
    label: 'Curage mécanique',
    color: '#F97316',
    bgClass: 'bg-orange-500',
    borderClass: 'border-orange-600',
    textClass: 'text-orange-800',
    defaultPersonnes: 1,
    hasPelles: true,
    pellesOptions: ['1.5t', '3t', '8t', '16t'],
    hasDumper: true,
    hasTracto: true,
    hasBull: true,
    hasChenillette: false,
    hasBateau: false,
    hasDrague: false,
    hasTelesco: false,
    hasPrepBassin: false,
  },
  broyage_chenillette_sans: {
    label: 'Broyage chenillette sans ramassage',
    color: '#22C55E',
    bgClass: 'bg-green-500',
    borderClass: 'border-green-600',
    textClass: 'text-green-800',
    defaultPersonnes: 1,
    hasPelles: false,
    hasDumper: false,
    hasTracto: false,
    hasBull: false,
    hasChenillette: true,
    hasBateau: false,
    hasDrague: false,
    hasTelesco: false,
    hasPrepBassin: false,
  },
  broyage_chenillette_avec: {
    label: 'Broyage chenillette avec ramassage',
    color: '#10B981',
    bgClass: 'bg-emerald-500',
    borderClass: 'border-emerald-600',
    textClass: 'text-emerald-800',
    defaultPersonnes: 1,
    hasPelles: false,
    hasDumper: false,
    hasTracto: false,
    hasBull: false,
    hasChenillette: true,
    hasBateau: false,
    hasDrague: false,
    hasTelesco: false,
    hasPrepBassin: false,
  },
  broyage_forestier: {
    label: 'Broyage forestier',
    color: '#15803D',
    bgClass: 'bg-green-700',
    borderClass: 'border-green-800',
    textClass: 'text-green-900',
    defaultPersonnes: 1,
    hasPelles: true,
    pellesOptions: ['16t'],
    hasDumper: false,
    hasTracto: false,
    hasBull: false,
    hasChenillette: false,
    hasBateau: false,
    hasDrague: false,
    hasTelesco: false,
    hasPrepBassin: false,
  },
  terrassement: {
    label: 'Terrassement',
    color: '#F59E0B',
    bgClass: 'bg-amber-500',
    borderClass: 'border-amber-600',
    textClass: 'text-amber-800',
    defaultPersonnes: 1,
    hasPelles: true,
    pellesOptions: ['1.5t', '3t', '8t', '16t'],
    hasDumper: true,
    hasTracto: true,
    hasBull: true,
    hasChenillette: false,
    hasBateau: false,
    hasDrague: false,
    hasTelesco: false,
    hasPrepBassin: false,
  },
  faucardage: {
    label: 'Faucardage',
    color: '#06B6D4',
    bgClass: 'bg-cyan-500',
    borderClass: 'border-cyan-600',
    textClass: 'text-cyan-800',
    defaultPersonnes: 1,
    hasPelles: false,
    hasDumper: false,
    hasTracto: false,
    hasBull: false,
    hasChenillette: false,
    hasBateau: true,
    hasDrague: false,
    hasTelesco: true,
    hasPrepBassin: false,
  },
  defenses_berges: {
    label: 'Défenses de berges',
    color: '#8B5CF6',
    bgClass: 'bg-violet-500',
    borderClass: 'border-violet-600',
    textClass: 'text-violet-800',
    defaultPersonnes: 1,
    hasPelles: true,
    pellesOptions: ['1.5t', '3t', '8t', '16t'],
    hasDumper: true,
    hasTracto: true,
    hasBull: false,
    hasChenillette: false,
    hasBateau: false,
    hasDrague: false,
    hasTelesco: true,
    hasPrepBassin: false,
  },
};

export const DAY_WIDTH = 40;
export const ROW_HEIGHT = 52;
export const HEADER_HEIGHT = 64;
export const SIDEBAR_WIDTH = 260;

export const MONTH_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
export const DAY_SHORT = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
