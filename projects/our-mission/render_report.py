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

# The site chrome's scroll effects are the page script's: as the window
# scrolls it gives the fixed nav its glass look (.is-scrolled, 20px taller)
# and stretches the reading-progress bar. A script runs once per document and
# the editor's incremental render never runs it, so after an edit made while
# scrolled the nav snapped back to its resting look and the bar to empty, and
# neither moved again — the listener still held the nodes the edit replaced.
# In the editor they hold still instead: the nav keeps its resting look (the
# values the import's own rules give it) and the bar is not drawn. The
# published page, which always runs its script, keeps both.
EDIT_CSS = """
[class*="reveal"], [class*="fade"], [class*="animate"], [data-aos] {
  opacity: 1 !important; transform: none !important;
  visibility: visible !important;
}
.px-nav.is-scrolled { background:#fff; box-shadow:none;
  -webkit-backdrop-filter:none; backdrop-filter:none; }
@media (min-width:701px) {
  .px-nav.is-scrolled { padding-top:14px; padding-bottom:14px; }
  .px-nav.is-scrolled .px-brand-mark { width:40px; height:40px; }
}
.px-scroll-progress { display:none; }
""" if EDIT else ""

SRC = (HERE / "original.html").read_text()
_body_m = re.search(r"<body[^>]*>(.*)</body>", SRC, re.S | re.I)
_head_src = SRC[:_body_m.start()] if _body_m else ""
STYLE = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", _head_src, re.S | re.I))
# The import map, carried over with the styles. The hero mark's script does
# `import * as THREE from 'three'`, a bare name only the map resolves; with
# the map left behind in the original's head every build threw "Failed to
# resolve module specifier 'three'" and the mark never drew. The module is
# vendored beside the page (assets/vendor/three.module.js, r160, the same file
# hiappleseed.org serves), and the map points there relative to the page.
IMPORTMAP = "\n".join(re.findall(r'<script type="importmap">.*?</script>', _head_src, re.S | re.I))
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
# The "Five" carousel leaned on the page's own script for two things it sets
# at load. A script runs once per document, and the editor's incremental
# render puts a re-rendered page in place without running it, so after any
# edit both fell back to the import's sheet. Both are CSS here instead:
#  - Its height. The three phase bodies share one slot, each absolutely
#    positioned over the others, so they give .ha-five-bodies no height; the
#    sheet holds 340px until sizeBodies() writes the tallest body's height
#    inline (246px). Without it everything under the carousel dropped 94px
#    (0.98in). Stacked in one grid cell, the slot is as tall as its tallest
#    body by itself, script or no script. The min-height is !important
#    because the script still writes its measurement inline: the same
#    number, but the height must not depend on whether the script has run.
#  - The focus icons. Each focus card's icon fades and grows with --morph,
#    which the sheet rests at 1 and the script holds at 0 until the focus
#    phase; at 1 the five icons sat over the practices' numbered badges. It
#    rests at 0 now unless that phase's body is the active one, and the
#    script's inline value still drives the morph between phases.
# Desktop only: at 700px and under the import's carousel shows one body at a
# time and sizes itself. One class more than the import's rules, which sit
# later, in the body.
FIVE_CSS = """
  @media (min-width:701px){
    .ha-mission .ha-five .ha-five-bodies{display:grid;
      grid-template-columns:minmax(0,1fr);min-height:0 !important;}
    .ha-mission .ha-five .ha-five-body{grid-area:1/1;position:relative;
      align-self:start;}
    .ha-mission .ha-five .ha-five-body-c:not(.is-active) .ha-focus-card{
      --morph:0;}
  }"""

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


SHEETS = ("".join(L.sheet(pid, BODY if pid == DESIGNED_PAGES else "")
                  for pid in L.page_order(DESIGNED_PAGES))
          + L.pagemeta(range(1, DESIGNED_PAGES + 1)))

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{C.text("title")}</title>
{IMPORTMAP}
<style>
{OKINA_FACES}
  body {{ margin:0; background:#EDF1EE; }}
  .page {{ width:{L.page_w}in; min-height:{L.page_h}in; margin:0 auto;
           background:#fff; position:relative; overflow:hidden; }}
  {STYLE}{FLOOR_CSS}{FIVE_CSS}
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
