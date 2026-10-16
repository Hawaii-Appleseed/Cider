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
BG_SOFT = "#F3F6F3"        # panel wash
WARM = "#A8603F"           # the poll page's "against" rust, used sparingly
WARM_TINT = "#F8EFEA"
GREEN_TINT = "#EAF1EC"

CHART_W_IN = 7.2

# --- DATA — UHERO Figure 10.1 (p. 160): yearly gain per household, 2027 ------
DECILE_GAIN = [156, 190, 263, 348, 414, 461, 501, 560, 590, 729]
DECILE_LABELS = ["Lowest", "2", "3", "4", "5", "6", "7", "8", "9", "Highest"]

CONTENTS = [("1", "contents.1"), ("2", "contents.2"),
            ("3", "contents.3"), ("4", "contents.4")]


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
    }


def fig(key: str, cls: str = "") -> str:
    return (f'<div class="fig{cls}"{L.attr(f"cover.fig.{key}")}>'
            f'<div class="fig-n">{C.t(f"cover.fig.{key}.n")}</div>'
            f'<div class="fig-l">{C.t(f"cover.fig.{key}.l")}</div></div>')


def stat(key: str) -> str:
    return (f'<div class="stat"{L.attr(f"groc.stat.{key}")}>'
            f'<div class="stat-n">{C.t(f"groc.stat.{key}.n")}</div>'
            f'<div class="stat-l">{C.t(f"groc.stat.{key}.l")}</div></div>')


def contents_rows() -> str:
    return "".join(
        f'<div class="crow"{L.attr(f"cover.crow.{n}")}><span class="cnum">{n}</span>'
        f'<span class="ctxt">{C.t(key, esc=True)}</span></div>'
        for n, key in CONTENTS)


def pairs() -> str:
    return "".join(
        f'<li{L.attr(f"about.pairli.{n}")}><span class="pn">{n}</span>'
        f'<span class="pt">{C.t(f"about.pair.{n}")}</span></li>'
        for n in range(1, 7))


def chap(n: int) -> str:
    return (f'<div class="chap"{L.frame(f"ch{n}.box")}>'
            f'<div class="slabel"{L.attr(f"ch{n}.h")}>{C.t(f"ch{n}.h")}</div>'
            f'{C.html(f"ch{n}.p", "body")}</div>')


def bullet(n: int) -> str:
    return (f'<li class="fb"{L.attr(f"fair.li.{n}")}>{C.html(f"fair.b{n}", "fbp")}</li>')


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
            f'{page_no:02d} · {C.t("foot.running")}</span></div></div>')


