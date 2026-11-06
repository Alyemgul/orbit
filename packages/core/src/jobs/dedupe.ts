/**
 * Canonical identity of a posting across sources: the same role at the same
 * company in the same place is one job, whether it came from the company's
 * own board or an aggregator. Callers hash this string (SHA-256) for storage.
 */

const COMPANY_SUFFIXES =
  /\b(inc|inc\.|llc|ltd|ltd\.|limited|gmbh|ag|se|sa|sas|s\.a\.|bv|b\.v\.|plc|corp|corporation|co|company|group)\b\.?/g;

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\((m|f|w|d|x|all genders?|gn)([/|,]\s*(m|f|w|d|x|div\.?))*\)/g, "") // (m/w/d), (f/m/x)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeCompanyName(company: string): string {
  return normalize(company.toLowerCase().replace(COMPANY_SUFFIXES, " "));
}

export function canonicalJobKey(company: string, title: string, location: string): string {
  // Only the first location segment: "Berlin, Germany" and "Berlin" are the same posting.
  const primaryLocation = location.split(/[;|/]| or /i)[0] ?? "";
  const city = primaryLocation.split(",")[0] ?? "";
  return [normalizeCompanyName(company), normalize(title), normalize(city)].join("|");
}
