// POST /api/redeem — adds a pack code's readings to this phone.

import type { Config } from "@netlify/functions";
import { redeemCode } from "../lib/allowance.mts";
import { attestedJSON, blobStore, deviceID, json } from "../lib/http.mts";

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const id = deviceID(req);
  if (!id) return json({ error: "Missing device ID" }, 400);
  const secret = process.env.CODE_SECRET;
  if (!secret) return json({ error: "Codes aren't set up yet" }, 503);

  const attested = await attestedJSON(req, id, "redeem");
  if ("response" in attested) return attested.response;
  const body = (attested.body ?? {}) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code.slice(0, 40) : "";

  const { result, allowance } = await redeemCode(blobStore(), id, code, secret, new Date());
  const status = { added: 200, invalid: 400, "already-used": 409, "too-many-tries": 429 }[result];
  return json({ result, allowance }, status);
};

export const config: Config = { path: "/api/redeem" };
