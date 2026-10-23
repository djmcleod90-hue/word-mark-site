// POST /api/check-sentence — has the reader used their word correctly in a sentence?

import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { checkSentence, cleanRequest } from "../lib/sentence.mts";
import { attestedJSON, deviceID, json } from "../lib/http.mts";

/** Checks a phone may ask for in a day. */
const DAILY_CHECKS = 20;
/** Of those, appeals (which use the costliest model) a phone may make in a day. */
const DAILY_APPEALS = 5;

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const id = deviceID(req);
  if (!id) return json({ error: "Missing device ID" }, 400);
  const attested = await attestedJSON(req, id, "check-sentence");
  if ("response" in attested) return attested.response;
  const request = cleanRequest(attested.body);
  if (!request) return json({ error: "Expected a word and a sentence" }, 400);

  const store = getStore({ name: "word-mark-sentences", consistency: "strong" });
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
  const countKey = `count/${day}/${id}`;
  const count = Number(await store.get(countKey) ?? 0);
  if (count >= DAILY_CHECKS) return json({ error: "daily-limit" }, 429);
  if (request.appealOf !== undefined) {
    const appealKey = `appeals/${day}/${id}`;
    const appeals = Number(await store.get(appealKey) ?? 0);
    if (appeals >= DAILY_APPEALS) return json({ error: "appeal-limit" }, 429);
    await store.set(appealKey, String(appeals + 1));
  }
  await store.set(countKey, String(count + 1));

  try {
    const verdict = await checkSentence(request);
    return json({ ...verdict, left: DAILY_CHECKS - count - 1 });
  } catch (error) {
    console.error("check-sentence failed", error);
    return json({ error: "check-failed" }, 502);
  }
};

export const config: Config = { path: "/api/check-sentence" };
