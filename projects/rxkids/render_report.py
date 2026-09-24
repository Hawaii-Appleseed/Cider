#!/usr/bin/env python3
"""RxKids renderer.

original.html stays the untouched reference copy of the page as pulled from
the Hawaii Appleseed website repo. This renderer no longer echoes its <body>
verbatim (STAGE ONE did, see git history) — every section below is rebuilt
from docsync slots, keeping the original CSS classes/JS so it renders
identically, but with text (C.t/C.html/C.list), images (img_el) and section
containers (L.attr/L.spacer) wired for the draft editor.

Two edit-mode-only overrides, both needed for the page to be usable INSIDE the
editor's iframe rather than just on the live site:
  - the original page gates each section behind a scroll-triggered
    IntersectionObserver ('.tfc-reveal' -> opacity:0 until it fires); that
    observer doesn't reliably fire inside the editor's iframe (see the
    report-editor skill's noted interop quirk), which left everything below
    the hero invisible, not just un-editable. DOCSYNC_EDIT forces reveal
    classes visible immediately.
  - the hero's auto-cycling JS overwrites <img id="hero-image">'s src with one
    of three hardcoded URLs every few seconds, which would silently undo a
    user's "replace image" edit a few seconds after they made it. Disabled
    under DOCSYNC_EDIT; unchanged on the published page.
"""
from pathlib import Path
import base64
import html as _html
import json
import os
import re
import sys

HERE = Path(__file__).resolve().parent           # projects/rxkids
REPO = HERE.parent.parent                        # repo root, where docsync/ lives
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from docsync.content import Content, ContentError, merge_attrs  # noqa: E402
from docsync.layout import Layout                # noqa: E402
from docsync.okina import OKINA_FACES, okinafy  # noqa: E402

_LAYOUT = Path(os.environ.get("DOCSYNC_LAYOUT") or (HERE / "layout.json"))
_CONTENT = Path(os.environ.get("DOCSYNC_CONTENT") or (HERE / "content.md"))
_OUT = Path(os.environ.get("DOCSYNC_OUT") or (HERE / "index.html"))
EDIT = bool(os.environ.get("DOCSYNC_EDIT"))

L = Layout(_LAYOUT, page=(12.5, 84))    # ~1200px wide (matches the editor's own
                                        # canvas width) x tall enough for the
                                        # page's natural content height (~82in;
                                        # content ends ~7885px at 96dpi) plus a
                                        # little headroom. The earlier 160in was
                                        # inflated by the hero.hawaii overlap bug
                                        # (duplicate style attrs) that has since
                                        # been fixed; 84in leaves no giant blank
                                        # tail on the published page.
C = Content(_CONTENT, styles=L)


def esc(s: str) -> str:
    return _html.escape(s, quote=True)


def data_uri(path: Path) -> str:
    """Inlines a local image as base64 — rxkids has no asset-copy step (unlike
    report2027's Makefile, which mirrors report2027/web/assets into
    docs/primer/assets), and the live editor's preview + the published page
    resolve relative image paths against two DIFFERENT directories. A data URI
    sidesteps that entirely: it works identically in both places with nothing
    to keep in sync."""
    mime = "image/png" if path.suffix == ".png" else "image/svg+xml"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def img_el(el_id, cls, src, alt):
    """One image element, honouring replace/radius/filter/crop overrides —
    copied from report2027's render_report.py per the report-editor skill
    (this helper is project-local, not a shared docsync.blocks export)."""
    src = L.img_src(el_id, src)
    css = L.img_css(el_id)
    crop = L.cropped(el_id)
    head = f'<img class="{cls}"' if cls else "<img"
    if not crop:
        return f'{head}{L.attr(el_id, css)} src="{src}" alt="{alt}">'
    inner = (f'<img src="{src}" alt="{alt}" style="position:absolute;'
             f'left:-{crop["dx"]}in;top:-{crop["dy"]}in;width:{crop["imgW"]}in;'
             f'max-width:none">')
    wcls = f"ds-cropw {cls}".strip()
    return f'<span class="{wcls}"{L.attr(el_id, css)}>{inner}</span>'


SRC = (HERE / "original.html").read_text()
STYLE = SRC.split("<style>", 1)[1].split("</style>", 1)[0]
SCRIPT = SRC.split("<script>", 1)[1].split("</script>", 1)[0]

# Re-brand toward rxkids.org's own palette (sampled from its CSS): the punchy
# accent red #EE303B, blue #0082C9, green #00A750, orange #F6921E. original.html
# was built on Material Design swatches — a pinkish coral red, Material greens
# and ambers — so we remap those hexes to the rxkids.org equivalents (with
# consistent lighter/darker shades so gradients and hovers keep their depth)
# rather than editing original.html, which stays the untouched reference copy.
# Navy #2A3A4D / slate #4A5568 / gray #718096 (headings and body text) are left
# alone: rxkids.org's own text is a near-black dark gray, close enough.
COLOR_REMAP = {
    # red family: Material Reds -> rxkids.org #EE303B and its shades
    "#e57373": "#ee303b",   # primary card/accent red (was a light coral)
    "#ef5350": "#e81f2b",
    "#e53935": "#d81f29",
    "#c62828": "#c11722",   # dark red — hovers, bold numbers
    "#b71c1c": "#a5141d",
    "#8b1a1a": "#7d1319",
    "#ef9a9a": "#f39aa0",   # light red tints
    "#ffcdd2": "#fbd0d3",
    "#ffebee": "#fdebec",
    # green family: Material Greens -> rxkids.org #00A750 (TANF "no strings")
    "#43a047": "#00a750",
    "#2e7d32": "#007a3a",
    "#66bb6a": "#2ab972",
    "#81c784": "#5bc890",
    "#a5d6a7": "#a2dcbc",
    "#e8f5e9": "#e6f6ee",
    # amber/orange family: Material Ambers -> rxkids.org #F6921E (warnings)
    "#ffd54f": "#fbb040",
    "#f9a825": "#f6921e",
    "#e65100": "#d97706",
    "#ffe0b2": "#fde3bd",
    "#fff3e0": "#fef4e7",
}


def rebrand(css: str) -> str:
    for old, new in COLOR_REMAP.items():
        css = css.replace(old, new).replace(old.upper(), new)
    return css


STYLE = rebrand(STYLE)
# Open Sans has no U+02BB, so every ʻokina fell back to the system UI font.
# okinafy() rewrites the inherited stacks; original.html stays untouched.
STYLE = okinafy(STYLE)

# The hero's auto-cycling JS (setInterval over three hardcoded URLs) would
# silently overwrite a user's "replace image" edit a few seconds later — cut
# JUST that block in edit mode, leaving the published page untouched. The
# block sits at the END of the DOMContentLoaded callback, so: keep everything
# before the marker, close the callback, then keep everything after its
# original close ("});") — openBenefit / toggleFlintSection / moveCarousel
# are defined there, and truncating the whole tail (the old approach) left
# the tabs, expandables and carousel dead inside the editor preview.
if EDIT:
    _head, _rest = SCRIPT.split("// Hero image cycling", 1)
    SCRIPT = _head + "});" + _rest.split("});", 1)[1]

# moveCarousel()'s bar-fill animation hardcodes these two percentages; keep it
# in sync with content.md instead of maintaining the same number in two places.
SCRIPT = (SCRIPT
          .replace("'49.0%'", f'\'{C.text("carousel.childcare.bar.single.value")}\'')
          .replace("'17.9%'", f'\'{C.text("carousel.childcare.bar.married.value")}\''))

EDIT_OVERRIDES = """
  /* DOCSYNC_EDIT only: the scroll-reveal IntersectionObserver above doesn't
     reliably fire inside the editor's iframe, which otherwise leaves every
     section but the hero at opacity:0 — invisible, not just un-editable. */
  .tfc-reveal { opacity: 1 !important; transform: none !important; }
""" if EDIT else ""


