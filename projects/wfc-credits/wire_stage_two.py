#!/usr/bin/env python3
"""STAGE TWO for the Estimates credits page: tables, endnotes, headline numbers.

Run once after `docsync.scaffold` + `docsync.propose` (both are re-runnable from
a fresh build of the site's page; this script is idempotent on their output):

    python3 projects/wfc-credits/wire_stage_two.py

What it does to body.slotted.html, content.md and layout.json:

  * every <table> becomes a real flow table in layout.json `tables` (the
    editor's Table panel: retype cells, add and remove rows and columns) and a
    `<!--wfc:table:ID-->` placeholder in the body that render_report.py fills;
  * every footnote marker <sup><a href="#enN">N</a></sup> becomes a `[^id]`
    citation token at the end of the slot it followed, and the endnote list
    becomes the [[sources]] block, so a cited sentence carries its note when it
    moves and the numbers follow reading order;
  * the headline stat figures ("$76 million") become slots.

The page's own look is NOT changed here: render_report.py draws the site's
table and endnote markup when WFC_SITE=1 (the publish path) and the editor's own
objects otherwise.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
BODY = HERE / "body.slotted.html"
CONTENT = HERE / "content.md"
LAYOUT = HERE / "layout.json"

body = BODY.read_text()
content = CONTENT.read_text()
layout = json.loads(LAYOUT.read_text())


def text_of(frag: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", frag)).strip()


def slug(s: str, n: int = 4) -> str:
    words = re.findall(r"[a-z0-9]+", s.lower().replace("ʻ", ""))
    return "-".join(words[:n]) or "x"


def drop_slot(key: str) -> None:
    global content
    content = re.sub(r"\n?\[\[" + re.escape(key) + r"\]\]\n.*?(?=\n\[\[|\Z)", "", content, flags=re.S)


def append_to_slot(key: str, token: str) -> None:
    global content
    pat = re.compile(r"(\[\[" + re.escape(key) + r"\]\]\n)(.*?)(?=\n\n\[\[|\n\[\[|\Z)", re.S)
    m = pat.search(content)
    if not m:
        raise SystemExit(f"slot {key} not found in content.md")
    content = content[:m.start(2)] + m.group(2).rstrip() + token + content[m.end(2):]


# -- 1. tables ---------------------------------------------------------------
TABLE = re.compile(r'<div class="ha-est__table-wrap"><table>(.*?)</table></div>', re.S)
CAPTION = re.compile(r'<p class="ha-est__figcap"[^>]*>(?:⟦T:([^⟧]+)⟧|([^<]*))</p>$')
tables = [t for t in layout.get("tables", []) if not str(t.get("id", "")).startswith("wfc.")]
raw_content_blocks = dict(re.findall(r"\[\[([^\]]+)\]\]\n(.*?)(?=\n\n\[\[|\n\[\[|\Z)", content, re.S))
count = 0


def seed(m: re.Match) -> str:
    global count
    count += 1
    inner = m.group(1)
    head = re.search(r"<thead>(.*?)</thead>", inner, re.S).group(1)
    rows = [[text_of(c) for c in re.findall(r"<th[^>]*>(.*?)</th>", head, re.S)]]
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", re.search(r"<tbody>(.*?)</tbody>", inner, re.S).group(1), re.S):
        rows.append([text_of(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)])
    # The caption sits just before this table in the body.
    before = body[:m.start()]
    cap = CAPTION.search(before[before.rfind('<p class="ha-est__figcap"'):])
    label = ""
    if cap:
        label = (raw_content_blocks.get(cap.group(1) or "", cap.group(2) or "")).strip()
    num = re.match(r"Table (\d+[a-z]?)\.", label)
    tid = f"wfc.table-{num.group(1)}" if num else f"wfc.table-{count}"
    tables.append({"id": tid, "flow": True, "header": True,
                   "headerFill": "#354F52", "headerColor": "#FFFFFF",
                   "rows": rows})
    return f"<!--wfc:table:{tid}-->"


body = TABLE.sub(seed, body)
layout["tables"] = tables

# -- 2. citations ------------------------------------------------------------
ol = re.search(r'<ol class="ha-est__endnotes">(.*?)</ol>', body, re.S)
notes: dict[int, tuple[str, str, str]] = {}      # n -> (id, text, url)
labels: dict[str, str] = {}
if ol:
    for n, li in re.findall(r'<li id="en(\d+)"[^>]*>(.*?)</li>', ol.group(1), re.S):
        # The slot fragments propose made inside the note carry its words in
        # content.md; put them back in order, then read the note whole.
        def fill(mm):
            return raw_content_blocks.get(mm.group(1), "")
        li_full = re.sub(r"⟦T:([^⟧]+)⟧", fill, li)
        li_full = re.sub(r"⟦A:[^⟧]+⟧", "", li_full)
        # The link is an <a> in the page and a markdown link where propose
        # folded it into a slot's text; accept either.
        link = re.search(r'<a href="([^"]+)">(.*?)</a>', li_full, re.S)
        mdlink = re.search(r"\[([^\]]+)\]\((\S+?)\)\s*$", li_full.strip()) if not link else None
        if link:
            url, label = html.unescape(link.group(1)), text_of(link.group(2))
        elif mdlink:
            url, label = mdlink.group(2), mdlink.group(1)
        else:
            url = label = ""
        no_link = re.sub(r'<a href="[^"]+">.*?</a>', "", li_full, flags=re.S)
        if mdlink:
            no_link = li_full.strip()[:mdlink.start()]
        txt = html.unescape(re.sub(r"<code>(.*?)</code>", r"`\1`", re.sub(r"</?span[^>]*>", "", no_link))).strip()
        txt = re.sub(r"\s+", " ", txt)
        notes[int(n)] = (f"n{n}-{slug(txt, 3)}", txt, url)
        if url:
            labels[url] = label
        # The slots those fragments used are gone with the list.
        for k in re.findall(r"⟦T:([^⟧]+)⟧", li):
            drop_slot(k)
    body = body.replace(ol.group(0), '<ol class="ha-est__endnotes"><!--wfc:endnotes--></ol>')

SUP = re.compile(r'(⟦T:([^⟧]+)⟧</[a-z]+>)((?:<sup><a href="#en\d+" id="ref-\d+">\d+</a></sup>)+)')


def cite(m: re.Match) -> str:
    key = m.group(2)
    for n in re.findall(r'href="#en(\d+)"', m.group(3)):
        append_to_slot(key, f"[^{notes[int(n)][0]}]")
    return m.group(1)


body = SUP.sub(cite, body)
leftover = re.findall(r'<sup><a href="#en\d+"', body)
if leftover:
    raise SystemExit(f"{len(leftover)} footnote marker(s) not directly after a slot — wire them by hand")

sources = "\n".join(f"[{sid}]: {txt}" + (f" — {url}" if url else "") for _, (sid, txt, url) in sorted(notes.items()))
content = re.sub(r"\[\[sources\]\]\n.*\Z", "[[sources]]\n" + sources + "\n", content, flags=re.S)

# -- 3. headline stat figures --------------------------------------------------
n = 0


def stat(m: re.Match) -> str:
    global n, content
    n += 1
    key = f"ha-est-stat-num.div-{n}"
    value = m.group(1)
    content = re.sub(r"(\n\[\[sources\]\])", f"\n[[{key}]]\n{value}\n\\1", content, count=1)
    return f'<div class="ha-est__stat-num"⟦A:{key}⟧>⟦T:{key}⟧</div>'


body = re.sub(r'<div class="ha-est__stat-num">([^<]*)</div>', stat, body)

BODY.write_text(body)
CONTENT.write_text(content)
LAYOUT.write_text(json.dumps(layout, ensure_ascii=False, indent=2) + "\n")
(HERE / "url_labels.json").write_text(json.dumps(labels, ensure_ascii=False, indent=2) + "\n")
print(f"{count} tables, {len(notes)} sources, {n} stat figures wired")
