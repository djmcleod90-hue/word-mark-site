// App Attest: proof that a request comes from the genuine Word-Mark app on a real iPhone, not a script.
// Each phone makes a key in its Secure Enclave and has Apple vouch for it once (an attestation); after that,
// requests that cost money (Close Reads, sentence checks, pack codes) carry a signature from that key
// (an assertion). See Apple's "Validating apps that connect to your server".
// Pure logic over the same small store as the allowance rules, so it can be tested without Netlify.

import { createHash, createPublicKey, randomBytes, verify, X509Certificate, type KeyObject } from "node:crypto";
import type { Store } from "./allowance.mts";
import { APPLE_APP_ATTESTATION_ROOT } from "./apple-attest-root.mts";

/** Team ID and bundle ID: Apple signs the hash of this into every attestation and assertion. */
export const APP_ID = "D86JH44SW8.ca.word-mark.WordMark";

/** "off": ignore; "log": check and log, never block (while older app versions are around); "enforce": require. */
export type Mode = "off" | "log" | "enforce";
export function mode(): Mode {
  const value = (process.env.APP_ATTEST ?? "log").toLowerCase();
  return value === "off" || value === "enforce" ? value : "log";
}

/** Apple's App Attestation Root CA. */
export function appleRoot(): X509Certificate {
  return new X509Certificate(APPLE_APP_ATTESTATION_ROOT);
}

const sha256 = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest();

// ---- CBOR, just the parts attestations and assertions use: maps, arrays, byte and text strings, integers.

export function decodeCBOR(data: Buffer): unknown {
  let at = 0;
  const length = (info: number): number => {
    if (info < 24) return info;
    const size = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
    if (!size) throw new Error("Unsupported CBOR length");
    const value = data.readUIntBE(at, Math.min(size, 6));
    at += size;
    return value;
  };
  const item = (): unknown => {
    if (at >= data.length) throw new Error("Truncated CBOR");
    const byte = data[at++];
    const major = byte >> 5, info = byte & 31;
    switch (major) {
      case 0: return length(info);
      case 1: return -1 - length(info);
      case 2: { const n = length(info); const bytes = data.subarray(at, at + n); at += n; return Buffer.from(bytes); }
      case 3: { const n = length(info); const text = data.toString("utf8", at, at + n); at += n; return text; }
      case 4: { const n = length(info); return Array.from({ length: n }, item); }
      case 5: {
        const n = length(info);
        const map: Record<string, unknown> = {};
        for (let i = 0; i < n; i++) { const key = String(item()); map[key] = item(); }
        return map;
      }
      default: throw new Error("Unsupported CBOR type");
    }
  };
  return item();
}

// ---- Authenticator data: rpIdHash (32) · flags (1) · counter (4) · [aaguid (16) · credentialId length (2) · credentialId]

interface AuthData { rpIdHash: Buffer; counter: number; aaguid?: Buffer; credentialId?: Buffer }

function readAuthData(data: Buffer, withCredential: boolean): AuthData {
  if (data.length < 37) throw new Error("Authenticator data too short");
  const parsed: AuthData = { rpIdHash: data.subarray(0, 32), counter: data.readUInt32BE(33) };
  if (withCredential) {
    if (data.length < 55) throw new Error("Authenticator data has no credential");
    parsed.aaguid = data.subarray(37, 53);
    const idLength = data.readUInt16BE(53);
    parsed.credentialId = data.subarray(55, 55 + idLength);
  }
  return parsed;
}

/** Keys from builds made in Xcode say "appattestdevelop"; App Store and TestFlight builds say "appattest". */
const AAGUIDS = [Buffer.from("appattestdevelop"), Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)])];

/** The 65-byte uncompressed point of an EC public key (0x04 · x · y), which Apple hashes into the key ID. */
function uncompressedPoint(key: KeyObject): Buffer {
  const jwk = key.export({ format: "jwk" });
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
}

