#!/usr/bin/env python3
"""Rx Kids Hawaiʻi fiscal one-pager — cost, and who can legally pay for it.

Every visual goes through the engine's hooks so the user can move, resize and
edit it: prose through C.t/C.html (never bare C(), which emits no data-slot),
each chart through graphic() (a bare <svg> is frozen and invisible to the
editor).

The figures are baked in as DATA below rather than read from a file: a data
file the renderer opens would have to be declared under `editor.engine` in
docsync.yml or the draft silently fails to build in Pyodide. Every number is
reproducible from ~/Census-Forecaster:

    uv run python forecast_rxkids_2028.py            # program cost + reach
    # funding-source split by FPL threshold:
    uv run python <scratch>/rxkids_tanf_split.py

Modeled program (the proposed HI structure, universal — same benefit for
every birth family, no work requirement, no asset test, no spending
restriction):
    $1,500 once during pregnancy (>=16 weeks gestation)
    $500/mo, months 1-6      -> core program,  $4,500/birth
    $500/mo, months 7-12     -> contingent on available funds, $7,500/birth
"""
from pathlib import Path
import os
import re
import sys

HERE = Path(__file__).resolve().parent           # projects/rxkids-fiscal
REPO = HERE.parent.parent                        # repo root, where docsync/ lives
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from docsync.content import Content              # noqa: E402
from docsync.layout import Layout                # noqa: E402
from docsync.blocks import describe, graphic, pdf_button, svg_text  # noqa: E402
from docsync.blocks import chart_scroll, chart_scroll_css  # noqa: E402
from docsync.okina import OKINA_FACES            # noqa: E402

_LAYOUT = Path(os.environ.get("DOCSYNC_LAYOUT") or (HERE / "layout.json"))
_CONTENT = Path(os.environ.get("DOCSYNC_CONTENT") or (HERE / "content.md"))
_OUT = Path(os.environ.get("DOCSYNC_OUT") or (HERE / "index.html"))
EDIT = bool(os.environ.get("DOCSYNC_EDIT"))

L = Layout(_LAYOUT, page=(8.5, 11))
C = Content(_CONTENT, styles=L)

# --- Hawaiʻi Appleseed brand -------------------------------------------------
INK = "#2F3E46"       # charcoal
SLATE = "#354F52"
TEAL = "#84A98C"
DEEP = "#52796F"
ASH = "#CAD2C5"
CREAM = "#F4F7F4"
MUTE = "#7C8A80"

# Categorical pair for the funding-source encoding. The brand greens sit below
# the chroma floor and read gray as data marks, so these are stepped up until
# they pass. Validated with the dataviz validator (all six checks pass; worst
# adjacent CVD separation dE 10.8 protan / 27.8 tritan, normal-vision 23.0,
# all >= 3:1 on the sheet).
FED = "#00907A"       # federal TANF can cover this
NONFED = "#C4602F"    # state / county / philanthropic dollars
MEDI = "#3D5A98"      # Medicaid-eligible births (third validated slot)

# Where a figure DRAWN ON A CHART comes from. svg_text(restates=…) takes one
# of these: the label is editable and the bar under it is not, so each figure
# says how it is remade rather than leaving a person to discover by retyping
# that the two have parted.
SRC_COST = "uv run python forecast_rxkids_2028.py  (~/Census-Forecaster)"
SRC_SPLIT = "uv run python rxkids_tanf_split.py  (~/Census-Forecaster)"
SRC_PROGRAM = "the modelled program structure — see this file's docstring"

# --- The modeled program -----------------------------------------------------
# TY2028, universal eligibility, take-up 0.90 newborn / 0.83 prenatal.
BIRTHS_PROJECTED = 13842      # CDC NVSR + HI DOH nowcast, Kalman-projected
BIRTHS_SERVED = 13228         # after take-up

COST_CORE = 52_145_328        # prenatal + 6 months  ($4,500/birth)
COST_FULL = 87_861_306        # prenatal + 12 months ($7,500/birth)

# The Medicaid split, computed per-family off the model's own medicaid_receives
# flag (Med-QUEST categorical eligibility on real PUMS incomes) — NOT the
# KFF national Medicaid-financed-birth rate.
BIRTHS_MEDICAID = 7969        # 60.2%
BIRTHS_NONMEDICAID = 5259     # 39.8%

