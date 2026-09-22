#!/usr/bin/env python3
"""Tax Fairness Coalition — 2027 Priorities: What the Poll Said renderer — auto-slotted by `python3 -m docsync.propose`.

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
from docsync.blocks import slot_descriptions     # noqa: E402

_LAYOUT = Path(os.environ.get("DOCSYNC_LAYOUT") or (HERE / "layout.json"))
_CONTENT = Path(os.environ.get("DOCSYNC_CONTENT") or (HERE / "content.md"))
_OUT = Path(os.environ.get("DOCSYNC_OUT") or (HERE / "index.html"))

# Keep in step with the `page:` in docsync.yml. 38.5in is the content's
# measured bottom (37.2in, the .sheet's own height, after adding the
# "Priorities by bucket" section and its per-bucket ranked lists) plus slack:
# the editor's cut-in-print check compares actual content height against this
# configured height, so a value trimmed exactly to today's content would flag
# every future sentence as clipped.
# 160in was the scaffold's no-clip import default, ~6x the real page.
L = Layout(_LAYOUT, page=(12.5, 38.5))
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

# This page ships a dark palette (@media (prefers-color-scheme: dark) redefines
# --ink to #E8EEE9), and the sheet the wrapper draws is always white — so on a
# dark-mode machine the editor showed near-white ink on white paper: text
# luminance 179 against 255. The page's own @media print block already says
# which palette it means for paper, and it is the light one.
#
# Switched off by making the media condition unsatisfiable: an unknown
# media-feature VALUE invalidates only the component it appears in, so a
# comma-separated list keeps its other arms. EDIT MODE ONLY — the published page
# is a real web page and keeps its dark mode, and these bytes are unchanged
# outside the editor.
if EDIT:
    STYLE = re.sub(r"prefers-color-scheme\s*:\s*dark",
                   "prefers-color-scheme:ds-edit-light-only", STYLE, flags=re.I)

BODY = (HERE / "body.slotted.html").read_text()
# Every bar in this page is drawn in CSS with role="img" and an aria-label
# spelling out its tally — which is the WHOLE figure for a reader who cannot
# see the bar, and was a literal in the markup that nobody could edit. They
# are slotted (desc.1 … desc.N, document order) BEFORE the markers below, so
# the pass only ever sees the body's own attributes and never an aria-label
# that arrived inside a slot's words. content.md's note about the three
# hand-maintained places that must agree — the counts, the widths and these
# labels — still applies; this makes the third of them editable.
BODY = slot_descriptions(C, BODY, "desc")
# marker substitution: A=slot attr, T=slot text, S=movable spacer,
# E=movable attr, B=resizable background band
BODY = re.sub("\u27e6A:([a-z0-9_.-]+)\u27e7", lambda m: C.slot_attr(m.group(1)), BODY)
BODY = re.sub("\u27e6T:([a-z0-9_.-]+)\u27e7", lambda m: C(m.group(1)), BODY)
BODY = re.sub("\u27e6S:([a-z0-9_.-]+)\u27e7", lambda m: L.spacer(m.group(1)), BODY)
BODY = re.sub("\u27e6E:([a-z0-9_.-]+)\u27e7", lambda m: L.attr(m.group(1)), BODY)
BODY = re.sub("\u27e6B:([a-z0-9_.-]+)\u27e7", lambda m: L.sec(m.group(1)), BODY)

# The one component this report has that original.html never had: the stacked
# family bar. Its CSS lives here rather than in original.html, which stays the
# untouched import. The three fills are TINTS OF ONE HUE, not the agree/pass/
# disagree palette — those three colours already mean a vote type everywhere
# else on the page, and reusing them for policy families would read as though
# credits were "agree" and GET were "disagree". A sequential ramp says "three
# parts of one whole", which is what this bar is. Each fill carries its own ink
# colour because the label sits INSIDE the segment, and dark mode is redefined
# in both places original.html defines it (media query and [data-theme]) so a
# themed editor and a themed browser agree.
FAMILY_CSS = """
:root{
  --fam1:#52796F; --fam1-ink:#FFFFFF;
  --fam2:#8AA79E; --fam2-ink:#1F2E2A;
  --fam3:#C3CEC5; --fam3-ink:#1F2E2A;
}
@media (prefers-color-scheme: dark){
  :root{
    --fam1:#9DBFA6; --fam1-ink:#16211E;
    --fam2:#5E8177; --fam2-ink:#EAF2EE;
    --fam3:#3A4A4A; --fam3-ink:#DCE6E1;
  }
}
:root[data-theme="dark"]{
  --fam1:#9DBFA6; --fam1-ink:#16211E;
  --fam2:#5E8177; --fam2-ink:#EAF2EE;
  --fam3:#3A4A4A; --fam3-ink:#DCE6E1;
}
:root[data-theme="light"]{
  --fam1:#52796F; --fam1-ink:#FFFFFF;
  --fam2:#8AA79E; --fam2-ink:#1F2E2A;
  --fam3:#C3CEC5; --fam3-ink:#1F2E2A;
}
.famsplit{margin:.2rem 0 1.5rem;}
.famsplit-bar{display:flex; height:2.1rem; border-radius:3px; overflow:hidden;
  background:var(--empty);}
