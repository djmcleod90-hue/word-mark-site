import assert from "node:assert/strict";
import { test } from "node:test";
import { creditPurchase, type Store } from "../lib/allowance.mts";
import { verifyPurchase } from "../lib/purchases.mts";

function memoryStore(): Store {
  const data = new Map<string, unknown>();
  return {
    async getJSON<T>(key: string) { return data.has(key) ? { value: data.get(key) as T } : null; },
    async setJSON(key, value, condition) {
      if (condition?.onlyIfNew && data.has(key)) return false;
      data.set(key, value);
      return true;
    },
  };
}

/** An unsigned transaction like Xcode's local test store produces. */
function xcodeTransaction(fields: Record<string, unknown> = {}): string {
  const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${encode({ alg: "ES256" })}.${encode({ transactionId: "2000000001", productId: "ca.word_mark.WordMark.scans15",
    bundleId: "ca.word-mark.WordMark", environment: "Xcode", signedDate: Date.now(), ...fields })}.signature`;
}

test("a purchase adds its scans once, however often it's sent", async () => {
  const store = memoryStore();
  const now = new Date("2026-10-16T12:00:00-07:00");
  const first = await creditPurchase(store, "PHONE", "T1", 15, now);
  assert.equal(first.result, "added");
  assert.equal(first.allowance.left, 5 + 15);
  const again = await creditPurchase(store, "PHONE", "T1", 15, now);
  assert.equal(again.result, "already-added");
  assert.equal(again.allowance.left, 20);
});

test("unsigned Xcode test purchases are refused unless testing is switched on", async () => {
  assert.equal(await verifyPurchase(xcodeTransaction(), {}), null);
  const allowed = await verifyPurchase(xcodeTransaction(), { ALLOW_XCODE_PURCHASES: "true" });
  assert.equal(allowed?.productId, "ca.word_mark.WordMark.scans15");
});

test("refuses other apps, nonsense, and production purchases without the app's Apple ID", async () => {
  assert.equal(await verifyPurchase(xcodeTransaction({ bundleId: "com.example.other" }), { ALLOW_XCODE_PURCHASES: "true" }), null);
  assert.equal(await verifyPurchase("not.a.purchase", {}), null);
  assert.equal(await verifyPurchase(xcodeTransaction({ environment: "Production" }), {}), null);
  // Claims to be a real App Store purchase but isn't signed by Apple.
  assert.equal(await verifyPurchase(xcodeTransaction({ environment: "Sandbox" }), {}), null);
});
