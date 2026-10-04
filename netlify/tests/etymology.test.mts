import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanMarkup, originFromEntries } from "../lib/etymology.mts";

test("turns Merriam-Webster markup into plain text with italics", () => {
  assert.equal(
    cleanMarkup("Latin {it}lugubris{/it}, from {it}lugēre{/it} to mourn {ma}{mat|luctuous|}{/ma}"),
    "Latin *lugubris*, from *lugēre* to mourn",
  );
  assert.equal(cleanMarkup("{et_link|defenestration|defenestration}, back-formation"), "defenestration, back-formation");
});

test("finds the entry by headword, or by one of its forms", () => {
  const entries = [
    { meta: { id: "candor", stems: ["candor", "candour", "candors"] }, et: [["text", "Latin {it}candor{/it}, from {it}candēre{/it} to shine"]] },
  ];
  assert.equal(originFromEntries("candour", entries), "Latin *candor*, from *candēre* to shine.");
  assert.equal(originFromEntries("candor", entries), "Latin *candor*, from *candēre* to shine.");
});

test("no origin when the word isn't found (Merriam-Webster sends spelling suggestions)", () => {
  assert.equal(originFromEntries("beazel", ["bezel", "beagle"]), "");
  assert.equal(originFromEntries("lugubrious", [{ meta: { id: "lugubrious" } }]), "");
});
