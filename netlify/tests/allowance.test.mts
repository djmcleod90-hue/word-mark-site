import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, checkScan, creditPurchase, spendCheck, spendScan, currentAllowance, type Store } from "../lib/allowance.mts";

/** In-memory stand-in for Netlify Blobs, including its conditional writes. */
function memoryStore(): Store {
  const data = new Map<string, { value: unknown; etag: string }>();
  let version = 0;
  return {
    async getJSON(key) {
      const entry = data.get(key);
      return entry ? { value: structuredClone(entry.value) as any, etag: entry.etag } : null;
    },
    async setJSON(key, value, condition) {
      const existing = data.get(key);
      if (condition?.onlyIfNew && existing) return false;
      if (condition?.onlyIfMatch && existing?.etag !== condition.onlyIfMatch) return false;
      data.set(key, { value: structuredClone(value), etag: String(++version) });
      return true;
    },
  };
}

const phone = "6F1C2B0A-1111-4222-8333-444455556666";
const day1 = new Date("2026-10-03T18:00:00Z");
const day2 = new Date("2026-10-04T18:00:00Z");

test("a new phone gets 15 free readings, then none", async () => {
  const store = memoryStore();
  assert.deepEqual(await currentAllowance(store, phone, day1), { left: 15, leftToday: 10, free: 15, checks: 150 });
  for (let i = 0; i < 10; i++) await spendScan(store, phone, day1);
  for (let i = 0; i < 5; i++) await spendScan(store, phone, day2);
  assert.equal((await checkScan(store, phone, day2)).check, "none-left");
});

test("bought readings add to the free ones, and the daily cap of 10 applies", async () => {
  const store = memoryStore();
  await creditPurchase(store, phone, "T1", { scans: 15 }, day1);
  assert.deepEqual(await currentAllowance(store, phone, day1), { left: 30, leftToday: 10, free: 15, checks: 150 });
  for (let i = 0; i < LIMITS.perDay; i++) await spendScan(store, phone, day1);
  assert.equal((await checkScan(store, phone, day1)).check, "daily-limit");
  // Next day (Vancouver time) the cap resets; 20 readings remain in total.
  assert.deepEqual(await checkScan(store, phone, day2), { check: "ok", allowance: { left: 20, leftToday: 10, free: 5, checks: 150 } });
});

test("sentence checks count down from 150 and don't go below nothing", async () => {
  const store = memoryStore();
  for (let i = 0; i < 150; i++) await spendCheck(store, phone, day1);
  assert.equal((await currentAllowance(store, phone, day1)).checks, 0);
  assert.equal((await spendCheck(store, phone, day1)).checks, 0);
  await creditPurchase(store, phone, "T1", { checks: 150 }, day1);
  assert.equal((await currentAllowance(store, phone, day1)).checks, 150);
});

test("a phone recorded before checks were counted starts with the full 150", async () => {
  const store = memoryStore();
  await store.setJSON(`devices/${phone}`, { free: 2, bought: 0, day: "2026-10-03", today: 3, failedCodes: 0 });
  assert.deepEqual(await currentAllowance(store, phone, day1), { left: 15, leftToday: 7, free: 15, checks: 150 });
});

test("a phone on the old allowance is raised to 15 free once, and bought readings are untouched", async () => {
  const store = memoryStore();
  await store.setJSON(`devices/${phone}`, { free: 4, bought: 3, day: "2026-10-03", today: 0, checks: 150 });
  assert.equal((await currentAllowance(store, phone, day1)).free, 15);
  assert.deepEqual(await spendScan(store, phone, day1), { left: 17, leftToday: 9, free: 14, checks: 150 });
  // Spent readings stay spent: the raise doesn't happen again.
  assert.equal((await currentAllowance(store, phone, day2)).free, 14);
});

test("a new phone that spends its free readings isn't raised again", async () => {
  const store = memoryStore();
  await spendScan(store, phone, day1);
  assert.equal((await currentAllowance(store, phone, day2)).free, 14);
});

test("two readings at once from the same phone are both counted", async () => {
  const store = memoryStore();
  await Promise.all([spendScan(store, phone, day1), spendScan(store, phone, day1)]);
  assert.deepEqual(await currentAllowance(store, phone, day1), { left: 13, leftToday: 8, free: 13, checks: 150 });
});