/** The 32-byte nonce in the certificate's Apple extension (OID 1.2.840.113635.100.8.2). */
function certificateNonce(cert: X509Certificate): Buffer {
  const oid = Buffer.from("06092a864886f763640802", "hex");
  const raw = cert.raw;
  const start = raw.indexOf(oid);
  if (start < 0) throw new Error("Certificate has no App Attest nonce");
  // Inside the extension: OCTET STRING { SEQUENCE { [1] { OCTET STRING (32 bytes) } } }.
  const marker = raw.indexOf(Buffer.from([0x04, 0x20]), start + oid.length);
  if (marker < 0 || marker > start + oid.length + 16) throw new Error("Malformed App Attest nonce");
  return raw.subarray(marker + 2, marker + 34);
}

export class AttestError extends Error {}

/**
 * Checks an attestation (Apple's steps 1–9) and returns the key to check this phone's later assertions with.
 * `keyId` and `attestation` are base64; `challenge` is the one-time text the server gave the phone.
 */
export function verifyAttestation(input: { keyId: string; attestation: string; challenge: string; root: X509Certificate; now: Date }): string {
  const object = decodeCBOR(Buffer.from(input.attestation, "base64")) as any;
  if (object?.fmt !== "apple-appattest") throw new AttestError("Not an App Attest attestation");
  const chain = object.attStmt?.x5c;
  if (!Array.isArray(chain) || chain.length < 2) throw new AttestError("Missing certificates");
  const [leaf, intermediate] = chain.map((der: Buffer) => new X509Certificate(der));

  // 1. The certificates chain up to Apple's App Attestation root and are in date.
  if (!intermediate.verify(input.root.publicKey) || !leaf.verify(intermediate.publicKey)) throw new AttestError("Untrusted certificate chain");
  for (const cert of [leaf, intermediate]) {
    if (input.now < new Date(cert.validFrom) || input.now > new Date(cert.validTo)) throw new AttestError("Certificate out of date");
  }

  // 2–4. The certificate vouches for exactly this attestation and this challenge.
  const authData: Buffer = object.authData;
  if (!Buffer.isBuffer(authData)) throw new AttestError("Missing authenticator data");
  const nonce = sha256(authData, sha256(Buffer.from(input.challenge, "utf8")));
  if (!certificateNonce(leaf).equals(nonce)) throw new AttestError("Nonce mismatch");

  // 5. The key ID is the hash of the certified public key.
  const keyId = Buffer.from(input.keyId, "base64");
  if (!sha256(uncompressedPoint(leaf.publicKey)).equals(keyId)) throw new AttestError("Key ID mismatch");

  // 6–9. Made for this app, never used before, by App Attest, for this key.
  const parsed = readAuthData(authData, true);
  if (!parsed.rpIdHash.equals(sha256(Buffer.from(APP_ID)))) throw new AttestError("Wrong app");
  if (parsed.counter !== 0) throw new AttestError("Key already used");
  if (!AAGUIDS.some((id) => id.equals(parsed.aaguid!))) throw new AttestError("Not an App Attest key");
  if (!parsed.credentialId!.equals(keyId)) throw new AttestError("Credential mismatch");

  return leaf.publicKey.export({ type: "spki", format: "pem" }) as string;
}

/**
 * Checks an assertion (Apple's steps 1–5) and returns its counter, which must only go up.
 * `clientDataHash` is what the phone signed: see `clientDataHash` below.
 */
export function verifyAssertion(input: { assertion: string; clientDataHash: Buffer; publicKey: string; lastCounter: number }): number {
  const object = decodeCBOR(Buffer.from(input.assertion, "base64")) as any;
  const signature: Buffer = object?.signature, authData: Buffer = object?.authenticatorData;
  if (!Buffer.isBuffer(signature) || !Buffer.isBuffer(authData)) throw new AttestError("Malformed assertion");
  const nonce = sha256(authData, input.clientDataHash);
  if (!verify("sha256", nonce, createPublicKey(input.publicKey), signature)) throw new AttestError("Bad signature");
  const parsed = readAuthData(authData, false);
  if (!parsed.rpIdHash.equals(sha256(Buffer.from(APP_ID)))) throw new AttestError("Wrong app");
  if (parsed.counter <= input.lastCounter) throw new AttestError("Replayed assertion");
  return parsed.counter;
}

