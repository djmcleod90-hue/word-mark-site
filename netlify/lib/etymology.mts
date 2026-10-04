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
    .replace(/\{[a-z_]+\|[^}]*\}/g, "")                      // any other tag with fields, e.g. {ds||1||}
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

/** What Merriam-Webster's entry for a word says about where it comes from. */
export interface Found {
  headword: string;
  /** The etymology as written, cleaned up; "" if the entry gives none. */
  etymology: string;
  /** When the word is first known in English, e.g. "1843" or "14th century"; "" if not given. */
  firstUse: string;
}

interface MWEntryFull extends MWEntry {
  hwi?: { hw?: string };
  date?: string;
}

/** Picks the entry for this word (or a form of it, like "candour" or "defenestrated"). */
export function findEntry(word: string, entries: unknown[]): Found | null {
  const target = word.toLowerCase();
  const all = (entries as MWEntryFull[]).filter((e) => typeof e === "object" && e?.meta);
  const headword = (e: MWEntryFull) => (e.meta?.id ?? "").split(":")[0];
  const isWord = (e: MWEntryFull) => headword(e).toLowerCase() === target;
  const isForm = (e: MWEntryFull) => (e.meta?.stems ?? []).some((s) => s.toLowerCase() === target);
  // Prefer an entry with an etymology; otherwise take the word's own entry for its date.
  const entry = all.find((e) => isWord(e) && e.et) ?? all.find((e) => isForm(e) && e.et) ?? all.find(isWord);
  if (!entry) return null;
  const text = entry.et?.filter(([kind]) => kind === "text").map(([, t]) => String(t)).join(" ") ?? "";
  return {
    headword: headword(entry),
    etymology: canadianSpelling(cleanMarkup(text)),
    firstUse: cleanMarkup(String(entry.date ?? "")).replace(/,? sense \d.*$/, ""),
  };
}

/** "French" alone means the word came unchanged from French; say so. */
const LANGUAGE_ONLY = /^(?:(?:Middle|Old|Late|Early|New|Medieval|Modern|Ancient|Vulgar|Classical|Old North)\s)*[A-Z][a-z]+(?:-[A-Z][a-z]+)?$/;

const sentence = (text: string) => text[0].toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? "" : ".");

/** The note shown in the app: the etymology, then when the word is first known in English. */
export function composeOrigin(found: Found, base?: { found: Found; suffix: string }): string {
  let origin = "";
  if (found.etymology) {
    origin = LANGUAGE_ONLY.test(found.etymology)
      ? `From ${found.etymology} *${found.headword}*.`
      : sentence(found.etymology);
  } else if (base?.found.etymology) {
    const parts = base.suffix ? `*${base.found.headword}* + *${base.suffix}*` : `*${base.found.headword}*`;
    const baseOrigin = LANGUAGE_ONLY.test(base.found.etymology)
      ? `From ${base.found.etymology} *${base.found.headword}*.`
      : sentence(base.found.etymology);
    // "From *pedant* + *-ic*. *Pedant*: Italian *pedante*."
    origin = `From ${parts}. *${base.found.headword[0].toUpperCase() + base.found.headword.slice(1)}*: ${baseOrigin}`;
  }
  if (!origin) return "";
  return found.firstUse ? `${origin} First known use: ${found.firstUse}.` : origin;
}

/** Words formed in English from another word: the word to look up instead, and the ending added. */
export function baseWords(word: string): { base: string; suffix: string }[] {
  const rules: [RegExp, string, string][] = [
    [/atic$/, "a", "-tic"], [/ic$/, "", "-ic"],
    [/(.)\1ish$/, "$1", "-ish"], [/ish$/, "", "-ish"],
    [/cious$/, "cy", "-ous"], [/tous$/, "ty", "-ous"], [/ious$/, "y", "-ous"], [/ious$/, "io", "-ous"], [/ous$/, "", "-ous"],
    [/iance$/, "y", "-ance"], [/ance$/, "", "-ance"], [/ance$/, "ant", ""], [/ence$/, "ent", ""],
    [/ation$/, "ate", "-ion"], [/able$/, "ate", "-able"],
    [/ine$/, "", "-ine"], [/ial$/, "y", "-al"], [/al$/, "", "-al"], [/ian$/, "", "-ian"], [/ean$/, "eus", "-an"],
    [/ry$/, "", "-ry"], [/y$/, "", "-y"], [/ed$/, "", "-ed"], [/ing$/, "", "-ing"],
  ];
  const seen = new Set<string>();
  return rules
    .filter(([pattern]) => pattern.test(word))
    .map(([pattern, replacement, suffix]) => ({ base: word.replace(pattern, replacement), suffix }))
    .filter(({ base }) => base.length >= 3 && !seen.has(base) && !!seen.add(base));
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

/** The word's origin, or "" if Merriam-Webster doesn't give one (under this spelling, its American one,
 * or, for a word formed in English like "pedantic", the word it was formed from). */
export async function originOf(word: string): Promise<string> {
  let found: Found | null = null;
  for (const spelling of [word, ...americanSpellings(word)]) {
    const entry = await lookUp(spelling);
    if (entry?.etymology) return composeOrigin(entry);
    found ??= entry; // e.g. "candour" has its own entry, without an etymology: keep trying "candor"
  }
  // At most three more lookups for the word it was formed from.
  for (const { base, suffix } of baseWords(word.toLowerCase()).slice(0, 3)) {
    const baseFound = await lookUp(base);
    if (baseFound?.etymology && baseFound.headword.toLowerCase() === base) {
      return composeOrigin(found ?? { headword: word, etymology: "", firstUse: "" }, { found: baseFound, suffix });
    }
  }
  return "";
}

async function lookUp(word: string): Promise<Found | null> {
  const key = process.env.MW_DICTIONARY_KEY;
  if (!key) throw new LookupUnavailable("MW_DICTIONARY_KEY is not set");
  const url = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${encodeURIComponent(key)}`;
  const response = await fetch(url);
  if (!response.ok) throw new LookupUnavailable(`Merriam-Webster replied ${response.status}`);
  const body = await response.json().catch(() => null);
  if (!Array.isArray(body)) throw new LookupUnavailable("Unexpected reply from Merriam-Webster");
  return findEntry(word, body);
}
