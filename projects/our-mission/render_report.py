#!/usr/bin/env python3
"""Our Mission — Hawaiʻi Appleseed renderer — auto-slotted by `python3 -m docsync.propose`.

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
from docsync.okina import OKINA_FACES, okinafy   # noqa: E402
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
# Manrope and Poppins have no U+02BB, so every ʻokina in "Hawaiʻi" fell back to
# the system UI font. okinafy() rewrites the inherited stacks rather than
# hand-editing original.html, which stays a pristine copy of the live page.
STYLE = okinafy(STYLE)
# The one size in the imported sheet below the engine's floor: the brand
# tagline under the logo, 9px (6.8pt printed) against MIN_TEXT_PX's 10.5px
# (7.875pt). Raised here, after the import's own rule, for the same reason
# okinafy() works here — original.html stays the live page's pristine copy.
# Its .26em tracking is what makes a small tagline read as one; that stays.
FLOOR_CSS = "\n  .px-nav .px-brand-tag{font-size:10.5px;}"

BODY = (HERE / "body.slotted.html").read_text()
# The markers (A=slot attr, T=slot text, S=movable spacer, E=movable attr,
# B=resizable background band) are the engine's to fill: fill_markers also
# makes every field movable and resizable, which five re.subs here never did.
BODY = fill_markers(C, L, BODY)
BODY = okinafy(BODY)                             # inline style= stacks too

# Every sheet, in order: this page, then any blank page added in the editor.
# Going through L.page_order() plus L.pagemeta() is what lets the page strip
# offer "+ Page" and reordering — the editor withholds both from a renderer
# that never declared its pages, since an order nothing reads draws nothing.
DESIGNED_PAGES = 1


def sheet(pid):
    """One <section class="page">: this report's markup for the designed page,
    empty for a blank page added in the editor.

    data-page carries the page's IDENTITY, which stops matching its position
    the moment the order can be changed.
    """
    inner = BODY if pid == DESIGNED_PAGES else ""
    return (f'<section class="page" data-page="{pid}"{L.fill_attr(f"page.{pid}")}>'
            f'{inner}'
            # Inside the section: .page is the positioning context every placed
            # element is measured against, so as siblings they sat a box out.
            f'{L.layer(pid)}{L.text_boxes(pid)}{L.tables_html(pid)}'
            f'</section>')


SHEETS = ("".join(sheet(pid) for pid in L.page_order(DESIGNED_PAGES))
          + L.pagemeta(range(1, DESIGNED_PAGES + 1)))

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{C.text("title")}</title>
<style>
{OKINA_FACES}
  body {{ margin:0; background:#EDF1EE; }}
  .page {{ width:{L.page_w}in; min-height:{L.page_h}in; margin:0 auto;
           background:#fff; position:relative; overflow:hidden; }}
  {STYLE}{FLOOR_CSS}
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
