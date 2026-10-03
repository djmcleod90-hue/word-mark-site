// Runs the app's endpoints locally against Netlify's local Blobs server and the real Claude API.
//   CARD=path/to/card.jpg npx tsx scripts/try-service.mts   (needs ANTHROPIC_API_KEY)

import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobsServer } from "@netlify/blobs/server";
import { setEnvironmentContext } from "@netlify/blobs";

process.env.CODE_SECRET ??= "local-test-secret";
const server = new BlobsServer({ directory: mkdtempSync(join(tmpdir(), "blobs-")), token: "local" });
const { port } = await server.start();
setEnvironmentContext({ siteID: "local", token: "local", edgeURL: `http://localhost:${port}`, uncachedEdgeURL: `http://localhost:${port}` });

const readCard = (await import("../netlify/functions/read-card.mts")).default;
const redeem = (await import("../netlify/functions/redeem.mts")).default;
const allowance = (await import("../netlify/functions/allowance.mts")).default;
const { makeCode } = await import("../netlify/lib/allowance.mts");

const phone = "6F1C2B0A-1111-4222-8333-444455556666";
const call = async (handler: (r: Request) => Promise<Response>, method: string, body?: unknown) => {
  const res = await handler(new Request("http://local/api", {
    method, headers: { "x-device-id": phone, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

console.log("allowance:", await call(allowance, "GET"));
const image = readFileSync(process.env.CARD!).toString("base64");
const read = await call(readCard, "POST", { image, draft: [] });
console.log("read-card:", read.status, read.body.allowance);
for (const e of read.body.entries ?? []) console.log(`   ${e.word} — ${e.definition}`);
console.log("redeem good code:", await call(redeem, "POST", { code: makeCode(1, process.env.CODE_SECRET!) }));
console.log("redeem same code:", (await call(redeem, "POST", { code: makeCode(1, process.env.CODE_SECRET!) })).body.result);
console.log("redeem made-up code:", (await call(redeem, "POST", { code: "WM-001-ABCDEF" })).body.result);
console.log("bad request:", (await call(readCard, "POST", { image: "not a photo" })).status);
await server.stop();
