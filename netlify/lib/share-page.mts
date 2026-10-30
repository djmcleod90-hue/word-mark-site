// The pages a word shared from the app opens: word-mark.ca/w/petrichor for one word, and
// word-mark.ca/l?w=petrichor,susurrus for a list. Only the words travel in the link, never a reader's own
// definitions or sentences, and nothing is stored.

import { isLookupWord } from "./etymology.mts";

export interface SharedWord {
  word: string;
  pos?: string;
  definition?: string;
  origin?: string;
  ipa?: string;
  examples?: string[];
}

/** The most words a list link carries; the app shares no more than this. */
export const MAX_LIST = 50;

/** Set once the app is on the App Store: shows Safari's app banner and a link to the app. */
const APP_STORE_ID = "";

/** A word as it arrives in a link: lowercase, curly apostrophes made straight. */
export const normalize = (word: string) => word.trim().toLowerCase().replace(/’/g, "'");

/** The words of a list link (?w=petrichor,susurrus), each checked, without repeats, at most MAX_LIST. */
export function listWords(param: string | null): string[] {
  const words = (param ?? "").split(",").map(normalize).filter(isLookupWord);
  return [...new Set(words)].slice(0, MAX_LIST);
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Merriam-Webster's **bold** and *italics*, kept as Markdown in the word bank, as HTML. */
export const styled = (s: string) =>
  escape(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<i>$1</i>");

/** Plain text for link previews: the Markdown marks dropped. */
const plain = (s: string) => s.replace(/\*+/g, "");

const numbers = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const count = (n: number) => numbers[n] ?? String(n);

export function wordPage(w: SharedWord, url: string): string {
  const meta = [w.ipa ? `/${escape(w.ipa)}/` : "", w.pos ? `<i>${escape(w.pos)}</i>` : ""].filter(Boolean).join("");
  const blocks = [
    w.origin ? `<div class="share-block"><p class="share-label">Origin</p><p>${styled(w.origin)}</p></div>` : "",
    w.examples?.length ? `<div class="share-block"><p class="share-label">In use</p>${w.examples.map((e) => `<p>${styled(e)}</p>`).join("")}</div>` : "",
  ].join("");
  const description = w.definition ? `${w.word}: ${plain(w.definition)}. Shared from Word-Mark.` : `${w.word}, a word shared from Word-Mark.`;
  return page({
    title: `${w.word} — Word&#8209;Mark™`,
    ogTitle: w.word,
    description,
    url,
    appArgument: url,
    body: `<div class="share-section"><div class="share-inner">
  <span class="eyebrow">A word shared from Word&#8209;Mark</span>
  <h1 class="share-word">${escape(w.word)}</h1>
  ${meta ? `<p class="share-meta">${meta}</p>` : ""}
  ${w.definition ? `<p class="share-def">${styled(w.definition)}</p>` : ""}
  ${blocks}
</div></div>
${cta("Add to my words")}`,
  });
}

export function listPage(words: SharedWord[], url: string): string {
  const n = words.length;
  const heading = `${count(n)} word${n === 1 ? "" : "s"}, collected while reading`;
  const items = words.map((w) =>
    `<li><a href="/w/${encodeURIComponent(w.word)}"><span class="w">${escape(w.word)}${w.pos ? `<i>${escape(w.pos)}</i>` : ""}</span>` +
    (w.definition ? `<span class="d">${styled(w.definition)}</span>` : "") + `</a></li>`).join("");
  return page({
    title: `${heading} — Word&#8209;Mark™`,
    ogTitle: heading,
    description: words.slice(0, 8).map((w) => w.word).join(", ") + (n > 8 ? "…" : "") + ". Shared from Word-Mark.",
    url,
    appArgument: url,
    body: `<div class="share-section"><div class="share-inner">
  <span class="eyebrow">Words shared from Word&#8209;Mark</span>
  <h1 class="share-word share-word-list">${heading}</h1>
  <ul class="share-list">${items}</ul>
</div></div>
${cta(n === 1 ? "Add it to my words" : `Add all ${n} to my words`)}`,
  });
}

export function notFoundPage(): string {
  return page({
    title: "Word not found — Word&#8209;Mark™",
    ogTitle: "Word-Mark",
    description: "A vocabulary bookmark for the words you meet in books.",
    url: "https://word-mark.ca/",
    body: `<div class="share-section"><div class="share-inner">
  <span class="eyebrow">Word&#8209;Mark</span>
  <h1 class="share-word share-word-list">This link doesn't lead to a word</h1>
  <p class="body-text">It may have been cut short when it was shared.</p>
</div></div>
${cta()}`,
  });
}

/** Get-the-app for those without it; the app opens these links itself once installed. */
function cta(addLabel?: string): string {
  const get = APP_STORE_ID && addLabel
    ? `<a class="btn btn-solid" href="https://apps.apple.com/app/id${APP_STORE_ID}">${addLabel}</a>` : "";
  return `<div class="share-cta"><div class="share-inner">
  <h2>Collect the words you find in books</h2>
  <p class="body-text">Word&#8209;Mark™ is a vocabulary bookmark for readers, writers, and thinkers. Jot down new words as you read. When you set your book down, look them up and write their meanings — this forms the first step in remembering them. The app reads your handwriting and keeps every word, so you can practise them later and welcome them into your active vocabulary.</p>
  <div class="share-buttons">${get}<a class="btn" href="/">Discover Word&#8209;Mark</a></div>
</div></div>`;
}

interface PageParts { title: string; ogTitle: string; description: string; url: string; appArgument?: string; body: string }

function page(p: PageParts): string {
  const d = escape(p.description);
  const banner = APP_STORE_ID
    ? `<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}${p.appArgument ? `, app-argument=${escape(p.appArgument)}` : ""}">` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.title}</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${escape(p.url)}">
${banner}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Word-Mark™">
<meta property="og:url" content="${escape(p.url)}">
<meta property="og:title" content="${escape(p.ogTitle)}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="https://word-mark.ca/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(p.ogTitle)}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="https://word-mark.ca/og-image.png">
<link href="https://fonts.googleapis.com/css2?family=Aboreto&family=Figtree:ital,wght@0,300;0,400;0,500;1,300&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="${FAVICON}">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<nav>
  <a href="/" class="nav-logo">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 543 387.5" class="wm-mark"><path class="st0" d="${MARK}"/></svg>
    <span class="nav-name">Word&#8209;Mark™</span>
  </a>
  <ul class="nav-links" id="navLinks">
    <li><a href="/">Home</a></li>
    <li><a href="/about.html">About</a></li>
    <li><a href="/stocklist.html">Stocklist</a></li>
    <li><a href="/contact.html">Contact</a></li>
  </ul>
  <button class="nav-toggle" id="navToggle" onclick="toggleNav()" aria-label="Menu" aria-expanded="false">
    <span></span><span></span><span></span>
  </button>
</nav>
${p.body}
<footer>
  <div class="footer-logo">Word&#8209;Mark™</div>
  <ul class="footer-links">
    <li><a href="/privacy.html">Privacy</a></li>
  </ul>
  <p class="footer-copy">© 2026 Word&#8209;Mark · Vancouver, Canada</p>
</footer>
<script>
function toggleNav() {
  const links = document.getElementById('navLinks');
  const toggle = document.getElementById('navToggle');
  const open = links.classList.toggle('open');
  toggle.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', open);
}
</script>
</body>
</html>`;
}

const MARK = "M537,25L509.5,0l-125.5,146.5L271.5,14.5l-112.5,132L33.5,0,6,25l133.5,157L0,358.5l30.5,26.5,116-145,125,147.5,125-147.5,116,145,30.5-26.5-139.5-176.5L537,25ZM271.5,74.5l105.5,123.5-105.5,124.5-105.5-124.5,105.5-123.5ZM530.5,357.5l-18,13-116-145-125,148-125-148L30.5,370.5l-18-13,133.5-168,125.5,147,125.5-147,133.5,168Z";
const FAVICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1NDMgMzg3LjUiPjxwYXRoIGZpbGw9IiMxYTE4MTQiIGQ9Ik01MzcsMjVMNTA5LjUsMGwtMTI1LjUsMTQ2LjVMMjcxLjUsMTQuNWwtMTEyLjUsMTMyTDMzLjUsMCw2LDI1bDEzMy41LDE1N0wwLDM1OC41bDMwLjUsMjYuNSwxMTYtMTQ1LDEyNSwxNDcuNSwxMjUtMTQ3LjUsMTE2LDE0NSwzMC41LTI2LjUtMTM5LjUtMTc2LjVMNTM3LDI1Wk0yNzEuNSw3NC41bDEwNS41LDEyMy41LTEwNS41LDEyNC41LTEwNS41LTEyNC41LDEwNS41LTEyMy41Wk01MzAuNSwzNTcuNWwtMTgsMTMtMTE2LTE0NS0xMjUsMTQ4LTEyNS0xNDhMMzAuNSwzNzAuNWwtMTgtMTMsMTMzLjUtMTY4LDEyNS41LDE0NywxMjUuNS0xNDcsMTMzLjUsMTY4WiIvPjwvc3ZnPg==";
