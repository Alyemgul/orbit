/**
 * Best-effort country detection from free-text locations such as
 * "Berlin, Germany", "US, CA, Santa Clara" or "Paris". Explicit country names
 * win, then well-known cities, then ISO and US-state codes.
 */

const COUNTRY_NAMES: Record<string, string> = {
  austria: "AT", österreich: "AT", belgium: "BE", bulgaria: "BG", croatia: "HR", cyprus: "CY",
  "czech republic": "CZ", czechia: "CZ", denmark: "DK", estonia: "EE", finland: "FI", france: "FR",
  germany: "DE", deutschland: "DE", greece: "GR", hungary: "HU", magyarország: "HU", ireland: "IE",
  italy: "IT", italia: "IT", latvia: "LV", lithuania: "LT", luxembourg: "LU", malta: "MT",
  netherlands: "NL", "the netherlands": "NL", holland: "NL", poland: "PL", polska: "PL", portugal: "PT",
  romania: "RO", slovakia: "SK", slovenia: "SI", spain: "ES", españa: "ES", sweden: "SE",
  "united kingdom": "GB", uk: "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB",
  switzerland: "CH", schweiz: "CH", norway: "NO", iceland: "IS", serbia: "RS", ukraine: "UA",
  turkey: "TR", türkiye: "TR", israel: "IL", "united arab emirates": "AE", uae: "AE",
  "united states": "US", "united states of america": "US", usa: "US", "u.s.": "US", "u.s.a.": "US",
  canada: "CA", mexico: "MX", brazil: "BR", brasil: "BR", argentina: "AR", chile: "CL", colombia: "CO",
  india: "IN", china: "CN", japan: "JP", "south korea": "KR", korea: "KR", singapore: "SG",
  "hong kong": "HK", taiwan: "TW", australia: "AU", "new zealand": "NZ", "south africa": "ZA",
  egypt: "EG", nigeria: "NG", kenya: "KE", philippines: "PH", indonesia: "ID", vietnam: "VN",
  thailand: "TH", malaysia: "MY", "costa rica": "CR", peru: "PE", uruguay: "UY", "saudi arabia": "SA",
  qatar: "QA", pakistan: "PK", bangladesh: "BD", "sri lanka": "LK",
  // US states spelled out. "Georgia" and "Washington" are left out: both are ambiguous
  // (the country / the city of Washington is covered by "washington, d.c." below).
  alabama: "US", alaska: "US", arizona: "US", arkansas: "US", california: "US", colorado: "US",
  connecticut: "US", delaware: "US", florida: "US", hawaii: "US", idaho: "US", illinois: "US",
  indiana: "US", iowa: "US", kansas: "US", kentucky: "US", louisiana: "US", maine: "US", maryland: "US",
  massachusetts: "US", michigan: "US", minnesota: "US", mississippi: "US", missouri: "US", montana: "US",
  nebraska: "US", nevada: "US", "new hampshire": "US", "new jersey": "US", "new mexico": "US",
  "north carolina": "US", "north dakota": "US", ohio: "US", oklahoma: "US", oregon: "US",
  pennsylvania: "US", "rhode island": "US", "south carolina": "US", "south dakota": "US", tennessee: "US",
  texas: "US", utah: "US", vermont: "US", virginia: "US", "west virginia": "US", wisconsin: "US",
  wyoming: "US", "washington, d.c.": "US", "washington d.c.": "US", "washington state": "US",
};

const CITIES: Record<string, string> = {
  berlin: "DE", munich: "DE", münchen: "DE", hamburg: "DE", frankfurt: "DE", cologne: "DE", köln: "DE",
  stuttgart: "DE", düsseldorf: "DE", dusseldorf: "DE", leipzig: "DE", dresden: "DE", nuremberg: "DE",
  paris: "FR", lyon: "FR", toulouse: "FR", nantes: "FR", bordeaux: "FR", lille: "FR",
  london: "GB", manchester: "GB", edinburgh: "GB", cambridge: "GB", bristol: "GB",
  amsterdam: "NL", rotterdam: "NL", utrecht: "NL", eindhoven: "NL", "the hague": "NL",
  dublin: "IE", cork: "IE", madrid: "ES", barcelona: "ES", valencia: "ES", lisbon: "PT", porto: "PT",
  milan: "IT", milano: "IT", rome: "IT", turin: "IT", vienna: "AT", wien: "AT", graz: "AT",
  zurich: "CH", zürich: "CH", geneva: "CH", basel: "CH", lausanne: "CH", brussels: "BE", antwerp: "BE",
  copenhagen: "DK", stockholm: "SE", gothenburg: "SE", oslo: "NO", helsinki: "FI",
  warsaw: "PL", krakow: "PL", kraków: "PL", wroclaw: "PL", wrocław: "PL", gdansk: "PL", poznan: "PL",
  prague: "CZ", brno: "CZ", budapest: "HU", debrecen: "HU", szeged: "HU", bucharest: "RO", cluj: "RO",
  sofia: "BG", athens: "GR", tallinn: "EE", riga: "LV", vilnius: "LT", belgrade: "RS", zagreb: "HR",
  ljubljana: "SI", bratislava: "SK", luxembourg: "LU", kyiv: "UA", istanbul: "TR", "tel aviv": "IL",
  dubai: "AE", toronto: "CA", vancouver: "CA", montreal: "CA", ottawa: "CA",
  "new york": "US", "san francisco": "US", seattle: "US", austin: "US", boston: "US", chicago: "US",
  "los angeles": "US", denver: "US", atlanta: "US", "santa clara": "US", "mountain view": "US",
  "palo alto": "US", "menlo park": "US", sunnyvale: "US", "san jose": "US", "washington, dc": "US",
  bellevue: "US", redmond: "US", "san diego": "US", portland: "US", "salt lake city": "US", miami: "US",
  bangalore: "IN", bengaluru: "IN", hyderabad: "IN", pune: "IN", mumbai: "IN", "new delhi": "IN",
  tokyo: "JP", seoul: "KR", sydney: "AU", melbourne: "AU", "são paulo": "BR", "sao paulo": "BR",
  "mexico city": "MX", "buenos aires": "AR",
};

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
  "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND",
  "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);

const ISO_CODES = new Set([...Object.values(COUNTRY_NAMES), ...Object.values(CITIES)]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMatcher(dictionary: Record<string, string>): (text: string) => string[] {
  // Longest names first so "united states of america" beats "united states".
  const entries = Object.entries(dictionary).sort(([a], [b]) => b.length - a.length);
  const patterns = entries.map(
    ([name, code]) => [new RegExp(`(^|[^\\p{L}])${escapeRegExp(name)}(?=$|[^\\p{L}])`, "iu"), code] as const,
  );
  return (text) => patterns.filter(([pattern]) => pattern.test(text)).map(([, code]) => code);
}

const matchCountryNames = buildMatcher(COUNTRY_NAMES);
const matchCities = buildMatcher(CITIES);

export function inferCountryCodes(location: string | null | undefined): string[] {
  if (!location) return [];
  const found = new Set<string>([...matchCountryNames(location), ...matchCities(location)]);
  if (found.size > 0) return [...found];

  const tokens = location.split(/[\s,;|/()·–-]+/).filter(Boolean);
  for (const token of tokens) {
    if (token === "US" || token === "USA") found.add("US");
    else if (token === "UK") found.add("GB");
    else if (/^[A-Z]{2}$/.test(token) && US_STATES.has(token) && tokens.length > 1) found.add("US");
    else if (/^[A-Z]{2}$/.test(token) && ISO_CODES.has(token)) found.add(token);
  }
  return [...found];
}