# ---- hero (with logo overlaid top-left) --------------------------------------
def hero() -> str:
    # The logo lives INSIDE the hero, absolutely positioned like hero.title —
    # so it sits on the hero's blue background (not a separate white band above
    # it) and its editor drag coords are relative to the hero, same as the
    # title. No leading L.spacer("hero.title") here: that spacer reserved
    # container-level flow space for a title that's actually positioned within
    # the hero, which only produced a phantom white band above it.
    logo_src = data_uri(HERE / "assets" / "rxkeiki-logo.png")
    return f"""
<div class="tfc-hero tfc-reveal"{L.sec("band.hero")}>
    {img_el("header.logo", "rxkeiki-logo", logo_src, esc(C.text("header.logo.alt")))}
    <div class="tfc-hero-content">
        <h1 class="tfc-hero-title"{L.attr("hero.title")}>{C.t("hero.title")}</h1>
        <h2 class="tfc-hero-title tfc-hawaii-title"{L.attr("hero.hawaii", "margin-right:20px")}>{C.t("hero.hawaii")}</h2>
        <div class="tfc-hero-badge"{L.attr("hero.badge")}>{C.t("hero.badge")}</div>
    </div>
    <div class="tfc-hero-image-container">
        {img_el("hero.image", "tfc-hero-image", "https://images.squarespace-cdn.com/content/63c215f8a268791349c9f04a/1673931525935-N3GTMH2YO0HVT68BZOA0/unsplash-image-5zp0jym2w9M.jpg?content-type=image%2Fjpeg", esc(C.text("hero.image.alt")))}
    </div>
</div>"""


# ---- what is rxkids ----------------------------------------------------------
def what_is_rxkids() -> str:
    return f"""
<div class="tfc-full-width tfc-bg-white tfc-reveal"{L.sec("band.what")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("what.h2")}<h2 class="tfc-section-title"{L.attr("what.h2")}>{C.t("what.h2")}</h2>
            {L.spacer("para.what.body")}
            <p class="tfc-section-subtitle tfc-subtitle-box"{L.frame("what.body")}><span class="tfc-subtitle-eyebrow"{L.attr("what.eyebrow")}>{C.t("what.eyebrow")}</span>{C.slot_span("what.body", C("what.body"))}</p>

            <div class="tfc-scene-container">
                {img_el("what.heart.image", "tfc-floating-heart", "https://images.squarespace-cdn.com/content/63c215f8a268791349c9f04a/7e595665-8ca3-4621-b694-a787aa3f3965/floating+heart.png?content-type=image%2Fpng", esc(C.text("what.heart.alt")))}
                {img_el("what.childcare.image", "tfc-childcare-image", "https://images.squarespace-cdn.com/content/63c215f8a268791349c9f04a/a493efe8-48df-4068-a64d-a1a8cf2f39a3/Childcare+center.png?content-type=image%2Fpng", esc(C.text("what.childcare.alt")))}
                {scene_tag("right", "what.scene.right")}
                {scene_tag("left", "what.scene.left")}
                {scene_tag("bottom", "what.scene.bottom")}
            </div>
        </div>
    </div>
</div>"""
# (Dropped an empty <div class="tfc-cards-grid"></div> that used to sit here:
#  it held no cards but still carried margin:60px 0, contributing 120px of
#  dead space to the bottom of the "What is RxKids?" band.)


def scene_tag(side: str, key: str) -> str:
    return f"""{L.spacer(key)}<div class="tfc-scene-tag tfc-scene-tag-{side}"{L.attr(key)}>
        <h3 class="tfc-scene-title">{C.t(f"{key}.title")}</h3><p>{C.t(f"{key}.body")}</p>
    </div>"""


# ---- benefits widget (6 tabs) -------------------------------------------------
BENEFIT_KEYS = ["health", "development", "housing", "food", "economic", "bonding"]
# The RxKeiki logo's rainbow, one per benefit tab (red, blue, green, orange,
# magenta, gold) — sampled from the logo PNG.
BENEFIT_COLORS = ["#D81830", "#0078C0", "#009048", "#F09018", "#A81878", "#F0A800"]


def _benefit_rainbow_css() -> str:
    """Per-tab logo colour: an inactive tab shows its colour as a left rule;
    active, that colour fills the tab; its panel's bullets and sub-headings
    match. Gold takes dark ink for contrast; every other fill takes white."""
    out = []
    for i, col in enumerate(BENEFIT_COLORS, start=1):
        ink = "#2A3A4D" if col == "#F0A800" else "#FFFFFF"
        out.append(
            f".tfc-benefits-tabs .tfc-benefit-tab:nth-child({i}) {{ border-left-color: {col}; }} "
            f".tfc-benefits-tabs .tfc-benefit-tab:nth-child({i}).active {{ background: {col}; border-left-color: {col}; color: {ink}; }} "
            f".tfc-benefits-display .tfc-benefit-content:nth-child({i}) .tfc-benefit-list li::before {{ color: {col}; }} "
            f".tfc-benefits-display .tfc-benefit-content:nth-child({i}) h3 {{ color: {col}; }}"
        )
    return "\n  ".join(out)


def benefits_widget() -> str:
    tabs = "\n".join(
        f'<button class="tfc-benefit-tab{" active" if i == 0 else ""}" '
        f'onclick="openBenefit(event, \'benefit-{k}\')">{C.t(f"benefits.{k}.title")}</button>'
        for i, k in enumerate(BENEFIT_KEYS))
    panels = "\n".join(benefit_panel(k, i == 0) for i, k in enumerate(BENEFIT_KEYS))
    return f"""
<div class="tfc-full-width tfc-bg-blue tfc-reveal"{L.sec("band.benefits")}>
    <div class="tfc-content-container">
        <div class="tfc-section tfc-benefits-widget-section" style="margin: 0 auto;">
            {L.spacer("benefits.h2")}<h2 class="tfc-section-title"{L.attr("benefits.h2")}>{C.t("benefits.h2")}</h2>

            <div class="tfc-benefits-layout">
            {L.spacer("benefits.tabs")}<div class="tfc-benefits-tabs"{L.attr("benefits.tabs")}>
                {tabs}
            </div>

            <div class="tfc-benefits-display"{L.frame("panel.benefits")}>
                {panels}
            </div>
            </div>

            {flint_expandable()}
        </div>
    </div>
</div>"""


def benefit_panel(key: str, active: bool) -> str:
    bullets_key = f"benefits.{key}.bullets"
    items = "".join(f"<li>{b}</li>" for b in C.list(bullets_key))
    style = ' style="display: flex;"' if active else ""
    return f"""<div id="benefit-{key}" class="tfc-benefit-content{' active' if active else ''}"{style}>
        {L.spacer(f"benefits.{key}.title")}
        <div class="tfc-benefit-text-box"{L.attr(f"benefits.{key}.title")}>
            <h3>{C.t(f"benefits.{key}.title")}</h3>
            <ul class="tfc-benefit-list"{C.ul_attr(bullets_key)}>{items}</ul>
        </div>
    </div>"""


