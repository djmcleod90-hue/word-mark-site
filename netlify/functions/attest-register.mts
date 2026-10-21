// POST /api/attest/register — the phone's App Attest key, with Apple's attestation that it's the genuine app.

import type { Config } from "@netlify/functions";
import { AttestError, appleRoot, register } from "../lib/app-attest.mts";
import { blobStore, deviceID, json } from "../lib/http.mts";

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const id = deviceID(req);
  if (!id) return json({ error: "Missing device ID" }, 400);
  let body: { keyId?: unknown; attestation?: unknown; challenge?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Expected JSON" }, 400); }
  const [keyId, attestation, challenge] = [body.keyId, body.attestation, body.challenge];
  if (typeof keyId !== "string" || typeof attestation !== "string" || typeof challenge !== "string" || attestation.length > 20_000) {
    return json({ error: "Expected a key ID, attestation and challenge" }, 400);
  }
  try {
    await register(blobStore(), { device: id, keyId, attestation, challenge, root: appleRoot(), now: new Date() });
    return json({ registered: true });
  } catch (error) {
    console.warn("attest-register refused", error instanceof AttestError ? error.message : error);
    return json({ error: "not-attested" }, error instanceof AttestError ? 400 : 500);
  }
};

export const config: Config = { path: "/api/attest/register" };
