// GET /api/word?word=churlish — counts that a reader collected a word: the app asks once for each word it
// collects. Only the word is counted, never who asked; scripts/new-words.py ranks words for the word bank by it.

import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { deviceID, json } from "../lib/http.mts";
import { isLookupWord, normalize } from "../lib/share-page.mts";

/** Words a phone may count in a day. */
const DAILY_COUNTS = 60;

export default async (req: Request) => {
  const id = deviceID(req);
  if (!id) return json({ error: "Missing device ID" }, 400);
  const word = normalize(new URL(req.url).searchParams.get("word") ?? "");
  if (!isLookupWord(word)) return json({ error: "Not a word" }, 400);

  const store = getStore({ name: "word-mark-etymology", consistency: "strong" });
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
  const countKey = `count/${day}/${id}`;
  const count = Number(await store.get(countKey) ?? 0);
  if (count >= DAILY_COUNTS) return json({ error: "Try again tomorrow" }, 429);
  await store.set(countKey, String(count + 1));

  const key = `readers/word/${word}`;
  await store.set(key, String(Number(await store.get(key) ?? 0) + 1));
  return json({ word });
};

export const config: Config = { path: "/api/word" };