def flint_expandable() -> str:
    stats = ["rent", "eviction", "food", "backrent", "depression", "worrying"]
    icons = {
        "rent": '<path d="M2 11 9 5l7 6"/><path d="M4 10v9h10v-9"/><path d="M19.5 9v8.5"/><path d="m16.5 14.5 3 3 3-3"/>',
        "eviction": '<path d="M12 21.5s7.5-3.7 7.5-9.5V5.5L12 2.7 4.5 5.5V12c0 5.8 7.5 9.5 7.5 9.5Z"/><path d="M8 12.4 12 8.6l4 3.8"/><path d="M9.3 11.4v5.1h5.4v-5.1"/>',
        "food": '<path d="M6 2.5V7"/><path d="M9 2.5V7"/><path d="M6 7c0 1.6 1 2.5 2.2 2.6"/><path d="M9 7c0 1.6-1 2.5-2.2 2.6"/><path d="M7.5 9.6V21.5"/><path d="M17 2.5c-1.9.7-3 2.8-3 5.3 0 2 1.2 3.4 3 3.7"/><path d="M17 2.5v19"/>',
        "backrent": '<rect x="2.5" y="6" width="13" height="9" rx="1.5"/><circle cx="9" cy="10.5" r="2"/><path d="M19.5 8v8.5"/><path d="m16.5 13.5 3 3 3-3"/>',
        "depression": '<circle cx="12" cy="9.5" r="6"/><path d="M12 12.6c-2-1.3-3.3-2.5-3.3-4 0-1 .8-1.7 1.7-1.7.7 0 1.3.4 1.6 1 .3-.6.9-1 1.6-1 .9 0 1.7.7 1.7 1.7 0 1.5-1.3 2.7-3.3 4Z"/',
        "worrying": None,   # tfc-stat-icon--empty in the original
    }
    blocks = []
    for s in stats:
        icon_svg = icons.get(s)
        icon = (f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
                f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{icon_svg}</svg>'
                if icon_svg else "")
        icon_cls = "tfc-stat-icon" + ("" if icon_svg else " tfc-stat-icon--empty")
        el = f"flint.stat.{s}"
        blocks.append(f"""{L.spacer(el)}<div class="tfc-stat-block"{L.attr(el)}>
            <span class="{icon_cls}" aria-hidden="true">{icon}</span>
            <div class="tfc-stat-value">{C.t(f"{el}.value")}</div>
            <div class="tfc-stat-desc">{C.t(f"{el}.desc")}</div>
        </div>""")
    return f"""<div class="tfc-expandable-section">
    {L.spacer("flint.button")}<button class="tfc-expand-btn" onclick="toggleFlintSection()"{L.attr("flint.button")}>
    {C.t("flint.button")} <span class="tfc-expand-icon">&#9660;</span>
</button>
<div id="flint-content" class="tfc-expand-content">
    <div class="tfc-expand-inner">
        <div class="tfc-flint-body">
            {L.spacer("flint.eyebrow")}<span class="tfc-flint-eyebrow"{L.attr("flint.eyebrow")}>{C.t("flint.eyebrow")}</span>
            {C.html("flint.lead", "tfc-flint-lead")}

            <div class="tfc-flint-stats-grid">
                {"".join(blocks)}
            </div>
        </div>
    </div>
</div>
</div>"""


# ---- stats carousel (2 slides) -----------------------------------------------
def stats_carousel() -> str:
    return f"""
<div class="tfc-full-width tfc-bg-white tfc-reveal"{L.sec("band.stats")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("carousel.h2")}<h2 class="tfc-section-title"{L.attr("carousel.h2")}>{C.t("carousel.h2")}</h2>

            <div class="tfc-carousel-container"{L.frame("panel.carousel")}>
                <button class="tfc-carousel-arrow tfc-carousel-prev" onclick="moveCarousel(-1)">&#10094;</button>
                <button class="tfc-carousel-arrow tfc-carousel-next" onclick="moveCarousel(1)">&#10095;</button>

                <div class="tfc-carousel-track" id="statsTrack">
                    <div class="tfc-carousel-slide">
                        {L.spacer("carousel.poverty.quote")}
                        <div class="tfc-pullout-quote"{L.attr("carousel.poverty.quote", "margin-top:0px")}>
                            <p class="tfc-quote-text">{C.t("carousel.poverty.quote")}</p>
                        </div>

                        {L.spacer("carousel.poverty.chart.title")}<h3{merge_attrs(' style="text-align: center; color: #2A3A4D; margin-bottom: 10px; margin-top: 40px; font-size: 1.5rem;"', L.attr("carousel.poverty.chart.title"))}>{C.t("carousel.poverty.chart.title")}</h3>

                        <div class="tfc-chart-container" style="margin-top: 80px;">
                            <div class="tfc-3d-chart">
                                {poverty_bar("married", 64)}
                                {poverty_bar("singlefather", 113)}
                                {poverty_bar("singlemother", 266)}
                            </div>
                            {L.spacer("carousel.poverty.source")}<p class="tfc-chart-source"{merge_attrs(C.slot_attr("carousel.poverty.source"), L.attr("carousel.poverty.source"))}>{C("carousel.poverty.source")}</p>
                        </div>
                    </div>

                    <div class="tfc-carousel-slide">
                        {L.spacer("carousel.childcare.title")}<h3{merge_attrs(' style="text-align: center; color: #2A3A4D; margin-bottom: 10px; font-size: 1.5rem;"', L.attr("carousel.childcare.title"))}>{C.t("carousel.childcare.title")}</h3>
                        <p class="tfc-section-subtitle"></p>

                        <div class="tfc-childcare-stats">
                            {L.spacer("carousel.childcare.cost.amount")}
                            <div class="tfc-cost-display"{L.attr("carousel.childcare.cost.amount")}>
                                <span class="tfc-cost-title">{C.t("carousel.childcare.cost.title")}</span>
                                <div class="tfc-cost-amount">{C.t("carousel.childcare.cost.amount")}</div>
                                <div class="tfc-cost-monthly">({C.t("carousel.childcare.cost.monthly")})</div>
                            </div>

                            <div class="tfc-income-comparison">
                                {L.spacer("carousel.childcare.bar.single")}<div class="tfc-income-bar-group"{L.attr("carousel.childcare.bar.single")}>
                                    <span class="tfc-income-label">{C.t("carousel.childcare.bar.single.label")}</span>
                                    <div class="tfc-bar-container">
                                        <div class="tfc-bar-fill single" id="bar-single">{C.t("carousel.childcare.bar.single.value")}</div>
                                    </div>
                                    <p style="font-size: 0.9rem; color: #718096; margin-top: 8px;">{C.t("carousel.childcare.bar.single.note")}</p>
                                </div>

                                {L.spacer("carousel.childcare.bar.married")}<div class="tfc-income-bar-group"{L.attr("carousel.childcare.bar.married")}>
                                    <span class="tfc-income-label">{C.t("carousel.childcare.bar.married.label")}</span>
                                    <div class="tfc-bar-container">
                                        <div class="tfc-bar-fill married" id="bar-married">{C.t("carousel.childcare.bar.married.value")}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="tfc-flint-source"{L.frame("panel.flint-source")}>
                            {L.spacer("carousel.childcare.source")}<p{merge_attrs(C.slot_attr("carousel.childcare.source"), L.attr("carousel.childcare.source"))}>{C("carousel.childcare.source")}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>"""


def poverty_bar(key: str, height_px: int) -> str:
    el = f"carousel.poverty.bar.{key}"
    return f"""{L.spacer(el)}<div class="tfc-3d-bar-group"{L.attr(el)}>
        <div class="tfc-3d-bar">
            <div class="tfc-3d-bar-front" style="height: {height_px}px;">
                <span class="tfc-3d-bar-value">{C.t(f"{el}.value")}</span>
            </div>
        </div>
        <div class="tfc-3d-bar-label">{C.t(f"{el}.label")}</div>
    </div>"""


# ---- how it works (4 steps) --------------------------------------------------
def how_it_works() -> str:
    steps = "\n".join(step(i) for i in (1, 2, 3, 4))
    return f"""
<div class="tfc-full-width rxk-hiw-bg tfc-reveal"{L.sec("band.how")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("steps.h2")}<h2 class="tfc-section-title"{L.attr("steps.h2")}>{C.t("steps.h2")}</h2>

            {L.spacer("steps.banner.amount")}
            <div class="tfc-total-banner"{L.attr("steps.banner.amount")}>
                <span class="tfc-total-label">{C.t("steps.banner.label")}</span>
                <span class="tfc-total-amount">{C.t("steps.banner.amount")}</span>
                <span class="tfc-total-sub">{C.t("steps.banner.sub")}</span>
            </div>

            <div class="tfc-steps">
                {steps}
            </div>

            {L.spacer("steps.note")}<p class="tfc-steps-note"{L.attr("steps.note")}>{C.t("steps.note")}</p>

            {cost_expandable()}
        </div>
    </div>
</div>"""


