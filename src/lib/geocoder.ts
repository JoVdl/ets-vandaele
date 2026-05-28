export interface GeoResult {
  lat: number;
  lon: number;
  displayName: string;
  shortName?: string;
}

/** Search Nominatim and return multiple candidates (for autocomplete) */
export async function geocodeSearch(query: string, limit = 6): Promise<GeoResult[]> {
  const q = encodeURIComponent(query);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=${limit}&countrycodes=fr&addressdetails=1`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'fr', 'User-Agent': 'ets-vandaele-app/1.0' },
    });
    if (!res.ok) return [];
    const data: Array<{
      lat: string; lon: string; display_name: string;
      address?: { village?: string; town?: string; city?: string; municipality?: string; county?: string; postcode?: string };
    }> = await res.json();
    return data.map(d => {
      const a = d.address ?? {};
      const locality = a.village ?? a.town ?? a.city ?? a.municipality ?? '';
      const postcode = a.postcode ?? '';
      const county   = a.county ?? '';
      const short = [locality, postcode, county].filter(Boolean).slice(0, 2).join(', ');
      return {
        lat: parseFloat(d.lat),
        lon: parseFloat(d.lon),
        displayName: d.display_name,
        shortName: short || d.display_name.split(',').slice(0, 2).join(',').trim(),
      };
    });
  } catch {
    return [];
  }
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

// ── Location extraction ───────────────────────────────────────────────────────

const VERB_PREFIXES = [
  'Curage aspiration fossés ', 'Curage aspiration fossé ', 'Curage aspiration ',
  'Curage fossés ', 'Curage fossé ', 'Curage ',
  'Broyage bords de berges ', 'Broyage bords de route ', 'Broyage accotements ',
  'Broyage talus ', 'Broyage ',
  'Faucardage ', 'Fauchage ', 'Faucardage / Curage ', 'Faucardage/Curage ',
  'Terrassements ', 'Terrassement ',
  'Défenses de berges ', 'Defenses de berges ', 'Défense de berges ', 'Défense de berge ',
  'Protection de berges ', 'Confortement de berges ', 'Enrochements ', 'Enrochement ',
  'Dragage ', 'Dragages ', 'Reprofilage fossé ', 'Reprofilage ',
  'Création fossés ', 'Création de fossés ', 'Création fossé ', 'Création de fossé ',
  'Création de ', 'Création ',
  'Pose de drains ', 'Pose de buses ', 'Pose de ',
  'Location matériel ', 'Location engins ', 'Location ',
  'Réfection chaussée ', 'Réfections ', 'Réfection ',
  'Entretien ', 'Nettoyage ', 'Travaux ', 'Aménagement ', 'Construction ',
];

// Words that are NOT place/commune names
const NON_PLACE_LOWER = new Set([
  'fossé', 'fossés', 'ruisseau', 'rivière', 'riviere', 'canal', 'chemin',
  'route', 'rue', 'avenue', 'boulevard', 'voie', 'impasse', 'allée',
  'talus', 'berge', 'berges', 'bord', 'bords', 'rive', 'rives',
  'lotissement', 'parking', 'terrain', 'zone', 'zac', 'zae',
  'communal', 'communaux', 'communale', 'municipal', 'municipale',
  'drain', 'drains', 'buse', 'buses', 'dalot', 'dalots',
  'chenal', 'marais', 'étang', 'bassin', 'retenue',
]);

function isLikelyPlaceWord(w: string): boolean {
  if (!w) return false;
  // Must start with uppercase (including accented)
  if (!/^[A-ZÁÀÂÄÉÈÊËÎÏÔÙÛÜÇŒÆ]/u.test(w)) return false;
  // Road/department numbers: D943, RD65, N17, etc.
  if (/\d/.test(w)) return false;
  return !NON_PLACE_LOWER.has(w.toLowerCase());
}

/**
 * Extract multiple location candidates from a chantier name, in priority order.
 * The batch geocoder tries them until one returns a result.
 */
export function extractLocationCandidates(nom: string, lieu?: string): string[] {
  // Explicit lieu field is the best source
  if (lieu?.trim()) return [lieu.trim()];

  const s = nom.trim();
  const candidates: string[] = [];

  // 1. "… à [Commune]" pattern — very common in French ("Curage à Arras")
  const atMatch = s.match(/\bà\s+([A-ZÁÀÂÄÉÈÊËÎÏÔÙÛÜÇŒÆ][^,()–\n]+?)(?:\s*[-–(]|$)/u);
  if (atMatch) {
    const place = atMatch[1].trim().replace(/\s+$/, '');
    if (place.length > 2) candidates.push(place);
  }

  // Strip verb prefix from name
  let stripped = s;
  for (const p of VERB_PREFIXES) {
    if (stripped.toLowerCase().startsWith(p.toLowerCase())) {
      stripped = stripped.slice(p.length).trim();
      break;
    }
  }
  // Remove trailing parenthetical or dash comment
  stripped = stripped.replace(/\s*[-–(].*$/, '').trim();

  // 2. Last run of "place-like" words (capitalized, non-road, non-generic)
  //    Works for names like "Curage fossé communal Hénin-Beaumont" → "Hénin-Beaumont"
  const words = stripped.split(/\s+/);
  let placeStart = words.length;
  for (let i = words.length - 1; i >= 0; i--) {
    if (isLikelyPlaceWord(words[i])) {
      placeStart = i;
    } else {
      break;
    }
  }
  if (placeStart < words.length && placeStart > 0) {
    const placeName = words.slice(placeStart).join(' ');
    if (!candidates.includes(placeName)) candidates.push(placeName);
  }

  // 3. Last single word (catches cases where only commune remains after prefix strip)
  const lastWord = words[words.length - 1];
  if (lastWord && isLikelyPlaceWord(lastWord) && !candidates.some(c => c.endsWith(lastWord))) {
    candidates.push(lastWord);
  }

  // 4. Full stripped string as broader fallback
  if (stripped && !candidates.includes(stripped)) candidates.push(stripped);

  // 5. Original name as last resort
  if (!candidates.includes(s)) candidates.push(s);

  return candidates.filter(c => c.length > 2);
}

/** Best single location candidate (for single-shot geocode or display) */
export function extractLocation(nom: string, lieu?: string): string {
  return extractLocationCandidates(nom, lieu)[0] ?? nom;
}
