// POST /api/check-sentence — has the reader used their word correctly in a sentence?

import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { checkSentence, cleanRequest } from "../lib/sentence.mts";
import { deviceID, json } from "../lib/http.mts";

/** Checks a phone may ask for in a day. */
const DAILY_CHECKS = 20;

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const id = deviceID(req);
  if (!id) return json({ error: "Missing device ID" }, 400);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Expected JSON" }, 400); }
  const request = cleanRequest(body);
  if (!request) return json({ error: "Expected a word and a sentence" }, 400);

  const store = getStore({ name: "word-mark-sentences", consistency: "strong" });
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
  const countKey = `count/${day}/${id}`;
  const count = Number(await store.get(countKey) ?? 0);
  if (count >= DAILY_CHECKS) return json({ error: "daily-limit" }, 429);
  await store.set(countKey, String(count + 1));

  try {
    const verdict = await checkSentence(request.word, request.definition, request.sentence);
    return json({ ...verdict, left: DAILY_CHECKS - count - 1 });
  } catch (error) {
    console.error("check-sentence failed", error);
    return json({ error: "check-failed" }, 502);
  }
};

export const config: Config = { path: "/api/check-sentence" };