def step(n: int) -> str:
    key = f"steps.{n}"
    has_amount = n != 1
    # Step 4 (months 4–12) is the OTHER-FUNDING stretch — purple, matching the
    # TANF timeline's colour language, so it reads apart from the TANF steps.
    alt = " tfc-step--alt" if n == 4 else ""
    amount = (f'<div class="tfc-step-amount">{C.t(f"{key}.amount")}'
              f'<span class="tfc-step-amount-note">{C.t(f"{key}.amountnote")}</span></div>'
              if has_amount else "")
    return f"""{L.spacer(key)}<div class="tfc-step{alt}"{L.attr(key)}>
        <div class="tfc-step-phase">{C.t(f"{key}.phase")}</div>
        <div class="tfc-step-number">{n}</div>
        <h3 class="tfc-step-title">{C.t(f"{key}.title")}</h3>
        {amount}
        <p class="tfc-step-text">{C.t(f"{key}.text")}</p>
    </div>"""


# Cost estimate table (from the program's own cost slide) — hand-set here like
# the other charts (see content.md's note). Columns 3–5 carry the same colour
# language as the funding timeline: TANF = green, additional dollars = purple.
#
# Row identity is a SLUG, not the county name: the name is a content.md slot
# (cost.<slug>.county) like every other cell, so this list only fixes which
# row a slot belongs to, never what it displays — the same discipline as
# tax-testimony's org.<slug>.name.
COST_ROWS = ["hawaii", "honolulu", "maui", "unidentified", "entire-state"]


def cost_expandable() -> str:
    body_rows = []
    for slug in COST_ROWS:
        total = ' class="rxk-cost-total"' if slug == "entire-state" else ""
        body_rows.append(f"""<tr{total}>
            <th scope="row"{C.slot_attr(f"cost.{slug}.county")}>{C.text(f"cost.{slug}.county")}</th>
            <td{C.slot_attr(f"cost.{slug}.babies")}>{C.text(f"cost.{slug}.babies")}</td>
            <td class="rxk-cost-tanf"{C.slot_attr(f"cost.{slug}.tanf")}>{C.text(f"cost.{slug}.tanf")}</td>
            <td class="rxk-cost-add"{C.slot_attr(f"cost.{slug}.six")}>{C.text(f"cost.{slug}.six")}</td>
            <td class="rxk-cost-add"{C.slot_attr(f"cost.{slug}.twelve")}>{C.text(f"cost.{slug}.twelve")}</td>
        </tr>""")
    # "Additional public and/or private dollars needed" is ONE slot rendered
    # under both money columns — the same words each time, so a reword lands
    # in both headers at once (the tax-testimony label pattern).
    return f"""<div class="tfc-expandable-section">
    {L.spacer("cost.button")}<button class="tfc-expand-btn rxk-cost-btn" onclick="rxkToggle(this, 'cost-content')"{L.attr("cost.button")}>
    <span class="rxk-cost-btn-eyebrow"{C.slot_attr("cost.button.eyebrow")}>{C.text("cost.button.eyebrow")}</span>
    <span class="rxk-cost-btn-amt"{C.slot_attr("cost.button.amt")}>{C.text("cost.button.amt")}</span>
    <span class="rxk-cost-btn-foot"><span class="tfc-expand-icon">&#9660;</span></span>
</button>
<div id="cost-content" class="tfc-expand-content">
    <div class="tfc-expand-inner">
        {L.spacer("cost.table")}<div class="rxk-cost-wrap"{L.attr("cost.table")}>
            <div class="rxk-cost-title"{C.slot_attr("cost.title")}>{C.text("cost.title")}</div>
            <table class="rxk-cost">
                <thead><tr>
                    <th></th>
                    <th{C.slot_attr("cost.head.babies")}>{C.text("cost.head.babies")}<span{C.slot_attr("cost.head.babies.note")}>{C.text("cost.head.babies.note")}</span></th>
                    <th class="rxk-cost-tanf"{C.slot_attr("cost.head.tanf")}>{C.text("cost.head.tanf")}<span{C.slot_attr("cost.head.tanf.note")}>{C.text("cost.head.tanf.note")}</span></th>
                    <th class="rxk-cost-add"{C.slot_attr("cost.head.add")}>{C.text("cost.head.add")}<span{C.slot_attr("cost.head.six.note")}>{C.text("cost.head.six.note")}</span></th>
                    <th class="rxk-cost-add"{C.slot_attr("cost.head.add")}>{C.text("cost.head.add")}<span{C.slot_attr("cost.head.twelve.note")}>{C.text("cost.head.twelve.note")}</span></th>
                </tr></thead>
                <tbody>{"".join(body_rows)}</tbody>
            </table>
        </div>
    </div>
</div>
</div>"""


# The RxKids payment schedule as a month-by-month funding timeline (mirrors the
# program graphic): a $1,500 prenatal payment then $500/month for 12 months.
# The first four columns (prenatal + months 1–3) are TANF-funded (green); the
# rest (months 4–12) are "other funding" (purple). Hand-set here like the other
# charts (see content.md's note) rather than wired to per-cell slots.
TANF_TIMELINE = [
    ("Prenatal", "$1,500", True),
    ("Month 1", "$500", True),
    ("Month 2", "$500", True),
    ("Month 3", "$500", True),
    ("Month 4", "$500", False),
    ("Month 5", "$500", False),
    ("Month 6", "$500", False),
    ("Month 7", "$500", False),
    ("Month 8", "$500", False),
    ("Month 9", "$500", False),
    ("Month 10", "$500", False),
    ("Month 11", "$500", False),
    ("Month 12", "$500", False),
]


def label(key: str, default: str, cls: str, tag: str = "span", style: str = "") -> str:
    """A short label the reader can retype: a slot defaulting to the renderer's
    wording (C.text_or), so it renders exactly as before until someone edits
    it. These sat in movable blocks as plain words — draggable, never
    editable — until docsync.check's C() trap learned to count labels too."""
    own = f' style="{style}"' if style else ""
    words = C.text_or(key, default).replace("&", "&amp;").replace("<", "&lt;")
    return f'<{tag} class="{cls}"{merge_attrs(own, C.slot_attr(key))}>{words}</{tag}>'


def tanf_timeline() -> str:
    n = len(TANF_TIMELINE)
    n_tanf = sum(1 for _, _, tanf in TANF_TIMELINE if tanf)
    n_other = n - n_tanf
    cols = []
    for i, (month, amount, tanf) in enumerate(TANF_TIMELINE):
        cls = "rxk-col rxk-col--tanf" if tanf else "rxk-col rxk-col--other"
        tag = label("timeline.tag", "TANF", "rxk-col-tag") if tanf else ""
        cols.append(f"""<div class="{cls}">
            {label(f"timeline.month-{i}", month, "rxk-col-month")}
            <span class="rxk-col-amt">{amount}</span>
            {tag}
        </div>""")
    # The CONTAINER ITSELF is the stepped shape — nothing (no purple, no frame
    # headroom) sits above the green stretch. Its outline: flat, lower top over
    # prenatal–month 2, a concave curve up over month 3, then the full-height
    # purple section. Two layers clipped to the same polygon make the orange
    # frame: an orange backdrop, and the content inset 4px inside it (same
    # polygon values — the inset shifts it, giving a ~4px rim all round).
    drop = 42                                       # px the green top sits below the purple top
    g1 = (n_tanf - 1) / n                           # curve start: month-3's left edge
    g2 = n_tanf / n                                 # curve end: month-3's right edge
    pts = [f"0 {drop}px", f"{g1 * 100:.4f}% {drop}px"]
    # Inverted (concave, ease-in) curve: hug the flat green top for most of
    # month 3's width, then rise VERY steeply around the last quarter to join
    # the purple at the cell boundary.
    for t, frac in ((0.4, 0.97), (0.6, 0.9), (0.75, 0.76), (0.85, 0.52), (0.93, 0.26)):
        x = (g1 + (g2 - g1) * t) * 100
        pts.append(f"{x:.4f}% {drop * frac:.1f}px")
    pts += [f"{g2 * 100:.4f}% 0", "100% 0", "100% 100%", "0 100%"]
    poly = f"polygon({', '.join(pts)})"
    green_w = f"{n_tanf / n * 100:.4f}%"            # green block: full height, left of the curve's end
    banner_w = f"{n_other / n * 100:.4f}%"          # OTHER FUNDING spans the purple columns
    return f"""{L.spacer("tanf.timeline")}
    <div{L.attr("tanf.timeline")}>
      <div class="rxk-timeline">
        <div class="rxk-frame" style="clip-path:{poly}; -webkit-clip-path:{poly};"></div>
        <div class="rxk-inner" style="clip-path:{poly}; -webkit-clip-path:{poly};">
          <div class="rxk-green-fill" style="width:{green_w};"></div>
          {label("timeline.other", "OTHER FUNDING", "rxk-otherfunding", "div", f"width:{banner_w}")}
          <div class="rxk-cols">
              {"".join(cols)}
          </div>
        </div>
      </div>
      <div class="rxk-bracket-row">
        <div class="rxk-bracket"><span class="rxk-bracket-amt">$3,000</span></div>
        <div class="rxk-bracket-rest"></div>
      </div>
    </div>"""