.famsplit-bar i{display:flex; align-items:center; justify-content:center;
  font-style:normal; font-size:.9rem; font-weight:700; letter-spacing:.01em;
  font-variant-numeric:tabular-nums;}
.famsplit-bar .f1{background:var(--fam1); color:var(--fam1-ink);}
.famsplit-bar .f2{background:var(--fam2); color:var(--fam2-ink);}
.famsplit-bar .f3{background:var(--fam3); color:var(--fam3-ink);}
.famsplit-key{display:flex; flex-wrap:wrap; gap:.35rem 1.25rem; margin-top:.55rem;
  font-size:.8rem; color:var(--ink-faint);}
.famsplit-key > span{display:inline-flex; align-items:center; gap:.4rem;}
.famsplit-cap{margin:.55rem 0 0; font-size:.84rem; color:var(--ink-soft);
  max-width:46rem;}
"""

# The Coalition's 2027 Charter groups its ballot into three priority buckets
# (tax the wealthy / tax corporations / tax credits and assistance) — a
# different cut of the same 14 ideas than the credits/raisers/GET split above,
# so it gets its own colour ramp rather than reusing --fam1..3 (which would
# visually claim the two splits are the same grouping). GET is deliberately
# NOT one of the three bars: the Charter treats it as its own track, so it's
# shown as a separate dashed callout below the bucket cards, not a fourth
# segment competing for a share of the same bar.
BUCKET_CSS = """
:root{
  --bkt1:#3B6E8F; --bkt1-ink:#FFFFFF;
  --bkt2:#A65D3D; --bkt2-ink:#FFFFFF;
  --bkt3:#C99A3E; --bkt3-ink:#241B08;
}
@media (prefers-color-scheme: dark){
  :root{
    --bkt1:#7FA8C4; --bkt1-ink:#0F1E27;
    --bkt2:#D08F6D; --bkt2-ink:#2A140A;
    --bkt3:#E0BD73; --bkt3-ink:#241B08;
  }
}
:root[data-theme="dark"]{
  --bkt1:#7FA8C4; --bkt1-ink:#0F1E27;
  --bkt2:#D08F6D; --bkt2-ink:#2A140A;
  --bkt3:#E0BD73; --bkt3-ink:#241B08;
}
:root[data-theme="light"]{
  --bkt1:#3B6E8F; --bkt1-ink:#FFFFFF;
  --bkt2:#A65D3D; --bkt2-ink:#FFFFFF;
  --bkt3:#C99A3E; --bkt3-ink:#241B08;
}
.famsplit-bar .b1{background:var(--bkt1); color:var(--bkt1-ink);}
.famsplit-bar .b2{background:var(--bkt2); color:var(--bkt2-ink);}
.famsplit-bar .b3{background:var(--bkt3); color:var(--bkt3-ink);}
.get-callout{margin-top:1.1rem; padding:.9rem 1.1rem; border:1px dashed var(--ink-faint);
  border-radius:6px;}
.get-callout .who{display:block;}
/* ol.items li's own grid-template-columns:1fr 11.5rem (original.html) assumes
   the full-width tier list; nested inside a ~15rem .group card or the
   .get-callout box it would push the tally column off the edge. Stack idea
   over gauge instead, at a slightly smaller size than the top-level list so
   a 5-item ranking still fits a card without dominating it. */
.group .items li, .get-callout .items li{
  grid-template-columns:1fr; gap:.2rem; padding:.5rem 0;
}
.group .items .idea, .get-callout .items .idea{font-size:.85rem;}
.group .items .tally, .get-callout .items .tally{font-size:.7rem;}
/* --empty is the page's own "recessed track" colour (already used for the
   turnout bar and every gauge's background) — reusing it here reads as "this
   is a sub-panel of the card above it" rather than introducing a new colour
   meaning. --panel (the card's own background) would barely show against
   itself in light mode; --empty is visibly darker/cooler in both themes. */
