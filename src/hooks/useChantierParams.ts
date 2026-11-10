import { useEffect, useState, useCallback } from 'react';
import { doc, onSnapshot, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { MachineParams } from '../lib/machineParams';

const COL = 'chantier_params';

export function useChantierParams(chantierId: string | null) {
  const [chantierParams, setChantierParams] = useState<MachineParams | null>(null);
  const [paramsLoaded, setParamsLoaded] = useState(false);

  useEffect(() => {
    if (!chantierId) { setChantierParams(null); setParamsLoaded(false); return; }
    setParamsLoaded(false);
    return onSnapshot(
      doc(db, COL, chantierId),
      snap => {
        if (snap.exists()) {
          const { updatedAt: _, ...rest } = snap.data() as Record<string, unknown>;
          setChantierParams(rest as unknown as MachineParams);
        } else {
          setChantierParams(null);
        }
        setParamsLoaded(true);
      },
      () => { setParamsLoaded(true); },
    );
  }, [chantierId]);

  const saveChantierParams = useCallback(async (p: MachineParams) => {
    if (!chantierId) return;
    await setDoc(doc(db, COL, chantierId), {
      ...p,
      updatedAt: Timestamp.now(),
    }).catch(() => {});
  }, [chantierId]);

  return { chantierParams, paramsLoaded, saveChantierParams };
}
