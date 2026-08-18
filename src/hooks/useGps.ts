import { useState, useEffect, useRef, useCallback } from 'react';
import type { GpsPoint } from '../types/suivi';
import { distanceM } from '../lib/geo';

interface GpsHook {
  points: GpsPoint[];
  currentPos: GpsPoint | null;
  error: string | null;
  accuracy: number | null;
  resetPoints: () => void;
  addPoints: (pts: GpsPoint[]) => void;  // for restoring crash-recovered session
}

export function useGps(active: boolean): GpsHook {
  const [points, setPoints] = useState<GpsPoint[]>([]);
  const [currentPos, setCurrentPos] = useState<GpsPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const watchRef = useRef<number | null>(null);
  const lastRef  = useRef<GpsPoint | null>(null);

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    const pt: GpsPoint = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      ts:  pos.timestamp,
      spd: pos.coords.speed   ?? undefined,
      acc: pos.coords.accuracy ?? undefined,
    };

    setAccuracy(pt.acc ?? null);
    setCurrentPos(pt);
    setError(null);

    if (!active) return;

    // Skip low-accuracy points (> 30 m) unless no previous point
    if (pt.acc && pt.acc > 30 && lastRef.current) return;

    // Skip if barely moved (< 2 m) — avoids stationary noise
    if (lastRef.current && distanceM(lastRef.current.lat, lastRef.current.lng, pt.lat, pt.lng) < 2) return;

    lastRef.current = pt;
    setPoints(prev => [...prev, pt]);
  }, [active]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('GPS non disponible sur cet appareil');
      return;
    }

    // Always watch position (for live indicator even when not in session)
    watchRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => setError(`GPS : ${err.message}`),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 },
    );

    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, [handlePosition]);

  const resetPoints = useCallback(() => {
    setPoints([]);
    lastRef.current = null;
  }, []);

  const addPoints = useCallback((pts: GpsPoint[]) => {
    setPoints(pts);
    if (pts.length) lastRef.current = pts[pts.length - 1];
  }, []);

  return { points, currentPos, error, accuracy, resetPoints, addPoints };
}
