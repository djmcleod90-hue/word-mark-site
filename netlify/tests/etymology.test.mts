import assert from "node:assert/strict";
import { test } from "node:test";
import { americanSpellings, baseWords, originOf, canadianSpelling, cleanMarkup, composeOrigin, findEntry } from "../lib/etymology.mts";

test("turns Merriam-Webster markup into plain text with italics", () => {
  assert.equal(
    cleanMarkup("Latin {it}lugubris{/it}, from {it}lugēre{/it} to mourn {ma}{mat|luctuous|}{/ma}"),
    "Latin *lugubris*, from *lugēre* to mourn",
  );
  assert.equal(cleanMarkup("{et_link|defenestration|defenestration}, back-formation"), "defenestration, back-formation");
});

const origin = (word: string, entries: unknown[]) => { const f = findEntry(word, entries); return f ? composeOrigin(f) : ""; };

test("finds the entry by headword, or by one of its forms", () => {
  const entries = [
    { meta: { id: "candor", stems: ["candor", "candour", "candors"] }, et: [["text", "Latin {it}candor{/it}, from {it}candēre{/it} to shine"]], date: "1653" },
  ];
  assert.equal(origin("candour", entries), "Latin *candor*, from *candēre* to shine. First known use: 1653.");
  assert.equal(origin("candor", entries), "Latin *candor*, from *candēre* to shine. First known use: 1653.");
});

test("no origin when the word isn't found (Merriam-Webster sends spelling suggestions)", () => {
  assert.equal(origin("beazel", ["bezel", "beagle"]), "");
  assert.equal(origin("lugubrious", [{ meta: { id: "lugubrious" } }]), "");
});

test("a bare language means the word came unchanged from it", () => {
  const argot = [{ meta: { id: "argot" }, et: [["text", "French"]], date: "1843" }];
  assert.equal(origin("argot", argot), "From French *argot*. First known use: 1843.");
  const found = findEntry("x", [{ meta: { id: "x" }, et: [["text", "Middle English"]], date: "14th century" }])!;
  assert.equal(composeOrigin(found), "From Middle English *x*. First known use: 14th century.");
});

test("a word formed in English gets the etymology of the word it came from", () => {
  const pedantic = findEntry("pedantic", [{ meta: { id: "pedantic" }, date: "1600" }])!;
  const pedant = findEntry("pedant", [{ meta: { id: "pedant" }, et: [["text", "Italian {it}pedante{/it}"]], date: "1588" }])!;
  assert.equal(composeOrigin(pedantic, { found: pedant, suffix: "-ic" }),
    "From *pedant* + *-ic*. *Pedant*: Italian *pedante*. First known use: 1600.");
  assert.deepEqual(baseWords("pedantic").map((b) => b.base), ["pedant"]);
  assert.deepEqual(baseWords("boorish").map((b) => b.base), ["boor"]);
  assert.deepEqual(baseWords("waggish").map((b) => b.base), ["wag", "wagg"]);
  assert.deepEqual(baseWords("prodigious").map((b) => b.base), ["prodigy", "prodigio", "prodigi"]);
});

test("origins are given in Canadian spelling, but foreign words are left alone", () => {
  assert.equal(canadianSpelling("Latin *color* color, colored; favorable humor"), "Latin *color* colour, coloured; favourable humour");
  assert.equal(canadianSpelling("gray, center, defense, traveled, skeptical"), "grey, centre, defence, travelled, sceptical");
  assert.equal(canadianSpelling("Gray, Theater"), "Grey, Theatre");
  assert.equal(canadianSpelling("door, motor, error, meter, level"), "door, motor, error, meter, level");
});

test("Canadian spellings have American ones to try", () => {
  assert.deepEqual(americanSpellings("candour"), ["candor"]);
  assert.deepEqual(americanSpellings("clamours"), ["clamors"]);
  assert.deepEqual(americanSpellings("centre"), ["center"]);
  assert.deepEqual(americanSpellings("defence"), ["defense"]);
  assert.deepEqual(americanSpellings("travelled"), ["traveled"]);
  assert.deepEqual(americanSpellings("lugubrious"), []);
});

test("strips tags with fields, like the date's sense marker", () => {
  assert.equal(cleanMarkup("1628{ds||1||}"), "1628");
});

test("a Canadian spelling with its own empty entry still finds the American one", async () => {
  const replies: Record<string, unknown[]> = {
    candour: [{ meta: { id: "candour" } }],
    candor: [{ meta: { id: "candor" }, et: [["text", "Latin {it}candor{/it}"]], date: "1653" }],
  };
  const realFetch = globalThis.fetch;
  process.env.MW_DICTIONARY_KEY = "test";
  globalThis.fetch = (async (url: string) => {
    const word = decodeURIComponent(String(url).split("/json/")[1].split("?")[0]);
    return new Response(JSON.stringify(replies[word] ?? []));
  }) as typeof fetch;
  try {
    assert.equal(await originOf("candour"), "Latin *candor*. First known use: 1653.");
  } finally {
    globalThis.fetch = realFetch;
  }
});
