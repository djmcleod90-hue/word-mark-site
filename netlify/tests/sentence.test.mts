import assert from "node:assert/strict";
import { test } from "node:test";
import { appealModel, cleanRequest, prompt, sentenceModel } from "../lib/sentence.mts";

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

test("an appeal is passed on, with the earlier feedback, to the most careful review", () => {
  const request = cleanRequest({ word: "abaft", definition: "behind", sentence: "The stern is abaft the helm.", appealOf: " The stern is at the back. " });
  assert.equal(request?.appealOf, "The stern is at the back.");
  const appeal = prompt(request!);
  assert.equal(appeal.model, appealModel());
  assert.match(appeal.system, /believes an earlier check wrongly rejected/);
  assert.match(appeal.user, /The earlier check said: The stern is at the back\./);
});

test("a first check uses the sentence model and says nothing of appeals", () => {
  const check = prompt(cleanRequest({ word: "abaft", definition: "behind", sentence: "The stern is abaft the helm." })!);
  assert.equal(check.model, sentenceModel());
  assert.doesNotMatch(check.system, /earlier check/);
  assert.match(check.system, /Judge the word, not the world/);
});