page = f"""
<section class="page cover">
  <div class="brand"{L.attr("cover.brand")}>{C.t("cover.brand")}</div>
  <div class="pill"{L.attr("cover.pill")}>{C.t("cover.pill")}</div>
  {L.spacer("cover.h1")}<h1 class="cover-h1"{L.attr("cover.h1")}>{C.t("cover.h1")}</h1>
  <div class="rule"{L.attr("cover.rule")}></div>
  {C.html("cover.deck", "deck")}

  <div class="klabel"{L.attr("cover.figures.h")}>{C.t("cover.figures.h")}</div>
  <div class="figs"{L.attr("cover.figs")}>
    {fig("a", " fig-warn")}{fig("b")}{fig("c")}
  </div>

  <div class="datebox"{L.frame("cover.datebox")}>
    <div class="box-h"{L.attr("cover.dates.h")}>{C.t("cover.dates.h")}</div>
    {C.html("cover.dates.p", "box-p")}
  </div>

  <div class="klabel klabel-t"{L.attr("cover.contents.h")}>{C.t("cover.contents.h")}</div>
  <div class="contents"{L.attr("cover.contents")}>{contents_rows()}</div>

  <div class="cfwrap"><div class="cover-foot"{L.frame("cover.foot")}>
    <div class="cfoot-l"{L.attr("cover.source")}>{C.t("cover.source")}</div>
    <div class="cfoot-l"{L.attr("cover.stamp")}>{C.t("cover.stamp")}</div>
  </div></div>
{C.extras("page1")} {L.layer(1)}{L.text_boxes(1)}{L.tables_html(1)}
</section>

<section class="page">
  {head("about.eyebrow", "about.h1", "about.sub", "about")}
  {C.html("about.works.p1", "lead")}
  {C.html("about.model.p", "body")}
  <div class="slabel"{L.attr("about.pairs.h", "color:" + PRIMARY)}>{C.t("about.pairs.h")}</div>
  <ol class="pairs"{L.frame("about.pairs")}>{pairs()}</ol>
  <div class="slabel"{L.attr("about.also.h", "color:" + WARM)}>{C.t("about.also.h")}</div>
  {C.html("about.also.p", "body")}
  <div class="box"{L.frame("about.glossbox")}>
    <div class="box-h"{L.attr("about.gloss.h")}>{C.t("about.gloss.h")}</div>
    {C.html("about.gloss.p", "box-p")}
  </div>
  {foot("about.foot", 2)}
{C.extras("page2")} {L.layer(2)}{L.text_boxes(2)}{L.tables_html(2)}
</section>

<section class="page">
  {head("groc.eyebrow", "groc.h1", "groc.sub", "groc")}
  {C.html("groc.lead", "lead")}
  <div class="stats"{L.frame("groc.stats")}>{stat("a")}{stat("b")}{stat("c")}</div>
  <h2{L.attr("groc.chart.h")}>{C.t("groc.chart.h")}</h2>
  {chart(L, "chart.decile", decile_spec(), w=CHART_W_IN, h=1.8,
         desc=describe(C, "groc.chart.desc", "Yearly gain per household from "
                       "exempting groceries, by income tenth, from 156 dollars "
                       "in the lowest to 729 dollars in the highest"))}
  {C.html("groc.chart.note", "note-b")}
  <div class="slabel"{L.attr("groc.read.h", "color:" + PRIMARY)}>{C.t("groc.read.h")}</div>
  {C.html("groc.read.p", "body")}
  <div class="slabel"{L.attr("groc.pay.h", "color:" + WARM)}>{C.t("groc.pay.h")}</div>
  {C.html("groc.pay.p", "body")}
  {foot("groc.foot", 3)}
{C.extras("page3")} {L.layer(3)}{L.text_boxes(3)}{L.tables_html(3)}
</section>

<section class="page">
  {head("ch.eyebrow.a", "ch.h1.a", "ch.sub.a", "cha")}
  {chap(2)}
  {chap(3)}
  {chap(4)}
  {foot("ch.foot.a", 4)}
{C.extras("page4")} {L.layer(4)}{L.text_boxes(4)}{L.tables_html(4)}
</section>

<section class="page">
  {head("ch.eyebrow.b", "ch.h1.b", "ch.sub.b", "chb")}
  {chap(5)}
  {chap(6)}
  {chap(7)}
  {chap(8)}
  {foot("ch.foot.b", 5)}
{C.extras("page5")} {L.layer(5)}{L.text_boxes(5)}{L.tables_html(5)}
</section>

<section class="page">
  {head("end.eyebrow", "end.h1", "end.sub", "end")}
  <div class="box box-green"{L.frame("rec.box")}>
    <div class="box-h"{L.attr("rec.h")}>{C.t("rec.h")}</div>
    {C.html("rec.p", "box-p")}
  </div>
  <h2{L.attr("fair.h")}>{C.t("fair.h")}</h2>
  {C.html("fair.note", "note")}
  <ul class="fl"{L.frame("fair.list")}>{"".join(bullet(n) for n in range(1, 6))}</ul>
  <div class="endnotes"{L.frame("endnotes.box")}><span class="srch"{L.attr("endnotes.h2")}>{C.t("endnotes.h2")}</span>{ENDNOTES_SLOT}</div>
  {foot("end.foot", 6)}
{C.extras("page6")} {L.layer(6)}{L.text_boxes(6)}{L.tables_html(6)}
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
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Poppins:wght@600;700&display=swap" rel="stylesheet">
<style>
{OKINA_FACES}
  body {{ margin:0; background:{BG_SOFT};
         font:14.5px/1.5 OkinaManrope, Manrope, system-ui, sans-serif; color:{INK};
         font-variant-ligatures:none; }}
  .page {{ width:8.5in; height:11in; margin:24px auto; background:#fff;
           box-shadow:0 4px 18px rgba(0,0,0,.12); padding:0.5in 0.55in 0.42in;
           box-sizing:border-box; position:relative; overflow:hidden; }}

  /* --- Cover --------------------------------------------------------- */
  .cover {{ padding-left:0.78in; }}
  .cover::before {{ content:""; position:absolute; left:0; top:0; bottom:0;
                     width:0.19in; background:{PRIMARY}; z-index:2; }}
  .cover::after {{ content:""; position:absolute; left:0; right:0; top:0;
                   height:3.6in; background:{BG_SOFT}; border-bottom:1px solid {LINE};
                   z-index:0; }}
  .cover > * {{ position:relative; z-index:1; }}
  .brand {{ font-family:OkinaPoppins, Poppins, sans-serif; font-weight:700;
            font-size:0.82rem; letter-spacing:.14em; color:{PRIMARY_DARK};
            margin:0 0 16px; }}
  .pill {{ display:inline-block; background:{WARM}; color:#fff;
           font-family:OkinaPoppins, Poppins, sans-serif; font-weight:700;
           font-size:0.82rem; letter-spacing:.06em; padding:5px 15px;
           border-radius:13px; }}
  .cover-h1 {{ font-family:OkinaPoppins, Poppins, OkinaManrope, Manrope, sans-serif;
               font-size:2.2rem; line-height:1.1; margin:16px 0 0;
               letter-spacing:-.022em; color:{INK}; max-width:6.2in; }}
  .rule {{ width:1.35in; height:5px; background:{PRIMARY}; margin:16px 0 14px; }}
  .deck {{ font-size:0.98rem; line-height:1.5; color:{BODY}; margin:0 0 22px;
           max-width:6.1in; }}
  .klabel {{ font-family:OkinaPoppins, Poppins, sans-serif; font-size:0.78rem;
             font-weight:700; letter-spacing:.1em; color:{PRIMARY};
             margin:0 0 10px; }}
  .klabel-t {{ margin-top:16px; }}
  .figs {{ display:flex; gap:12px; margin:0 0 16px; }}
  .fig {{ flex:1; background:#fff; border:1px solid {LINE};
          border-left:5px solid {PRIMARY}; padding:13px 15px 12px; }}
  .fig-warn {{ border-left-color:{WARM}; }}
  .fig-warn .fig-n {{ color:{WARM}; }}
  .fig-n {{ font-family:OkinaPoppins, Poppins, sans-serif; font-size:1.72rem;
            font-weight:700; line-height:1; color:{INK}; }}
  .fig-l {{ font-size:0.72rem; font-weight:700; letter-spacing:.03em;
            color:{MUTED}; margin-top:8px; line-height:1.35; }}
  .datebox {{ background:{GREEN_TINT}; border-left:4px solid {PRIMARY};
              padding:10px 15px; }}
  .contents {{ margin:0; }}
  .crow {{ display:flex; gap:16px; padding:7px 4px; border-top:1px solid {LINE};
           font-size:0.9rem; }}
  .crow:last-child {{ border-bottom:1px solid {LINE}; }}
  .cnum {{ font-weight:700; color:{PRIMARY}; min-width:1.6em; }}
  .ctxt {{ color:{BODY}; }}
  .cfwrap {{ position:absolute !important; left:0.78in; right:0.55in; bottom:0.5in; }}
  .cover-foot {{ border-top:1px solid {LINE}; padding-top:11px; }}
  .cfoot-l {{ font-size:0.76rem; color:{MUTED}; line-height:1.5; }}

  /* --- Interior pages ------------------------------------------------- */
  .phead {{ border-bottom:2px solid {PRIMARY}; padding-bottom:10px;
            margin-bottom:14px; }}
  .eyebrow {{ font-family:OkinaPoppins, Poppins, sans-serif; font-size:0.78rem;
              font-weight:700; letter-spacing:.1em; text-transform:uppercase;
              color:{PRIMARY}; margin-bottom:5px; }}
  h1 {{ font-family:OkinaPoppins, Poppins, OkinaManrope, Manrope, sans-serif;
        font-size:1.62rem; line-height:1.16; margin:0; color:{INK};
        letter-spacing:-.015em; }}
  .psub {{ font-size:0.86rem; color:{MUTED}; margin-top:6px; }}
  .slabel {{ font-family:OkinaPoppins, Poppins, sans-serif; font-size:0.78rem;
             font-weight:700; letter-spacing:.09em; text-transform:uppercase;
             margin:16px 0 0; padding-bottom:7px; position:relative;
             color:{PRIMARY}; }}
  .slabel::after {{ content:""; position:absolute; left:0; bottom:0;
                    width:0.55in; height:3px; background:currentColor; }}
  h2 {{ font-family:OkinaPoppins, Poppins, OkinaManrope, Manrope, sans-serif;
        font-size:1.02rem; margin:15px 0 0; padding-top:9px; color:{INK};
        border-top:1px solid {LINE}; letter-spacing:-.005em; }}
  .lead {{ font-size:0.93rem; line-height:1.52; color:{INK}; margin:12px 0 0; }}
  .body {{ font-size:0.88rem; line-height:1.5; color:{BODY}; margin:8px 0 0; }}
  .body b, .lead b {{ color:{INK}; }}
  .note {{ font-size:0.82rem; line-height:1.45; color:{MUTED}; margin:7px 0 0;
           font-style:italic; }}
  .note-b {{ font-size:0.8rem; line-height:1.42; color:{BODY}; margin:6px 0 0; }}
  .note-b b {{ color:{INK}; }}

  .pairs {{ list-style:none; margin:10px 0 0; padding:0;
            border-top:1px solid {LINE}; }}
  .pairs li {{ display:flex; gap:12px; padding:4px 2px;
               border-bottom:1px solid {LINE}; font-size:0.87rem;
               line-height:1.42; color:{BODY}; }}
  .pn {{ font-family:OkinaPoppins, Poppins, sans-serif; font-weight:700;
         color:#fff; background:{PRIMARY}; border-radius:50%; min-width:1.45em;
         height:1.45em; text-align:center; line-height:1.45em;
         font-size:0.78rem; margin-top:1px; }}

  .box {{ background:{BG_SOFT}; border:1px solid {LINE}; border-left:4px solid {PRIMARY};
          padding:9px 15px 9px; margin:14px 0 0; }}
  .box-green {{ background:{GREEN_TINT}; }}
  .box-h {{ font-family:OkinaPoppins, Poppins, sans-serif; font-size:0.76rem;
            font-weight:700; letter-spacing:.075em; text-transform:uppercase;
            color:{PRIMARY_DARK}; margin-bottom:6px; }}
  .box-p {{ font-size:0.85rem; line-height:1.48; color:{BODY}; margin:0; }}
  .box-p b {{ color:{INK}; }}
  .ds-graphic {{ margin-top:8px; }}

  .stats {{ display:flex; gap:11px; margin:14px 0 0; align-items:stretch; }}
  .stat {{ flex:1; background:{BG_SOFT}; border-left:4px solid {PRIMARY};
           padding:11px 13px 10px; }}
  .stat-n {{ font-family:OkinaPoppins, Poppins, OkinaManrope, Manrope, sans-serif;
             font-size:1.5rem; font-weight:700; line-height:1;
             color:{PRIMARY_DARK}; }}
  .stat-l {{ font-size:0.78rem; line-height:1.32; color:{BODY}; margin-top:7px; }}

  .chap {{ border-left:3px solid {TEAL}; padding:0 0 0 13px; margin:0 0 14px; }}
  .chap .slabel {{ margin-top:0; }}
  .chap .body {{ font-size:0.9rem; line-height:1.52; margin-top:7px; }}

  .fl {{ list-style:none; margin:8px 0 0; padding:0; }}
  .fb {{ padding:6px 0; border-bottom:1px solid {LINE}; }}
  .fb:last-child {{ border-bottom:none; }}
  .fbp {{ font-size:0.86rem; line-height:1.48; color:{BODY}; margin:0; }}
  .fbp b {{ color:{INK}; }}

  /* --- Footers, endnotes ---------------------------------------------- */
  .pfwrap {{ position:absolute; left:0.55in; right:0.55in; bottom:0.42in; }}
  .pfoot {{ border-top:1px solid {LINE}; padding-top:8px; }}
  .pfoot-t {{ font-size:0.735rem; line-height:1.45; color:{MUTED}; margin:0; }}
  .pfoot-t b {{ color:{BODY}; }}
  .pnum {{ display:block; margin-top:5px; font-weight:700; letter-spacing:.06em;
           text-transform:uppercase; font-size:0.7rem; color:{PRIMARY}; }}
  .srch {{ font-size:0.7rem; font-weight:700; letter-spacing:.07em;
           text-transform:uppercase; color:{BODY}; margin-right:5px; }}
  .endnotes {{ margin:12px 0 0; padding-top:9px; border-top:1px solid {LINE};
               font-size:0.715rem; line-height:1.4; color:{MUTED}; }}
  .en {{ white-space:normal; }}
  .enn {{ font-weight:700; color:{PRIMARY_DARK}; }}
  .ensep {{ color:{MUTED}; }}
  .endnotes a {{ color:{MUTED}; text-decoration:none; }}
  sup {{ font-size:10.6px; line-height:0; }}
  sup a.fn {{ color:{PRIMARY_DARK}; text-decoration:none; font-weight:700; }}
  a {{ color:{PRIMARY_DARK}; }}

  /* --- The phone: fluid pages, as in retitc --------------------------- */
  @media screen and (max-width:8.5in) {{
    .page {{ width:100%; max-width:100%; height:auto; min-height:0; margin:0;
             box-shadow:none; padding:26px 20px; }}
    .cover {{ padding-left:30px; }}
    .cover::before {{ width:6px; }}
    .cover::after {{ display:none; }}
    .ds-graphic {{ width:auto !important; max-width:100% !important; }}
    .cfwrap, .pfwrap {{ position:static !important; left:auto; right:auto;
                        bottom:auto; margin-top:22px; }}
    .figs, .stats {{ flex-direction:column; }}
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
