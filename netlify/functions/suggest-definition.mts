// POST /api/suggest-definition — a reader suggests a change to a definition, for Word-Mark to review.
// Each one is kept, without the phone's ID, then emailed through Netlify Forms.

import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { cleanSuggestion, formBody } from "../lib/suggestion.mts";
import { attestedJSON, deviceID, json } from "../lib/http.mts";

/** Suggestions a phone may send in a day. */
const DAILY_SUGGESTIONS = 10;

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const id = deviceID(req);
  if (!id) return json({ error: "Missing device ID" }, 400);
  const attested = await attestedJSON(req, id, "suggest-definition");
  if ("response" in attested) return attested.response;
  const suggestion = cleanSuggestion(attested.body);
  if (!suggestion) return json({ error: "Expected a word, its definition, and a reason" }, 400);

  const store = getStore({ name: "word-mark-suggestions", consistency: "strong" });
  const now = new Date();
  const day = now.toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
  const countKey = `count/${day}/${id}`;
  const count = Number(await store.get(countKey) ?? 0);
  if (count >= DAILY_SUGGESTIONS) return json({ error: "daily-limit" }, 429);
  await store.set(countKey, String(count + 1));

  await store.setJSON(`suggestions/${day}/${crypto.randomUUID()}`, { ...suggestion, at: now.toISOString() });

  // It's kept either way, so a failed email is logged rather than shown to the reader.
  try {
    const sent = await fetch(new URL("/contact.html", process.env.URL ?? req.url), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody(suggestion),
    });
    if (!sent.ok) console.error("suggest-definition email failed", sent.status);
  } catch (error) {
    console.error("suggest-definition email failed", error);
  }
  return json({ ok: true });
};

export const config: Config = { path: "/api/suggest-definition" };
