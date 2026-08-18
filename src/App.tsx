import { useState, useEffect } from 'react';
import Home from './components/Home';
import PlanDeCharge from './components/PlanDeCharge';
import PlanningPinGate from './components/PlanningPinGate';
import PinGate from './components/Suivi/PinGate';
import SuiviView from './components/Suivi/SuiviView';
import { loadSession, loadPlanningSession } from './lib/suiviConfig';
import type { PinRole } from './types/suivi';

type Tool = 'home' | 'planning' | 'suivi';

function getToolFromHash(): Tool {
  const h = location.hash;
  if (h === '#planning') return 'planning';
  if (h === '#suivi')    return 'suivi';
  return 'home';
}

export default function App() {
  const [tool, setTool]           = useState<Tool>(getToolFromHash);
  const [planningOk, setPlanningOk] = useState(loadPlanningSession);
  const [suiviRole, setSuiviRole] = useState<PinRole | null>(loadSession);

  useEffect(() => {
    const handler = () => setTool(getToolFromHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  if (tool === 'planning') {
    if (!planningOk) return <PlanningPinGate onUnlock={() => setPlanningOk(true)} />;
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <PlanDeCharge />
      </div>
    );
  }

  if (tool === 'suivi') {
    if (!suiviRole) return <PinGate onUnlock={setSuiviRole} />;
    return <SuiviView role={suiviRole} onLogout={() => setSuiviRole(null)} />;
  }

  return <Home />;
}
