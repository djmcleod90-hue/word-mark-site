import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP_ID, AttestError, appleRoot, checkRequest, clientDataHash, decodeCBOR, newChallenge, register, verifyAssertion, verifyAttestation,
} from "../lib/app-attest.mts";
import type { Store } from "../lib/allowance.mts";

const sha256 = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest();

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

// ---- A minimal CBOR encoder, to build attestations and assertions the way an iPhone does.

function cbor(value: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
  };
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === "string") { const b = Buffer.from(value); return Buffer.concat([head(3, b.length), b]); }
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  const entries = Object.entries(value as object);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

// ---- A pretend Apple: a root, an intermediate, and a leaf certificate per key, made with openssl.

const dir = mkdtempSync(join(tmpdir(), "app-attest-"));
const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });

function makeCA(name: string, issuer?: string) {
  openssl("ecparam", "-name", "secp384r1", "-genkey", "-noout", "-out", `${name}.key`);
  writeFileSync(join(dir, "ca.cnf"), "[req]\ndistinguished_name=dn\n[dn]\n[v3]\nbasicConstraints=critical,CA:true\nkeyUsage=critical,keyCertSign,cRLSign\n");
  if (!issuer) {
    openssl("req", "-new", "-x509", "-key", `${name}.key`, "-subj", `/CN=${name}`, "-days", "3650", "-out", `${name}.pem`, "-extensions", "v3", "-config", "ca.cnf");
  } else {
    openssl("req", "-new", "-key", `${name}.key`, "-subj", `/CN=${name}`, "-out", `${name}.csr`, "-config", "ca.cnf");
    openssl("x509", "-req", "-in", `${name}.csr`, "-CA", `${issuer}.pem`, "-CAkey", `${issuer}.key`, "-CAcreateserial", "-days", "3650", "-out", `${name}.pem`, "-extfile", "ca.cnf", "-extensions", "v3");
  }
}
writeFileSync(join(dir, "req.cnf"), "[req]\ndistinguished_name=dn\n[dn]\n");
makeCA("root");
makeCA("intermediate", "root");
makeCA("other-root");
const der = (name: string) => new X509Certificate(readFileSync(join(dir, `${name}.pem`))).raw;
const root = new X509Certificate(readFileSync(join(dir, "root.pem")));
const otherRoot = new X509Certificate(readFileSync(join(dir, "other-root.pem")));

/** A phone's new key, attested for `challenge`. `tweak` changes the authenticator data to test each check. */
function attestedKey(challenge: string, tweak: { app?: string; counter?: number; aaguid?: string } = {}) {
  const name = `leaf-${Math.random().toString(36).slice(2)}`;
  openssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", `${name}.key`);
  const privateKey = createPrivateKey(readFileSync(join(dir, `${name}.key`)));
  const jwk = privateKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  const keyId = sha256(point);

  const counter = Buffer.alloc(4); counter.writeUInt32BE(tweak.counter ?? 0);
  const aaguid = Buffer.alloc(16); Buffer.from(tweak.aaguid ?? "appattestdevelop").copy(aaguid);
  const idLength = Buffer.alloc(2); idLength.writeUInt16BE(keyId.length);
  const authData = Buffer.concat([sha256(Buffer.from(tweak.app ?? APP_ID)), Buffer.from([0x40]), counter, aaguid, idLength, keyId]);

  const nonce = sha256(authData, sha256(Buffer.from(challenge)));
  // The Apple extension: SEQUENCE { [1] { OCTET STRING nonce } }.
  writeFileSync(join(dir, `${name}.cnf`), `[v3]\n1.2.840.113635.100.8.2=DER:3024a1220420${nonce.toString("hex")}\n`);
  openssl("req", "-new", "-key", `${name}.key`, "-subj", `/CN=${keyId.toString("hex")}`, "-out", `${name}.csr`, "-config", "req.cnf");
  openssl("x509", "-req", "-in", `${name}.csr`, "-CA", "intermediate.pem", "-CAkey", "intermediate.key", "-CAcreateserial", "-days", "30", "-out", `${name}.pem`, "-extfile", `${name}.cnf`, "-extensions", "v3");

  const attestation = cbor({ fmt: "apple-appattest", attStmt: { x5c: [der(name), der("intermediate")], receipt: Buffer.alloc(0) }, authData });
  return { keyId: keyId.toString("base64"), attestation: attestation.toString("base64"), privateKey };
}