# ---- TANF section -------------------------------------------------------------
# Two full-width bands: the top (intro + "two ways" comparison) on a deep grape
# #5B2C7B field (see .rxk-tanf-top), the rest on white starting at
# "How RxKids uses TANF".
def tanf_section() -> str:
    return f"""
<div class="tfc-full-width rxk-tanf-top tfc-reveal"{L.sec("band.tanf-top")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("tanf.h2")}<h2 class="tfc-section-title"{L.attr("tanf.h2")}>{C.t("tanf.h2")}</h2>
            {C.html("tanf.intro", "tfc-section-subtitle")}

            {L.spacer("tanf.compare1.title")}<h3 class="rxk-tanf-h3"{merge_attrs(' style="text-align:center; font-size:1.5rem; margin: 0 0 28px;"', L.attr("tanf.compare1.title"))}>{C.t("tanf.compare1.title")}</h3>

            <div class="tfc-tanf-compare">
                {tanf_card("tanf.ongoing", good=False,
                           icon_path='<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/>')}
                {tanf_card("tanf.shortterm", good=True,
                           icon_path='<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2.6"/><path d="M12 15v2"/>')}
            </div>
        </div>
    </div>
</div>
<div class="tfc-full-width tfc-bg-white tfc-reveal"{L.sec("band.tanf")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("tanf.split.title")}
            <div class="tfc-tanf-split"{L.frame("tanf.split.title")}>
                <h3>{C.t("tanf.split.title")}</h3>
                <p>{C.t("tanf.split.body")}</p>
                {tanf_timeline()}
            </div>

            {L.spacer("tanf.choice.title")}<h3{merge_attrs(' style="text-align:center; color:#2A3A4D; font-size:1.5rem; margin: 56px 0 16px;"', L.attr("tanf.choice.title"))}>{C.t("tanf.choice.title")}</h3>
            {C.html("tanf.choice.body", "tfc-section-subtitle tanf-choice-body")}

            <div class="tfc-tanf-compare">
                {tanf_option_card("tanf.option1", "Option 1")}
                {tanf_option_card("tanf.option2", "Option 2 · Recommended", free=True)}
            </div>

            {C.html("tanf.note", "tfc-tanf-note")}

            {L.spacer("tanf.bottomline.title")}
            <!-- margin-top is zeroed alongside margin-bottom: .tfc-highlight-box
                 carries `margin: 60px 0`, and on an absolutely-positioned element
                 that margin is ADDED to the `top` the editor stores — so a saved
                 y landed the box 60px below the slot it was dragged to, and every
                 later drag re-measured from the wrong place. -->
            <div class="tfc-highlight-box"{L.attr("tanf.bottomline.title", "margin-top:0;margin-bottom:0")}>
                <h3>{C.t("tanf.bottomline.title")}</h3>
                <p>{C.t("tanf.bottomline.body")}</p>
            </div>
        </div>
    </div>
</div>"""


def tanf_card(key: str, good: bool, icon_path: str) -> str:
    free_cls = " tfc-tanf-card--free" if good else ""
    tag_cls = "tfc-tanf-tag tfc-tanf-tag--good" if good else "tfc-tanf-tag"
    return f"""{L.spacer(key)}<div class="tfc-tanf-card{free_cls}"{L.attr(key)}>
        <span class="tfc-tanf-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{icon_path}</svg></span>
        <h3>{C.t(f"{key}.title")}</h3>
        <span class="{tag_cls}">{C.t(f"{key}.tag")}</span>
        <p>{C.t(f"{key}.body")}</p>
    </div>"""


def tanf_option_card(key: str, num_label: str, free: bool = False) -> str:
    free_cls = " tfc-tanf-card--free" if free else ""
    tag_cls = "tfc-tanf-tag tfc-tanf-tag--good" if free else "tfc-tanf-tag"
    return f"""{L.spacer(key)}<div class="tfc-tanf-card{free_cls}"{L.attr(key)}>
        {label(f"{key}.num", num_label, "tfc-tanf-option-num")}
        <h3>{C.t(f"{key}.title")}</h3>
        <span class="{tag_cls}">{C.t(f"{key}.tag")}</span>
        <p>{C.t(f"{key}.body")}</p>
    </div>"""


# ---- CTA footer ---------------------------------------------------------------
def cta() -> str:
    return f"""
<div class="tfc-cta-section tfc-reveal"{L.frame("panel.cta", "margin-bottom:0")}>
    {L.spacer("cta.title")}<h2{L.attr("cta.title")}>{C.t("cta.title")}</h2>
    {L.spacer("cta.body")}<p{L.attr("cta.body")}>{C.t("cta.body")}</p>
    {L.spacer("cta.link1")}<a href="https://rxkids.org/" target="_blank" class="tfc-btn"{L.attr("cta.link1")}>{C.t("cta.link1.label")}</a>
    {L.spacer("cta.link2")}<a href="https://rxkids.org/about/" target="_blank" class="tfc-btn tfc-btn-outline"{L.attr("cta.link2")}>{C.t("cta.link2.label")}</a>
</div>"""


# ---- sources ------------------------------------------------------------------
# The original page's citations were plain <a>[Source]</a> links a reader could
# click straight through; converting them to numbered [^id] superscripts (see
# BENEFIT_KEYS etc. above) needs somewhere those numbers resolve TO, or a
# reader has no way to find what "¹" refers to. Mirrors report2027's own
# endnote_link pattern.
def endnote_link(n, sid, txt, url):
    return (f'<li id="en{n}"{L.attr(f"endnote.{sid}")}>{txt} '
            f'<a href="{url}" target="_blank">{url}</a></li>')


def sources_section(entries) -> str:
    items = "".join(endnote_link(i + 1, sid, t, u) for i, (sid, t, u) in enumerate(entries))
    return f"""
<div class="tfc-full-width tfc-bg-white tfc-reveal"{L.sec("band.sources")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("endnotes.h2")}<h2 class="tfc-section-title"{L.attr("endnotes.h2")}>{C.t("endnotes.h2")}</h2>
            <ol class="rxk-endnotes">{items}</ol>
        </div>
    </div>
</div>"""


MAIN_BODY = f"""<div class="tfc-container">
{hero()}
{what_is_rxkids()}
{benefits_widget()}
{stats_carousel()}
{how_it_works()}
{tanf_section()}"""

# Citation numbering runs once, on the whole body assembled SO FAR — before the
# sources section exists (it has no [^id] tokens of its own, and needs the
# order this establishes to render its numbered list in the first place).
C.fn.order_by(L.endnote_order(), C.fn.cited(MAIN_BODY))

BODY = f"""{MAIN_BODY}
{sources_section(C.fn.endnotes_with_ids())}
{cta()}
</div>"""

BODY = C.fn.resolve(BODY)

# ---- orphaned sources: edit-tolerant, publish-strict --------------------------
# A declared source that nothing cites is silently dropped from the numbered
# list (endnotes_with_ids only walks what was cited), so without this it fails
# invisibly — the citation is just gone from the page and nothing says why.
#
# It is a HARD error only when PUBLISHING. While editing (DOCSYNC_EDIT) it is
# almost always a normal in-between state: you cut a sentence to move it, and
# for those few seconds its source has nothing pointing at it. Crashing the live
# preview over that would make a routine move feel like a critical failure.
# Ported from report2027/tools/render_report.py:1240-1265, minus its hidden-page
# diagnosis — rxkids is a single flat page, so there is no page to hide.
missing_src = C.fn.unused()
if missing_src and os.environ.get("DOCSYNC_EDIT"):
    print("  draft: source(s) not cited yet — normal while moving text: "
          + ", ".join(missing_src))
