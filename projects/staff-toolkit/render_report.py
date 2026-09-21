#!/usr/bin/env python3
"""The Toolkit — the internal guide to the staff hub's tools.

Seven designed sheets on the shared engine, in the Appleseed brand system.
Every heading and paragraph is a content.md slot; the two diagrams go through
graphic(), so they can be moved and resized in the draft editor and their
placement sticks across rebuilds.

Not a research report, so deliberately without the published-report front
matter: no org boilerplate, no copyright page, no author line. The endnotes
point at where each thing is documented rather than at outside sources.

Why the diagrams are code and not assets: a bare <svg> in the markup is frozen
and invisible to the editor (docsync.blocks.graphic), and an uploaded PNG
cannot be recoloured when the palette moves. The cost is that changing what a
diagram SAYS is an edit here, not an edit in the editor.
"""
from pathlib import Path
import os
import re
import sys

HERE = Path(__file__).resolve().parent           # projects/staff-toolkit
REPO = HERE.parents[1]                           # repo root, where docsync/ lives
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from docsync.content import Content                                # noqa: E402
from docsync.layout import Layout                                  # noqa: E402
from docsync.blocks import (card, chart_scroll, chart_scroll_css,   # noqa: E402
                            graphic, pdf_button, svg_text)
from docsync.okina import OKINA_FACES                              # noqa: E402

# Same env contract as every renderer: the editor and the export endpoint
# override these to render a draft from temp files; unset -> the working tree.
_LAYOUT = Path(os.environ.get("DOCSYNC_LAYOUT") or (HERE / "layout.json"))
_CONTENT = Path(os.environ.get("DOCSYNC_CONTENT") or (HERE / "content.md"))
_OUT = Path(os.environ.get("DOCSYNC_OUT") or (HERE / "index.html"))

L = Layout(_LAYOUT, page=(8.5, 11.0))
C = Content(_CONTENT, styles=L)

# ── The brand palette ────────────────────────────────────────────────────────
# The nine Appleseed colours. DEEP (#52796F) is the workhorse accent, not
# TEAL (#6B9E78), which is lighter despite reading as the darker name.
TEAL = "#6B9E78"
MID = "#95B7A2"
SAGE = "#CAD2C5"
PALE = "#E8EDE6"
WASH = "#D6E0D2"
DEEP = "#52796F"
DARK = "#354F52"
INK = "#2F3E46"
WHITE = "#FFFFFF"

BODY_INK = "rgba(47,62,70,.80)"      # body text is never solid charcoal
MUTE_INK = "rgba(47,62,70,.62)"

# ── Diagram sizing ───────────────────────────────────────────────────────────
# The text column: 8.5in less two 0.62in margins. Both diagrams are drawn in
# 720 user units and render at this width, so one user unit is ~0.97 CSS px
# and an 11-unit label lands at 10.6px — just over docsync.blocks'
# CHART_MIN_LABEL_PX floor of 10.5. Drop a label below 11 and the legibility
# test fails the build; that is the constraint, not a style preference.
FIG_W_IN = 7.26
LABEL_U = 11

SANS = "OkinaManrope, Manrope, system-ui, sans-serif"


# Every diagram label is a SLOT (blocks.svg_text): the words live in
# content.md under `<figure>.<slug of the wording>` and edit on the page; the
# renderer's wording is the default until someone rephrases one. The key is
# the wording's slug, so adding a label never renames its neighbours — a
# reworded label is a new slot, and the old edit is simply left behind. The
# scope is set at the top of each diagram builder (_scope), and a wording
# that repeats within one diagram takes -2, -3 … in drawing order.
_SCOPE = "fig"
_SEEN: dict[str, int] = {}


def _scope(name: str) -> str:
    global _SCOPE
    _SCOPE = name
    _SEEN.clear()
    return ""


def _key(s: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48] or "label"
    n = _SEEN.get(slug, 0) + 1
    _SEEN[slug] = n
    return f"{_SCOPE}.{slug}" + (f"-{n}" if n > 1 else "")


def _t(x, y, s, *, size=LABEL_U, fill=INK, weight="400", anchor="start",
       track=0, family=SANS, opacity=None) -> str:
    """One SVG label — a slot the person can rephrase on the page. Every
    diagram string goes through here so no label can be written below the
    legibility floor by accident, and none can be frozen into the drawing."""
    if size < LABEL_U:
        raise SystemExit(f"diagram label {s!r} at {size}u is under the "
                         f"{LABEL_U}u floor — it would render below 10.5px")
    op = f' opacity="{opacity}"' if opacity else ""
    tr = f' letter-spacing="{track}"' if track else ""
    return svg_text(C, _key(s), s, x, y, size, fill, weight=weight, anchor=anchor,
                    extra=f' font-family="{family}"{tr}{op}')


def _box(x, y, w, h, *, fill=WHITE, stroke="", r=8, opacity=None) -> str:
    st = f' stroke="{stroke}" stroke-width="1.2"' if stroke else ""
    op = f' opacity="{opacity}"' if opacity else ""
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" '
            f'fill="{fill}"{st}{op}/>')


def _marker(mid, fill) -> str:
    return (f'<marker id="{mid}" viewBox="0 0 10 10" refX="9" refY="5" '
            f'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
            f'<path d="M0,1 L9,5 L0,9 z" fill="{fill}"/></marker>')


# ── Figure 1: the three models, and what effort buys ───────────────────────
# Every number here is Anthropic's published measurement, not ours, and the
# two panels are the whole reason the figure exists: effort is a real
# accuracy/cost tradeoff on long coding work and very nearly a no-op on
# research work, so "turn it up" is not general advice.
#
# The accuracy axis runs 0-100 and is NOT truncated. A zoomed axis would make
# 84.0 against 91.7 look like a chasm; the honest picture is two bars of
# similar length beside a cost that quadrupled, and the takeaway line under
# each panel carries the point the bars are too close to shout.
#
# Opus 5's medium row is the one derived figure: the source gives "about 2
# points at medium for half the cost" against a 91.7% / $1.01 default, so it
# is shown as approximate and figmodels.note says where it comes from.
# The use lines say what to REACH FOR each one for, in tasks a reader
# recognises — not what the marketing says. "The best combination of speed and
# intelligence" told nobody when to pick Sonnet. Two lines, and the widths are
# checked against the 200-unit card interior at 5.6 units a character.
MODELS = [
    (6, "Claude Fable 5.1", "$10 / $50 per MTok", "slower",
     "The hardest problems, and", "work that runs for hours", False),
    (246, "Claude Opus 5", "$5 / $25 per MTok", "moderate",
     "Start here — drafting,", "analysis, and most coding", True),
    (486, "Claude Sonnet 5", "$2 / $10 per MTok", "fast",
     "Simple work in bulk, when", "speed matters most", False),
]

