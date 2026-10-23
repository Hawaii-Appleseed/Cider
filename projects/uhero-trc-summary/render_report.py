#!/usr/bin/env python3
"""UHERO's draft "On Hawaiʻi's Tax System" — a 6-page summary, Tax Fairness
Coalition branding.

Structure, hooks and build pipeline are copied from projects/retitc (a paged
letter-size report: cover, interior pages with a running header and footer,
one inline chart, endnotes). Colours and fonts are the Tax Fairness Coalition
set used by projects/tfc-2027-priorities: the green-slate palette
(#52796F / #354F52 / #2F3E46 / #84A98C / #CAD2C5) and Manrope + Poppins.

It describes and does not advise. Every figure was checked against the text of
UHERO's draft (October 6, 2026); page numbers in content.md are the draft's
printed page numbers. The one chart's numbers (UHERO Figure 10.1, p. 160) are
DATA constants below, not read from a file, so nothing needs declaring under
`editor.engine` in docsync.yml.
"""
from pathlib import Path
import base64
import os
import sys

HERE = Path(__file__).resolve().parent           # projects/uhero-trc-summary
REPO = HERE.parent.parent                        # repo root, where docsync/ lives
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from docsync.content import Content              # noqa: E402
from docsync.layout import Layout                # noqa: E402
from docsync.blocks import chart, describe, pdf_button, print_css  # noqa: E402
from docsync.blocks import chart_scroll_css      # noqa: E402
from docsync.okina import OKINA_FACES            # noqa: E402

_LAYOUT = Path(os.environ.get("DOCSYNC_LAYOUT") or (HERE / "layout.json"))
_CONTENT = Path(os.environ.get("DOCSYNC_CONTENT") or (HERE / "content.md"))
_OUT = Path(os.environ.get("DOCSYNC_OUT") or (HERE / "index.html"))
EDIT = bool(os.environ.get("DOCSYNC_EDIT"))

def data_uri(path):
    return "data:image/png;base64," + base64.b64encode(Path(path).read_bytes()).decode()


def img_el(el_id, cls, src, desc):
    """One image element, honouring replace/radius/filter overrides; `desc`
    is the attribute string describe() returns (its description is a slot)."""
    src = L.img_src(el_id, src)
    return f'<img class="{cls}"{L.attr(el_id, L.img_css(el_id))} src="{src}"{desc}>'


L = Layout(_LAYOUT, page=(8.5, 11))
C = Content(_CONTENT, styles=L)

# --- Palette: Tax Fairness Coalition (as in tfc-2027-priorities) --------------
PRIMARY = "#52796F"        # --deep
PRIMARY_DARK = "#354F52"   # --slate
INK = "#2F3E46"            # --char
TEAL = "#84A98C"           # --teal
ASH = "#CAD2C5"            # --ash
BODY = "#3F5256"           # body copy (slate, darkened for 7:1 on white)
MUTED = "#5F7072"          # secondary text, clears 4.5:1 on white
LINE = "#DCE3DC"           # --rule
PAPER = "#EDF0ED"          # the desk behind the sheets on screen
WARM = "#A8603F"           # the poll page's "against" rust, used sparingly
NEUTRAL = "#A3AFAC"        # the swap table's "mixed / unclear" marker
TEXT = "#232B2D"           # body text (near-black, as the house reports set it)
STRIPE = "#F4F6F4"         # alternate rows of Table 1

CHART_W_IN = 7.2

# --- DATA — UHERO Figure 10.1 (p. 160): yearly gain per household, 2027 ------
DECILE_GAIN = [156, 190, 263, 348, 414, 461, 501, 560, 590, 729]
DECILE_LABELS = ["Lowest", "2", "3", "4", "5", "6", "7", "8", "9", "Highest"]

