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

/** American spellings Merriam-Webster uses, and their Canadian forms. Word-Mark writes in Canadian English. */
const CANADIAN: [RegExp, string][] = [
  ...["color", "honor", "favor", "labor", "behavior", "humor", "odor", "vapor", "rumor", "neighbor", "harbor", "flavor", "savor", "valor", "vigor", "rancor", "candor", "clamor", "ardor", "fervor", "splendor", "armor", "parlor"]
    .map((us): [RegExp, string] => [new RegExp(`\\b(${us.slice(0, -2)})or(s|ed|ing|ful|able|ably|less|ite|ites)?\\b`, "gi"), "$1our$2"]),
  ...["center", "theater", "fiber", "somber", "specter", "caliber", "luster", "saber", "scepter", "meager", "liter"]
    .map((us): [RegExp, string] => [new RegExp(`\\b(${us.slice(0, -2)})er(s|ed)?\\b`, "gi"), "$1re$2"]),
  [/\b(gr)ay(s|ed|ish)?\b/gi, "$1ey$2"],
  [/\b(def|off)ense(s)?\b/gi, "$1ence$2"],
  [/\b(travel|label|model|cancel|marvel|quarrel|revel|shovel|tunnel|signal|counsel|fuel|duel|level)(ed|ing|er|ers)\b/gi, "$1l$2"],
  [/\bjewelry\b/gi, "jewellery"],
  [/\bskeptic/gi, "sceptic"],
];

/** Converts to Canadian spelling, leaving foreign words (in *italics*) as they are. */
export function canadianSpelling(text: string): string {
  return text.split(/(\*[^*]*\*)/).map((part) =>
    part.startsWith("*") ? part : CANADIAN.reduce((t, [pattern, replacement]) => t.replace(pattern, replacement), part),
  ).join("");
}

/** Picks the entry for this word (or a form of it, like "candour" or "defenestrated") and returns its etymology. */
export function originFromEntries(word: string, entries: unknown[]): string {
  const target = word.toLowerCase();
  const found = (entries as MWEntry[]).filter((e) => typeof e === "object" && e?.et);
  const headword = (e: MWEntry) => (e.meta?.id ?? "").split(":")[0].toLowerCase();
  const entry = found.find((e) => headword(e) === target)
    ?? found.find((e) => (e.meta?.stems ?? []).some((s) => s.toLowerCase() === target));
  const text = entry?.et?.filter(([kind]) => kind === "text").map(([, t]) => String(t)).join(" ") ?? "";
  const origin = canadianSpelling(cleanMarkup(text));
  if (!origin) return "";
  return origin[0].toUpperCase() + origin.slice(1) + (/[.!?]$/.test(origin) ? "" : ".");
}

/** American spellings to try when Merriam-Webster doesn't know a Canadian one, e.g. "candour" → "candor". */
export function americanSpellings(word: string): string[] {
  const rules: [RegExp, string][] = [
    [/our(s|ed|ing|ful|able|ably|less|ite|ites)?$/, "or$1"],
    [/([^aeiou])re(s|d)?$/, "$1er$2"],
    [/(def|off|pret)ence(s)?$/, "$1ense$2"],
    [/([aeiou])ll(ed|ing|er|ers)$/, "$1l$2"],
    [/^grey/, "gray"],
    [/ogue$/, "og"],
    [/^sceptic/, "skeptic"],
  ];
  const variants = rules.map(([pattern, replacement]) => word.replace(pattern, replacement));
  return [...new Set(variants)].filter((v) => v !== word);
}

/** The word's origin, or "" if Merriam-Webster doesn't give one, under this spelling or its American one. */
export async function originOf(word: string): Promise<string> {
  for (const spelling of [word, ...americanSpellings(word)]) {
    const origin = await lookUp(spelling);
    if (origin) return origin;
  }
  return "";
}

async function lookUp(word: string): Promise<string> {
  const key = process.env.MW_DICTIONARY_KEY;
  if (!key) throw new LookupUnavailable("MW_DICTIONARY_KEY is not set");
  const url = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${encodeURIComponent(key)}`;
  const response = await fetch(url);
  if (!response.ok) throw new LookupUnavailable(`Merriam-Webster replied ${response.status}`);
  const body = await response.json().catch(() => null);
  if (!Array.isArray(body)) throw new LookupUnavailable("Unexpected reply from Merriam-Webster");
  return originFromEntries(word, body);
}