# --- The TANF envelope -------------------------------------------------------
# Federal TANF is capped TWICE over, and both caps bind:
#
#  1. STRUCTURE. Ongoing monthly cash for basic needs is "assistance"
#     (45 CFR 260.31), which triggers work requirements and the 60-month
#     clock — fatal to a no-work-requirement design. Michigan's Rx Kids
#     instead classifies its TANF slice as a non-recurrent short-term
#     benefit (NRST), which is exempt but must not exceed 4 payments. So at
#     MOST $1,500 + 3 x $500 = $3,000/birth is TANF-fundable, REGARDLESS of
#     how long the full program runs. Verified 2026-08-18 directly against
#     Rx Kids' own "Playbook for Replicating Rx Kids: Utilizing TANF and
#     Protecting Public Benefits" (Hanna & Shaefer, MSU/Poverty Solutions,
#     July 2024 -- written with MDHHS's TANF Policy Director), quoting
#     Michigan's TANF state plan: "no state funding will be used to support
#     families after these four payments."
#  2. INCOME. TANF dollars reach only families meeting a state "needy
#     family" test. Michigan's VERIFIED mechanism is general Medicaid
#     enrollment (not a pregnancy-specific pathway): "Families not covered
#     by Medicaid at the time of birth receive benefits through
#     philanthropic sources" (same playbook, quoting Michigan's state plan).
#
# Both screens price the SAME $3,000/birth cap -- only which births it
# reaches differs -- so TANF $ is IDENTICAL between the core (6mo) and full
# (12mo) program for a given screen; only the non-federal residual grows.
# Computed in rxkids_tanf_split.py. An EARLIER version of that script (and
# of this constant) re-ran RxKids' own eligibility test per FPL threshold,
# which is wrong: eligibility is (medicaid_receives OR income<=cap), and
# medicaid_receives is independent of income_fpl_cap, so it dominated every
# threshold up to 313% FPL and returned identical results throughout (that
# bug inflated "Med-QUEST pregnancy screen" TANF-fundable $ from a real
# $12.1M to a wrongly-uncapped ~$31-53M). Fixed by gating a raw FPL ratio
# directly instead of re-running RxKids' eligibility clauses.
TANF_ENVELOPE_UNIVERSAL = 34_287_339   # the $3,000 cap x every birth, for scale

# (label, TANF-fundable $ [same for core+full], births reached)
TANF_SCREENS = [
    ("Medicaid enrollment — Michigan's actual approach",
     20_655_771, 7969),
    ("Hawaiʻi's current TANF test (net income, ~30% FPL)",
     1_433_999, 553),
]

# Hawaii TANF context (federal award + the idle reserve). Both verified
# 2026-08-18 against primary documents: ACF's official FY2024 TANF Financial
# Data Table (SFAG, sheet E.2) and Hawaii DHS's "Report to the Thirty-Third
# Hawaii State Legislature 2025" (HRS 346-51.5), filed 2025-03-20 by
# Director Ryan I. Yamane, Attachment 1 "TANF Financial Plan."
TANF_BLOCK_GRANT = 98_578_402          # annual State Family Assistance Grant
TANF_RESERVE = 459_178_667             # reserve balance as of February 2025


def money_m(v: float, dp: int = 1) -> str:
    return f"${v / 1e6:.{dp}f}M"


# --- Chart geometry: read this before changing a viewBox or a font-size ------
# THE THREE-UNITS TRAP. A chart label's size on screen is NOT the number in the
# SVG. Each chart below is drawn in its own user units and rendered at
# CHART_W_IN inches, so:
#
#     px on screen = user units x (CHART_W_IN x 96) / VB_W
#
# At 7.5in over an 820-unit viewBox that is 0.878 px per unit, so labels
# authored at 11.5 units rendered at 10.1px — under the 10.5px floor in
# docsync/layout.py, and 7.6pt on paper against a 7.875pt floor. docsync.check
# never saw it: it reads AUTHORED sizes out of the markup and cannot know the
# conversion. tests/editor/text-legibility.spec.js measures the computed size,
# which is the only place this is visible.
#
# LABEL_U is therefore the smallest size anything here may use. Do not author a
# raw font-size below it, and if you change CHART_W_IN or VB_W, re-run the
# arithmetic — MIN_SAFE_U below is what the floor demands at the current
# geometry, and _assert_label_floor() fails the build if LABEL_U drops under it.
CHART_W_IN = 7.5
VB_W = 820
CHART_FLOOR_PX = 10.5                      # docsync.blocks.CHART_MIN_LABEL_PX
_PX_PER_UNIT = CHART_W_IN * 96 / VB_W      # 0.878
MIN_SAFE_U = CHART_FLOOR_PX / _PX_PER_UNIT  # 11.96

# 12.5 units -> 10.98px, a real margin over the floor. 12 units clears it by
# 0.04px, which is not a margin — it is the same bug waiting for someone to
# nudge CHART_W_IN. Both of the old sizes (11.5 and 12) are raised to this.
LABEL_U = 12.5
EMPH_U = 13                                # the two directly-labelled shares


def _assert_label_floor() -> None:
    if LABEL_U < MIN_SAFE_U:
        raise SystemExit(
            f"chart labels below the legibility floor: LABEL_U={LABEL_U} renders "
            f"at {LABEL_U * _PX_PER_UNIT:.2f}px at {CHART_W_IN}in over a {VB_W}-unit "
            f"viewBox; the floor is {CHART_FLOOR_PX}px (>= {MIN_SAFE_U:.2f} units)")


_assert_label_floor()


# --- Graphic 1: the payment schedule and the TANF ceiling --------------------