# Table 1 is a real table (layout.json `tables`, id "swaps", flow). This is what
# draws when a stored copy has no such entry — the hub's copy was saved before
# the table moved into layout.json — so it is the whole table, and the editor
# seeds it into that copy's layout.json the first time anyone touches it.
SWAPS_DEFAULT = {"header": True, "headerFill": "#354F52", "headerColor": "#FFFFFF",
                 "band": "#F4F6F4", "colw": [47, 53],
                 "rows": [
             ["The change", "The make-up change"],
             ["No GET on groceries", "Raise all income-tax rates by the same percentage"],
             ["No GET on groceries", "Cut the food/excise tax credit"],
             ["Tax long-term capital gains like regular income", "Lower the top three income-tax rates"],
             ["Raise the top income-tax rate by 1 point", "Lower the bottom three rates, or enlarge the food/excise credit"],
             ["Exempt long-term capital gains from tax", "Raise the top three income-tax rates"],
             ["Raise the GET rate by half a point", "Lower all income-tax rates by the same percentage"]]}

# The chapter-by-chapter table is a real table too (layout.json `tables`, id
# "chapters", flow), drawn from this default while a stored copy has none. The
# "In the draft" column links to the first page of the chapter in UHERO's PDF:
# a PDF page is the draft's printed page + 2 (a cover and a roman-numeral
# contents page come first), so printed p. 26 is #page=28.
_PDF = "https://files.hawaii.gov/tax/stats/trc/docs2025/2026-10-08_UHERO_draft_report.pdf"
CHAPTERS_DEFAULT = {"header": True, "headerFill": "#354F52", "headerColor": "#FFFFFF",
                    "band": "#F4F6F4", "colw": [22, 62, 16],
                    "rows": [
             ["Chapter", "What the draft finds", "In the draft"],
             ["**2 · Individual income tax**", "Higher earners pay a larger share of their income in Hawaiʻi's individual income tax, which brought in $3.29 billion in fiscal 2025, and Act 24 adds a 13 percent top rate above $500,000 for single filers (pp. 3, 28, 35).", f"[pp. 26–55]({_PDF}#page=28)"],
             ["**3 · General excise tax**", "The general excise tax is the state's largest, at $4.63 billion or 40.4 percent of fiscal 2025 collections, and because it applies to sales between businesses it can pile up at each stage of production (pp. 3, 56, 60).", f"[pp. 56–72]({_PDF}#page=58)"],
             ["**4 · Visitors and tourism**", "Taxing visitors can help residents, but only if residents are paid back for the share they also pay; the hotel and vacation-rental tax, for example, raised $816.2 million in fiscal 2025 (pp. 73–74, 77).", f"[pp. 73–85]({_PDF}#page=75)"],
             ["**5 · Property and real estate**", "Hawaiʻi homeowners pay 0.29 percent of their home value in property tax, the lowest rate of the 50 states and well below the 0.90 percent national figure, and only the counties may set it (pp. 87–88).", f"[pp. 86–99]({_PDF}#page=88)"],
             ["**6 · Business taxes**", "The corporate income tax raised $400.4 million net in fiscal 2025, and UHERO says a large rate cut could raise total revenue once the effects on other taxes are counted, although that rests on 2010 data (pp. 101, 107).", f"[pp. 100–117]({_PDF}#page=102)"],
             ["**7 · Wealth and estates**", "UHERO considers an annual wealth tax unlikely to raise much revenue if Hawaiʻi acts alone, while estate tax collections swing widely, reaching $405.8 million in fiscal 2025 including a one-time $315 million payment (pp. 118, 120).", f"[pp. 118–132]({_PDF}#page=120)"],
             ["**8 · Tax credits**", "Credits work like spending, and taxpayers claimed $621.3 million of them in 2023, while 72 percent of what individuals claimed in solar credits went to filers earning $100,000 or more (pp. 133, 147).", f"[pp. 133–156]({_PDF}#page=135)"]]}


def decile_spec() -> dict:
    return {
        "type": "bar",
        "labels": DECILE_LABELS,
        "series": [{"name": "Yearly gain per household",
                    "data": DECILE_GAIN, "color": PRIMARY}],
        "legend": False,
        "values": True, "grid": False,
        "format": {"prefix": "$", "decimals": 0},
        "labelColor": INK,
        "axisMax": 900,
    }


def fig(key: str, cls: str = "") -> str:
    return (f'<div class="fig fig-{key}{cls}"{L.attr(f"cover.fig.{key}")}>'
            f'<div class="fig-n">{C.t(f"cover.fig.{key}.n")}</div>'
            f'<div class="fig-l">{C.t(f"cover.fig.{key}.l")}</div></div>')