.group .items, .get-callout .items{
  background:var(--empty); border-radius:4px; margin-top:.15rem;
  padding:0 .65rem;
}
"""

# The wrapper's .page is a 12.5in-wide SCREEN canvas with overflow:hidden. Send
# that to a printer and Chrome lays it on Letter: the right four inches \u2014 every
# vote tally on every row \u2014 are clipped away, and the 27in column collapses to
# three sheets of half-drawn rows. The page's own @media print block (in
# original.html) already says what this document means on paper \u2014 .sheet at
# max-width:100% with break-inside rules per section \u2014 but it can't be reached
# while the wrapper holds a fixed width above it. Released here, printing only:
# the screen canvas is unchanged, and @page names the paper Chrome was assuming
# anyway rather than leaving it to the default margin box.
PRINT_CSS = """
@page { size: letter; margin: 0.25in; }
@media print {
  body { background:#fff; }
  .page { width:auto; min-height:0; margin:0; overflow:visible; }
  /* The last page held nothing but the source line: the document ran about
     three quarters of an inch past the third sheet, all of it whitespace the
     screen layout wants and paper does not. Reclaimed from the four places
     that had slack — the paper margin, the sheet's own vertical padding, the
     gap between sections, and footer's 3rem lead-in, which is generous even
     on screen. Nothing here changes type size or the space INSIDE a block, so
     the design reads the same; it just stops paying for a fourth sheet. */
  .sheet { padding:0.12in 0.3in; }
  section { margin-top:1.3rem; }
  footer { margin-top:1.25rem; padding-top:0.8rem; break-before:avoid; }
  /* A three-card .groups row printed as 2 + 1. On screen the sheet is 60rem
     and auto-fit's 15rem floor admits three columns; on Letter the sheet is
     only ~44rem (612pt less the @page margin and .sheet padding), where
     3x15rem + 2x1rem of gap does not fit, so the third card wrapped to a row
     of its own with a full empty column beside it. That stranded column, not
     the length of the text, is what pushed the closing note and source line
     onto a sheet by themselves. A 12rem floor fits all three across
     (3x12 + 2x1 = 38rem, comfortably inside 44rem) and stays auto-fit, so a
     future two-card or four-card row still lays itself out. Card content is
     ~10rem wide at that floor — the tallies and ranked lists still wrap
     cleanly, and no type size changes. */
  .groups { grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));
            align-items:start; }
  /* The bigger win was pagination, not whitespace. original.html marks whole
     sections and whole tiers break-inside:avoid, and by now both are taller
     than a sheet: the Settled tier alone is ~400pt and the credits/raisers
     section ~550pt, so each one refuses to start unless a full sheet is free.
     That stranded 500pt at the foot of page 1 and 550pt on page 3 — the
     document was not too long, it was packed badly. Let the containers flow
     and move the no-break rule down to the units that genuinely must not
     split: one idea's row, one family card, a tier's heading. Headings hold
     onto what follows them so nothing is left stranded at a page foot. */
  section, .tier { break-inside:auto; }
  /* .groups stays atomic: it is a 2-column grid, so a break through it does
     not read as "continued" — it drops one card alone onto the next sheet
     beside the whitespace where its row-mates should be. It is ~300pt, well
     under a sheet, so holding it together costs a page break, not a page. */
  ol.items li, .group, .groups, .tier-head, .legend, p.sub,
  .famsplit, .get-callout { break-inside:avoid; }
  /* .famsplit joins the heading-chain: the bar is the section's summary and
     the cards are its detail, so a break between them reads as two unrelated
     graphics. Chained with h2/p.sub above, the whole block moves together. */
  h2, h3, .tier-head, p.sub, .famsplit { break-after:avoid; }
  /* ...but p.sub plays two roles. As a lead-in it introduces the block below
     it and the rule above is right. As the LAST child of a section it is a
     closing note, and gluing it forward binds it to the NEXT section's
     heading — which then drags it into that section's whole avoid-chain.
     That is what left 5in of blank paper at the foot of the credits/raisers
     page while its own closing note sat alone atop the next sheet, and it
     cost the bucket section the room its three cards needed to print whole.
     A trailing note belongs to what is above it, so say exactly that. */
  section > p.sub:last-child { break-after:auto; break-before:avoid; }
}
"""

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
  {FAMILY_CSS}
  {BUCKET_CSS}
  {PRINT_CSS}
  {EDIT_CSS}
</style>
</head>
<body>
<section class="page">
{BODY}
</section>
{L.layer(1)}{L.text_boxes(1)}{L.tables_html(1)}
</body>
</html>
"""

_OUT.write_text(html)
print(f"wrote {_OUT} ({len(html):,} bytes)")
