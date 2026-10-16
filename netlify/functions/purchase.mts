// POST /api/purchase — credits Full scans bought in the app, after checking Apple's signature.

import type { Config } from "@netlify/functions";
import { creditPurchase } from "../lib/allowance.mts";
import { blobStore, deviceID, json } from "../lib/http.mts";
import { SCAN_PRODUCTS, verifyPurchase } from "../lib/purchases.mts";

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const id = deviceID(req);
  if (!id) return json({ error: "Missing device ID" }, 400);
  let body: { transaction?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Expected JSON" }, 400); }
  const jws = typeof body.transaction === "string" && body.transaction.length < 20_000 ? body.transaction : "";

  const purchase = jws ? await verifyPurchase(jws) : null;
  const scans = purchase ? SCAN_PRODUCTS[purchase.productId] : undefined;
  if (!purchase || !scans) return json({ error: "invalid-purchase" }, 400);

  const { result, allowance } = await creditPurchase(blobStore(), id, purchase.transactionId, scans, new Date());
  console.log(`purchase ${result} ${purchase.productId} env=${purchase.environment}`);
  return json({ result, allowance });
};

export const config: Config = { path: "/api/purchase" };
