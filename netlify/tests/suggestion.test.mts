import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSuggestion, formBody } from "../lib/suggestion.mts";

const good = { word: "Arboretum", definition: "A garden of trees", reason: "wrong" };

test("accepts a suggestion with or without a note, trimmed", () => {
  assert.deepEqual(cleanSuggestion({ ...good, word: " Arboretum " }), { ...good, note: "" });
  assert.equal(cleanSuggestion({ ...good, note: " Too narrow. " })?.note, "Too narrow.");
});

test("refuses missing fields, unknown reasons, and oversized text", () => {
  assert.equal(cleanSuggestion(null), null);
  assert.equal(cleanSuggestion({ ...good, word: " " }), null);
  assert.equal(cleanSuggestion({ ...good, definition: undefined }), null);
  assert.equal(cleanSuggestion({ ...good, reason: "bad" }), null);
  assert.equal(cleanSuggestion({ ...good, reason: "constructor" }), null);
  assert.equal(cleanSuggestion({ ...good, note: 5 }), null);
  assert.equal(cleanSuggestion({ ...good, note: "x".repeat(1001) }), null);
  assert.equal(cleanSuggestion({ ...good, word: "x".repeat(81) }), null);
});

test("the emailed form carries the reason's wording and the form's name", () => {
  const fields = new URLSearchParams(formBody({ ...good, note: "A & B" }));
  assert.equal(fields.get("form-name"), "definition-suggestion");
  assert.equal(fields.get("reason"), "It's wrong");
  assert.equal(fields.get("note"), "A & B");
});
