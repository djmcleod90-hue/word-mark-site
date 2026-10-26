#!/usr/bin/env python3
"""Words readers have collected in the app that aren't in wordbank.json yet, for choosing which to add.

The app looks up each word it collects at /api/word, and the service keeps what Merriam-Webster had for it
(netlify/functions/word.mts), with a count of how many readers looked it up. This lists those words, most
collected first, with the details a word bank entry would take from them. Only words, never who collected them.

  NETLIFY_AUTH_TOKEN=… NETLIFY_SITE_ID=… python3 scripts/new-words.py [--all] [--csv new-words.csv]

The token is a Netlify personal access token (User settings › Applications); the site ID is under
Site configuration › General. Words Merriam-Webster didn't recognize (often misreads) are left out unless --all.
"""

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

API = "https://api.netlify.com/api/v1/blobs"
STORE = "site:word-mark-etymology"  # getStore({ name: "word-mark-etymology" }) in the functions
DETAILS = "details-v3/word/"
READERS = "readers/word/"


def request(url, token, accept=None):
    headers = {"authorization": f"Bearer {token}"}
    if accept:
        headers["accept"] = accept
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as reply:
        return reply.read()


def keys(site, token, prefix):
    """Every key in the store under prefix, following Netlify's pages."""
    found, cursor = [], None
    while True:
        query = {"prefix": prefix, **({"cursor": cursor} if cursor else {})}
        page = json.loads(request(f"{API}/{site}/{STORE}?{urllib.parse.urlencode(query)}", token))
        found += [blob["key"] for blob in page.get("blobs", [])]
        cursor = page.get("next_cursor")
        if not cursor:
            return found


def value(site, token, key):
    """A blob's contents: Netlify answers with a signed address to fetch them from."""
    path = urllib.parse.quote(f"{STORE}/{key}", safe="/:")
    signed = json.loads(request(f"{API}/{site}/{path}", token, accept="application/json;type=signed-url"))
    with urllib.request.urlopen(signed["url"], timeout=30) as reply:
        return reply.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--all", action="store_true", help="include words Merriam-Webster didn't recognize")
    parser.add_argument("--csv", help="also write the list to this CSV file")
    args = parser.parse_args()
    token, site = os.environ.get("NETLIFY_AUTH_TOKEN"), os.environ.get("NETLIFY_SITE_ID")
    if not token or not site:
        sys.exit("Set NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID (see the top of this script).")

    bank = json.loads((Path(__file__).resolve().parent.parent / "wordbank.json").read_text())
    known = {entry["word"].lower() for entry in bank["words"]}
    words = [k[len(DETAILS):] for k in keys(site, token, DETAILS)]
    words = [w for w in words if w not in known]

    def details(word):
        entry = json.loads(value(site, token, DETAILS + word))
        try:
            readers = int(value(site, token, READERS + word))
        except urllib.error.HTTPError:  # looked up before readers were counted
            readers = 0
        return {"word": word, "readers": readers, "pos": entry.get("partOfSpeech", ""), "ipa": entry.get("ipa", ""),
                "origin": entry.get("origin", ""), "examples": " | ".join(entry.get("examples", [])),
                "first seen": entry.get("at", "")[:10]}

    with ThreadPoolExecutor(8) as pool:
        rows = list(pool.map(details, words))
    if not args.all:
        rows = [r for r in rows if r["pos"] or r["ipa"] or r["origin"]]
    rows.sort(key=lambda r: (-r["readers"], r["word"]))

    for r in rows:
        print(f"{r['readers']:>4}  {r['word']:<24} {r['pos']:<18} {r['ipa']}")
    print(f"\n{len(rows)} collected words not in the word bank ({len(known)} in it).")
    if args.csv:
        with open(args.csv, "w", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=list(rows[0]) if rows else ["word"])
            writer.writeheader()
            writer.writerows(rows)
        print(f"Written to {args.csv}.")


if __name__ == "__main__":
    main()