# label, percent, percent label, cost label, is_default
CODING = [("low", 84.0, "84.0%", "$0.25", False),
          ("medium", 89.7, "≈90%", "≈$0.50", False),
          ("high", 91.7, "91.7%", "$1.01", True)]
RESEARCH = [("low", 66.0, "66%", "$4.66", False),
            ("medium", 66.0, "≈66%", "—", False),
            ("high", 66.0, "≈66%", "$7.12", True)]


def _model_card(x, name, price, speed, use1, use2, default) -> str:
    ink = WHITE if default else DEEP
    body = PALE if default else BODY_INK
    mute = PALE if default else MUTE_INK
    use = WHITE if default else BODY_INK
    box = (_box(x, 34, 228, 112, fill=DEEP, r=8) if default
           else _box(x, 34, 228, 112, fill=WHITE, stroke=MID, r=8))
    tx = x + 14
    return "".join([
        box,
        _t(tx, 58, name, size=12.5, fill=ink, weight="700"),
        _t(tx, 78, price, size=11, fill=body),
        _t(tx, 94, speed, size=11, fill=mute),
        _t(tx, 116, use1, size=11, fill=use),
        _t(tx, 132, use2, size=11, fill=use),
    ])


def _effort_panel(x, title, claim, source, rows, takeaway) -> str:
    tx = x + 14
    track_x = x + 84
    out = [_box(x, 182, 346, 172, fill=PALE, stroke=DEEP, r=8),
           _t(tx, 204, title, size=12, fill=DEEP, weight="700"),
           _t(tx, 221, claim, size=11, fill=BODY_INK),
           _t(tx, 237, source, size=11, fill=MUTE_INK)]
    for i, (label, pct, pct_s, cost, is_default) in enumerate(rows):
        y = 250 + i * 26
        out += [
            _t(tx, y + 13, label, size=11, fill=INK,
               weight="700" if is_default else "400"),
            _box(track_x, y, 152, 18, fill=WHITE, r=4),
            _box(track_x, y, 152 * pct / 100.0, 18,
                 fill=DEEP if is_default else TEAL, r=4),
            _t(track_x + 166, y + 13, pct_s, size=11, fill=INK),
            _t(x + 338, y + 13, cost, size=11, fill=MUTE_INK, anchor="end"),
        ]
    out.append(_t(tx, 338, takeaway, size=11, fill=DEEP, weight="700"))
    return "".join(out)


def diagram_models() -> str:
    _scope("fig.models")
    return f"""<svg viewBox="0 0 720 366" xmlns="http://www.w3.org/2000/svg" \
role="img" aria-label="Three Claude models with their prices and what each is \
for: Fable 5.1 at ten and fifty dollars per million tokens for demanding \
reasoning and long-horizon agentic work, Opus 5 at five and twenty-five for \
complex agentic coding and the place to start for most work, and Sonnet 5 at \
two and ten for the best combination of speed and intelligence. Below, two \
panels show what raising the effort level buys. On long coding work, Opus 5 \
scores 84.0 percent at low effort for 25 cents a task and 91.7 percent at the \
default for a dollar one — eight points and four times the cost. On research \
work, Fable 5.1 scores about 66 percent at low, medium and high alike while \
the cost per task rises from 4 dollars 66 to 7 dollars 12.">

{_t(6, 16, "THE THREE MODELS", size=12, fill=DEEP, weight="700", track=1.3)}
{"".join(_model_card(*m) for m in MODELS)}

{_t(6, 172, "EFFORT, AND WHAT IT BUYS", size=12, fill=DEEP, weight="700",
    track=1.3)}
{_effort_panel(6, "Long coding work", "effort buys accuracy",
               "SWE-bench Pro subset · Opus 5", CODING,
               "8 points and 4× the cost, low to default")}
{_effort_panel(368, "Research work", "it buys almost nothing",
               "DeepResearch Bench II · Fable 5.1", RESEARCH,
               "the same score, $4.66 → $7.12 a task")}
</svg>"""


# ── Figure 2: GitHub — the repositories, and the public half ────────────────
# One figure per provider, because the combined three-column version made the
# reader hold GitHub and Cloudflare in their head at once to answer either
# question. This one answers "where does the code live and what does Claude
# do with it"; Figure 3 answers "what does Cloudflare keep".
#
# The right-hand column is the whole reason this figure is not just a repo
# list: the Library every staff member reads is built from files one public
# repository serves to anyone. The split is eight public and eight private —
# checked against `gh repo list Hawaii-Appleseed` — so the thing people get
# wrong is not the count but WHICH half holds our own work. The panel header
# carries the count; the rows carry the examples. Hawaii-Appleseed-website is
# row 1 because the arrow to GitHub Pages leaves that row at its centre —
# reorder REPOS and the arrow points at the wrong repository.
#
# ONE story: Claude Code pushes, and the public half feeds the Library. The
# project-directory box that used to hang below the repo panel was a second
# story with a second arrow back out of Claude Code, and the triangle those
# made was this figure's main legibility cost. Sheet 11 addresses the handful
# of people who clone; that detail belongs there, in prose, if anywhere.
#
# Gaps between columns are 26-40 units and carry no labels, so they can be
# tighter than Figure 2's. Manrope bold at 11u runs about 6.5 units a
# character and regular about 5.6 — that is what every width below is
# checked against.
REPOS = [("staff-updates-internal", "private"),
         ("Hawaii-Appleseed-website", "public"),
         ("primer-editor", "public"),
         ("Legislative-Research-Tool", "private"),
         ("and twelve more", "")]


def fig_repos() -> str:
    """The repository list, with the visibility tag right-aligned in the row.
    The tag is the load-bearing column, not decoration."""
    out = [_box(196, 40, 274, 152, fill=INK, r=10),
           _t(208, 62, "the repositories", size=11, fill=MID, weight="700"),
           _t(458, 62, "8 public, 8 private", size=11, fill=MID,
              weight="700", anchor="end")]
    for i, (label, vis) in enumerate(REPOS):
        y = 70 + i * 24
        muted = not vis
        out.append(_box(208, y, 250, 20, fill=WHITE, r=5,
                        opacity=".08" if muted else ".12"))
        out.append(_t(216, y + 14.5, label, size=11, fill=WHITE,
                      opacity=".65" if muted else None))
        if vis:
            out.append(_t(450, y + 14.5, vis, size=11,
                          fill=TEAL if vis == "public" else MID,
                          weight="700", anchor="end"))
    return "".join(out)


