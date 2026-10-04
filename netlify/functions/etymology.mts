// GET /api/etymology?word=lugubrious — where a word comes from, from Merriam-Webster.
// Each word is looked up once and kept, so later requests for it cost nothing.

import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { isLookupWord, LookupUnavailable, originOf } from "../lib/etymology.mts";
import { deviceID, json } from "../lib/http.mts";

/** New lookups (not already kept) a phone may make in a day. */
const DAILY_LOOKUPS = 60;

export default async (req: Request) => {
  const id = deviceID(req);
  if (!id) return json({ error: "Missing device ID" }, 400);
  const word = (new URL(req.url).searchParams.get("word") ?? "").trim().toLowerCase().replace(/’/g, "'");
  if (!isLookupWord(word)) return json({ error: "Not a word" }, 400);

  const store = getStore({ name: "word-mark-etymology", consistency: "strong" });
  // Found origins are kept for good; "none found" is rechecked after a month, in case the lookup improves.
  const kept = await store.get(`v2/word/${word}`, { type: "json" }) as { origin: string; at: string } | null;
  const isFresh = kept && (kept.origin || Date.now() - Date.parse(kept.at) < 30 * 86_400_000);
  if (kept && isFresh) return json({ word, origin: kept.origin || null });

  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
  const countKey = `count/${day}/${id}`;
  const count = Number(await store.get(countKey) ?? 0);
  if (count >= DAILY_LOOKUPS) return json({ error: "Try again tomorrow" }, 429);
  await store.set(countKey, String(count + 1));

  try {
    const origin = await originOf(word);
    await store.setJSON(`v2/word/${word}`, { origin, at: new Date().toISOString() });
    return json({ word, origin: origin || null });
  } catch (error) {
    if (!(error instanceof LookupUnavailable)) console.error(error);
    return json({ error: "Lookup failed" }, 502);
  }
};

export const config: Config = { path: "/api/etymology" };
