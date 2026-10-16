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
PAPER = "#EDF0ED"          # the desk behind the sheets on screen
WARM = "#A8603F"           # the poll page's "against" rust, used sparingly
NEUTRAL = "#A3AFAC"        # the swap table's "mixed / unclear" marker

CHART_W_IN = 7.2

# --- DATA — UHERO Figure 10.1 (p. 160): yearly gain per household, 2027 ------
DECILE_GAIN = [156, 190, 263, 348, 414, 461, 501, 560, 590, 729]
DECILE_LABELS = ["Lowest", "2", "3", "4", "5", "6", "7", "8", "9", "Highest"]

# FY2025 tax collections, UHERO Table 1.1 (p. 3): share of DOTAX's $11.46B total.
TAX_MIX = [("General excise & use tax", 40.4), ("Individual income tax", 28.7),
           ("Hotel & rental tax (state TAT)", 7.1),
           ("County GET surcharges", 4.9), ("Estate & transfer tax", 3.5),
           ("Corporate income tax", 3.5), ("Conveyance tax", 0.8)]

# Grocery exemption, 2027 (pp. 65, 158): $M. Both bars total $267.4M.
WHERE = [("Savings go to", [("Residents", 214.1), ("Visitors", 53.3)]),
         ("Revenue lost by", [("State", 237.7), ("Counties", 29.7)])]

# (tag text, css class) per swap; wording lives in content.md
SWAP_TAG = {1: "mx", 2: "mx", 3: "up", 4: "up", 5: "mx", 6: "dn"}

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


def mix_spec() -> dict:
    return {"type": "row", "labels": [a for a, _ in TAX_MIX],
            "series": [{"name": "Share of state tax collections",
                        "data": [b for _, b in TAX_MIX], "color": PRIMARY}],
            "legend": False, "values": True, "grid": False,
            "format": {"suffix": "%", "decimals": 1}, "labelColor": INK}