def payment_timeline() -> str:
    """Every payment the program makes, coloured by which funder can cover it.

    The point of the chart is the CEILING: federal TANF stops after four
    payments no matter how long the program runs, so the bars are coloured by
    funder and a band beneath restates the same split — identity never rests
    on colour alone.
    """
    W, H = VB_W, 129
    BASE = 88                       # bar baseline
    X0, SLOT, BW = 34, 59, 44
    UNIT = 58 / 1500.0              # px per dollar

    def x(i):
        return X0 + i * SLOT

    # slot 0 = prenatal; slots 1..12 = months 1..12
    p = [f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg"'
         f'{describe(C, "chart.timeline.desc", "Payment schedule by funding "
                    "source: federal TANF can cover the first four payments "
                    "only")}>']

    # legend — always present for >= 2 series
    p.append(f'<rect x="0" y="0" width="11" height="11" rx="2.5" fill="{FED}"/>')
    p.append(svg_text(C, "chart.timeline.legend.fed", "Federal TANF can cover",
                      17, 9.5, LABEL_U, SLATE))
    p.append(f'<rect x="168" y="0" width="11" height="11" rx="2.5" fill="{NONFED}"/>')
    p.append(svg_text(C, "chart.timeline.legend.nonfed", "State / county / philanthropy",
                      185, 9.5, LABEL_U, SLATE))
    p.append(f'<rect x="392" y="0" width="11" height="11" rx="2.5" fill="{NONFED}" '
             f'opacity="0.45"/>')
    p.append(svg_text(C, "chart.timeline.legend.contingent", "…contingent on available funds",
                      409, 9.5, LABEL_U, SLATE))

    # value labels
    p.append(svg_text(C, "chart.timeline.prenatal", "$1,500",
                      x(0) + BW/2, 24, LABEL_U, INK, weight=700, anchor="middle",
                      restates=SRC_PROGRAM))
    p.append(svg_text(C, "chart.timeline.monthly", "$500 per month",
                      x(6) + BW/2, 58, LABEL_U, INK, weight=700, anchor="middle",
                      restates=SRC_PROGRAM))

    bars = [(0, 1500, FED, 1.0)]
    for m in range(1, 13):
        if m <= 3:
            fill, op = FED, 1.0
        elif m <= 6:
            fill, op = NONFED, 1.0
        else:
            fill, op = NONFED, 0.45
        bars.append((m, 500, fill, op))

    for i, val, fill, op in bars:
        h = val * UNIT
        y = BASE - h
        # 4px radius on the data end only, anchored to the baseline
        p.append(f'<path d="M {x(i)} {BASE} V {y + 4} a4 4 0 0 1 4 -4 '
                 f'H {x(i) + BW - 4} a4 4 0 0 1 4 4 V {BASE} Z" '
                 f'fill="{fill}" opacity="{op}"/>')
        if i == 0:
            p.append(svg_text(C, "chart.timeline.axis.prenatal", "Pregnancy",
                              x(i) + BW/2, BASE + 14, LABEL_U, MUTE, anchor="middle"))
        else:
            # The month numbers are axis ticks — data marks, not words.
            p.append(f'<text x="{x(i) + BW/2}" y="{BASE + 14}" font-size="{LABEL_U}" '
                     f'fill="{MUTE}" text-anchor="middle">{i}</text>')

    p.append(f'<line x1="{X0}" y1="{BASE}" x2="{x(12) + BW}" y2="{BASE}" '
             f'stroke="{ASH}" stroke-width="1"/>')

    # the funding band — a 2px surface gap between the two fills
    by, bh = 107, 20
    split = x(3) + BW + 6
    p.append(f'<rect x="{X0}" y="{by}" width="{split - X0 - 2}" height="{bh}" '
             f'rx="5" fill="{FED}"/>')
    p.append(svg_text(C, "chart.timeline.band.fed", "4 payments · $3,000 max",
                      (X0 + split) / 2, by + 16, LABEL_U, "#fff", weight=700,
                      anchor="middle", restates=SRC_PROGRAM))
    p.append(f'<rect x="{split}" y="{by}" width="{x(12) + BW - split}" '
             f'height="{bh}" rx="5" fill="{NONFED}"/>')
    p.append(svg_text(C, "chart.timeline.band.rest", "every remaining payment",
                      (split + x(12) + BW) / 2, by + 16, LABEL_U, "#fff", weight=700, anchor="middle"))

    # The caption ("Numbered bars are months after birth.") is a slot rendered
    # under the graphic, not drawn in here — a sentence inside an SVG is
    # frozen to the editor (the editability contract in the report-editor
    # skill; docsync.check warns on it).
    p.append("</svg>")
    return "".join(p)


# --- Graphic 2: who pays, under each candidate needy-family screen -----------