elif missing_src:
    raise ContentError(
        "content.md declares sources never cited in the prose: "
        + ", ".join(f"[{s}]" for s in missing_src)
        + " — if you're moving the text that cites one, finish the move (paste it "
        + "back in); this blocks publishing only, not the live preview.")

# ---- footnote refs: make the numbers reachable --------------------------------
# resolve() leaves a bare <sup>N</sup>, which tells a reader a citation EXISTS
# but gives them no way to reach it — the endnote_link() comment above always
# intended otherwise, but only the destination was ever built, not the link.
# This is report2027's linkify_footnotes, ported verbatim in behaviour: the href
# points at the endnote anchor, so a marker still works with JS off and in
# print, and the popover in FN_POPOVER_JS is pure enhancement on top.
NOTES = C.fn.endnotes()                          # [(text, url)] in numbered order


def linkify_footnotes(markup: str) -> str:
    """Turn every <sup>N</sup> marker into a clickable ref the JS can pop.

    Handles multi-note markers like <sup>4&thinsp;5</sup> — resolve() collapses
    adjacent [^a][^b] tokens into ONE <sup> with thin-space separators, so this
    has to split them back apart to link each number at its own anchor.
    """
    def repl(m):
        nums = re.findall(r"\d+", m.group(1))
        if not nums:
            return m.group(0)
        out = []
        for n in nums:
            i = int(n)
            if 1 <= i <= len(NOTES):
                out.append(f'<a class="fn" href="#en{i}" data-fn="{i}">{n}</a>')
            else:
                out.append(n)                    # out of range: leave it inert
        return "<sup>" + "&thinsp;".join(out) + "</sup>"
    return re.sub(r"<sup>(.*?)</sup>", repl, markup, flags=re.S)


BODY = linkify_footnotes(BODY)

# The note data the popover reads. Precomputed rather than inlined in the page
# template: an f-string expression containing a dict literal AND quotes is a
# needless portability trap, and "</" has to be broken up so a citation that
# ever contains "</script>" can't close the block early.
NOTES_JSON = (json.dumps([{"t": t, "u": u} for t, u in NOTES], separators=(",", ":"))
              .replace("</", "<\\/"))

# Defined as PLAIN strings, not inside the page's f-string template: both are
# full of { } that would otherwise need doubling, and a single missed brace in
# there fails far away from the edit that caused it. Interpolated values are not
# re-scanned for placeholders, so these stay verbatim.
FN_CSS = """
  /* Footnote refs. rxkids' citations all sit on light ground (benefit-panel
     bullets, the flint lead, the small source lines), so unlike report2027 this
     needs no inverted variant for dark cards. Tinted pill in the brand blue so
     the marker reads as a control rather than as body punctuation. */
  sup { font-size: 11px; line-height: 0; }
  @media screen {
    a.fn { color: #00669E; font-weight: 700; text-decoration: none; cursor: pointer;
           background: #DCEBF7; padding: 1px 4px; border-radius: 4px; margin: 0 1px; }
    a.fn:hover { background: #0082C9; color: #fff; }
  }
  /* On paper the pill is noise and the popover is unreachable — the number
     alone does the job, and the endnote list carries the URL. */
  @media print { a.fn { color: inherit; background: none; text-decoration: none; } }
  #fnpop { position: fixed; z-index: 110; width: 320px; max-width: calc(100vw - 20px);
           background: #fff; border: 1.5px solid #BFDCF0; border-radius: 10px;
           box-shadow: 0 10px 30px rgba(42,58,77,.22); padding: 12px 14px; font-size: 12.5px; }
  #fnpop .fn-n { font-size: 10.5px; font-weight: 700; letter-spacing: .6px; color: #6B8AA3;
                 text-transform: uppercase; margin-bottom: 4px; }
  #fnpop p { margin: 0 0 10px; color: #3A4A5C; line-height: 1.42; }
  .fn-cta { display: inline-block; background: #0082C9; color: #fff !important;
            font-weight: 700; padding: 6px 12px; border-radius: 7px;
            text-decoration: none; font-size: 12px; }
  /* The endnote list itself: two columns on a 12.5in sheet, which halves a
     13-entry block that was running the full width one line at a time. */
  .rxk-endnotes { columns: 2; column-gap: 48px; padding-left: 1.4em;
                  font-size: 0.9rem; color: #4a5568; line-height: 1.6; }
  .rxk-endnotes li { margin-bottom: 12px; break-inside: avoid; }
  .rxk-endnotes a { word-break: break-all; }
  /* Jumping to an endnote should say WHICH one you landed on. */
  .rxk-endnotes li:target { background: #FFF6D8; border-radius: 6px;
                            box-shadow: 0 0 0 6px #FFF6D8; }
"""

FN_POPOVER_JS = """
(function () {
  var NOTES = window.RXK_NOTES || [];
  if (!NOTES.length) return;
  var fnp = document.createElement('div');
  fnp.id = 'fnpop';
  fnp.className = 'noprint';
  fnp.hidden = true;
  document.body.appendChild(fnp);
  var fnPinned = false, fnTimer = null;

  function fnHide() { fnp.hidden = true; fnPinned = false; }

  function fnShow(n, anchor) {
    var note = NOTES[n - 1];
    if (!note) return;
    var host = '';
    try { host = new URL(note.u).hostname.replace(/^www\\./, ''); } catch (err) { host = 'source'; }
    fnp.textContent = '';
    var lab = document.createElement('div');
    lab.className = 'fn-n';
    lab.textContent = 'Note ' + n;
    var p = document.createElement('p');
    p.textContent = note.t;          // textContent, not innerHTML: citation text is data
    var a = document.createElement('a');
    a.className = 'fn-cta';
    a.href = note.u; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = host + ' \\u2197';
    fnp.appendChild(lab); fnp.appendChild(p); fnp.appendChild(a);
    fnp.hidden = false;
    var r = anchor.getBoundingClientRect();
    var pw = fnp.offsetWidth, ph = fnp.offsetHeight;
    var x = Math.min(Math.max(r.left + r.width / 2 - pw / 2, 10), window.innerWidth - pw - 10);
    var y = r.bottom + 8;
    if (y + ph > window.innerHeight - 10) y = Math.max(r.top - ph - 8, 10);
    fnp.style.left = x + 'px';
    fnp.style.top = y + 'px';
  }

  document.addEventListener('mouseover', function (e) {
    var a = e.target.closest ? e.target.closest('a.fn') : null;
    if (a) {
      clearTimeout(fnTimer);
      fnShow(+a.dataset.fn, a);
    } else if (e.target.closest && e.target.closest('#fnpop')) {
      clearTimeout(fnTimer);   // inside the popover — keep it open so the link is reachable
    } else if (!fnPinned && !fnp.hidden) {
      clearTimeout(fnTimer);
      fnTimer = setTimeout(fnHide, 250);   // grace period to reach the popover
    }
  });

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a.fn') : null;
    if (a) {
      e.preventDefault();                  // stay put; the source link is in the popover
      fnShow(+a.dataset.fn, a);
      fnPinned = true;
      return;
    }
    if (!(e.target.closest && e.target.closest('#fnpop'))) fnHide();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fnHide(); });
  window.addEventListener('scroll', fnHide, { passive: true });
})();
"""

# Each <section class="page"> is the coordinate origin for every
# drag/resize/snap calculation on that page (see the report-editor skill).
#
# Every sheet, in order: this page, then any blank page added in the editor.
# Going through L.page_order() plus L.pagemeta() is what lets the page strip
# offer "+ Page" and reordering — the editor withholds both from a renderer
# that never declared its pages, since an order nothing reads draws nothing.
DESIGNED_PAGES = 1


