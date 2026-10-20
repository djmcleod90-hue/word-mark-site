// Shared request handling for the app's endpoints.

import { getStore } from "@netlify/blobs";
import type { Store } from "./allowance.mts";
import { checkRequest, mode } from "./app-attest.mts";

/** Netlify Blobs, wrapped in the small interface the allowance rules use. */
export function blobStore(): Store {
  const store = getStore({ name: "word-mark-app", consistency: "strong" });
  return {
    async getJSON<T>(key: string) {
      const found = await store.getWithMetadata(key, { type: "json" });
      return found ? { value: found.data as T, etag: found.etag } : null;
    },
    async setJSON(key, value, condition) {
      const result = await store.setJSON(key, value, condition as any);
      return result.modified;
    },
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The phone's ID, a UUID the app creates once and keeps in the phone's keychain. */
export function deviceID(req: Request): string | null {
  const id = req.headers.get("x-device-id") ?? "";
  return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(id) ? id.toUpperCase() : null;
}

/**
 * The request's JSON body, after checking it carries a valid App Attest assertion from this phone's key.
 * In "log" mode a missing or bad assertion is only logged; in "enforce" mode it's refused (APP_ATTEST setting).
 */
export async function attestedJSON(req: Request, device: string, endpoint: string): Promise<{ body: unknown } | { response: Response }> {
  const raw = Buffer.from(await req.arrayBuffer());
  const current = mode();
  if (current !== "off") {
    const check = await checkRequest(blobStore(), {
      device, body: raw, now: new Date(),
      keyId: req.headers.get("x-attest-key"), assertion: req.headers.get("x-attest-assertion"), challenge: req.headers.get("x-attest-challenge"),
    });
    if (!check.ok) {
      console.warn(`app-attest ${endpoint} (${current}): ${check.reason}`);
      if (current === "enforce") return { response: json({ error: "not-attested" }, 401) };
    }
  }
  try { return { body: JSON.parse(raw.toString("utf8")) }; } catch { return { response: json({ error: "Expected JSON" }, 400) }; }
}