def stat(key: str) -> str:
    return (f'<div class="stat"{L.attr(f"groc.stat.{key}")}>'
            f'<div class="stat-n">{C.t(f"groc.stat.{key}.n")}</div>'
            f'<div class="stat-l">{C.t(f"groc.stat.{key}.l")}</div></div>')


def bullet(n: int) -> str:
    return (f'<li class="fb"{L.frame(f"fair.li.{n}")}>{C.html(f"fair.b{n}", "fbp")}</li>')


ENDNOTES_SLOT = "<!--ds-endnotes-->"


def head(eyebrow: str, h1: str, sub: str, tag: str) -> str:
    return (f'<div class="phead"{L.frame(f"phead.{tag}")}>'
            f'<div class="eyebrow"{L.attr(eyebrow)}>{C.t(eyebrow)}</div>'
            f'{L.spacer(h1)}<h1{L.attr(h1)}>{C.t(h1)}</h1>'
            f'<div class="psub"{L.attr(sub)}>{C.t(sub)}</div></div>')


def foot(key: str, page_no: int) -> str:
    # The wrapper is what is pinned to the sheet's bottom: L.frame() makes the
    # frame itself position:relative so the editor can move it, which would
    # beat a position:absolute on the frame and leave the footer in the flow.
    return (f'<div class="pfwrap"><div class="pfoot"{L.frame(f"pfoot.{page_no}")}>{C.html(key, "pfoot-t")}'
            f'<span class="pnum"{L.attr(f"foot.pnum.{page_no}")}>'
            f'{page_no} · {C.t("foot.running")}</span></div></div>')


