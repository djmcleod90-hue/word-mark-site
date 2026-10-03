// TEMPORARY: compares CODE_SECRET without revealing it. Remove before merging.
import type { Config } from "@netlify/functions";
import { createHash } from "node:crypto";

export default async () => {
  const secret = process.env.CODE_SECRET ?? "";
  const fingerprint = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 10);
  return Response.json({ length: secret.length, fingerprint: fingerprint(secret), trimmedFingerprint: fingerprint(secret.trim()) });
};

export const config: Config = { path: "/api/code-check" };
