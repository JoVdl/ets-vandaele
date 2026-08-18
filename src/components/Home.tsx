import { CalendarDays, Tractor, ChevronRight } from 'lucide-react';

const tools = [
  {
    id: 'planning',
    href: '#planning',
    icon: CalendarDays,
    label: 'Plan de Charge',
    description: 'Planification et gestion des chantiers',
    accent: 'bg-blue-600',
    hover: 'hover:ring-blue-500/30',
  },
  {
    id: 'suivi',
    href: '#suivi',
    icon: Tractor,
    label: 'Suivi Chantier',
    description: 'GPS, surface et rendement en temps réel',
    accent: 'bg-green-600',
    hover: 'hover:ring-green-500/30',
  },
] as const;

export default function Home() {
  return (
    <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center gap-10 px-6">

      {/* Branding */}
      <div className="text-center">
        <div className="w-20 h-20 rounded-3xl bg-green-600 flex items-center justify-center shadow-xl mx-auto mb-4">
          <Tractor size={36} className="text-white" />
        </div>
        <h1 className="text-white text-3xl font-bold tracking-tight">ETS Vandaele</h1>
        <p className="text-slate-400 text-sm mt-1.5">Sélectionnez un outil</p>
      </div>

      {/* Tool tiles */}
      <div className="w-full max-w-sm flex flex-col gap-3">
        {tools.map(({ id, href, icon: Icon, label, description, accent, hover }) => (
          <a
            key={id}
            href={href}
            className={`flex items-center gap-4 p-4 bg-slate-800 border border-slate-700 rounded-2xl
              active:scale-[.98] transition-all duration-150 hover:border-slate-600 ring-0 hover:ring-4 ${hover}`}
          >
            <div className={`w-12 h-12 rounded-xl ${accent} flex items-center justify-center flex-shrink-0 shadow-md`}>
              <Icon size={22} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-base leading-tight">{label}</p>
              <p className="text-slate-400 text-sm mt-0.5">{description}</p>
            </div>
            <ChevronRight size={18} className="text-slate-500 flex-shrink-0" />
          </a>
        ))}
      </div>

      <p className="text-slate-600 text-xs absolute bottom-6">
        {new Date().getFullYear()} · ETS Vandaele
      </p>
    </div>
  );
}