def funding_split() -> str:
    """Stacked TANF vs non-federal, for both program lengths and both screens.

    One shared scale across all four bars so they are directly comparable, and
    every segment is directly labelled.
    """
    W = VB_W
    ROW, GAP, GRPGAP = 18, 3, 6
    # The TANF segment is only ~21px wide in the tightest row ($3.2M against a
    # $87.9M scale) — far too narrow to hold its own label inside. So the
    # federal value lives in the gutter for EVERY row (right-aligned, in the
    # federal colour) rather than inside for some rows and outside for others;
    # only the always-wide non-federal segment is labelled in place.
    X0 = 214
    BARMAX = W - X0 - 8
    scale = BARMAX / COST_FULL

    # Every label keyed by screen (s1, s2 …) and row (core, full), so the
    # words a person edits stay filed under the same bar when the chart
    # is redrawn.
    rows = []
    for n, (label, tanf, _births) in enumerate(TANF_SCREENS, 1):
        rows.append(("hdr", label, 0, 0, f"chart.funding.s{n}.title"))
        rows.append(("bar", "Core · through 6 mo", tanf, COST_CORE, f"chart.funding.s{n}.core"))
        rows.append(("bar", "Full · through 12 mo", tanf, COST_FULL, f"chart.funding.s{n}.full"))

    H = 20 + sum(ROW + GAP if k == "bar" else 16 for k, *_ in rows) + GRPGAP + 2

    p = [f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg"'
         f'{describe(C, "chart.funding.desc", "Annual cost split between "
                    "federal TANF and non-federal dollars, by program length "
                    "and needy-family screen")}>']

    p.append(f'<rect x="0" y="0" width="11" height="11" rx="2.5" fill="{FED}"/>')
    p.append(svg_text(C, "chart.funding.legend.fed", "Federal TANF", 17, 9.5, LABEL_U, SLATE))
    p.append(f'<rect x="112" y="0" width="11" height="11" rx="2.5" fill="{NONFED}"/>')
    p.append(svg_text(C, "chart.funding.legend.nonfed", "State / county / philanthropy",
                      129, 9.5, LABEL_U, SLATE))
    p.append(svg_text(C, "chart.funding.scale", "all bars share one scale",
                      W, 9.5, LABEL_U, MUTE, anchor="end"))

    y = 20
    for kind, label, tanf, total, key in rows:
        if kind == "hdr":
            if y > 24:            # extra air before a 2nd group
                y += GRPGAP
            p.append(svg_text(C, key, label, 0, y + 10, LABEL_U, INK,
                              weight=700, restates=SRC_SPLIT))
            y += 16
            continue

        p.append(svg_text(C, f"{key}.label", label, 0, y + 14, LABEL_U, SLATE))

        tw = tanf * scale
        rest = total - tanf
        rw = rest * scale
        # 2px surface gap between stacked segments
        p.append(f'<path d="M {X0} {y} H {X0 + tw - 4} a4 4 0 0 1 4 4 '
                 f'V {y + ROW - 4} a4 4 0 0 1 -4 4 H {X0} Z" fill="{FED}"/>')
        p.append(f'<path d="M {X0 + tw + 2} {y} H {X0 + tw + 2 + rw - 4} '
                 f'a4 4 0 0 1 4 4 V {y + ROW - 4} a4 4 0 0 1 -4 4 '
                 f'H {X0 + tw + 2} Z" fill="{NONFED}"/>')

        # federal value in the gutter, in the federal colour.
        # Value labels default from the DATA, so they track the model until
        # someone retypes one; a retyped label does not move its bar, which is
        # what restates= declares.
        p.append(svg_text(C, f"{key}.fed", money_m(tanf),
                          X0 - 10, y + 14, LABEL_U, FED, weight=700,
                          anchor="end", restates=SRC_SPLIT))
        # Kept short deliberately: the narrowest non-federal segment is ~230px,
        # and the long form ("needed from non-federal sources") overflows it.
        # The legend and the section heading carry the rest of the sentence.
        p.append(svg_text(C, f"{key}.rest", f"{money_m(rest)} to raise",
                          X0 + tw + 12, y + 14, LABEL_U, "#fff", weight=700,
                          restates=SRC_SPLIT))
        y += ROW + GAP

    p.append("</svg>")
    return "".join(p)


# --- Graphic 3: births by Medicaid status ------------------------------------

def medicaid_split() -> str:
    """One 100% bar: how the birth cohort divides on Medicaid eligibility.

    A single split, so a bar beats a pie — and both segments are directly
    labelled with count and share.
    """
    W, H = VB_W, 42
    X0, BW, BH, Y = 0, 820, 26, 14
    total = BIRTHS_MEDICAID + BIRTHS_NONMEDICAID
    mw = BW * BIRTHS_MEDICAID / total

    p = [f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg"'
         f'{describe(C, "chart.medicaid.desc", "Births served, split by "
                    "Medicaid eligibility")}>']
    p.append(svg_text(C, "chart.medicaid.caption", f"{total:,} births served each year",
                      0, 10, LABEL_U, MUTE, restates=SRC_COST))

    p.append(f'<rect x="{X0}" y="{Y}" width="{mw - 2}" height="{BH}" rx="5" '
             f'fill="{MEDI}"/>')
    p.append(f'<rect x="{X0 + mw}" y="{Y}" width="{BW - mw}" height="{BH}" '
             f'rx="5" fill="{NONFED}" opacity="0.75"/>')

    p.append(svg_text(C, "chart.medicaid.left", f"{BIRTHS_MEDICAID:,} on Medicaid  ·  60%",
                      10, Y + 19, EMPH_U, "#fff", weight=700, restates=SRC_COST))
    p.append(svg_text(C, "chart.medicaid.right", f"{BIRTHS_NONMEDICAID:,}  ·  40%",
                      X0 + mw + 10, Y + 19, EMPH_U, "#fff", weight=700,
                      restates=SRC_COST))

    # The takeaway line lives in a slot under the graphic (see payment_timeline
    # for why), so H stops at the bar plus its inside labels.
    p.append("</svg>")
    return "".join(p)


