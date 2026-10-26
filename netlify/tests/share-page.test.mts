import assert from "node:assert/strict";
import { test } from "node:test";
import { listPage, listWords, MAX_LIST, styled, wordPage } from "../lib/share-page.mts";

test("a list link's words are checked, lowercased and not repeated", () => {
  assert.deepEqual(listWords("Petrichor,susurrus,petrichor,,<script>,en masse,don’t"), ["petrichor", "susurrus", "en masse", "don't"]);
  assert.deepEqual(listWords(null), []);
  assert.equal(listWords(Array.from({ length: 80 }, (_, i) => "word" + "abcdefghij"[i % 10] + "abcdefgh"[Math.floor(i / 10)]).join(",")).length, MAX_LIST);
});

test("the word bank's Markdown becomes HTML, and nothing else does", () => {
  assert.equal(styled("Latin *lambere* to **lick** <b>"), "Latin <i>lambere</i> to <strong>lick</strong> &lt;b&gt;");
});

test("a word's page shows what it has and leaves out what it doesn't", () => {
  const page = wordPage({ word: "petrichor", pos: "noun", definition: "The pleasant smell of rain on dry earth", ipa: "ˈpɛtrəˌkɔr" }, "https://word-mark.ca/w/petrichor");
  assert.match(page, /<h1 class="share-word">petrichor<\/h1>/);
  assert.match(page, /The pleasant smell of rain on dry earth/);
  assert.doesNotMatch(page, /Origin|In use/);
  assert.match(page, /<link rel="canonical" href="https:\/\/word-mark.ca\/w\/petrichor">/);
});

test("a list's page counts its words and links each one", () => {
  const page = listPage([{ word: "susurrus" }, { word: "lambent" }], "https://word-mark.ca/l?w=susurrus,lambent");
  assert.match(page, /Two words, collected while reading/);
  assert.match(page, /href="\/w\/susurrus"/);
});
