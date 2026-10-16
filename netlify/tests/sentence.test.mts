import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanRequest } from "../lib/sentence.mts";

test("accepts a word and sentence, tidying spaces", () => {
  assert.deepEqual(cleanRequest({ word: " lugubrious ", definition: "sad", sentence: "His  lugubrious\nface." }),
    { word: "lugubrious", definition: "sad", sentence: "His lugubrious face." });
});

test("refuses missing or oversized input", () => {
  assert.equal(cleanRequest({ word: "", sentence: "A sentence." }), null);
  assert.equal(cleanRequest({ word: "argot", sentence: "" }), null);
  assert.equal(cleanRequest({ word: "argot", sentence: "x".repeat(401) }), null);
  assert.equal(cleanRequest(null), null);
});