/** What the phone signs for a request: the one-time challenge and the exact body it sends. */
export function clientDataHash(challenge: string, body: Buffer): Buffer {
  return sha256(Buffer.from(`${challenge}.${sha256(body).toString("hex")}`, "utf8"));
}

// ---- Challenges and keys, in the store.

const CHALLENGE_LIFETIME_MS = 5 * 60_000;
const challengeKey = (challenge: string) => `attest/challenges/${challenge}`;
const keyKey = (keyId: string) => `attest/keys/${Buffer.from(keyId, "base64").toString("base64url")}`;
const deviceKey = (device: string) => `attest/devices/${device}`;

interface KeyRecord { publicKey: string; counter: number; device: string; at: string }

export async function newChallenge(store: Store, now: Date): Promise<string> {
  const challenge = randomBytes(24).toString("base64url");
  await store.setJSON(challengeKey(challenge), { at: now.toISOString() }, { onlyIfNew: true });
  return challenge;
}

/** A challenge counts once: claiming it marks it used, so a recorded request can't be sent again. */
async function useChallenge(store: Store, challenge: string, now: Date): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(challenge)) return false;
  const found = await store.getJSON<{ at: string; used?: boolean }>(challengeKey(challenge));
  if (!found || found.value.used) return false;
  if (now.getTime() - new Date(found.value.at).getTime() > CHALLENGE_LIFETIME_MS) return false;
  return store.setJSON(challengeKey(challenge), { ...found.value, used: true }, found.etag ? { onlyIfMatch: found.etag } : undefined);
}

/** Registers a phone's attested key. The phone's ID is bound to its first key, or to a newer one it attests. */
export async function register(store: Store, input: { device: string; keyId: string; attestation: string; challenge: string; root: X509Certificate; now: Date }): Promise<void> {
  if (!(await useChallenge(store, input.challenge, input.now))) throw new AttestError("Unknown or used challenge");
  const publicKey = verifyAttestation(input);
  const record: KeyRecord = { publicKey, counter: 0, device: input.device, at: input.now.toISOString() };
  await store.setJSON(keyKey(input.keyId), record);
  // A reinstall makes a new key; the newest attested key is the one this phone signs with.
  await store.setJSON(deviceKey(input.device), { keyId: input.keyId, at: input.now.toISOString() });
}

export type Check = { ok: true } | { ok: false; reason: string };

/** Checks a request's App Attest headers against the phone's registered key, and moves its counter on. */
export async function checkRequest(store: Store, input: { device: string; keyId?: string | null; assertion?: string | null; challenge?: string | null; body: Buffer; now: Date }): Promise<Check> {
  if (!input.keyId || !input.assertion || !input.challenge) return { ok: false, reason: "no assertion" };
  const bound = await store.getJSON<{ keyId: string }>(deviceKey(input.device));
  if (!bound || bound.value.keyId !== input.keyId) return { ok: false, reason: "key not registered to this phone" };
  if (!(await useChallenge(store, input.challenge, input.now))) return { ok: false, reason: "unknown or used challenge" };
  for (let attempt = 0; attempt < 5; attempt++) {
    const found = await store.getJSON<KeyRecord>(keyKey(input.keyId));
    if (!found) return { ok: false, reason: "unknown key" };
    let counter: number;
    try {
      counter = verifyAssertion({ assertion: input.assertion, clientDataHash: clientDataHash(input.challenge, input.body), publicKey: found.value.publicKey, lastCounter: found.value.counter });
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "bad assertion" };
    }
    const saved = await store.setJSON(keyKey(input.keyId), { ...found.value, counter }, found.etag ? { onlyIfMatch: found.etag } : undefined);
    if (saved) return { ok: true };
  }
  return { ok: false, reason: "busy" };
}
