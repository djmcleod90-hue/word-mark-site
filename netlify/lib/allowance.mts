// How many AI readings each phone may use: a few free ones, more from pack codes, and a daily cap.
// Pure logic over a small key-value store, so it can be tested without Netlify.

import { createHmac } from "node:crypto";

export const LIMITS = { free: 5, perCode: 15, perDay: 10, failedCodesPerDay: 10 };

/** Minimal storage the rules need; Netlify Blobs in production, a Map in tests. */
export interface Store {
  getJSON<T>(key: string): Promise<{ value: T; etag?: string } | null>;
  /** Returns false if the condition failed (someone else wrote first). */
  setJSON(key: string, value: unknown, condition?: { onlyIfNew?: boolean; onlyIfMatch?: string }): Promise<boolean>;
}

export interface Device {
  free: number;      // free readings left
  bought: number;    // readings left from redeemed codes
  day: string;       // the day `today` counts, in Vancouver time
  today: number;     // readings used that day
  failedCodes: number;
}

export interface Allowance { left: number; leftToday: number }

export function dayIn(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Vancouver" }); // YYYY-MM-DD
}

export function allowanceOf(device: Device): Allowance {
  const left = device.free + device.bought;
  return { left, leftToday: Math.min(left, Math.max(0, LIMITS.perDay - device.today)) };
}

const deviceKey = (id: string) => `devices/${id}`;

async function loadDevice(store: Store, id: string, now: Date) {
  const found = await store.getJSON<Device>(deviceKey(id));
  const day = dayIn(now);
  const device: Device = found?.value ?? { free: LIMITS.free, bought: 0, day, today: 0, failedCodes: 0 };
  if (device.day !== day) Object.assign(device, { day, today: 0, failedCodes: 0 });
  return { device, exists: found !== null, etag: found?.etag };
}

/** Applies `change` to a device record, retrying if another request updated it at the same time. */
async function updateDevice<T>(store: Store, id: string, now: Date, change: (device: Device) => T): Promise<{ device: Device; result: T }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { device, exists, etag } = await loadDevice(store, id, now);
    const result = change(device);
    // Guard against a simultaneous update when the store gives us a version tag to check against.
    const condition = !exists ? { onlyIfNew: true } : etag ? { onlyIfMatch: etag } : undefined;
    const saved = await store.setJSON(deviceKey(id), device, condition);
    if (saved) return { device, result };
  }
  throw new Error("Busy, try again");
}

export type ScanCheck = "ok" | "daily-limit" | "none-left";

export async function checkScan(store: Store, id: string, now: Date): Promise<{ check: ScanCheck; allowance: Allowance }> {
  const { device } = await loadDevice(store, id, now);
  const allowance = allowanceOf(device);
  const check = allowance.left === 0 ? "none-left" : allowance.leftToday === 0 ? "daily-limit" : "ok";
  return { check, allowance };
}

/** Records one successful reading: free readings are used before bought ones. */
export async function spendScan(store: Store, id: string, now: Date): Promise<Allowance> {
  const { device } = await updateDevice(store, id, now, (d) => {
    if (d.free > 0) d.free -= 1;
    else if (d.bought > 0) d.bought -= 1;
    d.today += 1;
  });
  return allowanceOf(device);
}

export async function currentAllowance(store: Store, id: string, now: Date): Promise<Allowance> {
  return allowanceOf((await loadDevice(store, id, now)).device);
}

// ---- Pack codes: "WM-<serial>-<check>", the check signed with a secret, so no list of codes is stored.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base 32: no I, L, O or U

function toBase32(n: number, width = 0): string {
  let out = "";
  do { out = ALPHABET[n % 32] + out; n = Math.floor(n / 32); } while (n > 0);
  return out.padStart(width, "0");
}

function fromBase32(text: string): number | null {
  let n = 0;
  for (const ch of text) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * 32 + i;
  }
  return n;
}

function checkPart(serial: number, secret: string): string {
  const digest = createHmac("sha256", secret).update(`word-mark-code:${serial}`).digest();
  return toBase32(digest.readUIntBE(0, 5)).padStart(8, "0").slice(-6); // 30 bits
}

export function makeCode(serial: number, secret: string): string {
  return `WM-${toBase32(serial, 3)}-${checkPart(serial, secret)}`;
}

/** Accepts what people type: any case, spaces, and O/I/L mistaken for 0/1. Returns the serial if genuine. */
export function readCode(input: string, secret: string): number | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  const match = /^WM([0-9A-Z]{3,})([0-9A-Z]{6})$/.exec(cleaned);
  if (!match) return null;
  const serial = fromBase32(match[1]);
  if (serial === null || checkPart(serial, secret) !== match[2]) return null;
  return serial;
}

export type RedeemResult = "added" | "invalid" | "already-used" | "too-many-tries";

export async function redeemCode(store: Store, id: string, input: string, secret: string, now: Date): Promise<{ result: RedeemResult; allowance: Allowance }> {
  const { device } = await loadDevice(store, id, now);
  if (device.failedCodes >= LIMITS.failedCodesPerDay) return { result: "too-many-tries", allowance: allowanceOf(device) };

  const serial = readCode(input, secret);
  if (serial === null) {
    const { device: updated } = await updateDevice(store, id, now, (d) => { d.failedCodes += 1; });
    return { result: "invalid", allowance: allowanceOf(updated) };
  }
  // Claiming the code first means two phones can't both redeem it.
  const claimed = await store.setJSON(`codes/${serial}`, { device: id, at: now.toISOString() }, { onlyIfNew: true });
  if (!claimed) return { result: "already-used", allowance: allowanceOf(device) };

  const { device: updated } = await updateDevice(store, id, now, (d) => { d.bought += LIMITS.perCode; });
  return { result: "added", allowance: allowanceOf(updated) };
}
