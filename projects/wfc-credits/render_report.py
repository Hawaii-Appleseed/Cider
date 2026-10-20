#!/usr/bin/env python3
"""Saving the Working Families Tax Credit Expansions | Hawaiʻi Appleseed Estimates renderer — auto-slotted by `python3 -m docsync.propose`.

body.slotted.html is original.html's body with slot/movable markers; every
marker is substituted at build time from content.md ([[key]] blocks) and
layout.json. Rename a slot by changing the key in BOTH files. Richer wiring
(structured widgets, citations, page-specific edit-mode overrides) still
belongs in this file — see the report-editor skill.
"""
from pathlib import Path
import os
import re
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from docsync.content import Content              # noqa: E402
from docsync.layout import Layout                # noqa: E402
from docsync.blocks import fill_markers          # noqa: E402

_LAYOUT = Path(os.environ.get("DOCSYNC_LAYOUT") or (HERE / "layout.json"))
_CONTENT = Path(os.environ.get("DOCSYNC_CONTENT") or (HERE / "content.md"))
_OUT = Path(os.environ.get("DOCSYNC_OUT") or (HERE / "index.html"))

L = Layout(_LAYOUT, page=(12.5, 160.0))
C = Content(_CONTENT, styles=L)

EDIT = bool(os.environ.get("DOCSYNC_EDIT"))

EDIT_CSS = """
[class*="reveal"], [class*="fade"], [class*="animate"], [data-aos] {
  opacity: 1 !important; transform: none !important;
  visibility: visible !important;
}
""" if EDIT else ""

SRC = (HERE / "original.html").read_text()
_body_m = re.search(r"<body[^>]*>(.*)</body>", SRC, re.S | re.I)
_head_src = SRC[:_body_m.start()] if _body_m else ""
STYLE = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", _head_src, re.S | re.I))

# An imported page's DARK palette is a trap in the editor. The sheet this
# wrapper draws is always white, and a dark theme only recolours the text — so
# its near-white --ink lands on white paper. Measured on the page that showed
# this up: text luminance 179 against a 255 sheet, which is legible nowhere.
#
# Every page that ships a dark block ships a light one too, and that is the
# palette a printed report wants (such pages usually say so themselves, in an
# @media print block). So the dark half is switched off — by making its media
# condition unsatisfiable. An unknown media-feature VALUE invalidates only the
# component it appears in, so a comma-separated list keeps its other arms.
#
# EDIT MODE ONLY, deliberately: the published page is a real web page and keeps
# its dark mode, and these bytes stay identical to before outside the editor.
if EDIT:
    STYLE = re.sub(r"prefers-color-scheme\s*:\s*dark",
                   "prefers-color-scheme:ds-edit-light-only", STYLE, flags=re.I)

BODY = (HERE / "body.slotted.html").read_text()
# The markers (A=slot attr, T=slot text, S=movable spacer, E=movable attr,
# B=resizable background band) are the engine's to fill. fill_markers also
# makes every field MOVABLE and RESIZABLE, not only editable — the five
# re.subs this template used to write gave each field a slot and nothing else.
BODY = fill_markers(C, L, BODY)

# --- STAGE TWO: tables, citations, endnotes -----------------------------------
# WFC_SITE=1 is the publish path: the tables and endnotes are drawn in the
# Estimates site's own markup so the published page keeps its look. Without it
# they are the editor's objects: flow tables from layout.json `tables`, and the
# engine's endnote list.
import html as _html
import json

SITE = bool(os.environ.get("WFC_SITE"))
_LABELS_PATH = HERE / "url_labels.json"
URL_LABELS = json.loads(_LABELS_PATH.read_text()) if _LABELS_PATH.exists() else {}


def _cell(text):
    return _html.escape(text, quote=False)


def site_table(t):
    rows = t.get("rows", [])
    head, body_rows = (rows[0], rows[1:]) if t.get("header") and rows else ([], rows)
    th = "".join(f'<th scope="col">{_cell(c)}</th>' for c in head)
    trs = "".join(
        "<tr>" + "".join((f'<th scope="row">{_cell(c)}</th>' if k == 0 else f"<td>{_cell(c)}</td>")
                         for k, c in enumerate(r)) + "</tr>"
        for r in body_rows)
    return (f'<div class="ha-est__table-wrap"><table><thead><tr>{th}</tr></thead>'
            f'<tbody>{trs}</tbody></table></div>')


def _table(m):
    tid = m.group(1)
    t = L.table(tid)
    if SITE:
        if t is None:
            raise SystemExit(f"table {tid} is not in layout.json")
        return site_table(t)
    return L.flow_table(tid)


def site_endnotes():
    out = []
    for n, (sid, txt, url) in enumerate(C.fn.endnotes_with_ids(), 1):
        words = re.sub(r"`([^`]*)`", r"<code>\1</code>", _html.escape(txt, quote=False))
        link = (f' <a href="{_html.escape(url)}">{_html.escape(URL_LABELS.get(url, url))}</a>'
                if url else "")
        out.append(f'<li id="en{n}">{words}{link}</li>')
    return "".join(out)


def _endnotes(_m):
    return site_endnotes() if SITE else C.fn.endnote_items(L)


BODY = C.fn.resolve(BODY)
BODY = C.fn.linkify(BODY)
if SITE:
    BODY = re.sub(r'<a class="fn" href="#en(\d+)">', r'<a href="#en\1" id="ref-\1">', BODY)
BODY = re.sub(r"<!--wfc:table:([^>]+?)-->", _table, BODY)
BODY = re.sub(r"<!--wfc:endnotes-->", _endnotes, BODY)

# Every sheet, in order: this page, then any blank page added in the editor.
# Going through L.page_order() plus L.pagemeta() is what lets the editor's page
# strip offer "+ Page" and reordering \u2014 it withholds both from a renderer that
# never declared its pages, since an order nothing reads draws nothing.
DESIGNED_PAGES = 1


SHEETS = ("".join(L.sheet(pid, BODY if pid == DESIGNED_PAGES else "")
                  for pid in L.page_order(DESIGNED_PAGES))
          + L.pagemeta(range(1, DESIGNED_PAGES + 1)))

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{C.text("title")}</title>
<style>
  body {{ margin:0; background:#EDF1EE; }}
  .page {{ width:{L.page_w}in; min-height:{L.page_h}in; margin:0 auto;
           background:#fff; position:relative; overflow:hidden; }}
  {STYLE}
  {EDIT_CSS}
</style>
</head>
<body>
{SHEETS}
</body>
</html>
"""

_OUT.write_text(html)
print(f"wrote {_OUT} ({len(html):,} bytes)")