def diagram_github() -> str:
    _scope("fig.github")
    return f"""<svg viewBox="0 0 720 248" xmlns="http://www.w3.org/2000/svg" \
role="img" aria-label="Claude Code works in a local checkout and pushes to \
the Hawaiʻi Appleseed repositories on GitHub. There are sixteen, eight public \
and eight private, and the private half is the half with our own work in it, \
starting with staff-updates-internal. Hawaii-Appleseed-website is public, and \
GitHub Pages serves its publications.json and news.json to anyone, nightly, \
which is what the hub's Library is built from.">
<defs>{_marker("f1a", INK)}{_marker("f1b", DEEP)}</defs>

{_t(6, 18, "CLAUDE", size=12, fill=DEEP, weight="700", track=1.3)}
{_t(196, 18, "GITHUB", size=12, fill=DEEP, weight="700", track=1.3)}
{_t(500, 18, "PUBLIC", size=12, fill=DEEP, weight="700", track=1.3)}

{_box(6, 60, 150, 70, fill=SAGE, r=8)}
{_t(81, 88, "Claude Code", size=12.5, fill=INK, weight="700", anchor="middle")}
{_t(81, 106, "in a local checkout", size=11, fill=INK, anchor="middle")}

{_t(176, 84, "push", size=11, fill=INK, weight="700", anchor="middle")}
<line x1="160" y1="95" x2="192" y2="95" stroke="{INK}" stroke-width="2"
      marker-end="url(#f1a)"/>

{fig_repos()}

<line x1="470" y1="104" x2="496" y2="104" stroke="{DEEP}" stroke-width="2"
      marker-end="url(#f1b)"/>

{_box(500, 60, 214, 88, fill=PALE, stroke=DEEP, r=8)}
{_t(512, 84, "GitHub Pages", size=12.5, fill=DEEP, weight="700")}
{_t(512, 104, "publications.json,", size=11, fill=BODY_INK)}
{_t(512, 120, "news.json", size=11, fill=BODY_INK)}
{_t(512, 138, "nightly, open to anyone", size=11, fill=MUTE_INK)}

<line x1="607" y1="148" x2="607" y2="174" stroke="{DEEP}" stroke-width="2"
      marker-end="url(#f1b)"/>

{_box(500, 178, 214, 60, fill=DEEP, r=8)}
{_t(607, 202, "The hub's Library", size=12, fill=WHITE, weight="700",
    anchor="middle")}
{_t(607, 220, "reads them straight", size=11, fill=PALE, anchor="middle")}
</svg>"""


# ── Figure 3: Cloudflare — the gate, and the four things it keeps ───────────
# Access is drawn as a NODE both arrows pass through, not as a band down the
# side of the Cloudflare box: a band would also have been crossed by the
# rebuild that Pages pulls from GitHub, and that pull carries no Access check
# at all. Nothing in this figure touches GitHub, which is the point of
# splitting it out — the rebuild arrow lives in Figure 1's story, not here.
#
# The stores are nested inside the Cloudflare box rather than wired to it with
# arrows. Nesting says "these are all one provider" in a way six more arrows
# would only have made harder to read.
def diagram_cloudflare() -> str:
    _scope("fig.cloudflare")
    return f"""<svg viewBox="0 0 720 300" xmlns="http://www.w3.org/2000/svg" \
role="img" aria-label="A browser and a staff member's own Claude both reach \
the hub through one gate, Cloudflare Access, which checks a Google sign-in \
before anything is answered. Behind it Cloudflare Pages serves the pages, \
Pages Functions answer everything under slash api, KV keeps the checkboxes, \
tasks, comms board and live notes, R2 keeps the documents and every version \
of them, and a Durable Object is the room where live co-editing happens.">
<defs>{_marker("f2a", DEEP)}</defs>

{_t(6, 14, "WHO IS ASKING", size=12, fill=DEEP, weight="700", track=1.3)}
{_t(390, 14, "CLOUDFLARE", size=12, fill=DEEP, weight="700", track=1.3)}

{_box(6, 40, 164, 54, fill=SAGE, r=8)}
{_t(88, 62, "You, in a browser", size=12, fill=INK, weight="700",
    anchor="middle")}
{_t(88, 80, "any page on the hub", size=11, fill=INK, anchor="middle")}

{_box(6, 122, 164, 54, fill=SAGE, r=8)}
{_t(88, 144, "Your own Claude", size=12, fill=INK, weight="700",
    anchor="middle")}
{_t(88, 162, "over MCP", size=11, fill=INK, anchor="middle")}
{_t(88, 196, "no GitHub account,", size=11, fill=MUTE_INK, anchor="middle")}
{_t(88, 212, "no second password", size=11, fill=MUTE_INK, anchor="middle")}

<path d="M 170,67 C 190,67 190,92 206,92" fill="none" stroke="{DEEP}"
      stroke-width="2" marker-end="url(#f2a)"/>
<path d="M 170,149 C 190,149 190,122 206,122" fill="none" stroke="{DEEP}"
      stroke-width="2" marker-end="url(#f2a)"/>

{_box(210, 68, 140, 78, fill=DEEP, r=8)}
{_t(280, 96, "Access", size=13, fill=WHITE, weight="700", anchor="middle")}
{_t(280, 115, "Google sign-in", size=11, fill=PALE, anchor="middle")}
{_t(280, 132, "one gate, all of it", size=11, fill=PALE, anchor="middle")}
{_t(280, 170, "nothing is answered", size=11, fill=MUTE_INK, anchor="middle")}
{_t(280, 186, "before this", size=11, fill=MUTE_INK, anchor="middle")}

<path d="M 350,92 C 370,92 370,59 386,59" fill="none" stroke="{DEEP}"
      stroke-width="2" marker-end="url(#f2a)"/>
<path d="M 350,122 C 370,122 370,117 386,117" fill="none" stroke="{DEEP}"
      stroke-width="2" marker-end="url(#f2a)"/>

{_box(390, 24, 324, 272, fill=PALE, stroke=DEEP, r=10)}

{_box(404, 34, 296, 50, fill=WHITE, stroke=MID, r=8)}
{_t(416, 55, "Pages", size=12.5, fill=DEEP, weight="700")}
{_t(416, 74, "the pages themselves, rebuilt on a push", size=11,
    fill=BODY_INK)}

{_box(404, 92, 296, 50, fill=WHITE, stroke=MID, r=8)}
{_t(416, 113, "Pages Functions", size=12.5, fill=DEEP, weight="700")}
{_t(416, 132, "everything under /api", size=11, fill=BODY_INK)}

<line x1="552" y1="142" x2="552" y2="158" stroke="{DEEP}" stroke-width="2"
      marker-end="url(#f2a)"/>

{_box(404, 162, 142, 70, fill=WHITE, stroke=MID, r=8)}
{_t(416, 183, "KV", size=12.5, fill=DEEP, weight="700")}
{_t(416, 201, "checkboxes, tasks,", size=11, fill=BODY_INK)}
{_t(416, 217, "the board, the notes", size=11, fill=BODY_INK)}

{_box(558, 162, 142, 70, fill=WHITE, stroke=MID, r=8)}
{_t(570, 183, "R2", size=12.5, fill=DEEP, weight="700")}
{_t(570, 201, "the documents, and", size=11, fill=BODY_INK)}
{_t(570, 217, "every version kept", size=11, fill=BODY_INK)}

{_box(404, 242, 296, 44, fill=DEEP, r=8)}
{_t(416, 263, "The room", size=12.5, fill=WHITE, weight="700")}
{_t(416, 280, "a Durable Object — live co-editing", size=11, fill=PALE)}
</svg>"""