def where_spec() -> dict:
    names = [n for _, g in WHERE for n, _ in g]
    cols = [PRIMARY, TEAL, PRIMARY_DARK, ASH]
    series = []
    for i, n in enumerate(names):
        data = [0.0, 0.0]
        data[i // 2] = dict(WHERE[i // 2][1])[n]
        series.append({"name": n, "data": data, "color": cols[i]})
    return {"type": "stacked-row", "labels": [a for a, _ in WHERE],
            "series": series, "legend": True, "legendPos": "top",
            "values": False, "grid": False, "labelColor": INK}


def swap_rows() -> str:
    out = []
    for n in range(1, 7):
        out.append(
            f'<div class="swrow"{L.frame(f"swap.row.{n}")}>'
            f'<div class="sw a"{L.attr(f"swap.{n}.a")}>{C.t(f"swap.{n}.a")}</div>'
            f'<div class="arr">&rarr;</div>'
            f'<div class="sw b"{L.attr(f"swap.{n}.b")}>{C.t(f"swap.{n}.b")}</div>'
            f'<div class="tag {SWAP_TAG[n]}"{L.attr(f"swap.{n}.tag")}>{C.t(f"swap.{n}.tag")}</div></div>')
    return "".join(out)


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
            f'<div class="bl"{L.attr(f"ch{n}.bl")}>{C.t(f"ch{n}.bl")}</div>'
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
  <div class="mast">
    <div class="brand"{L.attr("cover.brand")}>{C.t("cover.brand")}</div>
    <div class="pill"{L.attr("cover.pill")}>{C.t("cover.pill")}</div>
  </div>
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

  <div class="cgrid">
    <div class="klabel klabel-t"{L.attr("cover.contents.h")}>{C.t("cover.contents.h")}</div>
    <div class="contents"{L.attr("cover.contents")}>{contents_rows()}</div>
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
  {C.html("about.model.p", "body")}
  <div class="slabel"{L.attr("about.pairs.h", "color:" + PRIMARY)}>{C.t("about.pairs.h")}</div>
  <div class="swhead"{L.frame("swap.head")}><span{L.attr("swap.head.a")}>{C.t("swap.head.a")}</span><span{L.attr("swap.head.b")}>{C.t("swap.head.b")}</span><span{L.attr("swap.head.c")}>{C.t("swap.head.c")}</span></div>
  <div class="swaps"{L.frame("swap.rows")}>{swap_rows()}</div>
  {C.html("swap.note", "note")}
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
  <h2{L.attr("groc.where.h")}>{C.t("groc.where.h")}</h2>
  {chart(L, "chart.where", where_spec(), w=CHART_W_IN, h=0.8,
         desc=describe(C, "groc.where.desc", "Two stacked bars of 267.4 million dollars each"))}
  {C.html("groc.where.note", "note-b")}
  <h2{L.attr("groc.chart.h")}>{C.t("groc.chart.h")}</h2>
  <div class="split"{L.frame("groc.split")}><div class="splitl">
  {chart(L, "chart.decile", decile_spec(), w=4.7, h=1.6,
         desc=describe(C, "groc.chart.desc", "Yearly gain per household from "
                       "exempting groceries, by income tenth, from 156 dollars "
                       "in the lowest to 729 dollars in the highest"))}
  </div><div class="pcts"{L.frame("groc.pcts")}>
    <div class="klabel"{L.attr("groc.pct.h")}>{C.t("groc.pct.h")}</div>
    <div class="pct"{L.attr("groc.pct.a")}><div class="pct-n">{C.t("groc.pct.a.n")}</div><div class="pct-l">{C.t("groc.pct.a.l")}</div></div>
    <div class="pct"{L.attr("groc.pct.b")}><div class="pct-n">{C.t("groc.pct.b.n")}</div><div class="pct-l">{C.t("groc.pct.b.l")}</div></div>
  </div></div>
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
  <h2{L.attr("mix.h")}>{C.t("mix.h")}</h2>
  {chart(L, "chart.mix", mix_spec(), w=CHART_W_IN, h=1.3,
         desc=describe(C, "mix.desc", "Shares of state tax collections, FY2025"))}
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
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Poppins:wght@600&display=swap" rel="stylesheet">
<style>
{OKINA_FACES}
  /* Editorial: one display face (Poppins) for titles and big figures, Manrope
     for everything else; hairline rules instead of cards, no tinted panels,
     colour only where it carries meaning (green = the report, rust = against). */
  body {{ margin:0; background:{PAPER};
         font:14.5px/1.5 OkinaManrope, Manrope, system-ui, sans-serif; color:{INK};
         font-variant-ligatures:none; -webkit-font-smoothing:antialiased;
         font-feature-settings:"tnum" 0; }}
  .page {{ width:8.5in; height:11in; margin:28px auto; background:#fff;
           box-shadow:0 0 0 1px rgba(47,62,70,.07), 0 1px 3px rgba(47,62,70,.08);
           padding:0.5in 0.55in 0.42in;
           box-sizing:border-box; position:relative; overflow:hidden; }}

  /* --- Cover --------------------------------------------------------- */
  .mast {{ display:flex; justify-content:space-between; align-items:baseline; }}
  .brand, .pill {{ font-family:OkinaManrope, Manrope, sans-serif; font-weight:800;
                   font-size:0.7rem; letter-spacing:.16em; line-height:1.4;
                   padding-bottom:9px; border-bottom:1.5px solid {INK}; margin:0; }}
  .brand {{ color:{INK}; flex:1; }}
  .pill {{ color:{WARM}; padding-left:16px; font-weight:700; font-size:0.8rem;
           letter-spacing:0; line-height:calc(0.7rem * 1.4); }}
  .cover-h1 {{ font-family:OkinaPoppins, Poppins, OkinaManrope, Manrope, sans-serif;
               font-weight:600; font-size:2.7rem; line-height:1.06;
               margin:1.05in 0 0; letter-spacing:-.03em; color:{INK}; max-width:7in; }}
  .rule {{ width:0.5in; height:3px; background:{PRIMARY}; margin:24px 0 0; }}
  .deck {{ font-size:1.06rem; line-height:1.55; color:{BODY}; margin:16px 0 0;
           max-width:6in; }}
  .deck b {{ color:{INK}; font-weight:700; }}
  .klabel {{ font-family:OkinaManrope, Manrope, sans-serif; font-size:0.8rem;
             font-weight:800; letter-spacing:0; color:{INK};
             margin:0.62in 0 0; padding-top:9px; border-top:1.5px solid {INK}; }}
  .figs {{ display:grid; grid-template-columns:repeat(3, 1fr); margin:14px 0 0; }}
  .fig {{ padding:0 20px 0 0; }}
  .fig + .fig {{ border-left:1px solid {LINE}; padding-left:20px; }}
  .fig-n {{ font-family:OkinaPoppins, Poppins, sans-serif; font-size:2.35rem;
            font-weight:600; line-height:1; letter-spacing:-.02em; color:{INK}; }}
  .fig-warn .fig-n {{ color:{WARM}; }}
  .fig-l {{ font-size:0.8rem; font-weight:500; color:{BODY}; margin-top:10px;
            line-height:1.45; }}
  /* label column + text column, ruled on top: the cover's dates and contents,
     and the glossary on page 2 */
  .datebox, .cgrid {{ display:grid; grid-template-columns:1.75in 1fr; }}
  .datebox {{ margin:0.5in 0 0; padding:10px 0 0; border-top:1px solid {INK}; }}
  .datebox .box-h {{ margin:0; padding-right:16px; }}
  .datebox .box-p {{ font-size:0.9rem; }}
  .cgrid {{ margin:22px 0 0; }}
  .cgrid .klabel {{ margin:0; padding:10px 16px 0 0; border-top:1px solid {INK}; }}
  .contents {{ margin:0; border-top:1px solid {INK}; }}
  .crow {{ display:grid; grid-template-columns:1.9em 1fr; padding:9px 0 8px;
           font-size:0.92rem; line-height:1.35; }}
  .crow + .crow {{ border-top:1px solid {LINE}; }}
  .cnum {{ font-weight:800; color:{PRIMARY}; font-variant-numeric:tabular-nums; }}
  .ctxt {{ color:{INK}; }}
  .cfwrap {{ position:absolute !important; left:0.55in; right:0.55in; bottom:0.5in; }}
  .cover-foot {{ border-top:1px solid {LINE}; padding-top:10px; }}
  .cfoot-l {{ font-size:0.72rem; color:{MUTED}; line-height:1.55; }}

  /* --- Interior pages ------------------------------------------------- */
  .phead {{ border-bottom:1px solid {INK}; padding-bottom:10px; margin-bottom:12px; }}
  .eyebrow {{ font-family:OkinaManrope, Manrope, sans-serif; font-size:0.82rem;
              font-weight:700; color:{PRIMARY}; margin-bottom:6px; }}
  h1 {{ font-family:OkinaPoppins, Poppins, OkinaManrope, Manrope, sans-serif;
        font-weight:600; font-size:1.78rem; line-height:1.12; margin:0; color:{INK};
        letter-spacing:-.025em; }}
  .psub {{ font-size:0.96rem; font-weight:500; line-height:1.4; color:{BODY};
           margin-top:7px; }}
  .slabel {{ font-family:OkinaManrope, Manrope, sans-serif; font-size:0.84rem;
             font-weight:800; margin:15px 0 0; color:{INK}; }}
  h2 {{ font-family:OkinaManrope, Manrope, sans-serif; font-weight:800;
        font-size:1.02rem; line-height:1.3; margin:14px 0 0; padding-top:9px; color:{INK};
        border-top:1px solid {LINE}; letter-spacing:-.01em; }}
  .lead {{ font-size:0.93rem; line-height:1.52; color:{INK}; margin:12px 0 0; }}
  .body {{ font-size:0.88rem; line-height:1.49; color:{BODY}; margin:6px 0 0; }}
  .body b, .lead b {{ color:{INK}; font-weight:700; }}
  .note {{ font-size:0.8rem; line-height:1.45; color:{MUTED}; margin:8px 0 0; }}
  .note-b {{ font-size:0.8rem; line-height:1.42; color:{MUTED}; margin:6px 0 0; }}
  .note-b b {{ color:{BODY}; }}

  .box {{ margin:18px 0 0; }}
  .box:not(.box-green) {{ padding-top:9px; border-top:1px solid {INK}; }}
  .box-green {{ padding-top:12px; border-top:2px solid {PRIMARY}; margin-top:6px; }}
  .phead + .box-green {{ border-top:0; padding-top:4px; margin-top:0; }}
  .box-h {{ font-family:OkinaManrope, Manrope, sans-serif; font-size:0.84rem;
            font-weight:800; color:{INK}; margin-bottom:4px; }}
  .box-green .box-h {{ color:{PRIMARY}; }}
  .box-p {{ font-size:0.86rem; line-height:1.5; color:{BODY}; margin:0; }}
  .box-green .box-p {{ font-size:0.9rem; line-height:1.52; color:{INK}; }}
  .box-p b {{ color:{INK}; }}
  .ds-graphic {{ margin-top:8px; }}

  /* the six swaps: a ruled table, not a stack of cards */
  .swhead, .swrow {{ display:grid; grid-template-columns:2.35in 0.3in 2.75in 1fr; }}
  .swhead {{ margin:10px 0 0; padding-bottom:6px; border-bottom:1px solid {INK};
             font-family:OkinaManrope, Manrope, sans-serif; font-size:0.76rem; font-weight:700;
             color:{MUTED}; }}
  .swhead span:nth-child(2) {{ grid-column:3; }} .swhead span:nth-child(3) {{ grid-column:4; }}
  .swaps {{ margin:0; }}
  .swrow {{ align-items:center; padding:5px 0; border-bottom:1px solid {LINE}; }}
  .sw {{ font-size:0.81rem; line-height:1.3; padding-right:10px; }}
  .sw.a {{ color:{INK}; font-weight:600; }}
  .sw.b {{ color:{BODY}; }}
  .arr {{ color:{MUTED}; }}
  .tag {{ font-size:0.78rem; font-weight:700; line-height:1.3; color:{INK};
          display:flex; align-items:center; gap:8px; }}
  .tag::before {{ content:""; flex:none; width:8px; height:8px; border-radius:50%;
                  background:{NEUTRAL}; }}
  .tag.up::before {{ background:{PRIMARY}; }}
  .tag.dn {{ color:{WARM}; }} .tag.dn::before {{ background:{WARM}; }}

  .split {{ display:flex; gap:28px; align-items:flex-start; margin-top:6px; }}
  .splitl {{ flex:0 0 4.7in; }}
  .pcts {{ flex:1; padding-top:4px; }}
  .pcts .klabel {{ margin:0; padding:0 0 2px; border:0; color:{MUTED};
                   font-weight:700; line-height:1.4; }}
  .pct {{ border-top:1px solid {LINE}; padding:10px 0 0; margin-top:10px; }}
  .pct-n {{ font-family:OkinaPoppins, Poppins, sans-serif; font-weight:600; font-size:1.9rem;
            line-height:1; letter-spacing:-.02em; color:{PRIMARY_DARK}; }}
  .pct-l {{ font-size:0.8rem; line-height:1.35; color:{BODY}; margin-top:5px; }}

  /* chapters: separated by a hairline, kicker + dek + text */
  .chap {{ padding:9px 0 0; margin:0 0 10px; border-top:1px solid {LINE}; }}
  .phead + .chap {{ border-top:0; padding-top:0; }}
  .chap .slabel {{ margin-top:0; color:{PRIMARY}; }}
  .bl {{ font-weight:700; font-size:0.86rem; line-height:1.35; color:{INK};
         margin:5px 0 0; letter-spacing:-.005em; }}
  .chap .body {{ font-size:0.83rem; line-height:1.46; margin-top:3px; }}

  .fl {{ list-style:none; margin:8px 0 0; padding:0; border-top:1px solid {LINE}; }}
  .fb {{ padding:6px 0; border-bottom:1px solid {LINE}; }}
  .fb:last-child {{ border-bottom:none; }}
  .fbp {{ font-size:0.86rem; line-height:1.5; color:{BODY}; margin:0; }}
  .fbp b {{ color:{INK}; }}

  /* --- Footers, endnotes ---------------------------------------------- */
  .pfwrap {{ position:absolute; left:0.55in; right:0.55in; bottom:0.42in; }}
  .pfoot {{ border-top:1px solid {LINE}; padding-top:8px; }}
  .pfoot-t {{ font-size:0.72rem; line-height:1.45; color:{MUTED}; margin:0; }}
  .pfoot-t b {{ color:{BODY}; font-weight:700; }}
  .pnum {{ display:block; margin-top:5px; font-weight:700;
           font-size:0.72rem; color:{INK};
           font-variant-numeric:tabular-nums; }}
  .srch {{ font-size:0.76rem; font-weight:800; color:{INK}; margin-right:6px; }}
  .endnotes {{ margin:14px 0 0; padding-top:10px; border-top:1px solid {INK};
               font-size:0.715rem; line-height:1.45; color:{MUTED}; }}
  .en {{ white-space:normal; }}
  .enn {{ font-weight:700; color:{INK}; }}
  .ensep {{ color:{MUTED}; }}
  .endnotes a {{ color:{MUTED}; text-decoration:none; }}
  sup {{ font-size:10.6px; line-height:0; }}
  sup a.fn {{ color:{PRIMARY}; text-decoration:none; font-weight:700; }}
  a {{ color:{PRIMARY_DARK}; text-underline-offset:2px; }}

  /* --- The phone: fluid pages, as in retitc --------------------------- */
  @media screen and (max-width:8.5in) {{
    .page {{ width:100%; max-width:100%; height:auto; min-height:0; margin:0;
             box-shadow:none; padding:28px 20px; border-bottom:8px solid {PAPER}; }}
    .ds-graphic {{ width:auto !important; max-width:100% !important; }}
    .cfwrap, .pfwrap {{ position:static !important; left:auto; right:auto;
                        bottom:auto; margin-top:26px; }}
    .mast {{ flex-direction:column; gap:0; }}
    .brand {{ border-bottom:0; padding-bottom:4px; }}
    .pill {{ align-self:stretch; padding-left:0; }}
    .cover-h1 {{ font-size:2.05rem; margin-top:40px; }}
    .klabel {{ margin-top:36px; }}
    .figs {{ grid-template-columns:1fr; }}
    .fig {{ padding:12px 0; }}
    .fig + .fig {{ border-left:0; padding-left:0; border-top:1px solid {LINE}; }}
    .datebox, .cgrid {{ grid-template-columns:1fr; }}
    .datebox {{ margin-top:30px; }}
    .datebox .box-h {{ margin-bottom:6px; }}
    .cgrid .klabel {{ border-top:1px solid {INK}; padding-bottom:4px; }}
    .contents {{ border-top:0; }}
    .split {{ flex-direction:column; gap:10px; }}
    .splitl {{ flex:none; }}
    .swhead {{ display:none; }}
    .swrow {{ grid-template-columns:1fr; gap:2px; padding:10px 0; }}
    .arr {{ display:none; }}
    .sw.b::before {{ content:"\\2192\\00a0"; color:{MUTED}; }}
    .tag {{ margin-top:4px; }}
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