# --- Graphic 4 (page 2): how-it-works timeline ------------------------------

def how_it_works_chart() -> str:
    """Five-step horizontal flow: sign up → $1,500 → birth → $500/mo → birthday.

    Step labels sit above each circle; brief descriptions below. Every label
    is a slot drawn in place (svg_text), so the words edit on the page; the
    circles and connectors are the drawing.
    """
    W, H = VB_W, 112
    CY = 55.0
    R = 18.0
    CXS = [82.0, 246.0, 410.0, 574.0, 738.0]

    # Keyed s1..s5 so a rewording stays with its circle. Every one of these
    # is a word a person might rephrase, so every one is a slot (svg_text).
    steps = [
        ("Sign up",       "during pregnancy", TEAL),
        ("$1,500",        "prenatal payment",  FED),
        ("Baby arrives",  "deposits start",    TEAL),
        ("$500/month",    "no re-enrollment",  FED),
        ("1st birthday",  "family chooses",    TEAL),
    ]

    p = [f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg"'
         f'{describe(C, "chart.how.desc", "How Rx Keiki works: sign up during "
                    "pregnancy, receive a $1,500 prenatal payment, then $500 "
                    "per month through the first birthday")}>']

    # connector lines between circles
    for i in range(len(steps) - 1):
        x1 = CXS[i] + R + 2
        x2 = CXS[i + 1] - R - 2
        p.append(f'<line x1="{x1:.1f}" y1="{CY:.1f}" x2="{x2:.1f}" y2="{CY:.1f}" '
                 f'stroke="{TEAL}" stroke-width="2" opacity="0.45"/>')

    for i, (label, desc, fill) in enumerate(steps):
        cx = CXS[i]
        # circle
        p.append(f'<circle cx="{cx:.1f}" cy="{CY:.1f}" r="{R:.1f}" fill="{fill}"/>')
        # step label above the circle
        above_y = CY - R - 5
        p.append(svg_text(C, f"chart.how.s{i + 1}.label", label,
                          f"{cx:.1f}", f"{above_y:.1f}", LABEL_U, INK,
                          weight=700, anchor="middle", restates=SRC_PROGRAM))
        # description below the circle
        below_y = CY + R + LABEL_U + 3
        p.append(svg_text(C, f"chart.how.s{i + 1}.desc", desc,
                          f"{cx:.1f}", f"{below_y:.1f}", LABEL_U, MUTE, anchor="middle"))

    p.append("</svg>")
    return "".join(p)


# Card "d" is the thesis (what share TANF can cover), not a peer of the three
# descriptive facts beside it — and it is a statement about FEDERAL money, so it
# takes the federal green the charts already use for that. The other three keep
# the neutral brand teal.
def stat(key: str, cls: str = "") -> str:
    return (f'<div class="stat{cls}"{L.attr(f"stat.{key}")}>'
            f'<div class="stat-n">{C.t(f"stat.{key}.n")}</div>'
            f'<div class="stat-l">{C.t(f"stat.{key}.l")}</div></div>')


def bullets(key: str) -> str:
    return "".join(f"<li>{b}</li>" for b in C.list(key))


# Filled after C.fn.resolve() has walked the body and assigned every number.
ENDNOTES_SLOT = "<!--ds-endnotes-->"


def endnote_link(n: int, sid: str, txt: str, url: str) -> str:
    # Keyed by source id, not by n: the number is whatever the current order
    # says, but the identity the editor routes an edit back through has to stay
    # put. data-el also makes the entry draggable to reorder.
    # The citation TEXT is the link, not a spelled-out URL beside it. Six
    # printed URLs cost two vertical inches on a page that has none to spare,
    # and every route this page reaches a reader by — PDF, screen — carries
    # the href.
    sep = "" if n == 1 else '<span class="ensep"> · </span>'
    return (f'{sep}<span id="en{n}" class="en"{L.attr(f"endnote.{sid}")}>'
            f'<span class="enn">{n}</span> <a href="{url}">{txt}</a></span>')


def linkify_footnotes(markup: str, count: int) -> str:
    """Turn every <sup>N</sup> marker into a link to its endnote.

    Without this the markers render as bare numerals — visible, meaningless,
    and pointing at nothing.
    """
    def repl(m):
        nums = re.findall(r"\d+", m.group(1))
        if not nums:
            return m.group(0)
        out = [f'<a class="fn" href="#en{n}">{n}</a>' if 1 <= int(n) <= count
               else n for n in nums]
        return "<sup>" + "&thinsp;".join(out) + "</sup>"
    return re.sub(r"<sup>(.*?)</sup>", repl, markup, flags=re.S)


