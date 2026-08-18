import { useState, useEffect } from 'react';
import PlanDeCharge from './components/PlanDeCharge';
import PinGate from './components/Suivi/PinGate';
import SuiviView from './components/Suivi/SuiviView';
import { loadSession } from './lib/suiviConfig';
import type { PinRole } from './types/suivi';

export default function App() {
  const [isSuivi, setIsSuivi] = useState(location.hash === '#suivi');
  const [role, setRole] = useState<PinRole | null>(loadSession);

  useEffect(() => {
    const handler = () => setIsSuivi(location.hash === '#suivi');
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  if (isSuivi) {
    if (!role) return <PinGate onUnlock={setRole} />;
    return <SuiviView role={role} onLogout={() => setRole(null)} />;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <PlanDeCharge />
    </div>
  );
}
