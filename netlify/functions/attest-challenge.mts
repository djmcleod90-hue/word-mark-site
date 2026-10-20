// GET /api/attest/challenge — a one-time challenge for the phone to sign with its App Attest key.

import type { Config } from "@netlify/functions";
import { newChallenge } from "../lib/app-attest.mts";
import { blobStore, deviceID, json } from "../lib/http.mts";

export default async (req: Request) => {
  if (!deviceID(req)) return json({ error: "Missing device ID" }, 400);
  return json({ challenge: await newChallenge(blobStore(), new Date()) });
};

export const config: Config = { path: "/api/attest/challenge" };
