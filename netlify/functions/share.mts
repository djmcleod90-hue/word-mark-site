// GET /w/petrichor and /l?w=petrichor,susurrus — the pages a word or list shared from the app opens.
// Words come from the word bank, or, for a word a reader collected that isn't in it, from what
// Merriam-Webster had when the app looked it up (kept by /api/word; no definition).

import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { isLookupWord } from "../lib/etymology.mts";
import type { WordDetails } from "../lib/word-details.mts";
import { listPage, listWords, normalize, notFoundPage, wordPage, type SharedWord } from "../lib/share-page.mts";

let bank: Promise<Map<string, SharedWord>> | undefined;

/** The site's own wordbank.json, read once per function instance. */
function wordBank(origin: string): Promise<Map<string, SharedWord>> {
  bank ??= fetch(new URL("/wordbank.json", origin))
    .then((r) => r.json() as Promise<{ words: SharedWord[] }>)
    .then(({ words }) => new Map(words.map((w) => [w.word.toLowerCase(), w])))
    .catch((error) => { bank = undefined; throw error; });
  return bank;
}

async function lookUp(word: string, origin: string): Promise<SharedWord | null> {
  const found = (await wordBank(origin)).get(word);
  if (found) return found;
  const kept = await getStore("word-mark-etymology").get(`details-v3/word/${word}`, { type: "json" }) as WordDetails | null;
  if (!kept || !(kept.origin || kept.ipa || kept.partOfSpeech || kept.examples.length)) return null;
  return { word, pos: kept.partOfSpeech, origin: kept.origin, ipa: kept.ipa, examples: kept.examples };
}

const html = (body: string, status = 200) => new Response(body, {
  status,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" },
});

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/w/")) {
    let word = context.params.word ?? "";
    try { word = decodeURIComponent(word); } catch { /* already plain */ }
    word = normalize(word);
    const entry = isLookupWord(word) ? await lookUp(word, url.origin) : null;
    return entry ? html(wordPage(entry, `https://word-mark.ca/w/${encodeURIComponent(word)}`)) : html(notFoundPage(), 404);
  }
  const words = listWords(url.searchParams.get("w"));
  const entries = (await Promise.all(words.map((w) => lookUp(w, url.origin)))).filter((e): e is SharedWord => !!e);
  if (!entries.length) return html(notFoundPage(), 404);
  const link = `https://word-mark.ca/l?w=${entries.map((e) => encodeURIComponent(e.word)).join(",")}`;
  return html(listPage(entries, link));
};

export const config: Config = { path: ["/w/:word", "/l"] };
