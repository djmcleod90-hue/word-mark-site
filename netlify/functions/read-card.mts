// POST /api/read-card — the AI reading of one side of a bookmark, within the phone's allowance.

import type { Config } from "@netlify/functions";
import { checkScan, spendScan } from "../lib/allowance.mts";
import { blobStore, deviceID, json } from "../lib/http.mts";
import { transcribe, type Entry } from "../lib/transcribe.mts";

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const id = deviceID(req);
  if (!id) return json({ error: "Missing device ID" }, 400);

  let body: { image?: unknown; draft?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Expected JSON" }, 400); }
  const image = typeof body.image === "string" ? body.image : "";
  // A JPEG in base64 starts with "/9j/"; ~4 MB of base64 is far more than a card photo needs.
  if (!image.startsWith("/9j/") || image.length > 4_000_000) return json({ error: "Expected a JPEG photo of the card" }, 400);
  const draft: Entry[] = Array.isArray(body.draft)
    ? body.draft.map((e: any) => ({ word: String(e?.word ?? ""), definition: String(e?.definition ?? "") }))
    : [];

  const store = blobStore();
  const now = new Date();
  const { check, allowance } = await checkScan(store, id, now);
  if (check === "daily-limit") return json({ error: "daily-limit", allowance }, 429);
  if (check === "none-left") return json({ error: "none-left", allowance }, 402);

  try {
    const reading = await transcribe(image, draft);
    // Only a successful reading uses up a scan.
    const after = await spendScan(store, id, now);
    console.log(`read-card ok model=${reading.model} entries=${reading.entries.length} cost=${reading.costCents.toFixed(2)}c`);
    return json({ entries: reading.entries, allowance: after });
  } catch (error) {
    console.error("read-card failed", error);
    return json({ error: "reading-failed", allowance }, 502);
  }
};

export const config: Config = { path: "/api/read-card" };