page = f"""
<section class="page cover">
  <div class="cfield"{L.frame("cover.field")}>
  <div class="mast">
    {img_el("cover.logo", "brand-logo", data_uri(HERE / "assets" / "HawaiiTaxFairness_Horizontal_white-text.png"), describe(C, "cover.logo.desc", "Hawaiʻi Tax Fairness Coalition"))}
    <div class="pill"{L.attr("cover.pill")}>{C.t("cover.pill")}</div>
  </div>
  {L.spacer("cover.h1")}<h1 class="cover-h1"{L.attr("cover.h1")}>{C.t("cover.h1")}</h1>
  <div class="rule"{L.attr("cover.rule")}></div>
  {C.html("cover.deck", "deck")}
  </div>

  <div class="datebox what"{L.frame("cover.whatbox")}>
    <div class="box-h"{L.attr("cover.what.h")}>{C.t("cover.what.h")}</div>
    {C.html("cover.what.p", "box-p")}
  </div>

  <div class="klabel"{L.attr("cover.figures.h")}>{C.t("cover.figures.h")}</div>
  <div class="figs"{L.frame("cover.figs")}>
    {fig("a", " fig-warn")}{fig("b")}{fig("c")}
  </div>

  <div class="datebox"{L.frame("cover.datebox")}>
    <div class="box-h"{L.attr("cover.dates.h")}>{C.t("cover.dates.h")}</div>
    {C.html("cover.dates.p", "box-p")}
  </div>


  <div class="cfwrap"><div class="cover-foot"{L.frame("cover.foot")}>
    <div class="cfoot-l"{L.attr("cover.source")}>{C.t("cover.source")}</div>
    <div class="cfoot-l"{L.attr("cover.stamp")}>{C.t("cover.stamp")}</div>
  </div></div>
{C.extras("page1")} {L.layer(1)}{L.text_boxes(1)}{L.tables_html(1)}
</section>

<section class="page">
  {head("about.eyebrow", "about.h1", "about.sub", "about")}
  {C.html("about.works.p1", "lead")}
  <div class="slabel tbl"{L.attr("about.pairs.h")}>{C.t("about.pairs.h")}</div>
  {L.flow_table("swaps", SWAPS_DEFAULT)}
  <div class="swnote">{C.html("swap.note", "cap")}</div>
  <h2 class="figt"{L.attr("groc.h1")}>{C.t("groc.h1")}</h2>
  {C.html("groc.lead", "body")}
  <h2 class="figt"{L.attr("groc.chart.h")}>{C.t("groc.chart.h")}</h2>
  <div class="split"{L.frame("groc.split")}><div class="splitl">
  {chart(L, "chart.decile", decile_spec(), w=3.9, h=0.9,
         desc=describe(C, "groc.chart.desc", "Yearly gain per household from "
                       "exempting groceries, by income tenth, from 156 dollars "
                       "in the lowest to 729 dollars in the highest"))}
  </div><div class="pcts"{L.frame("groc.pcts")}>
    <div class="klabel"{L.attr("groc.pct.h")}>{C.t("groc.pct.h")}</div>
    <div class="pct"{L.attr("groc.pct.a")}><div class="pct-n">{C.t("groc.pct.a.n")}</div><div class="pct-l">{C.t("groc.pct.a.l")}</div></div>
    <div class="pct"{L.attr("groc.pct.b")}><div class="pct-n">{C.t("groc.pct.b.n")}</div><div class="pct-l">{C.t("groc.pct.b.l")}</div></div>
  </div></div>
  {C.html("groc.chart.note", "cap")}
  <div class="slabel"{L.attr("groc.pay.h")}>{C.t("groc.pay.h")}</div>
  {C.html("groc.pay.p", "body")}
  {foot("about.foot", 2)}
{C.extras("page2")} {L.layer(2)}{L.text_boxes(2)}{L.tables_html(2)}
</section>

<section class="page">
  {head("ch.eyebrow.a", "ch.h1.a", "ch.sub.a", "cha")}
  {L.flow_table("chapters", CHAPTERS_DEFAULT)}
  {C.html("ch.foot.b", "cap")}
  <div class="box box-green"{L.frame("rec.box")}>
    <div class="box-h"{L.attr("rec.h")}>{C.t("rec.h")}</div>
    {C.html("rec.p", "box-p")}
  </div>
  <div class="endnotes"{L.frame("endnotes.box")}><span class="srch"{L.attr("endnotes.h2")}>{C.t("endnotes.h2")}</span>{ENDNOTES_SLOT}</div>
  {foot("end.foot", 3)}
{C.extras("page3")} {L.layer(3)}{L.text_boxes(3)}{L.tables_html(3)}
</section>

<section class="page">
  {head("end.eyebrow", "end.h1", "end.sub", "end")}
  <h2{L.attr("fair.h")}>{C.t("fair.h")}</h2>
  {C.html("fair.note", "note")}
  <ul class="fl"{L.frame("fair.list")}>{"".join(bullet(n) for n in range(1, 5))}</ul>
  <h2{L.attr("miss.h")}>{C.t("miss.h")}</h2>
  <ul class="fl"{L.frame("miss.list")}>{"".join(f'<li class="fb"{L.frame(f"miss.li.{n}")}>{C.html(f"miss.b{n}", "fbp")}</li>' for n in range(1, 6))}</ul>
  <div class="box"{L.frame("adv.box")}>
    <div class="box-h"{L.attr("adv.h")}>{C.t("adv.h")}</div>
    {"".join(f'<div class="advb"{L.frame(f"adv.li.{n}")}>{C.html(f"adv.b{n}", "box-p")}</div>' for n in range(1, 4))}
  </div>
  {foot("adv.foot", 4)}
{C.extras("page4")} {L.layer(4)}{L.text_boxes(4)}{L.tables_html(4)}
</section>
"""

