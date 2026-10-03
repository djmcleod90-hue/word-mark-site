import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, checkScan, spendScan, currentAllowance, makeCode, readCode, redeemCode, type Store } from "../lib/allowance.mts";

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

const SECRET = "test-secret";
const phone = "6F1C2B0A-1111-4222-8333-444455556666";
const day1 = new Date("2026-10-03T18:00:00Z");
const day2 = new Date("2026-10-04T18:00:00Z");

test("a new phone gets 5 free readings, then none", async () => {
  const store = memoryStore();
  assert.deepEqual(await currentAllowance(store, phone, day1), { left: 5, leftToday: 5 });
  for (let i = 0; i < 5; i++) await spendScan(store, phone, day1);
  assert.equal((await checkScan(store, phone, day1)).check, "none-left");
});

test("a code adds 15, and the daily cap of 10 applies", async () => {
  const store = memoryStore();
  assert.equal((await redeemCode(store, phone, makeCode(1, SECRET), SECRET, day1)).result, "added");
  assert.deepEqual(await currentAllowance(store, phone, day1), { left: 20, leftToday: 10 });
  for (let i = 0; i < LIMITS.perDay; i++) await spendScan(store, phone, day1);
  assert.equal((await checkScan(store, phone, day1)).check, "daily-limit");
  // Next day (Vancouver time) the cap resets; 10 readings remain in total.
  assert.deepEqual((await checkScan(store, phone, day2)), { check: "ok", allowance: { left: 10, leftToday: 10 } });
});

test("a code works once, across phones", async () => {
  const store = memoryStore();
  const code = makeCode(42, SECRET);
  assert.equal((await redeemCode(store, phone, code, SECRET, day1)).result, "added");
  assert.equal((await redeemCode(store, "other-phone", code, SECRET, day1)).result, "already-used");
  assert.equal((await redeemCode(store, phone, code, SECRET, day1)).result, "already-used");
});

test("codes are forgiving to type but can't be made up", () => {
  const code = makeCode(7, SECRET);
  assert.match(code, /^WM-[0-9A-Z]{3}-[0-9A-Z]{6}$/);
  assert.equal(readCode(code.toLowerCase().replace(/-/g, " "), SECRET), 7);
  assert.equal(readCode(code.replace(/0/g, "O"), SECRET), 7);
  assert.equal(readCode("WM-007-ABCDEF", SECRET), null);
  assert.equal(readCode(code, "a-different-secret"), null);
});

test("too many wrong codes in a day are refused", async () => {
  const store = memoryStore();
  for (let i = 0; i < LIMITS.failedCodesPerDay; i++) {
    assert.equal((await redeemCode(store, phone, "WM-000-ZZZZZZ", SECRET, day1)).result, "invalid");
  }
  assert.equal((await redeemCode(store, phone, makeCode(3, SECRET), SECRET, day1)).result, "too-many-tries");
  assert.equal((await redeemCode(store, phone, makeCode(3, SECRET), SECRET, day2)).result, "added");
});

test("two readings at once from the same phone are both counted", async () => {
  const store = memoryStore();
  await Promise.all([spendScan(store, phone, day1), spendScan(store, phone, day1)]);
  assert.deepEqual(await currentAllowance(store, phone, day1), { left: 3, leftToday: 3 });
});
