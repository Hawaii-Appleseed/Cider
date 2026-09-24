#!/usr/bin/env python3
"""Demo report renderer — a SECOND project on the shared engine.

Minimal on purpose, but unlike the "New report" scaffold it exercises the
engine's shared building blocks (docsync.blocks): a movable/resizable graphic
and a detachable card, both editable in the same draft editor that serves the
Budget Primer. This is the template to copy when a new report wants more than
"prose, in order".
"""
from pathlib import Path
import os
import sys

HERE = Path(__file__).resolve().parent           # projects/demo-report
REPO = HERE.parent.parent                        # repo root, where docsync/ lives
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from docsync.content import Content, merge_attrs  # noqa: E402
from docsync.layout import Layout                # noqa: E402
from docsync.blocks import describe, graphic, card   # noqa: E402

# Same env contract as every renderer: the editor and the export endpoint
# override these to render a draft from temp files; unset -> the working tree.
_LAYOUT = Path(os.environ.get("DOCSYNC_LAYOUT") or (HERE / "layout.json"))
_CONTENT = Path(os.environ.get("DOCSYNC_CONTENT") or (HERE / "content.md"))
_OUT = Path(os.environ.get("DOCSYNC_OUT") or (HERE / "index.html"))

L = Layout(_LAYOUT)
C = Content(_CONTENT, styles=L)

TEAL, DEEP = "#6B9E78", "#52796F"
DIAGRAM = ('<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"'
           f'{describe(C, "diagram.desc", "demo diagram")}>'
           f'<circle cx="60" cy="60" r="56" fill="{DEEP}"/>'
           '<path d="M30 78 L52 54 L68 66 L92 38" fill="none" stroke="#fff" '
           'stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
           '<circle cx="92" cy="38" r="8" fill="#fff"/></svg>')

page1 = f"""
<section class="page">
 {L.spacer("page1.h1")}<h1{L.attr("page1.h1")}>{C.t("page1.h1")}</h1>
 {C.html("page1.intro")}
 {graphic(L, "page1.diagram", DIAGRAM, w=1.6)}
 {card(C, L, "page1.card.title", "page1.card.bullets", DEEP,
       detachable=True, min_h=1.4)}
{C.extras("page1")} {L.layer(1)}{L.text_boxes(1)}{L.tables_html(1)}
</section>"""

body = C.fn.resolve(page1)
# The engine's list, not a hand-built one: each entry carries its
# endnote.<id> hook (Sources panel), where the <li>s built here had none.
endnotes = C.fn.endnotes_html(L)
_eh = "endnotes.title"
endnotes_title = (f'{L.spacer(_eh)}<h2{merge_attrs(C.slot_attr(_eh), L.attr(_eh))}>'
                  f'{C.text_or(_eh, "Endnotes")}</h2>')

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{C.text("title")}</title>
<style>
  body {{ margin:0; background:#D6E0D2; font:15px/1.6 system-ui, sans-serif; color:#2F3E46; }}
  .page {{ width:8.5in; min-height:11in; margin:24px auto; background:#fff;
           box-shadow:0 4px 18px rgba(0,0,0,.12); padding:0.75in 0.62in;
           box-sizing:border-box; position:relative; overflow:hidden; }}
  h1 {{ font-size:28px; margin:0 0 .6em; color:{TEAL}; }}
  p {{ margin:0 0 12px; }}
  .endnotes {{ font-size:12px; }}
</style>
</head>
<body>
{body}
<section class="page">
 {endnotes_title}
 <div class="endnotes">{endnotes}</div>
</section>
</body>
</html>
"""

_OUT.write_text(html)
print(f"wrote {_OUT} ({len(html):,} bytes)")