def sheet(pid):
    """One page section: this report's markup for the designed page, empty for
    a blank page added in the editor.

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
  {STYLE}
  /* original.html reserves dead space at the top for chrome we don't have:
     body{{padding-top:80px}} cleared Squarespace's sticky nav, and
     .tfc-container's own 30px top padding sat below it — both removed so the
     hero (with the logo overlaid on its blue background) starts at the top. */
  body {{ padding-top: 0 !important; }}
  .tfc-container {{ padding-top: 0 !important; }}
  /* Full-bleed bands must break out to the PAGE, not the viewport. Squarespace
     sized these against the browser window (.tfc-hero: width:100vw +
     margin-left:-50vw + left:50%; .tfc-full-width: width:100vw +
     margin:0 calc(50% - 50vw)), which pins their left edge to viewport x≈0.
     Here the page is a fixed {L.page_w}in sheet that gets CENTERED in whatever
     window it's viewed at, so those two origins diverge by (viewport - page)/2
     — and .tfc-hero's children (logo, title, badge) are absolutely positioned
     with layout.json coords measured from the hero, so the whole hero drifts
     further left the wider the window gets. At 1685px that already put the
     hero's text ~220px outside the page's left edge; it only looked right at
     a viewport of exactly {L.page_w}in.
     Breaking out with -24px (the .tfc-container side padding) instead spans
     the same full page width at ANY window size, and makes the saved drag
     coords mean one fixed thing. */
  .tfc-hero, .tfc-full-width {{
      width: auto !important; left: 0 !important; right: auto !important;
      margin-left: -24px !important; margin-right: -24px !important; }}
  /* Vertical rhythm. original.html gave every band `padding: 80px 0 140px`
     (its own comment: "Increased bottom padding") — tuned for a Squarespace
     page where sections scroll past one at a time. Stacked into one continuous
     sheet that reads as a document, 80 over 140 leaves a visible dead strip at
     every seam, and the lopsidedness makes each band look like it's drifted
     up. 48/56 is snug and near-symmetric while still separating the bands. */
  .tfc-full-width {{ padding-top: 48px !important; padding-bottom: 56px !important; }}
  /* The hero keeps its 80px TOP: the title/logo/badge are absolutely
     positioned from the hero's top edge, but the photo is in normal flow, so
     shrinking the top padding would slide the photo up out of alignment with
     the title block. Only the bottom is free to move. */
  .tfc-hero {{ padding-bottom: 44px !important; }}
  /* Trailing margins on a band's last child stack on top of the band's own
     bottom padding — measured 196–200px of dead space where 140 was intended.
     .tfc-scene-container is excluded because ITS trailing margin is
     load-bearing, not slack: .tfc-scene-tag-bottom is absolutely positioned at
     top:calc(100% + 40px), i.e. entirely OUTSIDE the container, and the
     container's `margin: 60px auto 200px` ("room for floating heart above +
     bottom box below") is what reserves room for it. Zeroing it dropped the
     tag ~161px into the blue benefits band below. Any element that parks an
     absolutely-positioned child past its own bottom edge belongs in this
     exclusion list. */
  .tfc-section > *:last-child:not(.tfc-scene-container) {{ margin-bottom: 0 !important; }}
  /* .tfc-container's 60px bottom padding sat below the final band's own
     padding, doubling the gap at the very end of the page. */
  .tfc-container {{ padding-bottom: 0 !important; }}
  /* Same doubling at the CTA: its 60px top margin stacked on the last band's
     bottom padding for a ~116px trough right before the closing call to
     action. */
  .tfc-cta-section {{ margin-top: 28px !important; margin-bottom: 0 !important; }}
  /* The logo is an absolute overlay inside the hero (positioned by the editor
     via layout.json), so it needs no box of its own — just block display. */
  .rxkeiki-logo {{ display: block; height: auto; }}
  /* TANF funding timeline — a month-by-month bar: GREEN columns are the
     TANF-funded prenatal–month 3 payments, PURPLE columns the month 4–12
     "other funding", all inside an orange frame. Mirrors the program graphic. */
  /* The timeline container is ITSELF the stepped shape (see tanf_timeline():
     nothing sits above the green stretch — the orange frame hugs the green's
     flat top, curves up over month 3, then runs the full-height purple part).
     Two same-polygon layers form it: .rxk-frame (orange, inset 0) and
     .rxk-inner (content, inset 4px) — identical polygon values on an element
     shifted 4px in from every side read as a ~4px orange rim. */
  .rxk-timeline {{ position: relative; margin-top: 22px; border-radius: 12px;
                   overflow: hidden;
                   filter: drop-shadow(0 4px 10px rgba(42,58,77,.15)); }}
  .rxk-frame {{ position: absolute; inset: 0; background: #F6921E; }}
  .rxk-inner {{ position: relative; margin: 4px; background: #8E3B9C; }}
  /* The green (TANF) block: full height, its top shaped by the container's
     own curve. The orange lines are its internal cell separators, plus one on
     its right edge where it hands off to the purple. */
  .rxk-green-fill {{ position: absolute; left: 0; top: 0; height: 100%; z-index: 0;
      background:
        linear-gradient(90deg, transparent calc(25% - 1px), #F6921E calc(25% - 1px), #F6921E calc(25% + 1px), transparent calc(25% + 1px)),
        linear-gradient(90deg, transparent calc(50% - 1px), #F6921E calc(50% - 1px), #F6921E calc(50% + 1px), transparent calc(50% + 1px)),
        linear-gradient(90deg, transparent calc(75% - 1px), #F6921E calc(75% - 1px), #F6921E calc(75% + 1px), transparent calc(75% + 1px)),
        linear-gradient(90deg, transparent calc(100% - 3px), #F6921E calc(100% - 3px)),
        linear-gradient(180deg, #34B36B, #1E9E57); }}
  /* Solid purple so the column separator lines behind it don't cross the
     "OTHER FUNDING" text; sits above the columns (z-index) to cover them. */
  .rxk-otherfunding {{ position: absolute; top: 0; right: 0; height: 40px; z-index: 2;
                       background: #8E3B9C;
                       display: flex; align-items: center; justify-content: center;
                       color: #fff; font-weight: 800; font-size: 0.95rem;
                       letter-spacing: 1px; text-transform: uppercase; }}
  .rxk-cols {{ position: relative; z-index: 1; display: flex; align-items: stretch; min-height: 158px; }}
  /* Content top-aligned below the OTHER FUNDING band / the green's flat top
     (42px) — every column's month label sits on the same line, green and
     purple alike; TANF flows below, matching the program graphic. Slim side
     padding so the nowrap labels fit inside their own cells. */
  .rxk-col {{ flex: 1; display: flex; flex-direction: column; align-items: center;
              justify-content: flex-start; gap: 5px; padding: 52px 2px 14px;
              color: #fff; text-align: center; line-height: 1.15; min-width: 0; }}
  /* nowrap: "Month 10/11/12" are wider and would wrap to two lines in the
     narrow columns, pushing their $500 down out of line with the rest. */
  .rxk-col-month {{ font-size: 0.78rem; font-weight: 700; opacity: .95; white-space: nowrap; }}
  .rxk-col-amt {{ font-size: 1.3rem; font-weight: 800; white-space: nowrap; }}
  .rxk-col-tag {{ font-size: 0.72rem; font-weight: 700; letter-spacing: .5px; margin-top: auto; }}
  /* Purple columns carry the thin separators; green columns are drawn by the
     fill shape (which has its own orange separators), so they add none. */
  .rxk-col--other {{ border-right: 1px solid rgba(255,255,255,.28); }}
  .rxk-col--other:last-child {{ border-right: none; }}
  /* Backdrop for the How-RxKids-would-work section: an 18% tint of the brand
     blue #0082C9. This is the page's only coloured band before the magenta
     TANF section, so it has to hand off to that band — the previous mustard
     cream did that badly (warm yellow straight into magenta), and yellow is
     the palette's weakest colour besides. Blue is a core brand colour that
     was otherwise only carrying one benefit tab; it reads cool and
     mechanism-y for the "how it works" step-through, sets the section apart
     from the white sections above, and sits next to magenta as a neighbour
     rather than a clash. White step/banner cards and the green $15M pill and
     cost button all pop harder on blue than they did on the cream — and that
     green is the TANF/money colour, so it previews the section below. */
  .rxk-hiw-bg {{ background-color: #D1E8F5; }}
  .rxk-hiw-bg .tfc-step:not(:last-child)::after {{ background: #7FB9DE; }}
  .rxk-hiw-bg .tfc-steps-note {{ color: #3F6B8C; }}
  /* Heading goes back to the brand navy — it was only espresso-brown to cope
     with the warm cream, and navy is the correct ink on a cool blue field. */
  .rxk-hiw-bg .tfc-section-title {{ color: #2A3A4D; }}

  /* "How TANF helps pay for RxKids" top band — a deep grape drawn from the
     same purple family as the funding timeline further down (#8E3B9C /
     #7A3E9D / #9B4DB8) rather than the old logo magenta #AB3192. The magenta
     was a fourth hue on a page already carrying blue, green, red and orange,
     and it read as its own unrelated thing rather than as the purple the
     "other funding" language uses everywhere else. Pulling it into that
     family also makes the page's tail one descent — pale blue field, then
     deep purple — instead of a jump between two unrelated saturated bands.
     Heading/intro go white; the "two ways" cards stay light boxes. */
  .rxk-tanf-top {{ background-color: #5B2C7B; }}
  .rxk-tanf-top .tfc-section-title {{ color: #FFFFFF; }}
  .rxk-tanf-top .tfc-section-subtitle {{ color: #E7DAF2; }}
  .rxk-tanf-top .rxk-tanf-h3 {{ color: #FFFFFF; }}

  /* Benefits of RxKids — the tabs take the logo's rainbow (red / blue / green
     / orange / magenta / gold), each tab's active fill + left rule + its
     panel's bullets sharing one colour. Gold gets dark text for contrast. */
  {_benefit_rainbow_css()}
  /* Step 4 = the other-funding stretch: purple, matching the timeline. */
  .tfc-step--alt {{ background: #F7F0FA; }}
  .tfc-step--alt .tfc-step-number {{ background: linear-gradient(135deg, #9B4DB8, #7A3E9D); }}
  .tfc-step--alt .tfc-step-phase {{ color: #8E3B9C; }}
  .tfc-step--alt .tfc-step-amount {{ color: #7A3E9D; }}
  /* The Cost expandable's button features the statewide TANF figure — a tall
     green pill (TANF colour) with the amount big and the rest small, instead
     of the flat red text button the other expandables use. */
  /* Deeper, cooler sea-green than the flat brand #00A750: the bright brand
     green read acid against the cool blue field it now sits on, but the
     button has to STAY green — it's the TANF/money colour, and the table it
     opens is headed and tinted green. This gradient lands either side of the
     #007A3A already used for that table's TANF figures, so the two read as
     one tonal family instead of two different greens. */
  .rxk-cost-btn {{ flex-direction: column; gap: 2px; padding: 16px 40px;
                   background: linear-gradient(135deg, #00915C, #00693F) !important;
                   box-shadow: 0 6px 18px rgba(0,90,58,.32) !important; line-height: 1.1; }}
  .rxk-cost-btn-eyebrow {{ font-size: 0.72rem; font-weight: 700; letter-spacing: 1.5px;
                           text-transform: uppercase; opacity: .9; }}
  .rxk-cost-btn-amt {{ font-size: 2.4rem; font-weight: 800; letter-spacing: .5px;
                       font-family: 'Halyard Display','Oswald','Impact',sans-serif; }}
  .rxk-cost-btn-foot {{ font-size: 0.78rem; font-weight: 600; opacity: .92;
                        display: inline-flex; align-items: center; gap: 8px; }}
  .rxk-cost-btn .tfc-expand-icon {{ transition: transform .3s ease; }}
  .rxk-cost-btn.active .tfc-expand-icon {{ transform: rotate(180deg); }}
  /* Cost estimate table — TANF column tinted green, the two "additional
     dollars" columns tinted purple (same colour language as the timeline). */
  .rxk-cost-wrap {{ border-radius: 14px; overflow: hidden; text-align: left;
                    box-shadow: 0 4px 16px rgba(42,58,77,.12); }}
  .rxk-cost-title {{ background: #00A750; color: #fff; font-weight: 800;
                     font-size: 1.05rem; letter-spacing: .5px; text-transform: uppercase;
                     text-align: center; padding: 14px 18px; }}
  .rxk-cost {{ width: 100%; border-collapse: collapse; background: #fff;
               font-size: 0.95rem; color: #2A3A4D; }}
  .rxk-cost th, .rxk-cost td {{ padding: 12px 14px; text-align: center;
               border-bottom: 1px solid #E2E8F0; }}
  .rxk-cost thead th {{ font-size: 0.85rem; line-height: 1.35; vertical-align: top;
               background: #F1F4F8; }}
  .rxk-cost thead th span {{ display: block; font-weight: 600; font-style: italic;
               font-size: 0.78rem; color: #4a5568; margin-top: 4px; }}
  .rxk-cost tbody th {{ text-align: left; font-weight: 700; }}
  .rxk-cost thead th.rxk-cost-tanf {{ background: #DFF3E8; color: #007A3A; }}
  .rxk-cost td.rxk-cost-tanf {{ background: #EFF9F3; color: #007A3A; font-weight: 700; }}
  .rxk-cost thead th.rxk-cost-add {{ background: #EFDFF5; color: #7A3E9D; }}
  .rxk-cost td.rxk-cost-add {{ background: #F7EFFA; color: #7A3E9D; font-weight: 700; }}
  .rxk-cost tr.rxk-cost-total th, .rxk-cost tr.rxk-cost-total td {{
               font-weight: 800; border-top: 2px solid #2A3A4D; border-bottom: none; }}
  /* A green square bracket under the prenatal–month 3 columns, labelled with
     the TANF total. flex 4:9 matches the 4 green : 9 purple columns exactly;
     the 4px side margin lines the bracket up inside the timeline's 4px frame. */
  .rxk-bracket-row {{ display: flex; margin: 10px 4px 0; }}
  .rxk-bracket {{ flex: 4; height: 15px; position: relative;
                  border: 3px solid #1E9E57; border-top: none;
                  border-radius: 0 0 10px 10px; }}
  .rxk-bracket-rest {{ flex: 9; }}
  .rxk-bracket-amt {{ position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
                      margin-top: 6px; white-space: nowrap;
                      color: #1E9E57; font-weight: 800; font-size: 1.4rem; }}
  .tanf-choice-body {{ margin-bottom: 32px; }}
  .rxk-col--other {{ background: transparent; }}
  /* (A local `.page [style*="position:absolute"] {{ margin:0 }}` rule used to
     live here. docsync's Layout._style() now emits margin:0 itself, so every
     report on the engine gets it — see the comment there for why a margin on a
     positioned element compounds into its saved coordinate. hero.badge and
     hero.hawaii keep the coordinates that were compensated for it.) */
  {FN_CSS}
  {EDIT_OVERRIDES}
</style>
</head>
<body>
{SHEETS}
<script>
{SCRIPT}
// Generic expand/collapse for sections added on the Hawaii page (the Cost
// table) — same max-height dance as the original page's toggleFlintSection,
// which is hard-wired to #flint-content and can't be reused.
function rxkToggle(btn, id) {{
    const content = document.getElementById(id);
    const isOpen = content.classList.toggle('active');
    btn.classList.toggle('active');
    if (isOpen) {{
        content.style.maxHeight = content.scrollHeight + 'px';
        const release = () => {{
            if (content.classList.contains('active')) content.style.maxHeight = 'none';
        }};
        content.addEventListener('transitionend', release, {{ once: true }});
        setTimeout(release, 500);
    }} else {{
        content.style.maxHeight = content.scrollHeight + 'px';
        void content.offsetHeight;
        content.style.maxHeight = '0';
    }}
}}
</script>
<script>window.RXK_NOTES = {NOTES_JSON};</script>
<script>
{FN_POPOVER_JS}
</script>
</body>
</html>
"""

_OUT.write_text(html)
print(f"wrote {_OUT} ({len(html):,} bytes)")