/** What the phone sends with a request: an assertion over the challenge and body, with its counter. */
function assertion(privateKey: ReturnType<typeof createPrivateKey>, challenge: string, body: Buffer, count: number, app = APP_ID) {
  const counter = Buffer.alloc(4); counter.writeUInt32BE(count);
  const authData = Buffer.concat([sha256(Buffer.from(app)), Buffer.from([0x40]), counter]);
  const signature = sign("sha256", sha256(authData, clientDataHash(challenge, body)), privateKey);
  return cbor({ signature, authenticatorData: authData }).toString("base64");
}

// A minute on, as on a server: the phone's certificate is made just before it reaches us.
const now = new Date(Date.now() + 60_000);
const phone = "6F1C2B0A-1111-4222-8333-444455556666";
const challenge = "abcdefghijklmnopqrstuvwxyz012345";

test("Apple's root certificate is the App Attestation root", () => {
  const apple = appleRoot();
  assert.match(apple.subject, /Apple App Attestation Root CA/);
  assert.equal(apple.fingerprint256, "1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32");
});

test("CBOR decoding reads maps, arrays, byte strings and integers", () => {
  const decoded = decodeCBOR(cbor({ a: [1, -2, 300, 70000], b: Buffer.from("hi"), c: "text" })) as any;
  assert.deepEqual(decoded.a, [1, -2, 300, 70000]);
  assert.equal(decoded.b.toString(), "hi");
  assert.equal(decoded.c, "text");
});

test("a genuine attestation gives the key to check later requests with", () => {
  const key = attestedKey(challenge);
  const publicKey = verifyAttestation({ ...key, challenge, root, now });
  assert.match(publicKey, /BEGIN PUBLIC KEY/);
});

test("App Store builds' production keys are accepted too", () => {
  const key = attestedKey(challenge, { aaguid: "appattest" });
  assert.doesNotThrow(() => verifyAttestation({ ...key, challenge, root, now }));
});

test("attestations are refused when anything doesn't match", () => {
  const key = attestedKey(challenge);
  assert.throws(() => verifyAttestation({ ...key, challenge: "a-different-challenge-0123456789", root, now }), AttestError);
  assert.throws(() => verifyAttestation({ ...key, challenge, root: otherRoot, now }), AttestError);
  const otherKey = attestedKey(challenge);
  assert.throws(() => verifyAttestation({ ...key, keyId: otherKey.keyId, challenge, root, now }), AttestError);
  assert.throws(() => verifyAttestation({ ...attestedKey(challenge, { app: "TEAMID.com.example.other" }), challenge, root, now }), AttestError);
  assert.throws(() => verifyAttestation({ ...attestedKey(challenge, { counter: 1 }), challenge, root, now }), AttestError);
  assert.throws(() => verifyAttestation({ ...attestedKey(challenge, { aaguid: "somethingelse" }), challenge, root, now }), AttestError);
  assert.throws(() => verifyAttestation({ ...key, challenge, root, now: new Date(now.getTime() + 400 * 86_400_000) }), AttestError);
});

