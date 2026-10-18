// Everything the app's word page shows from Merriam-Webster's Collegiate Dictionary, from one lookup:
// how the word is said (turned into IPA), its part of speech, example sentences and its origin.

import { americanSpellings, canadianSpelling, cleanMarkup, fetchEntries, originOf, type EntriesFor } from "./etymology.mts";

export interface WordDetails {
  /** The etymology note, as /api/etymology gives it; "" if none. */
  origin: string;
  /** The pronunciation in IPA, e.g. "ˈtʃərlɪʃ"; "" if Merriam-Webster gives none for this word. */
  ipa: string;
  /** Merriam-Webster's recording of the word (an MP3 address); "" if they have none. */
  audio: string;
  /** e.g. "adjective", "noun", "transitive verb"; "" if unknown. */
  partOfSpeech: string;
  /** Up to two, with the word in **bold**, e.g. "A **churlish** refusal". */
  examples: string[];
}

/** Merriam-Webster's pronunciation symbols, longest first where one starts another. */
const MW_TO_IPA: [string, string][] = [
  ["t͟h", "ð"], ["au̇", "aʊ"], ["yu̇", "jʊ"], ["yü", "ju"], ["ȯi", "ɔɪ"],
  ["th", "θ"], ["sh", "ʃ"], ["ch", "tʃ"], ["zh", "ʒ"], ["hw", "hw"], ["au", "aʊ"], ["ue", "y"], ["u̇", "ʊ"],
  ["ā", "eɪ"], ["ä", "ɑ"], ["ȧ", "a"], ["a", "æ"], ["ē", "i"], ["e", "ɛ"], ["ī", "aɪ"], ["i", "ɪ"],
  ["ō", "oʊ"], ["ȯ", "ɔ"], ["ü", "u"], ["ᵊ", "ə"], ["j", "dʒ"], ["y", "j"], ["ḵ", "x"], ["ᵫ", "ʏ"], ["ⁿ", ""],
];

/** Turns Merriam-Webster's respelling ("ˈchər-lish") into IPA ("ˈtʃərlɪʃ"). Only the first way of saying it is kept. */
export function mwToIPA(mw: string): string {
  const first = mw.normalize("NFC").split(/[,;]/)[0]
    .replace(/\([^)]*\)/g, "")   // optional sounds, e.g. "(ˌ)" or "(ə)"
    .replace(/[-\s‧]/g, "")
    .trim();
  if (!first) return "";
  let ipa = "";
  for (let i = 0; i < first.length;) {
    const match = MW_TO_IPA.find(([symbol]) => first.startsWith(symbol, i));
    if (match) { ipa += match[1]; i += match[0].length; } else { ipa += first[i]; i += 1; }
  }
  return ipa;
}

interface Pronunciation { mw?: string; sound?: { audio?: string } }

