"""Renderer for a PLACED document — content positioned, not flowing.

Scaffolded blank by the draft editor. Everything on the page is a shape, a
text box or a table in layout.json, which is what the editor writes;
content.md holds only the title and the citation list every project needs.

Page size (13.333in x 7.5in) is fixed at creation time. This is a BRANDED starting point: its pages
are placed boxes, shapes, a chart and tables in layout.json (so everything moves and edits like
anything the editor places), set in Manrope (headings) and Poppins (body) from the brand guide.
"""
from pathlib import Path
import os
import sys

HERE = Path(__file__).resolve().parent      # .../projects/<slug>
ROOT = HERE                                  # content.md and layout.json live here
REPO = HERE.parents[1]                       # the checkout, where docsync/ lives
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from docsync.content import Content
from docsync.layout import Layout

_LAYOUT = Path(os.environ.get("DOCSYNC_LAYOUT") or (ROOT / "layout.json"))
_CONTENT = Path(os.environ.get("DOCSYNC_CONTENT") or (ROOT / "content.md"))
_OUT = Path(os.environ.get("DOCSYNC_OUT") or (ROOT / "web" / "index.html"))

L = Layout(_LAYOUT, page=(13.333, 7.5))
C = Content(_CONTENT, styles=L)

# Page 1 always exists; pages added in the editor land in layout.pages and
# come back through the same helper every renderer uses. A converted document
# starts with the page count it had.
DESIGNED_PAGES = 6
PAGES = L.page_order(DESIGNED_PAGES)

# What conversion had to decide for you, said in the editor rather than in
# terminal output you will never see again. Empty for a blank project.
NOTICES = []

body = "".join(L.sheet(pid) for pid in PAGES)
# Tell the editor's page strip which pages are designed, so it can draw a
# thumbnail per page and reorder them. Without this the strip stays hidden.
body += L.pagemeta(range(1, DESIGNED_PAGES + 1))
body += L.notices(NOTICES)
body = C.fn.resolve(body)
# Each marker a link to its endnote: resolve() alone leaves <sup>1</sup> as a
# bare numeral pointing at nothing (docsync.check warns on exactly that).
body = C.fn.linkify(body)

# The citation list. An endnotes section placed in the editor (Insert ▸
# Endnotes) already carries it, titled and movable — so nothing more is
# emitted, where this used to add a second, hand-built copy after the last
# page: uneditable, duplicating every anchor id (two id="en1"), and printed
# as a stray extra sheet. With no section placed yet, the list still renders
# so no citation dangles, through the engine's endnotes_html: every entry
# carries its endnote.<id> hook and edits in the Sources panel.
endnotes = ("" if "ds-endnotes-sec" in body or not C.fn.endnotes()
            else C.fn.endnotes_html(L))

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{C.text("title")}</title>
{L.font_link()}
<style>
  body {{ margin:0; background:#D6E0D2; font:32px/1.5 'Poppins', system-ui, sans-serif;
         color:#2F3E46; }}
  /* position:relative is load-bearing: every placed object is absolute
     against its page, so the page must be the containing block or the whole
     document stacks at the window's origin. isolation:isolate equally so:
     it makes the page a stacking context, which is what keeps a
     send-to-back shape (z-index -1) ABOVE the page's own background — on a
     page with a fill, a plain relative page painted that shape underneath
     its background, i.e. invisible. */
  .page {{ width:13.333in; min-height:7.5in; margin:24px auto; background:#fff;
          box-shadow:0 4px 18px rgba(0,0,0,.12); position:relative;
          isolation:isolate; overflow:hidden; box-sizing:border-box; }}
  .ds-textbox p {{ margin:0 0 .5em; }}
  .ds-textbox p:last-child {{ margin-bottom:0; }}
  .ds-table {{ border-collapse:collapse; }}
  .ds-table td, .ds-table th {{ border:1px solid #C9D6CD; padding:4px 7px;
          text-align:left; }}
  .endnotes {{ font-size:14px; color:#52796F; }}
  .ds-endnotes-sec h2 {{ font:800 34px/1.1 'Manrope', system-ui, sans-serif; color:#354F52;
          margin:0 0 .5em; letter-spacing:0; }}
  .ds-endnotes-sec ol {{ font:14px/1.55 'Poppins', system-ui, sans-serif; color:#4A5A61;
          margin:0; padding-left:1.4em; }}
  .ds-endnotes-sec li {{ margin:0 0 .7em; }}
  sup a, a.fn {{ color:#52796F; text-decoration:none; font-weight:600; }}
  @media print {{
    @page {{ size: 13.333in 7.5in; margin: 0; }}
    body {{ background:#fff; }}
    .page {{ box-shadow:none; margin:0; width:13.333in; height:7.5in; }}
  }}
</style>
</head>
<body>
{body}
{f'<div class="endnotes">{endnotes}</div>' if endnotes else ''}
</body>
</html>
"""

_OUT.parent.mkdir(parents=True, exist_ok=True)
_OUT.write_text(html)