test("assertions are checked against the key and counter", () => {
  const key = attestedKey(challenge);
  const publicKey = verifyAttestation({ ...key, challenge, root, now });
  const body = Buffer.from('{"image":"/9j/..."}');
  const signed = assertion(key.privateKey, "c1", body, 1);
  assert.equal(verifyAssertion({ assertion: signed, clientDataHash: clientDataHash("c1", body), publicKey, lastCounter: 0 }), 1);
  // The same assertion can't be used twice, and it only covers the body it was made for.
  assert.throws(() => verifyAssertion({ assertion: signed, clientDataHash: clientDataHash("c1", body), publicKey, lastCounter: 1 }), AttestError);
  assert.throws(() => verifyAssertion({ assertion: signed, clientDataHash: clientDataHash("c1", Buffer.from("{}")), publicKey, lastCounter: 0 }), AttestError);
  // Another app's assertion, or another key's, fails.
  const otherApp = assertion(key.privateKey, "c1", body, 2, "TEAMID.com.example.other");
  assert.throws(() => verifyAssertion({ assertion: otherApp, clientDataHash: clientDataHash("c1", body), publicKey, lastCounter: 1 }), AttestError);
  const stranger = attestedKey(challenge);
  assert.throws(() => verifyAssertion({ assertion: assertion(stranger.privateKey, "c1", body, 5), clientDataHash: clientDataHash("c1", body), publicKey, lastCounter: 0 }), AttestError);
});

test("a registered phone's requests pass; replays, other phones and unknown challenges don't", async () => {
  const store = memoryStore();
  const first = await newChallenge(store, now);
  const key = attestedKey(first);
  await register(store, { device: phone, ...key, challenge: first, root, now });
  // A challenge counts once, so the same attestation can't register again.
  await assert.rejects(register(store, { device: phone, ...key, challenge: first, root, now }), AttestError);

  const body = Buffer.from('{"word":"inchoate"}');
  const c1 = await newChallenge(store, now);
  const headers = { keyId: key.keyId, assertion: assertion(key.privateKey, c1, body, 1), challenge: c1 };
  assert.deepEqual(await checkRequest(store, { device: phone, ...headers, body, now }), { ok: true });
  assert.equal((await checkRequest(store, { device: phone, ...headers, body, now })).ok, false); // replay

  const c2 = await newChallenge(store, now);
  const other = { keyId: key.keyId, assertion: assertion(key.privateKey, c2, body, 2), challenge: c2 };
  assert.equal((await checkRequest(store, { device: "00000000-0000-4000-8000-000000000000", ...other, body, now })).ok, false);
  assert.deepEqual(await checkRequest(store, { device: phone, ...other, body, now }), { ok: true });

  assert.equal((await checkRequest(store, { device: phone, keyId: key.keyId, assertion: assertion(key.privateKey, "x".repeat(32), body, 3), challenge: "x".repeat(32), body, now })).ok, false);
  assert.equal((await checkRequest(store, { device: phone, body, now })).ok, false);
});

test("challenges expire after five minutes", async () => {
  const store = memoryStore();
  const old = await newChallenge(store, now);
  const key = attestedKey(old);
  await assert.rejects(register(store, { device: phone, ...key, challenge: old, root, now: new Date(now.getTime() + 6 * 60_000) }), AttestError);
});

test("a reinstall's new key replaces the old one", async () => {
  const store = memoryStore();
  const c1 = await newChallenge(store, now);
  const oldKey = attestedKey(c1);
  await register(store, { device: phone, ...oldKey, challenge: c1, root, now });
  const c2 = await newChallenge(store, now);
  const newKey = attestedKey(c2);
  await register(store, { device: phone, ...newKey, challenge: c2, root, now });

  const body = Buffer.from("{}");
  const c3 = await newChallenge(store, now);
  assert.equal((await checkRequest(store, { device: phone, keyId: oldKey.keyId, assertion: assertion(oldKey.privateKey, c3, body, 1), challenge: c3, body, now })).ok, false);
  const c4 = await newChallenge(store, now);
  assert.deepEqual(await checkRequest(store, { device: phone, keyId: newKey.keyId, assertion: assertion(newKey.privateKey, c4, body, 1), challenge: c4, body, now }), { ok: true });
});
