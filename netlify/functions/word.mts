// GET /api/word?word=churlish — what the app's word page shows from Merriam-Webster:
// pronunciation (IPA), part of speech, examples and etymology.
// Each word is looked up once and kept, so later requests for it cost nothing.

import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { isLookupWord, LookupUnavailable } from "../lib/etymology.mts";
import { detailsOf, type WordDetails } from "../lib/word-details.mts";
import { deviceID, json } from "../lib/http.mts";

/** New lookups (not already kept) a phone may make in a day, shared with /api/etymology. */
const DAILY_LOOKUPS = 60;

export default async (req: Request) => {
  const id = deviceID(req);
  if (!id) return json({ error: "Missing device ID" }, 400);
  const word = (new URL(req.url).searchParams.get("word") ?? "").trim().toLowerCase().replace(/’/g, "'");
  if (!isLookupWord(word)) return json({ error: "Not a word" }, 400);

  const store = getStore({ name: "word-mark-etymology", consistency: "strong" });
  // Found words are kept for good; "not found" is rechecked after a month, in case the lookup improves.
  const kept = await store.get(`details-v1/word/${word}`, { type: "json" }) as (WordDetails & { at: string }) | null;
  const found = (d: WordDetails) => !!(d.origin || d.ipa || d.partOfSpeech || d.examples.length);
  if (kept && (found(kept) || Date.now() - Date.parse(kept.at) < 30 * 86_400_000)) return json(reply(word, kept));

  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
  const countKey = `count/${day}/${id}`;
  const count = Number(await store.get(countKey) ?? 0);
  if (count >= DAILY_LOOKUPS) return json({ error: "Try again tomorrow" }, 429);
  await store.set(countKey, String(count + 1));

  try {
    const details = await detailsOf(word);
    await store.setJSON(`details-v1/word/${word}`, { ...details, at: new Date().toISOString() });
    return json(reply(word, details));
  } catch (error) {
    if (!(error instanceof LookupUnavailable)) console.error(error);
    return json({ error: "Lookup failed" }, 502);
  }
};

const reply = (word: string, d: WordDetails) => ({
  word,
  origin: d.origin || null,
  ipa: d.ipa || null,
  partOfSpeech: d.partOfSpeech || null,
  examples: d.examples,
});

export const config: Config = { path: "/api/word" };
