// A word's origin, from Merriam-Webster's Collegiate Dictionary (dictionaryapi.com).
// Shown as Merriam-Webster wrote it, with their markup turned into Markdown italics.

/** Words the app may ask about: letters, with spaces, hyphens and apostrophes inside. */
export const isLookupWord = (word: string) => /^\p{L}[\p{L} '’-]{0,38}\p{L}$/u.test(word);

/** Thrown when Merriam-Webster can't be asked (no key, outage, limit), as opposed to having no origin. */
export class LookupUnavailable extends Error {}

interface MWEntry {
  meta?: { id?: string; stems?: string[] };
  et?: [string, unknown][];
}

/** Turns Merriam-Webster's formatting tokens into plain text with *italics*. */
export function cleanMarkup(text: string): string {
  return text
    .replace(/\{ma\}.*?\{\/ma\}/g, "")                      // "— more at …" cross-references
    .replace(/\{dx_ety\}.*?\{\/dx_ety\}/g, "")              // "see …" cross-references
    .replace(/\{(?:it|qword)\}(.*?)\{\/(?:it|qword)\}/g, "*$1*")
    .replace(/\{(?:et_link|a_link|d_link|i_link|mat|sx|dxt)\|([^|}]*)[^}]*\}/g, "$1")
    .replace(/\{ldquo\}/g, "“").replace(/\{rdquo\}/g, "”")
    .replace(/\{bc\}/g, ": ")
    .replace(/\{\/?[a-z_]+\}/g, "")                          // any other tag, e.g. {sc}, {inf}, {sup}
    .replace(/\s+([,;.])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s;,—-]+$/, "")
    .trim();
}

/** Picks the entry for this word (or a form of it, like "candour" or "defenestrated") and returns its etymology. */
export function originFromEntries(word: string, entries: unknown[]): string {
  const target = word.toLowerCase();
  const found = (entries as MWEntry[]).filter((e) => typeof e === "object" && e?.et);
  const headword = (e: MWEntry) => (e.meta?.id ?? "").split(":")[0].toLowerCase();
  const entry = found.find((e) => headword(e) === target)
    ?? found.find((e) => (e.meta?.stems ?? []).some((s) => s.toLowerCase() === target));
  const text = entry?.et?.filter(([kind]) => kind === "text").map(([, t]) => String(t)).join(" ") ?? "";
  const origin = cleanMarkup(text);
  if (!origin) return "";
  return origin[0].toUpperCase() + origin.slice(1) + (/[.!?]$/.test(origin) ? "" : ".");
}

/** The word's origin, or "" if Merriam-Webster doesn't give one. */
export async function originOf(word: string): Promise<string> {
  const key = process.env.MW_DICTIONARY_KEY;
  if (!key) throw new LookupUnavailable("MW_DICTIONARY_KEY is not set");
  const url = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${encodeURIComponent(key)}`;
  const response = await fetch(url);
  if (!response.ok) throw new LookupUnavailable(`Merriam-Webster replied ${response.status}`);
  const body = await response.json().catch(() => null);
  if (!Array.isArray(body)) throw new LookupUnavailable("Unexpected reply from Merriam-Webster");
  return originFromEntries(word, body);
}