INNER = f"""
  <div class="eyebrow"{L.attr("hero.eyebrow")}>{C.t("hero.eyebrow")}</div>
  {L.spacer("hero.h1")}<h1{L.attr("hero.h1")}>{C.t("hero.h1")}</h1>
  {C.html("hero.standfirst", "standfirst")}

  <div class="stats"{L.attr("stats.strip")}>
    {stat("a")}{stat("b")}{stat("c")}{stat("d", " stat-fed")}
  </div>

  <h2{L.attr("timeline.title")}>{C.t("timeline.title")}</h2>
  {graphic(L, "chart.timeline", chart_scroll(payment_timeline(), smallest_label=LABEL_U), w=CHART_W_IN)}
  {C.html("timeline.note", "cnote")}

  <h2{L.attr("funding.title")}>{C.t("funding.title")}</h2>
  {graphic(L, "chart.funding", chart_scroll(funding_split(), smallest_label=LABEL_U), w=CHART_W_IN)}
  {C.html("funding.note", "note")}

  <h2{L.attr("medicaid.title")}>{C.t("medicaid.title")}</h2>
  {graphic(L, "chart.medicaid", chart_scroll(medicaid_split(), smallest_label=LABEL_U), w=CHART_W_IN)}
  {C.html("medicaid.note", "cnote")}

  <div class="cols">
    <div class="col">
      <h3 class="h-warn"{L.attr("risk.h")}>{C.t("risk.h")}</h3>
      <ul{C.ul_attr("risk.points")}>{bullets("risk.points")}</ul>
    </div>
    <div class="col">
      <h3 class="h-fed"{L.attr("ask.h")}>{C.t("ask.h")}</h3>
      <ul{C.ul_attr("ask.points")}>{bullets("ask.points")}</ul>
    </div>
  </div>

  {C.html("footer.note", "foot")}

  <div class="endnotes"><span class="srch"{L.attr("endnotes.h2")}>{C.t("endnotes.h2")}</span>{ENDNOTES_SLOT}</div>
{C.extras("page1")}"""

# --- Page 2: program overview ------------------------------------------------

def stat_p2(key: str) -> str:
    return (f'<div class="stat"{L.attr(f"p2.stat.{key}")}>'
            f'<div class="stat-n">{C.t(f"p2.stat.{key}.n")}</div>'
            f'<div class="stat-l">{C.t(f"p2.stat.{key}.l")}</div></div>')


INNER2 = f"""
  <div class="eyebrow"{L.attr("p2.hero.eyebrow")}>{C.t("p2.hero.eyebrow")}</div>
  {L.spacer("p2.hero.h1")}<h1{L.attr("p2.hero.h1")}>{C.t("p2.hero.h1")}</h1>
  {C.html("p2.hero.standfirst", "standfirst")}

  <div class="stats"{L.attr("p2.stats.strip")}>
    {stat_p2("a")}{stat_p2("b")}{stat_p2("c")}{stat_p2("d")}
  </div>

  <h2{L.attr("p2.evidence.title")}>{C.t("p2.evidence.title")}</h2>
  <div class="ev-grid"{L.attr("p2.ev.grid")}>
    <div class="ev-card"{L.attr("p2.ev.a")}>{C.t("p2.ev.a")}</div>
    <div class="ev-card"{L.attr("p2.ev.b")}>{C.t("p2.ev.b")}</div>
    <div class="ev-card"{L.attr("p2.ev.c")}>{C.t("p2.ev.c")}</div>
    <div class="ev-card"{L.attr("p2.ev.d")}>{C.t("p2.ev.d")}</div>
  </div>
  {C.html("p2.evidence.note", "cnote")}

  <div class="p2-mid">
    <div class="p2-mid-left">
      <h2{L.attr("p2.why.title")}>{C.t("p2.why.title")}</h2>
      <div class="why-cards">
        <div class="why-card"{L.attr("p2.why.a")}>
          <div class="why-h"{L.attr("p2.why.a.h")}>{C.t("p2.why.a.h")}</div>
          <div class="why-b"{L.attr("p2.why.a.b")}>{C.t("p2.why.a.b")}</div>
        </div>
        <div class="why-card"{L.attr("p2.why.b")}>
          <div class="why-h"{L.attr("p2.why.b.h")}>{C.t("p2.why.b.h")}</div>
          <div class="why-b"{L.attr("p2.why.b.b")}>{C.t("p2.why.b.b")}</div>
        </div>
        <div class="why-card"{L.attr("p2.why.c")}>
          <div class="why-h"{L.attr("p2.why.c.h")}>{C.t("p2.why.c.h")}</div>
          <div class="why-b"{L.attr("p2.why.c.b")}>{C.t("p2.why.c.b")}</div>
        </div>
      </div>
      <h2{L.attr("p2.benefits.title")}>{C.t("p2.benefits.title")}</h2>
      <div class="benefit-wrap"{L.attr("p2.benefit.row")}>
        <ul class="benefit-row"{C.ul_attr("p2.benefits.items")}>
          {"".join(f'<li class="benefit-pill">{item}</li>'
                   for item in C.list("p2.benefits.items"))}
        </ul>
      </div>
    </div>
    <div class="p2-mid-right">
      <blockquote class="pullquote"{L.attr("p2.quote")}>
        {C.html("p2.quote.text", "qtext")}
        <cite{L.attr("p2.quote.attr")}>{C.t("p2.quote.attr")}</cite>
      </blockquote>
    </div>
  </div>

  <h2{L.attr("p2.how.title")}>{C.t("p2.how.title")}</h2>
  {graphic(L, "p2.chart.how", chart_scroll(how_it_works_chart(), smallest_label=LABEL_U), w=CHART_W_IN)}
  {C.html("p2.how.note", "cnote")}

  {C.html("p2.footer.note", "foot")}
  <div class="p2sources"{L.attr("p2.sources.note")}>{C.t("p2.sources.note")}</div>
{C.extras("page2")}"""

