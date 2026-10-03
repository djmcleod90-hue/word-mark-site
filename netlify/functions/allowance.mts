// GET /api/allowance — how many AI readings this phone has left.

import type { Config } from "@netlify/functions";
import { currentAllowance } from "../lib/allowance.mts";
import { blobStore, deviceID, json } from "../lib/http.mts";

export default async (req: Request) => {
  const id = deviceID(req);
  if (!id) return json({ error: "Missing device ID" }, 400);
  return json({ allowance: await currentAllowance(blobStore(), id, new Date()) });
};

export const config: Config = { path: "/api/allowance" };
