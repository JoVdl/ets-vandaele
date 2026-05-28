export interface GeoResult {
  lat: number;
  lon: number;
  displayName: string;
}

/** Geocode a location string via Nominatim (OpenStreetMap, free, no key) */
export async function geocode(query: string): Promise<GeoResult | null> {
  const q = encodeURIComponent(`${query}, France`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=fr`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'fr', 'User-Agent': 'ets-vandaele-app/1.0' },
    });
    if (!res.ok) return null;
    const data: Array<{ lat: string; lon: string; display_name: string }> = await res.json();
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), displayName: data[0].display_name };
  } catch {
    return null;
  }
}

/** Extract a plausible location string from a chantier name or lieu */
export function extractLocation(nom: string, lieu?: string): string {
  if (lieu && lieu.trim()) return lieu.trim();
  // Strip common prefixes and return the rest as location hint
  const prefixes = [
    'Curage ', 'Curage aspiration ', 'Broyage ', 'Terrassement ', 'Faucardage ',
    'Défenses de berges ', 'Defenses de berges ', 'Location ',
  ];
  let s = nom.trim();
  for (const p of prefixes) {
    if (s.toLowerCase().startsWith(p.toLowerCase())) {
      s = s.slice(p.length).trim();
      break;
    }
  }
  // Remove trailing parenthetical or extra words
  s = s.replace(/\s*[-–(].*$/, '').trim();
  return s;
}