# ── Figure 4: the notes pipeline ────────────────────────────────────────────
def diagram_notes() -> str:
    _scope("fig.notes")
    return f"""<svg viewBox="0 0 720 172" xmlns="http://www.w3.org/2000/svg" \
role="img" aria-label="An edit to the all-staff notes doc is picked up by \
Apps Script, which both commits it to GitHub and mirrors it live into \
Cloudflare KV. The Updates page reads whichever arrives first.">
<defs>{_marker("f3a", DEEP)}</defs>

{_box(6, 56, 132, 58, fill=SAGE, r=8)}
{_t(72, 80, "The all-staff", size=11.5, fill=INK, weight="700", anchor="middle")}
{_t(72, 96, "notes doc", size=11.5, fill=INK, weight="700", anchor="middle")}

<line x1="142" y1="85" x2="172" y2="85" stroke="{DEEP}" stroke-width="2"
      marker-end="url(#f3a)"/>

{_box(176, 48, 126, 74, fill=WHITE, stroke=MID, r=8)}
{_t(239, 76, "Apps Script", size=12, fill=DEEP, weight="700", anchor="middle")}
{_t(239, 93, "watches the doc", size=11, fill=BODY_INK, anchor="middle")}
{_t(239, 108, "and pushes", size=11, fill=BODY_INK, anchor="middle")}

{_t(331, 37, "committed", size=11, fill=MUTE_INK, anchor="middle")}
<path d="M 306,74 C 330,52 336,44 360,42" fill="none" stroke="{DEEP}"
      stroke-width="2" marker-end="url(#f3a)"/>
{_t(331, 149, "live", size=11, fill=MUTE_INK, anchor="middle")}
<path d="M 306,96 C 330,118 336,126 360,128" fill="none" stroke="{DEEP}"
      stroke-width="2" stroke-dasharray="5 4" marker-end="url(#f3a)"/>

{_box(364, 14, 160, 54, fill=INK, r=8)}
{_t(444, 36, "GitHub", size=11.5, fill=MID, weight="700", anchor="middle")}
{_t(444, 53, "data/staff-updates.json", size=11, fill=WHITE, anchor="middle")}

{_box(364, 104, 160, 54, fill=PALE, stroke=DEEP, r=8)}
{_t(444, 126, "Cloudflare KV", size=11.5, fill=DEEP, weight="700",
    anchor="middle")}
{_t(444, 143, "the live mirror", size=11, fill=BODY_INK, anchor="middle")}

<path d="M 528,41 C 548,52 544,68 556,80" fill="none" stroke="{DEEP}"
      stroke-width="2" marker-end="url(#f3a)"/>
<path d="M 528,131 C 548,120 544,104 556,92" fill="none" stroke="{DEEP}"
      stroke-width="2" stroke-dasharray="5 4" marker-end="url(#f3a)"/>

{_box(560, 56, 154, 58, fill=DEEP, r=8)}
{_t(637, 80, "The Updates", size=12, fill=WHITE, weight="700", anchor="middle")}
{_t(637, 97, "page", size=12, fill=WHITE, weight="700", anchor="middle")}
</svg>"""


# ── Figure 5: connectors, the CLI, MCP servers and plugins ─────────────────
# Four words people use as if they were four alternatives. They are not, and
# the geometry is the argument: the server is ONE box on the right, both
# doors point at it, and the plugin is a container drawn underneath rather
# than a fourth door — because it is not one.
#
# The `.mcp.json` chip is filled rather than outlined for the same reason the
# Access gate is filled in Figure 3: it is the one part of the bundle that is
# the same thing as the box above it, and that overlap is the whole confusion
# the figure exists to end.
PLUGIN_PARTS = ["skills", "agents", "hooks", "commands",
                ".mcp.json", "LSP servers", "monitors"]


def _chips(x0, y, parts) -> str:
    out, x = [], x0
    for p in parts:
        w = 5.6 * len(p) + 22
        overlap = p == ".mcp.json"
        out.append(_box(x, y, w, 24, fill=DEEP if overlap else WHITE,
                        stroke="" if overlap else MID, r=5))
        out.append(_t(x + 11, y + 16.5, p, size=11,
                      fill=WHITE if overlap else INK,
                      weight="700" if overlap else "400"))
        x += w + 8
    return "".join(out)


