import assert from "node:assert/strict";
import { test } from "node:test";
import { audioURL, detailsOf, entryDetails, mwToIPA } from "../lib/word-details.mts";

test("turns Merriam-Webster's respelling into IPA", () => {
  assert.equal(mwToIPA("ˈchər-lish"), "ˈtʃərlɪʃ");
  assert.equal(mwToIPA("ˈhā-dᵊl"), "ˈheɪdəl");
  assert.equal(mwToIPA("dē-ˌä-blə-ˈrē"), "diˌɑbləˈri");
  assert.equal(mwToIPA("ˈthi-t͟hər"), "ˈθɪðər");
  assert.equal(mwToIPA("lu̇-ˈgü-brē-əs"), "lʊˈgubriəs");
  assert.equal(mwToIPA("ˈȯi-stər"), "ˈɔɪstər");
  assert.equal(mwToIPA("ˈau̇t-ˌlȯ"), "ˈaʊtˌlɔ");
  assert.equal(mwToIPA("ˈyu̇r-ə-pē-ən"), "ˈjʊrəpiən");
  assert.equal(mwToIPA("ˈjü-bə-ˌlē"), "ˈdʒubəˌli");
});

test("keeps only the first way of saying it, without optional sounds", () => {
  assert.equal(mwToIPA("(ˌ)pan-ˌdi-kyə-ˈlā-shən"), "pænˌdɪkjəˈleɪʃən");
  assert.equal(mwToIPA("ˈe-kə-ˌnä-mik, ˌē-kə-"), "ˈɛkəˌnɑmɪk");
  assert.equal(mwToIPA("ˈthi-t\u035Fhər, also ˈt\u035Fhi-"), "ˈθɪðər");
  assert.equal(mwToIPA(""), "");
});

const churlish = {
  meta: { id: "churlish", stems: ["churlish", "churlishly", "churlishness"] },
  hwi: { hw: "churl*ish", prs: [{ mw: "ˈchər-lish", sound: { audio: "churli01" } }] },
  fl: "adjective",
  def: [{ sseq: [
    [["sense", { sn: "1", dt: [["text", "{bc}of, resembling, or characteristic of a churl {bc}{sx|vulgar||}"]] }]],
    [["sense", { sn: "2", dt: [["text", "{bc}marked by a lack of civility {bc}{sx|surly||}"], ["vis", [{ t: "a {wi}churlish{/wi} refusal" }]]] }]],
    [["sense", { sn: "3", dt: [["text", "{bc}difficult to work with"], ["vis", [
      { t: "his {wi}churlish{/wi} behavior toward the neighbors was noticed by everyone" },
      { t: "… too {wi}churlish{/wi} to say thank you.", aq: { auth: "Jane Smith" } },
    ]]] }]],
  ] }],
  uros: [{ ure: "churl*ish*ly", fl: "adverb", prs: [{ mw: "ˈchər-lish-lē" }] }],
};

test("finds pronunciation, part of speech and examples, preferring whole sentences", () => {
  assert.deepEqual(entryDetails("churlish", [churlish]), {
    ipa: "ˈtʃərlɪʃ",
    audio: "https://media.merriam-webster.com/audio/prons/en/us/mp3/c/churli01.mp3",
    partOfSpeech: "adjective",
    examples: [
      "His **churlish** behaviour toward the neighbours was noticed by everyone",
      "… too **churlish** to say thank you. — Jane Smith",
    ],
  });
});

test("a run-on word has its own pronunciation and part of speech", () => {
  assert.deepEqual(entryDetails("churlishly", [churlish]), { ipa: "ˈtʃərlɪʃli", audio: "", partOfSpeech: "adverb", examples: [] });
});

test("an inflected form gets no pronunciation; spelling suggestions get nothing", () => {
  assert.deepEqual(entryDetails("churlishness", [churlish])?.ipa, "");
  assert.equal(entryDetails("beazel", ["bezel", "beagle"]), null);
});

test("a spelling variant is said like its headword", () => {
  const candor = {
    meta: { id: "candor", stems: ["candor", "candour"] }, hwi: { prs: [{ mw: "ˈkan-dər" }] }, fl: "noun",
    vrs: [{ vl: "chiefly British", va: "can*dour" }], et: [["text", "Latin {it}candor{/it}"]], date: "1653",
  };
  assert.equal(entryDetails("candour", [candor])?.ipa, "ˈkændər");
});

test("one fetch per spelling serves the origin and the details", async () => {
  const asked: string[] = [];
  const details = await detailsOf("churlish", async (word) => {
    asked.push(word);
    return word === "churlish" ? [{ ...churlish, et: [["text", "Middle English {it}cherlish{/it}"]], date: "before 12th century" }] : [];
  });
  assert.deepEqual(asked, ["churlish"]);
  assert.equal(details.origin, "Middle English *cherlish*. First known use: before 12th century.");
  assert.equal(details.ipa, "ˈtʃərlɪʃ");
});

test("an inflected form takes the entry it's built on", () => {
  const entries = [
    { meta: { id: "defenestration", stems: ["defenestration", "defenestrate", "defenestrated"] }, fl: "noun" },
    { meta: { id: "defenestrate", stems: ["defenestrate", "defenestrated"] }, fl: "verb" },
  ];
  assert.equal(entryDetails("defenestrated", entries)?.partOfSpeech, "verb");
});

test("a Canadian spelling's bare entry is filled in from the American one", async () => {
  const details = await detailsOf("candour", async (word) => word === "candour"
    ? [{ meta: { id: "candour", stems: ["candour"] }, hwi: { prs: [{ mw: "ˈkan-dər" }] } }]
    : word === "candor" ? [{ meta: { id: "candor", stems: ["candor"] }, fl: "noun", et: [["text", "Latin {it}candor{/it}"]] }] : []);
  assert.equal(details.ipa, "ˈkændər");
  assert.equal(details.partOfSpeech, "noun");
});

test("recording addresses follow Merriam-Webster's folder rule", () => {
  const base = "https://media.merriam-webster.com/audio/prons/en/us/mp3/";
  assert.equal(audioURL("hadal001"), `${base}h/hadal001.mp3`);
  assert.equal(audioURL("bixbol01"), `${base}bix/bixbol01.mp3`);
  assert.equal(audioURL("ggmail01"), `${base}gg/ggmail01.mp3`);
  assert.equal(audioURL("3d000001"), `${base}number/3d000001.mp3`);
  assert.equal(audioURL("_test01"), `${base}number/_test01.mp3`);
  assert.equal(audioURL("../x"), "");
  assert.equal(audioURL(""), "");
});