# Every sheet, in order: this page, then any blank page added in the editor.
# Going through L.page_order() plus L.pagemeta() is what lets the page strip
# offer "+ Page" and reordering — the editor withholds both from a renderer
# that never declared its pages, since an order nothing reads draws nothing.
DESIGNED_PAGES = 2


def sheet(pid):
    """One <section class="page">: this report's markup for the designed page,
    empty for a blank page added in the editor.

    data-page carries the page's IDENTITY, which stops matching its position
    the moment the order can be changed.
    """
    inner = INNER if pid == 1 else INNER2 if pid == 2 else ""
    return (f'<section class="page" data-page="{pid}"{L.fill_attr(f"page.{pid}")}>'
            f'{inner}'
            # Inside the section: .page is the positioning context every placed
            # element is measured against, so as siblings they sat a box out.
            f'{L.layer(pid)}{L.text_boxes(pid)}{L.tables_html(pid)}'
            f'</section>')


page = ("".join(sheet(pid) for pid in L.page_order(DESIGNED_PAGES))
        + L.pagemeta(range(1, DESIGNED_PAGES + 1)))

body = C.fn.resolve(page)
en = "".join(endnote_link(i + 1, sid, txt, url)
             for i, (sid, txt, url) in enumerate(C.fn.endnotes_with_ids(), 0))