def diagram_stack() -> str:
    _scope("fig.stack")
    return f"""<svg viewBox="0 0 720 344" xmlns="http://www.w3.org/2000/svg" \
role="img" aria-label="One MCP server with two doors onto it. claude.ai \
reaches it through a Connector added in Settings; Claude Code, the CLI, \
reaches the same server with claude mcp add --transport http. Both arrows \
point at a single box: the MCP server, one address and one protocol, which \
for this hub is slash api slash mcp. Signing in to Claude Code with a \
claude.ai account makes your connectors appear there too. Underneath, a \
plugin is drawn as a container rather than a third door: it is Claude Code \
only, installed from a marketplace, and it bundles skills, agents, hooks, \
commands, an .mcp.json, LSP servers and monitors — the .mcp.json inside it \
being itself an MCP server.">
<defs>{_marker("f5a", INK)}{_marker("f5b", DEEP)}</defs>

{_t(6, 16, "ONE SERVER, AND TWO DOORS ONTO IT", size=12, fill=DEEP,
    weight="700", track=1.3)}

{_box(6, 36, 164, 58, fill=SAGE, r=8)}
{_t(88, 58, "claude.ai", size=12, fill=INK, weight="700", anchor="middle")}
{_t(88, 76, "Pro, Max or Team", size=11, fill=INK, anchor="middle")}

{_box(6, 116, 164, 58, fill=SAGE, r=8)}
{_t(88, 138, "Claude Code", size=12, fill=INK, weight="700", anchor="middle")}
{_t(88, 156, "the CLI, in a terminal", size=11, fill=INK, anchor="middle")}

<line x1="174" y1="65" x2="202" y2="65" stroke="{INK}" stroke-width="2"
      marker-end="url(#f5a)"/>
<line x1="174" y1="145" x2="202" y2="145" stroke="{INK}" stroke-width="2"
      marker-end="url(#f5a)"/>

{_box(206, 36, 190, 58, fill=WHITE, stroke=MID, r=8)}
{_t(218, 58, "A Connector", size=12, fill=DEEP, weight="700")}
{_t(218, 76, "Settings, then Connectors", size=11, fill=BODY_INK)}

{_box(206, 116, 190, 58, fill=WHITE, stroke=MID, r=8)}
{_t(218, 138, "claude mcp add", size=12, fill=DEEP, weight="700")}
{_t(218, 156, "--transport http", size=11, fill=BODY_INK)}

<path d="M 400,65 C 418,65 418,88 430,88" fill="none" stroke="{DEEP}"
      stroke-width="2" marker-end="url(#f5b)"/>
<path d="M 400,145 C 418,145 418,122 430,122" fill="none" stroke="{DEEP}"
      stroke-width="2" marker-end="url(#f5b)"/>

{_box(434, 56, 280, 98, fill=DEEP, r=10)}
{_t(574, 86, "The MCP server", size=13, fill=WHITE, weight="700",
    anchor="middle")}
{_t(574, 106, "one address, one protocol", size=11, fill=PALE,
    anchor="middle")}
{_t(574, 128, "this hub: /api/mcp", size=11, fill=PALE, anchor="middle")}

{_t(206, 192, "Sign in to Claude Code with your claude.ai account and your \
connectors appear there too.", size=11, fill=MUTE_INK)}

{_t(6, 218, "A PLUGIN IS NOT A DOOR — IT IS A BUNDLE", size=12, fill=DEEP,
    weight="700", track=1.3)}
{_box(6, 234, 708, 104, fill=PALE, stroke=DEEP, r=10)}
{_t(20, 258, "Claude Code only, and installed from a marketplace", size=12,
    fill=DEEP, weight="700")}
{_chips(20, 272, PLUGIN_PARTS)}
{_t(20, 316, "The .mcp.json inside it is an MCP server — that is the whole \
overlap. A plugin can carry one,", size=11, fill=MUTE_INK)}
{_t(20, 332, "along with everything a connector cannot.", size=11,
    fill=MUTE_INK)}
</svg>"""


# ── Figure 6: the two routes from the Claude app to GitHub ─────────────────
# Drawn rather than screenshotted on purpose. A screenshot of the app is
# right until the app's next release and cannot be recoloured when the
# palette moves — the same reason every other figure here is code.
#
# The two lanes are separated because the difference between them is the
# whole point: the top one cannot write, and people wait for it to open a
# pull request that it will never open. The read-only sentence therefore sits
# UNDER the top lane, where someone tracing that route meets it, rather than
# in the figure note where it would be read last or not at all.
def _lane(y, a1, a2, b1, b2, c1, c2) -> str:
    return "".join([
        _box(6, y, 150, 50, fill=SAGE, r=8),
        _t(81, y + 21, a1, size=12, fill=INK, weight="700", anchor="middle"),
        _t(81, y + 38, a2, size=11, fill=INK, anchor="middle"),
        f'<line x1="160" y1="{y + 25}" x2="192" y2="{y + 25}" stroke="{INK}" '
        f'stroke-width="2" marker-end="url(#f6a)"/>',
        _box(196, y, 200, 50, fill=WHITE, stroke=MID, r=8),
        _t(208, y + 21, b1, size=12, fill=DEEP, weight="700"),
        _t(208, y + 38, b2, size=11, fill=BODY_INK),
        f'<line x1="400" y1="{y + 25}" x2="432" y2="{y + 25}" stroke="{DEEP}" '
        f'stroke-width="2" marker-end="url(#f6b)"/>',
        _box(436, y, 278, 50, fill=DEEP, r=8),
        _t(450, y + 21, c1, size=12, fill=WHITE, weight="700"),
        _t(450, y + 38, c2, size=11, fill=PALE),
    ])


def diagram_routes() -> str:
    _scope("fig.routes")
    return f"""<svg viewBox="0 0 720 268" xmlns="http://www.w3.org/2000/svg" \
role="img" aria-label="Two routes from the Claude app to GitHub. The reading \
route: a Connector, added with the plus button and Add from GitHub, brings \
the files of a repository — names and contents only — into a chat or a \
Project, where you can ask questions about the code. That route is read-only: \
no commit history, no issues and no pull requests. The changing route: Claude \
Code in the Code tab works in your checkout, where it branches, commits and \
pushes, and opens a pull request with gh pr create. The pull request is then \
reviewed and merged, and merging is a person's act.">
<defs>{_marker("f6a", INK)}{_marker("f6b", DEEP)}</defs>

{_t(6, 14, "READING — A CONNECTOR", size=12, fill=DEEP, weight="700",
    track=1.3)}
{_lane(28, "A Connector", "Add from GitHub",
       "The files of a repo", "names and contents only",
       "Into a chat or a Project", "ask it about the code")}
{_t(6, 96, "Read-only. No commit history, no issues, and no pull requests — \
so do not wait for one.", size=11, fill=MUTE_INK)}

{_t(6, 120, "CHANGING — CLAUDE CODE", size=12, fill=DEEP, weight="700",
    track=1.3)}
{_lane(136, "Claude Code", "the Code tab",
       "Your checkout", "branch, commit, push",
       "A pull request", "gh pr create")}

<line x1="575" y1="186" x2="575" y2="206" stroke="{DEEP}" stroke-width="2"
      marker-end="url(#f6b)"/>

{_box(436, 210, 278, 46, fill=PALE, stroke=DEEP, r=8)}
{_t(450, 232, "Read, then merged", size=12, fill=DEEP, weight="700")}
{_t(450, 248, "merging stays a person's act", size=11, fill=BODY_INK)}
</svg>"""