body = C.fn.resolve(page)
en = C.fn.endnotes_run(L)
body = C.fn.linkify(body)
body = body.replace(ENDNOTES_SLOT, en)

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{C.text("title")}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@600;700;800&family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
<style>
{OKINA_FACES}
  /* House report style, as in Hawaiʻi Appleseed's published reports (and the
     docsync report template drawn from them): Barlow for display, Source Sans 3
     for text, a topic-colour field on the cover with the title in white caps,
     caps section headings over a hairline in the topic colour, "Figure N."
     titles, a dark terms panel, "<page> · <TITLE>" footers. Topic colour here
     is the Coalition's slate. Both faces carry their own ʻokina (U+02BB). */
  body {{ margin:0; background:{PAPER};
         font:14.5px/1.5 'Source Sans 3', 'Source Sans Pro', system-ui, sans-serif;
         color:{TEXT}; -webkit-font-smoothing:antialiased; }}
  .page {{ width:8.5in; height:11in; margin:28px auto; background:#fff;
           box-shadow:0 0 0 1px rgba(47,62,70,.07), 0 1px 3px rgba(47,62,70,.08);
           padding:0.5in 0.6in 0.42in; box-sizing:border-box; position:relative;
           overflow:hidden; }}
  .disp {{ font-family:Barlow, 'Source Sans 3', sans-serif; }}

  /* --- Cover --------------------------------------------------------- */
  .cfield {{ margin:-0.5in -0.6in 0; padding:0.42in 0.6in 0.34in;
             background:{PRIMARY_DARK}; color:#fff;
             box-sizing:border-box; display:flex; flex-direction:column; }}
  .mast {{ display:flex; justify-content:space-between; align-items:flex-start;
           padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,.35); }}
  .brand {{ font-family:Barlow, sans-serif; font-weight:700; font-size:13.5px;
            letter-spacing:.14em; color:#fff; }}
  .brand-logo {{ height:0.55in; width:auto; display:block; }}
  .pill {{ font-family:Barlow, sans-serif; font-weight:600; font-size:13.5px;
           letter-spacing:.06em; text-transform:uppercase; color:{ASH}; }}
  .cover-h1 {{ font-family:Barlow, sans-serif; font-weight:800; font-size:40px;
               line-height:1.02; text-transform:uppercase; letter-spacing:-.005em;
               color:#fff; margin:auto 0 0; padding-top:0.3in; max-width:6.6in; }}
  .rule {{ width:1.1in; height:4px; background:{TEAL}; margin:22px 0 0; }}
  .deck {{ font-size:16px; line-height:1.48; color:#E6ECE7; margin:12px 0 0;
           max-width:6.2in; }}
  .deck b {{ color:#fff; font-weight:700; }}
  .deck sup a.fn {{ color:{ASH}; }}
  .klabel {{ font-family:Barlow, sans-serif; font-size:13.5px; font-weight:700;
             letter-spacing:.1em; text-transform:uppercase; color:{PRIMARY_DARK};
             margin:0.2in 0 0; }}
  .figs {{ display:grid; grid-template-columns:repeat(3, 1fr); margin:8px 0 0;
           border-top:2px solid {PRIMARY_DARK}; }}
  .fig {{ padding:12px 18px 0 0; }}
  /* by class, not .fig + .fig: the editor's strut beside a moved fact would
     break the sibling chain and take the rule off its neighbour */
  .fig-b, .fig-c {{ border-left:1px solid {LINE}; padding-left:18px; }}
  .fig-n {{ font-family:Barlow, sans-serif; font-size:32px; font-weight:800;
            line-height:1; color:{PRIMARY_DARK}; }}
  .fig-warn .fig-n {{ color:{WARM}; }}
  .fig-l {{ font-size:13.5px; color:{BODY}; margin-top:8px; line-height:1.4; }}
  .datebox {{ display:grid; grid-template-columns:1.6in 1fr; }}
  .datebox {{ margin:0.2in 0 0; padding:9px 0 0; border-top:1px solid {LINE}; }}
  .datebox .box-h {{ margin:2px 16px 0 0; }}
  .datebox .box-p {{ font-size:14.5px; }}
  .cfwrap {{ position:absolute !important; left:0.6in; right:0.6in; bottom:0.42in; }}
  .cover-foot {{ border-top:1px solid {LINE}; padding-top:8px; }}
  .cfoot-l {{ font-size:13.5px; color:{MUTED}; line-height:1.5; }}

  /* --- Interior pages ------------------------------------------------- */
  .phead {{ border-bottom:2px solid {PRIMARY}; padding-bottom:10px; margin-bottom:12px; }}
  .eyebrow {{ font-family:Barlow, sans-serif; font-size:13.5px; font-weight:700;
              letter-spacing:.1em; text-transform:uppercase; color:{PRIMARY};
              margin-bottom:4px; }}
  h1 {{ font-family:Barlow, sans-serif; font-weight:800; font-size:31px;
        line-height:1.04; text-transform:uppercase; margin:0; color:{INK}; }}
  .psub {{ font-size:16.5px; line-height:1.4; color:{PRIMARY_DARK}; margin-top:8px; }}
  .slabel {{ font-family:Barlow, sans-serif; font-size:17px; font-weight:700;
             line-height:1.25; margin:13px 0 0; color:{PRIMARY_DARK}; }}
  .slabel.tbl, h2.figt {{ font-family:Barlow, sans-serif; font-size:15px;
             font-weight:700; color:{INK}; }}
  h2 {{ font-family:Barlow, sans-serif; font-weight:700; font-size:17px;
        line-height:1.25; margin:12px 0 0; color:{PRIMARY_DARK}; }}
  h2.figt {{ margin-top:6px; padding-top:4px; border-top:1px solid {LINE}; }}
  .lead {{ font-size:15px; line-height:1.52; color:{TEXT}; margin:0; }}
  .body {{ font-size:14.5px; line-height:1.5; color:{TEXT}; margin:5px 0 0; }}
  .body b, .lead b {{ font-weight:700; color:{INK}; }}
  .note, .cap {{ font-size:13.5px; line-height:1.45; color:{MUTED}; margin:6px 0 0; }}
  .swnote .cap {{ margin:3px 0 0; line-height:1.35; }}
  .cap b {{ color:{BODY}; }}

  .box {{ margin:16px 0 0; }}
  .box:not(.box-green) {{ background:{INK}; color:#fff; padding:11px 16px 12px; }}
  .box:not(.box-green) .box-h {{ color:{ASH}; }}
  .box:not(.box-green) .box-p, .box:not(.box-green) .box-p b {{ color:#fff; }}
  .box-green {{ padding-top:2px; }}
  .box-h {{ font-family:Barlow, sans-serif; font-size:13.5px; font-weight:700;
            letter-spacing:.1em; text-transform:uppercase; color:{PRIMARY_DARK};
            margin-bottom:4px; }}
  .box-green .box-h {{ font-size:17px; letter-spacing:0; text-transform:none; }}
  .box-p {{ font-size:13.5px; line-height:1.5; color:{TEXT}; margin:0; }}
  .box-green .box-p {{ font-size:15px; line-height:1.55; }}
  .box-p b {{ color:{INK}; }}
  .ds-graphic {{ margin-top:8px; }}

  /* Table 1, the six swaps: a real table (L.flow_table), so the layout's own
     fills and borders apply; this adds only the type */
  table.ds-flow {{ margin:8px 0 0; border-bottom:1px solid {PRIMARY_DARK}; }}
  table.ds-flow th {{ font-family:Barlow, sans-serif; font-size:13.5px; font-weight:700;
                      letter-spacing:.06em; text-transform:uppercase; }}
  table.ds-flow td {{ font-size:13.5px; line-height:1.3; color:{TEXT}; border-top:1px solid {LINE}; }}
  table.ds-flow td:first-child {{ color:{INK}; font-weight:600; }}
  .page table.ds-flow td {{ padding-top:3px; padding-bottom:3px; }}

  .split {{ display:flex; gap:26px; align-items:flex-start; margin-top:6px; }}
  .splitl {{ flex:0 0 3.9in; }}
  .pcts {{ flex:1; padding-top:2px; }}
  .pcts .klabel {{ margin:0; font-size:13.5px; color:{MUTED}; line-height:1.35; }}
  .pct {{ border-top:1px solid {LINE}; padding:6px 0 0; margin-top:6px;
          display:flex; align-items:center; gap:12px; }}
  .pct-n {{ font-family:Barlow, sans-serif; font-weight:800; font-size:28px;
            line-height:1; color:{PRIMARY_DARK}; flex:0 0 0.8in; }}
  .pct-l {{ font-size:13.5px; line-height:1.35; color:{BODY}; flex:1; }}


  .fl {{ list-style:none; margin:6px 0 0; padding:0; }}
  .fb {{ padding:2px 0; border-top:1px solid {LINE}; }}
  .fbp {{ font-size:13.5px; line-height:1.42; color:{TEXT}; margin:0; }}
  .advl {{ font-size:13.5px; color:{ASH}; margin:-2px 0 6px; font-style:italic; }}
  .advb {{ padding:5px 0; border-top:1px solid rgba(255,255,255,.25); }}
  .box:not(.box-green) .box-p {{ font-size:14.5px; }}
  .fbp b {{ color:{PRIMARY_DARK}; }}

  /* --- Footers, endnotes ---------------------------------------------- */
  .pfwrap {{ position:absolute; left:0.6in; right:0.6in; bottom:0.42in; }}
  .pfoot {{ border-top:1px solid {LINE}; padding-top:7px; }}
  .pfoot-t {{ font-size:13.5px; line-height:1.45; color:{MUTED}; margin:0; }}
  .pfoot-t b {{ color:{BODY}; }}
  .pnum {{ display:block; margin-top:5px; text-align:right; font-family:Barlow, sans-serif;
           font-weight:700; letter-spacing:.06em; text-transform:uppercase;
           font-size:13.5px; color:#464646; }}
  .srch {{ font-family:Barlow, sans-serif; font-size:13.5px; font-weight:700;
           letter-spacing:.1em; text-transform:uppercase; color:{INK}; margin-right:6px; }}
  .endnotes {{ margin:14px 0 0; padding-top:8px; border-top:1px solid {LINE};
               font-size:13.5px; line-height:1.45; color:{MUTED}; }}
  .en {{ white-space:normal; }}
  .enn {{ font-weight:700; color:{INK}; }}
  .ensep {{ color:{MUTED}; }}
  .endnotes a {{ color:{MUTED}; text-decoration:none; }}
  sup {{ font-size:10.6px; line-height:0; }}
  sup a.fn {{ color:{PRIMARY}; text-decoration:none; font-weight:700; }}
  a {{ color:{PRIMARY_DARK}; text-underline-offset:2px; }}

  /* --- The phone: fluid pages ----------------------------------------- */
  @media screen and (max-width:8.5in) {{
    .page {{ width:100%; max-width:100%; height:auto; min-height:0; margin:0;
             box-shadow:none; padding:28px 20px; border-bottom:8px solid {PAPER}; }}
    .cfield {{ margin:-28px -20px 0; padding:24px 20px 28px; min-height:0; }}
    .mast {{ flex-direction:column; gap:4px; }}
    .cover-h1 {{ font-size:36px; padding-top:48px; }}
    .ds-graphic {{ width:auto !important; max-width:100% !important; }}
    .cfwrap, .pfwrap {{ position:static !important; left:auto; right:auto;
                        bottom:auto; margin-top:26px; }}
    h1 {{ font-size:27px; }}
    .figs {{ grid-template-columns:1fr; }}
    .fig {{ padding:12px 0; }}
    .fig-b, .fig-c {{ border-left:0; padding-left:0; border-top:1px solid {LINE}; }}
    .datebox {{ grid-template-columns:1fr; }}
    .datebox .box-h {{ margin:0 0 4px; }}
    .split {{ flex-direction:column; gap:10px; }}
    .splitl {{ flex:none; }}
    table.ds-flow {{ border-top:2px solid {PRIMARY_DARK}; }}
    table.ds-flow td {{ padding:9px 8px; }}
    .cover-h1 {{ font-size:36px; padding-top:48px; }}
    .ds-graphic {{ width:auto !important; max-width:100% !important; }}
    .cfwrap, .pfwrap {{ position:static !important; left:auto; right:auto;
                        bottom:auto; margin-top:26px; }}
    h1 {{ font-size:27px; }}
    .figs {{ grid-template-columns:1fr; }}
    .fig {{ padding:12px 0; }}
    .fig-b, .fig-c {{ border-left:0; padding-left:0; border-top:1px solid {LINE}; }}
    .datebox {{ grid-template-columns:1fr; }}
    .datebox .box-h {{ margin:0 0 4px; }}
    .split {{ flex-direction:column; gap:10px; }}
    .splitl {{ flex:none; }}
    .swhead {{ display:none; }}
    .swaps {{ border-top:2px solid {PRIMARY_DARK}; }}
    .swrow {{ grid-template-columns:1fr; gap:2px; padding:9px 8px; }}
    .sw.a {{ padding-left:0; }}
    .arr {{ display:none; }}
    .sw.b::before {{ content:"\\2192\\00a0"; color:{MUTED}; }}
    .cover-h1, .deck, .psub {{ max-width:100%; }}
    body > button {{ top:auto !important; bottom:14px !important;
                     right:14px !important; padding:8px 13px !important;
                     font-size:13.5px !important; }}
  }}
</style>
</head>
<body>
{pdf_button(L, bg=PRIMARY_DARK)}
{chart_scroll_css()}
{print_css(L)}
{body}
</body>
</html>
"""

_OUT.write_text(html)