/** The address of a Merriam-Webster recording, from its file name (their documented folder rule). */
export function audioURL(file: string): string {
  if (!/^[\w-]+$/.test(file)) return "";
  const folder = file.startsWith("bix") ? "bix" : file.startsWith("gg") ? "gg" : /^[a-z]/i.test(file) ? file[0].toLowerCase() : "number";
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${folder}/${file}.mp3`;
}
interface MWEntry {
  meta?: { id?: string; stems?: string[] };
  hwi?: { prs?: Pronunciation[] };
  fl?: string;
  def?: unknown;
  vrs?: { va?: string; prs?: Pronunciation[] }[];
  uros?: { ure?: string; fl?: string; prs?: Pronunciation[]; utxt?: unknown }[];
}

/** "churl*ish" → "churlish": Merriam-Webster marks syllables with asterisks. */
const plain = (text = "") => text.replace(/\*/g, "").toLowerCase();

/** Every example sentence ("vis") inside part of an entry, in order. */
function examplesIn(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    if (node[0] === "vis" && Array.isArray(node[1])) {
      for (const vis of node[1] as { t?: string; aq?: { auth?: string } }[]) {
        if (!vis?.t) continue;
        const text = cleanMarkup(vis.t.replace(/\{(wi|it|phrase)\}(.*?)\{\/\1\}/g, "\u0001$2\u0002"))
          .replace(/\u0001/g, "**").replace(/\u0002/g, "**");
        const author = vis.aq?.auth ? cleanMarkup(vis.aq.auth) : "";
        found.push(author ? `${text} — ${author}` : text);
      }
    } else {
      for (const child of node) examplesIn(child, found);
    }
  } else if (node && typeof node === "object") {
    for (const child of Object.values(node)) examplesIn(child, found);
  }
  return found;
}

/** Two examples, preferring whole sentences to short phrases; capitalised and in Canadian spelling. */
function pickExamples(all: string[]): string[] {
  const usable = [...new Set(all)].filter((e) => e.length <= 220);
  const words = (e: string) => e.split(/\s+/).length;
  const chosen = [...usable.filter((e) => words(e) >= 5), ...usable.filter((e) => words(e) < 5)].slice(0, 2);
  return chosen.map((e) => canadianSpelling(e).replace(/^([“"(*]*)(\p{Ll})/u, (_, lead, letter) => lead + letter.toUpperCase()));
}

/** The pronunciation, part of speech and examples for this exact spelling, or null if no entry is for it. */
export function entryDetails(word: string, entries: unknown[]): Omit<WordDetails, "origin"> | null {
  const target = word.toLowerCase();
  const all = (entries as MWEntry[]).filter((e) => typeof e === "object" && e?.meta);
  const headword = (e: MWEntry) => (e.meta?.id ?? "").split(":")[0].toLowerCase();
  const ipaOf = (prs?: Pronunciation[]) => mwToIPA(prs?.find((p) => p.mw)?.mw ?? "");
  const audioOf = (prs?: Pronunciation[]) => audioURL(prs?.find((p) => p.sound?.audio)?.sound?.audio ?? "");

  const own = all.find((e) => headword(e) === target);
  if (own) {
    return { ipa: ipaOf(own.hwi?.prs), audio: audioOf(own.hwi?.prs), partOfSpeech: own.fl ?? "", examples: pickExamples(examplesIn(own.def)) };
  }
  for (const entry of all) {
    // A spelling variant ("candour" under "candor") is said like the headword unless it has its own pronunciation.
    const variant = entry.vrs?.find((v) => plain(v.va) === target);
    if (variant) {
      const prs = variant.prs ?? entry.hwi?.prs;
      return { ipa: ipaOf(prs), audio: audioOf(prs), partOfSpeech: entry.fl ?? "", examples: pickExamples(examplesIn(entry.def)) };
    }
    // A word run on at the end of another's entry ("churlishly" under "churlish").
    const runOn = entry.uros?.find((u) => plain(u.ure) === target);
    if (runOn) {
      return { ipa: ipaOf(runOn.prs), audio: audioOf(runOn.prs), partOfSpeech: runOn.fl ?? "", examples: pickExamples(examplesIn(runOn.utxt)) };
    }
  }
  // An inflected form ("defenestrated"): the base word's part of speech and examples, but not its pronunciation.
  // Prefer the entry it's built on ("defenestrate") to others listing it ("defenestration").
  const forms = all.filter((e) => (e.meta?.stems ?? []).some((s) => s.toLowerCase() === target));
  const form = forms.find((e) => target.startsWith(headword(e))) ?? forms[0];
  if (form) return { ipa: "", audio: "", partOfSpeech: form.fl ?? "", examples: pickExamples(examplesIn(form.def)) };
  return null;
}

/** Looks the word up (under its Canadian and American spellings), sharing each fetch between the parts. */
export async function detailsOf(word: string, fetch: EntriesFor = fetchEntries): Promise<WordDetails> {
  const fetched = new Map<string, Promise<unknown[]>>();
  const entriesFor: EntriesFor = (spelling) => {
    if (!fetched.has(spelling)) fetched.set(spelling, fetch(spelling));
    return fetched.get(spelling)!;
  };
  const origin = await originOf(word, entriesFor);
  // A Canadian spelling's own entry may only point to the American one ("candour" → "candor"): fill its gaps from there.
  const result: WordDetails = { origin, ipa: "", audio: "", partOfSpeech: "", examples: [] };
  for (const spelling of [word, ...americanSpellings(word)]) {
    const details = entryDetails(spelling, await entriesFor(spelling));
    if (!details) continue;
    if (!result.ipa) { result.ipa = details.ipa; result.audio = details.audio; }
    result.partOfSpeech ||= details.partOfSpeech;
    if (!result.examples.length) result.examples = details.examples;
    if (result.ipa && result.partOfSpeech && result.examples.length) break;
  }
  return result;
}