# ── Sheet furniture ─────────────────────────────────────────────────────────
def head(pre: str, page_no: int) -> str:
    """A content page's eyebrow, title and standfirst."""
    return (f'<div class="phead">'
            f'<div class="eyebrow"{L.attr(f"{pre}.eyebrow")}>'
            f'{C.t(f"{pre}.eyebrow")}</div>'
            f'{L.spacer(f"{pre}.h1")}<h1{L.attr(f"{pre}.h1")}>'
            f'{C.t(f"{pre}.h1")}</h1>'
            f'<div class="psub"{L.attr(f"{pre}.sub")}>{C.t(f"{pre}.sub")}</div>'
            f'</div>')


def foot(key: str, page_no: int) -> str:
    """The running folio. C.html, not C.t: these carry emphasis, and a bare
    C.t would ship the asterisks. The label beside the numeral is one slot
    shared by every page, so retitling the document moves all five at once."""
    return (f'<div class="pfoot">{C.html(key, "pfoot-t")}'
            f'<span class="pnum"{L.attr(f"foot.pnum.{page_no}")}>'
            f'{page_no:02d} · {C.t("foot.running")}</span></div>')


def figure(cap_key: str, note_key: str, el_id: str, svg: str) -> str:
    """Caption above, source line below — the house figure furniture."""
    return (f'<div class="figure">'
            f'<div class="figcap"{L.attr(cap_key)}>{C.t(cap_key)}</div>'
            f'{graphic(L, el_id, chart_scroll(svg, smallest_label=LABEL_U), w=FIG_W_IN)}'
            f'{C.html(note_key, "figsrc")}'
            f'</div>')


def contents_rows() -> str:
    return "".join(
        f'<div class="crow"{L.attr(f"cover.contents.{n}")}>'
        f'<span class="cnum">{n}</span>'
        f'<span class="ctxt">{C.t(f"cover.contents.{n}")}</span></div>'
        for n in ("02", "03", "04", "05", "06", "07", "08", "09", "10",
                  "11", "12", "13", "14"))


PAGE1 = f"""
  <div class="eyebrow"{L.attr("cover.eyebrow")}>{C.t("cover.eyebrow")}</div>
  {L.spacer("cover.h1")}<h1 class="cover-h1"{L.attr("cover.h1")}>\
{C.t("cover.h1")}</h1>
  <div class="rule"></div>
  {C.html("cover.deck", "deck")}
  {C.html("cover.lead", "lead")}
  <div class="contents">
    <div class="klabel"{L.attr("cover.contents.h")}>{C.t("cover.contents.h")}</div>
    {contents_rows()}
  </div>
  <div class="cstamp"{L.attr("cover.stamp")}>{C.t("cover.stamp")}</div>
"""

# The models sheet, first after the cover. Slots are prefixed `peval`/`eval`
# and the figure is `figmodels`, not `fig1` — same rule as the Cloudflare
# sheet below: a slot key is an identity, and the CAPTION carries the figure
# number. So fig1.h reads "Figure 2." and that is correct, not a leftover.
PAGE2 = f"""
  {head("peval", 2)}
  {figure("figmodels.h", "figmodels.note", "fig.models", diagram_models())}
  <h2{L.attr("eval.read.h")}>{C.t("eval.read.h")}</h2>
  {C.html("eval.read.p", "body")}
  {foot("peval.foot", 2)}
"""

PAGE3 = f"""
  {head("p2", 4)}
  {figure("fig1.h", "fig1.note", "fig.github", diagram_github())}
  <h2{L.attr("cover.read.h")}>{C.t("cover.read.h")}</h2>
  {C.html("cover.read.p", "body")}
  {foot("p2.foot", 4)}
"""

PAGE4 = f"""
  {head("pcf", 8)}
  {figure("fig2.h", "fig2.note", "fig.cloudflare", diagram_cloudflare())}
  <h2{L.attr("cf.read.h")}>{C.t("cf.read.h")}</h2>
  {C.html("cf.read.p", "body")}
  {card(C, L, "cover.card.title", "cover.card.bullets", DEEP,
        detachable=True, min_h=1.4)}
  {foot("pcf.foot", 8)}
"""

PAGE5 = f"""
  {head("p3", 9)}
  {C.html("updates.p", "lead")}
  {figure("fig3.h", "fig3.note", "fig.notes", diagram_notes())}
  <h2{L.attr("updates.how.h")}>{C.t("updates.how.h")}</h2>
  {C.html("updates.how.p", "body")}
  {foot("p3.foot", 9)}
"""

PAGE6 = f"""
  {head("p4", 10)}
  <h2{L.attr("cal.h")}>{C.t("cal.h")}</h2>
  {C.html("cal.p", "lead")}
  {card(C, L, "cal.card.title", "cal.card.bullets", PALE,
        detachable=True, min_h=1.3)}
  <h2{L.attr("subs.h")}>{C.t("subs.h")}</h2>
  {C.html("subs.p", "body")}
  {foot("p4.foot", 10)}
"""

PAGE7 = f"""
  {head("p5", 11)}
  {C.html("lib.p", "lead")}
  <h2{L.attr("res.h")}>{C.t("res.h")}</h2>
  {C.html("res.p", "body")}
  <h2{L.attr("search.h")}>{C.t("search.h")}</h2>
  {C.html("search.p", "body")}
  {card(C, L, "search.card.title", "search.card.bullets", SAGE,
        detachable=True, min_h=1.5)}
  {foot("p5.foot", 11)}
"""

PAGE8 = f"""
  {head("p6", 12)}
  {C.html("ed.p", "lead")}
  {card(C, L, "ed.card.title", "ed.card.bullets", DARK,
        detachable=True, min_h=1.9)}
  <h2{L.attr("ed.rooms.h")}>{C.t("ed.rooms.h")}</h2>
  {C.html("ed.rooms.p", "body")}
  <h2{L.attr("ed.share.h")}>{C.t("ed.share.h")}</h2>
  {C.html("ed.share.p", "body")}
  {foot("p6.foot", 12)}
"""

PAGE9 = f"""
  {head("p7", 13)}
  {C.html("mcp.p", "lead")}
  {card(C, L, "mcp.card.title", "mcp.card.bullets", DEEP,
        detachable=True, min_h=1.7)}
  <h2{L.attr("broke.h")}>{C.t("broke.h")}</h2>
  {C.html("broke.p", "body")}
  {foot("p7.foot", 13)}
"""