# `en` carries no <sup> markers of its own, so linkifying before the fill is
# safe and keeps the substitution out of the regex's way.
body = linkify_footnotes(body, len(C.fn.endnotes()))
body = body.replace(ENDNOTES_SLOT, en)

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{C.text("title")}</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Poppins:wght@600;700&display=swap" rel="stylesheet">
<style>
  /* Neither Manrope nor Poppins encodes U+02BB, so every ʻokina would fall
     back to the OS UI font. These one-glyph faces re-encode each family's own
     U+2018 outline at U+02BB; they must come FIRST in a stack. */
{OKINA_FACES}
  body {{ margin:0; background:{CREAM};
         font:14.5px/1.48 OkinaManrope, Manrope, system-ui, sans-serif; color:{INK}; }}
  .page {{ width:8.5in; min-height:11in; margin:24px auto; background:#fff;
           box-shadow:0 4px 18px rgba(0,0,0,.12); padding:0.4in 0.5in;
           box-sizing:border-box; position:relative; overflow:hidden; }}

  .eyebrow {{ font-size:0.88rem; font-weight:700; letter-spacing:.09em;
              color:{DEEP}; margin-bottom:3px; }}
  h1 {{ font-family:OkinaPoppins, Poppins, OkinaManrope, Manrope, sans-serif;
        font-size:1.62rem; line-height:1.06; margin:0 0 5px; color:{INK};
        letter-spacing:-.015em; }}
  .standfirst {{ font-size:0.93rem; line-height:1.36; margin:0 0 5px;
                 color:{SLATE}; max-width:7.4in; }}
  .standfirst b {{ color:{INK}; }}

  .stats {{ display:flex; gap:7px; margin:0 0 5px; align-items:stretch; }}
  .stat {{ flex:1; background:{CREAM}; border-left:3px solid {TEAL};
           padding:7px 9px; border-radius:0 7px 7px 0; }}
  /* The federal-ceiling card is the page's thesis, and it is a claim about
     federal money — so it carries the same green the charts use for TANF. */
  .stat-fed {{ border-left-color:{FED}; }}
  .stat-fed .stat-n {{ color:{FED}; }}
  .stat-n {{ font-family:OkinaPoppins, Poppins, OkinaManrope, Manrope, sans-serif;
             font-size:1.2rem; font-weight:700; line-height:1.1; color:{DEEP}; }}
  .stat-l {{ font-size:0.82rem; color:{SLATE}; line-height:1.26; margin-top:1px; }}

  /* Section rhythm. Every h2 opens a section, so each gets a rule above and
     noticeably more air before it than after — otherwise a heading sits as
     close to the chart it follows as to the one it introduces, and the page
     reads as one undifferentiated column. */
  h2 {{ font-family:OkinaPoppins, Poppins, OkinaManrope, Manrope, sans-serif;
        font-size:1.1rem; margin:12px 0 4px; padding-top:8px; color:{INK};
        border-top:1px solid {ASH}; letter-spacing:-.005em; }}
  .note {{ font-size:0.86rem; color:{SLATE}; margin:3px 0 0; }}
  .note b {{ color:{INK}; }}
  /* Chart caption, as a slot rather than SVG text — 0.74rem = 10.7px, just
     over the 10.5px chart-label floor its SVG predecessor was held to. */
  .cnote {{ font-size:0.74rem; line-height:1.25; color:{MUTE}; margin:1px 0 0; }}

  .cols {{ display:flex; gap:14px; margin:12px 0 0; align-items:stretch; }}
  /* Framed rather than bare: two colour-coded headings over loose bullets was
     the page's weakest region, with nothing holding either column together. */
  .col {{ flex:1; background:{CREAM}; border-radius:8px; padding:11px 13px 10px; }}
  h3 {{ font-family:OkinaPoppins, Poppins, OkinaManrope, Manrope, sans-serif;
        font-size:0.95rem; margin:0 0 4px; }}
  .h-warn {{ color:{NONFED}; }}
  .h-fed {{ color:{FED}; }}
  .col ul {{ margin:0; padding-left:1.05em; }}
  .col li {{ font-size:0.845rem; line-height:1.3; margin-bottom:4px;
             color:{SLATE}; }}
  .col li:last-child {{ margin-bottom:0; }}
  .col li b {{ color:{INK}; }}

  .foot {{ margin:11px 0 0; padding-top:7px; border-top:1px solid {ASH};
           font-size:0.775rem; color:{MUTE}; line-height:1.32; }}
  .foot b {{ color:{SLATE}; }}

  /* Sources: two columns of small type, so six citations cost a few lines
     rather than an inch. */
  .srch {{ font-size:0.66rem; font-weight:700; letter-spacing:.07em;
           text-transform:uppercase; color:{SLATE}; margin-right:5px; }}
  .endnotes {{ margin:5px 0 0; font-size:0.685rem; line-height:1.3;
               color:{MUTE}; }}
  .en {{ white-space:normal; }}
  .enn {{ font-weight:700; color:{DEEP}; }}
  .ensep {{ color:{ASH}; }}
  .endnotes a {{ color:{MUTE}; text-decoration:none; }}
  .endnotes a:hover {{ text-decoration:underline; }}
  /* Superscript markers inherit the UA sheet's `font-size: smaller` (~0.83x),
     so the ones inside the 0.775rem footer computed to 10.3px — under the
     10.5px floor, and invisible to docsync.check, which cannot resolve a class
     to a size. Pin it instead of letting the cascade shrink it. Do not name the
     element in this comment: check.py scans the OUTPUT for it and a tag name in
     a CSS comment swallows the first real marker after it. */
  sup {{ font-size:10.6px; line-height:0; }}
  sup a.fn {{ color:{DEEP}; text-decoration:none; font-weight:700; }}
  a {{ color:{DEEP}; }}

  /* ---- page 2 -----------------------------------------------------------
     All sizes below 10.5px floor: ev-card 0.88rem = 12.8px; why-b 0.82rem =
     11.9px; benefit-pill 0.81rem = 11.8px; qtext 0.96rem = 13.9px; p2sources
     0.72rem = 10.5px exactly at the floor. ✓ */
  .ev-grid {{ display:grid; grid-template-columns:1fr 1fr; gap:7px; margin:5px 0 0; }}
  .ev-card {{ background:{CREAM}; border-left:3px solid {TEAL};
              padding:9px 12px 9px 10px; border-radius:0 7px 7px 0;
              font-size:0.88rem; font-weight:700; color:{INK}; line-height:1.3; }}

  .p2-mid {{ display:flex; gap:14px; margin:8px 0 0; align-items:stretch; }}
  .p2-mid-left {{ flex:2; }}
  .p2-mid-right {{ flex:1; display:flex; flex-direction:column; }}

  .why-cards {{ display:flex; flex-direction:column; gap:6px; margin:5px 0 0; }}
  .why-card {{ background:{CREAM}; border-radius:7px; padding:9px 11px; }}
  .why-h {{ font-family:OkinaPoppins, Poppins, OkinaManrope, Manrope, sans-serif;
             font-size:0.875rem; font-weight:700; color:{DEEP}; margin:0 0 2px; }}
  .why-b {{ font-size:0.82rem; color:{SLATE}; line-height:1.3; margin:0; }}

  /* The pills are the items of ONE list slot (p2.benefits.items), so the
     row is a <ul> the editor opens as a bullet list; the wrapper carries
     the movable hook, since a tag cannot hold both a data-el and a
     data-slot style. */
  .benefit-row {{ display:flex; flex-wrap:wrap; gap:5px; margin:5px 0 0;
                  padding:0; list-style:none; }}
  .benefit-pill {{ background:{SLATE}; color:#fff; border-radius:20px;
                   padding:3px 11px; font-size:0.81rem; font-weight:700; }}

  .pullquote {{ margin:0; padding:14px 15px; background:{CREAM};
                border-left:3px solid {TEAL}; border-radius:0 7px 7px 0;
                flex:1; display:flex; flex-direction:column; justify-content:center; }}
  .qtext {{ font-size:0.96rem; font-style:italic; color:{INK};
            line-height:1.45; margin:0 0 8px; }}
  .qtext p {{ margin:0; }}
  .pullquote cite {{ font-size:0.795rem; color:{SLATE}; font-style:normal;
                     font-weight:700; letter-spacing:.01em; }}

  .p2sources {{ margin:8px 0 0; padding-top:7px; border-top:1px solid {ASH};
                font-size:0.72rem; color:{MUTE}; line-height:1.3; }}
</style>
</head>
<body>
{pdf_button(L, bg=DEEP)}
{chart_scroll_css()}
{body}
</body>
</html>
"""

_OUT.write_text(html)
print(f"wrote {_OUT} ({len(html):,} bytes)")
