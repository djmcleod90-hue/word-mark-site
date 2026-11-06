// What each phone may use of the services that cost money: Close Reads (AI readings) and sentence checks.
// Each has a free allowance, and more can be bought in the app. Close Reads also have a daily cap.
// Pure logic over a small key-value store, so it can be tested without Netlify.

export const LIMITS = { free: 15, perDay: 10, freeChecks: 150 };

/** Minimal storage the rules need; Netlify Blobs in production, a Map in tests. */
export interface Store {
  getJSON<T>(key: string): Promise<{ value: T; etag?: string } | null>;
  /** Returns false if the condition failed (someone else wrote first). */
  setJSON(key: string, value: unknown, condition?: { onlyIfNew?: boolean; onlyIfMatch?: string }): Promise<boolean>;
}

export interface Device {
  free: number;      // free readings left
  bought: number;    // readings left from purchases
  day: string;       // the day `today` counts, in Vancouver time
  today: number;     // readings used that day
  checks: number;    // sentence checks left, free and bought together
}

/** `free` is how many of `left` are the free ones every phone starts with; `checks` is sentence checks left. */
export interface Allowance { left: number; leftToday: number; free: number; checks: number }

export function dayIn(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Vancouver" }); // YYYY-MM-DD
}

export function allowanceOf(device: Device): Allowance {
  const left = device.free + device.bought;
  return { left, leftToday: Math.min(left, Math.max(0, LIMITS.perDay - device.today)), free: device.free, checks: device.checks };
}

const deviceKey = (id: string) => `devices/${id}`;

async function loadDevice(store: Store, id: string, now: Date) {
  const found = await store.getJSON<Device>(deviceKey(id));
  const day = dayIn(now);
  const device: Device = found?.value ?? { free: LIMITS.free, bought: 0, day, today: 0, checks: LIMITS.freeChecks };
  device.checks ??= LIMITS.freeChecks; // phones recorded before sentence checks were counted
  if (device.day !== day) Object.assign(device, { day, today: 0 });
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

/** Records one sentence check that came back with a verdict. A check that failed on our side isn't counted. */
export async function spendCheck(store: Store, id: string, now: Date): Promise<Allowance> {
  const { device } = await updateDevice(store, id, now, (d) => { d.checks = Math.max(0, d.checks - 1); });
  return allowanceOf(device);
}

export async function currentAllowance(store: Store, id: string, now: Date): Promise<Allowance> {
  return allowanceOf((await loadDevice(store, id, now)).device);
}

// ---- In-app purchases: each Apple transaction is credited once.

export type PurchaseResult = "added" | "already-added";

/** What a purchase adds to a phone. */
export interface Credit { scans?: number; checks?: number }

export async function creditPurchase(store: Store, id: string, transactionId: string, credit: Credit, now: Date): Promise<{ result: PurchaseResult; allowance: Allowance }> {
  const claimed = await store.setJSON(`purchases/${transactionId}`, { device: id, ...credit, at: now.toISOString() }, { onlyIfNew: true });
  if (!claimed) return { result: "already-added", allowance: await currentAllowance(store, id, now) };
  const { device } = await updateDevice(store, id, now, (d) => {
    d.bought += credit.scans ?? 0;
    d.checks += credit.checks ?? 0;
  });
  return { result: "added", allowance: allowanceOf(device) };
}