PAGE10 = f"""
  {head("pmcp", 7)}
  {figure("figstack.h", "figstack.note", "fig.stack", diagram_stack())}
  <h2{L.attr("stack.read.h")}>{C.t("stack.read.h")}</h2>
  {C.html("stack.read.p", "body")}
  {foot("pmcp.foot", 7)}
"""

PAGE11 = f"""
  {head("pgh", 5)}
  {C.html("gh.p", "lead")}
  {card(C, L, "gh.card.title", "gh.card.bullets", DARK,
        detachable=True, min_h=2.4)}
  <h2{L.attr("gh.after.h")}>{C.t("gh.after.h")}</h2>
  {C.html("gh.after.p", "body")}
  {foot("pgh.foot", 5)}
"""

PAGE12 = f"""
  {head("pdesk", 6)}
  {figure("figroutes.h", "figroutes.note", "fig.routes", diagram_routes())}
  <h2{L.attr("routes.h")}>{C.t("routes.h")}</h2>
  {C.html("routes.p", "body")}
  <h2{L.attr("pr.h")}>{C.t("pr.h")}</h2>
  {C.html("pr.p", "body")}
  {foot("pdesk.foot", 6)}
"""

# The glossary runs in two columns. .twocol has been in this stylesheet since
# the first draft and unused until now; a seventeen-term list down one column
# would have run past the foot of the sheet.
PAGE13 = f"""
  {head("pgloss", 14)}
  <div class="twocol">
    <div>{C.html("gloss.a", "gloss")}</div>
    <div>{C.html("gloss.b", "gloss")}</div>
  </div>
  {foot("pgloss.foot", 14)}
"""

# The endnotes get their own sheet. Seven of them plus two sections no longer
# fit on page 9, and the alternative was shaving real sentences to buy a
# quarter inch — see primer/CLAUDE.md on measuring, not guessing.
PAGE14 = f"""
  <div class="endnotes endnotes-own">
    <div class="klabel"{L.attr("endnotes.h2")}>{C.t("endnotes.h2")}</div>
    {C.fn.MOUNT}
  </div>
  {foot("pend.foot", 15)}
"""

PAGEWHY = f"""
  {head("pwhy", 3)}
  {C.html("why.p", "lead")}
  {card(C, L, "why.card.title", "why.card.bullets", DEEP,
        detachable=True, min_h=2.4)}
  <h2{L.attr("why.gh.h")}>{C.t("why.gh.h")}</h2>
  {C.html("why.gh.p", "body")}
  {foot("pwhy.foot", 3)}
"""

# Position -> sheet. The GitHub trio (what GitHub remembers, the CLI, the two
# routes) now runs together at 4-6 instead of being split across the guide,
# and PAGEWHY opens the whole block at 3. Sheets 2-7 are the basics — choosing
# a model, why a hub at all, GitHub, and the four words for reaching a tool;
# 8-13 are this hub specifically, starting with what Cloudflare keeps. The
# PAGEn NAMES are identities and
# deliberately no longer match their positions: renaming them would be a much
# larger diff than reordering this one map, and every page number a reader
# sees comes from the foot() call inside each sheet.
DESIGNED = {1: PAGE1, 2: PAGE2, 3: PAGEWHY, 4: PAGE3, 5: PAGE11,
            6: PAGE12, 7: PAGE10, 8: PAGE4, 9: PAGE5, 10: PAGE6,
            11: PAGE7, 12: PAGE8, 13: PAGE9, 14: PAGE13, 15: PAGE14}

# Derived from the layout rather than hardcoded: Save commits layout.json but
# NOT this file, so a hardcoded count goes stale the moment a page is added in
# the editor — and page_order() then refuses to render at all.
DESIGNED_PAGES = max(
    [p for p in (L.pages.get("order") or []) if isinstance(p, int)]
    or [len(DESIGNED)])
NOTICES: list = []


def sheet(pid) -> str:
    """One <section class="page">: this document's markup for a designed
    page, empty for a blank page added in the editor.

    data-page carries the page's IDENTITY, which stops matching its position
    the moment the order can be changed. L.layer/text_boxes/tables_html go
    INSIDE the section — .page is the positioning context every placed
    element is measured against, so as siblings they would sit a box out.
    """
    inner = DESIGNED.get(pid, "") if isinstance(pid, int) else ""
    return (f'<section class="page" data-page="{pid}"'
            f'{L.fill_attr(f"page.{pid}")}>{inner}'
            f'{C.extras(f"page{pid}") if isinstance(pid, int) else ""}'
            f'{L.layer(pid)}{L.text_boxes(pid)}{L.tables_html(pid)}'
            f'</section>')


def linkify_footnotes(markup: str, count: int) -> str:
    """Turn every <sup>N</sup> marker into a link to its endnote. Without this
    the markers render as bare numerals pointing at nothing."""
    def repl(m):
        nums = re.findall(r"\d+", m.group(1))
        if not nums:
            return m.group(0)
        out = [f'<a class="fn" href="#en{n}">{n}</a>' if 1 <= int(n) <= count
               else n for n in nums]
        return "<sup>" + "&thinsp;".join(out) + "</sup>"
    return re.sub(r"<sup>(.*?)</sup>", repl, markup, flags=re.S)


body = ("".join(sheet(pid) for pid in L.page_order(DESIGNED_PAGES))
        + L.pagemeta(range(1, DESIGNED_PAGES + 1))
        + L.notices(NOTICES))
# resolve() walks the body assigning numbers and fills the endnotes mount on
# the last sheet as it goes; only after that is the count known, so linkify runs last.
body = C.fn.resolve(body)
body = linkify_footnotes(body, len(C.fn.endnotes()))

unused = C.fn.unused()
if unused:
    raise SystemExit(f"sources nothing cites: {', '.join(unused)}")

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{C.text("title")}</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800\
&family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  /* Neither Manrope nor Poppins encodes U+02BB, so every ʻokina would fall
     back to the OS UI font. These one-glyph faces re-encode each family's own
     U+2018 outline at U+02BB; they must come FIRST in a stack. */
{OKINA_FACES}
  body {{ margin:0; background:{WASH};
          font:13.5px/1.6 OkinaPoppins, Poppins, system-ui, -apple-system,
               Arial, sans-serif;
          color:{BODY_INK}; }}

  /* position:relative is load-bearing: every placed object is absolute
     against its page, so the page must be the containing block or the whole
     document stacks at the window's origin. isolation:isolate equally so —
     it keeps a send-to-back shape above the page's own background. */
  .page {{ width:8.5in; min-height:11in; margin:24px auto; background:{WHITE};
           box-shadow:0 4px 18px rgba(0,0,0,.12); padding:0.75in 0.62in;
           box-sizing:border-box; position:relative; isolation:isolate;
           overflow:hidden; }}

  /* --- Headings. Manrope has no true italic on Google Fonts, so nothing
         here ever sets font-style:italic on it. ------------------------- */
  h1, h2, .eyebrow, .klabel, .figcap, .cnum, .pnum {{
      font-family:OkinaManrope, Manrope, system-ui, sans-serif; }}
  .eyebrow {{ font-size:11px; font-weight:800; letter-spacing:1.6px;
              text-transform:uppercase; color:{TEAL}; margin:0 0 10px; }}
  h1 {{ font-size:26px; line-height:1.14; font-weight:800; color:{DEEP};
        margin:0 0 10px; letter-spacing:-.3px; }}
  .cover-h1 {{ font-size:52px; line-height:1.02; letter-spacing:-1.4px;
               color:{DARK}; margin:0 0 14px; }}
  h2 {{ font-size:16px; font-weight:800; color:{DARK}; margin:20px 0 7px; }}
  .rule {{ height:4px; width:1.5in; background:{TEAL}; border-radius:2px;
           margin:0 0 16px; }}
  .deck {{ font-size:16px; line-height:1.45; font-weight:500; color:{DEEP};
           margin:0 0 16px; max-width:6in; }}
  .lead {{ font-size:14px; margin:0 0 16px; }}
  .body {{ font-size:13.5px; margin:0 0 12px; }}
  /* The glossary: one paragraph per term, tighter than body prose so a
     column of seventeen reads as a list without being one. Bold is <b>
     (docsync's inline grammar emits <b>, never <strong>), so the term
     itself is what takes the accent colour. */
  .gloss {{ font-size:12px; line-height:1.45; margin:0 0 9px; }}
  .gloss b {{ color:{DEEP}; }}
  .lead p, .body p {{ margin:0 0 9px; }}
  .lead p:last-child, .body p:last-child {{ margin-bottom:0; }}
  .psub {{ font-size:14.5px; line-height:1.4; font-weight:500; color:{TEAL};
           margin:0 0 15px; max-width:5.4in; }}
  .phead {{ border-bottom:1px solid {PALE}; padding-bottom:11px;
            margin-bottom:15px; }}
  .klabel {{ font-size:11px; font-weight:800; letter-spacing:1.4px;
             text-transform:uppercase; color:{DEEP}; margin:0 0 9px; }}

  /* --- Figures: caption above, source below --------------------------- */
  .figure {{ margin:16px 0 18px; }}
  .figcap {{ font-size:13.5px; font-weight:800; color:{DARK}; margin:0 0 9px; }}
  .figsrc {{ font-size:11.5px; line-height:1.4; color:{MUTE_INK};
             margin:9px 0 0; }}
  .figsrc p {{ margin:0; }}

  /* --- The cover's lower band ----------------------------------------- */
  .twocol {{ display:flex; gap:18px; align-items:flex-start; margin:18px 0 0; }}
  .twocol > * {{ flex:1 1 0; min-width:0; }}
  .crow {{ display:flex; gap:11px; align-items:baseline;
           padding:7px 0; border-top:1px solid {PALE}; }}
  .cnum {{ font-size:13px; font-weight:800; color:{TEAL}; min-width:20px; }}
  .ctxt {{ font-size:13px; line-height:1.35; color:{INK}; }}
  .cstamp {{ position:absolute; left:0.62in; bottom:0.55in; font-size:11px;
             font-weight:600; letter-spacing:1.2px; text-transform:uppercase;
             color:{MUTE_INK}; }}

  /* --- Footers and endnotes ------------------------------------------- */
  .pfoot {{ position:absolute; left:0.62in; right:0.62in; bottom:0.5in;
            display:flex; justify-content:space-between; align-items:baseline;
            gap:14px; border-top:1px solid {PALE}; padding-top:8px; }}
  .pfoot-t {{ font-size:11.5px; color:{MUTE_INK}; margin:0; }}
  .pfoot-t p {{ margin:0; }}
  .pnum {{ font-size:11px; font-weight:800; letter-spacing:1.2px;
           text-transform:uppercase; color:{DEEP}; white-space:nowrap; }}
  .endnotes {{ margin:20px 0 0; padding-top:12px; border-top:1px solid {PALE}; }}
  .ds-endnotes {{ font-size:11.5px; line-height:1.45; color:{MUTE_INK}; }}
  .ds-endnotes a {{ color:{DEEP}; text-decoration:none; }}
  .ds-endnotes a:hover {{ text-decoration:underline; }}

  /* --- Prose details --------------------------------------------------- */
  strong {{ font-weight:700; color:{INK}; }}
  code {{ font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size:.92em; background:{PALE}; color:{DARK};
          padding:1px 4px; border-radius:4px; }}
  a {{ color:{DEEP}; }}
  sup {{ font-size:10.5px; line-height:0; }}
  sup a.fn {{ color:{DEEP}; text-decoration:none; font-weight:700; }}
  .extra-section h2 {{ margin-top:18px; }}
  .ds-textbox p {{ margin:0 0 .5em; }}
  .ds-textbox p:last-child {{ margin-bottom:0; }}
  .ds-table {{ border-collapse:collapse; font-size:11.5px; }}
  .ds-table td, .ds-table th {{ border:1px solid {SAGE}; padding:4px 7px;
          text-align:left; }}

  /* The sheet is the breakpoint, not a device: below its own width the page
     can no longer show the design at the size it was composed at. */
  @media screen and (max-width:8.5in) {{
    .page {{ width:100%; min-height:0; margin:0; box-shadow:none;
             padding:26px 20px; }}
    .cover-h1 {{ font-size:38px; letter-spacing:-.9px; }}
    /* The .ds-graphic release this used to carry by hand now comes from
       docsync.blocks itself (_graphic_mobile_once), so every report that
       places a figure by inch gets it — not just the one that noticed. */
    /* pdf_button() pins itself top-right, which on a desktop floats over the
       grey gutter beside the sheet. At 375px there is no gutter and it sat on
       top of the page title. Bottom-right corner instead — !important because
       the button's geometry is inline styles from docsync.blocks. */
    body > button {{ top:auto !important; bottom:14px !important;
                     right:14px !important; padding:8px 13px !important;
                     font-size:13.5px !important; }}
    .twocol {{ flex-direction:column; gap:14px; }}
    .pfoot, .cstamp {{ position:static; left:auto; right:auto; bottom:auto;
                       margin-top:22px; }}
  }}
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
