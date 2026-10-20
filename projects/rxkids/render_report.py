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
import re
import os
import sys

HERE = Path(__file__).resolve().parent           # projects/rxkids
REPO = HERE.parent.parent                        # repo root, where docsync/ lives
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from docsync.content import Content, ContentError, merge_attrs  # noqa: E402
from docsync.blocks import describe                 # noqa: E402
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

# ---- Rx Kids Brand Standard Guidelines (July 2026) pass ----------------------
# Fonts: Franklin Gothic (headlines, subheads, body) and Georgia Pro (quotes,
# subheads). Libre Franklin (OFL) stands in for Franklin Gothic on the web;
# Georgia is the system face Georgia Pro extends. OkinaOpenSans leads every
# stack so U+02BB (the Hawaiian okina) gets a real glyph -- Libre Franklin and
# Georgia do not encode it (see docsync/okina.py; its unicode-range claims
# nothing else, so it is safe in front of any family).
FRANKLIN = ("OkinaOpenSans, 'Libre Franklin', 'Franklin Gothic Book', "
            "'Franklin Gothic Medium', Arial, sans-serif")
FRANKLIN_HEAVY = ("OkinaOpenSans, 'Libre Franklin', 'Franklin Gothic Heavy', "
                  "'Franklin Gothic Demi', Arial, sans-serif")
GEORGIA = "OkinaOpenSans, 'Georgia Pro', Georgia, serif"
FONT_LINK = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
             '<link href="https://fonts.googleapis.com/css2?family=Libre+Franklin:ital,wght@'
             '0,400;0,500;0,600;0,700;0,800;0,900;1,400&display=swap" rel="stylesheet">')
STYLE = re.sub(r"@import url\('[^']*family=Open\+Sans[^']*'\);\s*", "", STYLE)
STYLE = re.sub(r"@import url\('[^']*family=Halyard\+Display[^']*'\);\s*", "", STYLE)
STYLE = STYLE.replace("font-family: 'Halyard Display', 'Oswald', 'Impact', sans-serif;",
                      f"font-family: {FRANKLIN_HEAVY};")
STYLE = STYLE.replace("font-family: 'Arial Black', 'Helvetica', sans-serif;",
                      f"font-family: {FRANKLIN_HEAVY};")
STYLE = re.sub(r"font-family:\s*(?:OkinaOpenSans,\s*)?'?Open Sans'?,\s*sans-serif;",
               f"font-family: {FRANKLIN};", STYLE)

# Colors: snap the page's own variants to the guide's palette (hex values from
# p.4 of the guide). Darker "depth" shades (#c11722, #007a3a ...) stay: they
# are shades of these hues kept for text contrast on white, which the guide's
# tints (all lighter) cannot give. Purples fold into the guide's magenta
# #AB3192 (tints 80/60/40/20 are mixes with white); navy text becomes #10125A.
BRAND_COLORS = {
    "#2a3a4d": "#10125a",   # navy (headings / strong text)
    "#ee303b": "#ee303c",   # red
    "#0082c9": "#0083ca",   # blue
    "#00a750": "#00a84f",   # green
    "#f6921e": "#f7941d",   # orange
    "#f0a800": "#ffc20e",   # yellow
    "#8e3b9c": "#ab3192",   # magenta
    "#7a3e9d": "#ab3192",
    "#5b2c7b": "#ab3192",
    "#9b4db8": "#bc5aa8",   # magenta 80% tint
    "#efdff5": "#eed6e9",   # magenta 20% tint
    "#f7effa": "#f8eaf5",
    "#f7f0fa": "#f8eaf5",
    # -- everything else the original page used, snapped to the guide. Hue picks
    # the family; lighter tones become the guide's tints (80/60/40/20% with white,
    # 10% for pale backgrounds), mid-dark tones a shade (the colour mixed with
    # navy, at most 35%), near-black navy, and slate / gray-blue tones the navy
    # family. Generated once from the built page; see the Rx Kids guide, p.4.
    "#00669e": "#0272b9",
    "#00693f": "#067453",
    "#007a3a": "#048252",
    "#00915c": "#029151",
    "#0d47a1": "#0272b9",
    "#1565c0": "#0083ca",
    "#1976d2": "#339cd5",
    "#1b5e20": "#048252",
    "#1e3a5b": "#0467ae",
    "#1e9e57": "#00a84f",
    "#263238": "#10125a",
    "#2ab972": "#33b972",
    "#2e5a8b": "#0272b9",
    "#34b36b": "#33b972",
    "#388e3c": "#00a84f",
    "#3949ab": "#0083ca",
    "#3a4a5c": "#40417b",
    "#3f6b8c": "#40417b",
    "#42a5f5": "#66b5df",
    "#4a3728": "#a66632",
    "#4a5568": "#40417b",
    "#4a90d9": "#339cd5",
    "#546e7a": "#40417b",
    "#5bc890": "#66cb95",
    "#5c6bc0": "#339cd5",
    "#5d4037": "#b62844",
    "#607d8b": "#70719c",
    "#64b5f6": "#66b5df",
    "#6b4423": "#bd742c",
    "#6b8aa3": "#70719c",
    "#718096": "#40417b",
    "#7a5d3a": "#d48026",
    "#7d1319": "#b62844",
    "#7fb9de": "#66b5df",
    "#8b6914": "#c39621",
    "#90a4ae": "#9fa0bd",
    "#90caf9": "#99cdea",
    "#9b7b4e": "#d48026",
    "#a2dcbc": "#99dcb9",
    "#a5141d": "#cd2c40",
    "#a8895a": "#d48026",
    "#b0bec5": "#9fa0bd",
    "#bfdcf0": "#cce6f4",
    "#c11722": "#cd2c40",
    "#c4a574": "#f9a94a",
    "#d1e8f5": "#cce6f4",
    "#d81f29": "#cd2c40",
    "#d97706": "#d48026",
    "#dcebf7": "#e6f3fa",
    "#dff3e8": "#e6f6ed",
    "#e2e8f0": "#e7e7ee",
    "#e5e5e5": "#e7e7ee",
    "#e6f6ee": "#e6f6ed",
    "#e7daf2": "#f7eaf4",
    "#e81f2b": "#cd2c40",
    "#e8e6e1": "#e7e7ee",
    "#e8ecf0": "#e7e7ee",
    "#eceff1": "#e7e7ee",
    "#edf1ee": "#e7e7ee",
    "#eff9f3": "#e6f6ed",
    "#f1f4f8": "#e7e7ee",
    "#f39aa0": "#f5838a",
    "#f8f9fa": "#f4f4f8",
    "#f8fafc": "#f0f8fc",
    "#fafafa": "#f4f4f8",
    "#fbb040": "#f9a94a",
    "#fbd0d3": "#fcd6d8",
    "#fde3bd": "#fdead2",
    "#fdebec": "#fdeaec",
    "#fef4e7": "#fef4e8",
    "#fff6d8": "#fff3cf",
}

# Shadows and glows: tinted rgba() values follow their colour; neutral black and
# white ones stay.
BRAND_RGBA = {
    "42,58,77": "16,18,90", "229,83,83": "238,48,60", "229,57,53": "238,48,60",
    "140,20,20": "238,48,60", "0,90,58": "0,168,79", "232,230,225": "231,231,239",
    "139,90,43": "247,148,29",
}


def brand_colors(markup: str) -> str:
    markup = re.sub(r"#[0-9a-fA-F]{6}\b",
                    lambda m: BRAND_COLORS.get(m.group(0).lower(), m.group(0)), markup)
    return re.sub(r"rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,",
                  lambda m: "rgba(" + BRAND_RGBA.get(f"{m.group(1)},{m.group(2)},{m.group(3)}",
                                                       f"{m.group(1)},{m.group(2)},{m.group(3)}") + ",",
                  markup)



# ---- Phase 1 "modern" restyle -------------------------------------------------
# Tokens + overrides that sit AFTER every other rule (MODERN_CSS is emitted last,
# beside FN_CSS), so they win on order instead of !important. Cards go flat
# (hairline + one soft shadow), bands go white / pale-navy / navy, buttons go
# solid, the cost table loses its colour columns. No markup changed.
ICONS = {
    "heart": "<path d='M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'/>",
    "dollar": "<line x1='12' y1='1' x2='12' y2='23'/><path d='M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'/>",
    "calendar": "<rect x='3' y='4' width='18' height='18' rx='2' ry='2'/><line x1='16' y1='2' x2='16' y2='6'/><line x1='8' y1='2' x2='8' y2='6'/><line x1='3' y1='10' x2='21' y2='10'/>",
    "activity": "<polyline points='22 12 18 12 15 21 9 3 6 12 2 12'/>",
    "shield": "<path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/>",
    "home": "<path d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/><polyline points='9 22 9 12 15 12 15 22'/>",
    "smile": "<circle cx='12' cy='12' r='10'/><path d='M8 14s1.5 2 4 2 4-2 4-2'/><line x1='9' y1='9' x2='9.01' y2='9'/><line x1='15' y1='9' x2='15.01' y2='9'/>",
}


def _icon_uri(body: str) -> str:
    return ("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' "
            "stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>" + body + "</svg>")


ICON_CSS = "".join(
    f'  .rxk-ic-{k}::before {{ -webkit-mask-image: url("{_icon_uri(b)}"); mask-image: url("{_icon_uri(b)}"); }}\n'
    for k, b in ICONS.items())

MODERN_CSS = """
  .page { --rx-navy:#10125A; --rx-ink:#40417B; --rx-muted:#555689;
          --rx-line:#E4E4EE; --rx-tint:#F5F5F9;
          --rx-red:#EE303C; --rx-blue:#0083CA; --rx-green:#00A84F;
          --rx-orange:#F7941D; --rx-magenta:#AB3192;
          --rx-radius:16px;
          --rx-shadow:0 1px 2px rgba(16,18,90,.05), 0 8px 24px rgba(16,18,90,.06);
          --rx-lift:0 2px 4px rgba(16,18,90,.06), 0 14px 32px rgba(16,18,90,.10); }

  /* Cards: hairline + one soft shadow, no coloured top rules */
  .tfc-scene-tag, .tfc-total-banner, .tfc-tanf-card, .tfc-benefit-text-box,
  .tfc-highlight-box, .rxk-cost-wrap, .tfc-carousel-container {
    border: 1px solid var(--rx-line); border-top: 1px solid var(--rx-line);
    border-radius: var(--rx-radius); box-shadow: var(--rx-shadow); }
  .tfc-tanf-card--free { border-top-color: var(--rx-line); }
  .tfc-scene-tag:hover { transform: translateY(-2px); box-shadow: var(--rx-lift); }
  .tfc-highlight-box { background: var(--rx-tint); }
  .tfc-highlight-box h3 { color: var(--rx-navy); }
  .tfc-carousel-container { background: var(--rx-tint); }
  .tfc-benefits-display { background: var(--rx-tint); box-shadow: none; border: 1px solid var(--rx-line); }
  .tfc-benefit-text-box { box-shadow: none; }
  .tfc-benefit-tab { box-shadow: none; border-top: 1px solid var(--rx-line);
                     border-right: 1px solid var(--rx-line); border-bottom: 1px solid var(--rx-line); }
  .tfc-benefit-tab.active { box-shadow: none; }
  .tfc-hero-image { border-radius: 20px; box-shadow: var(--rx-lift); }

  /* Bands: white, pale navy, and one navy slab */
  .tfc-hero, .tfc-bg-blue, .rxk-hiw-bg { background-color: var(--rx-tint); }
  .rxk-tanf-top { background-color: var(--rx-navy); }
  .rxk-tanf-top .tfc-section-subtitle { color: rgba(255,255,255,.82); }

  /* Type */
  .tfc-section-title { letter-spacing: -.02em; line-height: 1.12; font-weight: 800; }
  h1, h2, h3 { text-wrap: balance; }
  p, li { text-wrap: pretty; }
  .tfc-section-subtitle { line-height: 1.65; font-size: 1.15rem; color: var(--rx-ink); }
  .tfc-scene-title, .tfc-tanf-card h3 { letter-spacing: -.01em; }

  /* Buttons: solid fills, no gradients or glows */
  .tfc-expand-btn { background-color: var(--rx-red); box-shadow: none; padding: 14px 28px; font-size: 1.1rem; }
  .tfc-expand-btn:hover { background-color: var(--rx-red); transform: none; box-shadow: none; filter: brightness(.92); }
  .rxk-cost-btn { background: var(--rx-navy) !important; box-shadow: none !important; }
  .rxk-cost-btn:hover { filter: brightness(1.25); }
  .tfc-cta-section { background: var(--rx-red); }
  .tfc-btn:hover { transform: none; box-shadow: none; opacity: .92; }

  /* Quiet details: plain superscript footnotes, a hairline cost table */
  @media screen {
    a.fn { background: none; padding: 0; margin: 0 1px; border-radius: 0; color: var(--rx-blue); }
    a.fn:hover { background: none; color: var(--rx-navy); text-decoration: underline; }
  }
  .rxk-cost-title { background: none; color: var(--rx-navy); text-align: left; text-transform: none;
                    letter-spacing: -.01em; font-size: 1.2rem; padding: 20px 24px 8px; }
  .rxk-cost th, .rxk-cost td { padding: 14px 20px; }
  .rxk-cost thead th, .rxk-cost thead th.rxk-cost-tanf, .rxk-cost thead th.rxk-cost-add {
    background: none; color: var(--rx-ink); border-bottom: 1px solid var(--rx-line); }
  .rxk-cost thead th:not(:first-child) { text-align: right; }
  .rxk-cost td { text-align: right; font-variant-numeric: tabular-nums; }
  .rxk-cost td.rxk-cost-tanf, .rxk-cost td.rxk-cost-add { background: none; color: var(--rx-navy); font-weight: 600; }
  .rxk-cost tr.rxk-cost-total th, .rxk-cost tr.rxk-cost-total td { background: var(--rx-tint); }


  /* Phase 2: benefit tabs are pills over one card */
  .tfc-benefits-layout { flex-direction: column; align-items: stretch; gap: 24px; }
  .tfc-benefits-tabs { flex: none; display: grid; grid-template-columns: repeat(3, max-content);
                       justify-content: center; gap: 10px 12px; overflow: visible; padding: 0; }
  .tfc-benefits-tabs .tfc-benefit-tab { border-radius: 999px; padding: 10px 20px; font-size: .98rem;
    display: inline-flex; align-items: center; gap: 10px;
    border: 1px solid var(--rx-line); border-left-width: 1px; border-left-color: var(--rx-line); }
  .tfc-benefit-tab::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: currentColor; flex: none; }
  .tfc-benefits-tabs .tfc-benefit-tab.active { border-color: transparent; }
  .tfc-benefits-display { background: none; border: none; min-height: 0; overflow: visible; }
  .tfc-benefit-content { padding: 0; min-height: 0; }
  .tfc-benefit-text-box { padding: 32px 40px; box-shadow: var(--rx-shadow); }

  /* Phase 2: the closing call to action is a navy block with the white logo */
  .tfc-cta-section { background: var(--rx-navy); }
  .rxk-cta-logo { display: block; width: 320px; height: auto; margin: 0 auto 28px; }
  .tfc-cta-section p { color: rgba(255,255,255,.85); opacity: 1; }
  .tfc-cta-section .tfc-btn { background: var(--rx-red); color: #fff; }
  .tfc-cta-section .tfc-btn:hover { background: var(--rx-red); color: #fff; opacity: .92; }
  .tfc-cta-section .tfc-btn-outline, .tfc-cta-section .tfc-btn-outline:hover {
    background: none; border: none; color: #fff; text-decoration: underline;
    text-underline-offset: 4px; padding: 16px 20px; margin-left: 8px; }
  .tfc-cta-section p.rxk-partner { border-top-color: rgba(255,255,255,.2); color: rgba(255,255,255,.7); }


  /* Phase 3: three heart cards replace the clip-art house diagram */
  .rxk-feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; margin-top: 48px; }
  .rxk-feature-grid .tfc-scene-tag { position: static; width: auto; margin: 0; padding: 28px 28px 30px;
    text-align: left; transform: none; }
  .rxk-feature-grid .tfc-scene-tag::before, .rxk-feature-grid .tfc-scene-tag::after { display: none; }
  .rxk-feature-grid .tfc-scene-tag:hover { transform: translateY(-2px); }
  .rxk-feature-grid .tfc-scene-title { font-size: 1.25rem; margin: 18px 0 8px; }
  .rxk-feature-grid .tfc-scene-tag p { font-size: 1rem; line-height: 1.6; }
  .rxk-feature-icon { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%;
    background: var(--rx-tint); color: var(--rx-red); }
  .rxk-feature-icon::before { content: ""; width: 24px; height: 24px; background: currentColor;
    -webkit-mask: url("{_HEART}") center / contain no-repeat; mask: url("{_HEART}") center / contain no-repeat; }
  .rxk-feature-grid .tfc-scene-tag:nth-child(2) .rxk-feature-icon { color: var(--rx-blue); }
  .rxk-feature-grid .tfc-scene-tag:nth-child(3) .rxk-feature-icon { color: var(--rx-green); }
  @media (max-width: 768px) { .rxk-feature-grid { grid-template-columns: 1fr; } }

  /* Phase 3: a larger hero photo and a facts strip straddling its bottom edge */
  .tfc-hero { gap: 56px; }
  .tfc-hero-image-container { margin-left: auto; }
  .tfc-hero-image-container { max-width: 540px; }
  .rxk-facts { position: relative; z-index: 3; max-width: 1000px; margin: -40px auto 0; display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)); background: #fff; border: 1px solid var(--rx-line);
    border-radius: 20px; box-shadow: var(--rx-lift); }
  .rxk-fact { padding: 24px 32px; text-align: left; }
  .rxk-fact + .rxk-fact { border-left: 1px solid var(--rx-line); }
  .rxk-fact-value { display: block; font-size: 2.1rem; font-weight: 800; letter-spacing: -.02em; line-height: 1.1;
    color: var(--rx-navy); font-family: OkinaOpenSans, 'Libre Franklin', 'Franklin Gothic Heavy', Arial, sans-serif; }
  .rxk-fact-label { display: block; margin-top: 6px; font-size: .98rem; line-height: 1.45; color: var(--rx-ink); }
  @media (max-width: 768px) { .rxk-facts { grid-template-columns: 1fr; margin-top: -24px; }
    .rxk-fact + .rxk-fact { border-left: none; border-top: 1px solid var(--rx-line); } }

  /* Phase 3: the long TANF explainer sits behind one button */
  .rxk-fold { text-align: center; margin: 8px 0 44px; }
  .rxk-fold .tfc-expand-content { text-align: left; }
  .rxk-fold .tfc-expand-inner { padding-top: 32px; }


  /* Tabs: a Home summary plus four deeper pages in one embed */
  .page { min-height: 0 !important; }
  .rxk-tabs { display: flex; justify-content: center; gap: 4px; padding: 0 16px; background: #fff;
    border-bottom: 1px solid var(--rx-line); overflow-x: auto; }
  .rxk-tab { appearance: none; background: none; border: none; border-bottom: 3px solid transparent;
    margin-bottom: -1px; padding: 18px 22px; font: inherit; font-weight: 600; font-size: 1rem;
    color: var(--rx-ink); cursor: pointer; white-space: nowrap; transition: color .2s, border-color .2s; }
  .rxk-tab:hover { color: var(--rx-navy); }
  .rxk-tab[aria-selected="true"] { color: var(--rx-navy); border-bottom-color: var(--rx-red); }
  .rxk-tab:focus-visible, .rxk-teaser:focus-visible, .rxk-next-btn:focus-visible {
    outline: 2px solid var(--rx-blue); outline-offset: 2px; border-radius: 8px; }
  .rxk-panel[hidden] { display: none !important; }
  .rxk-next { text-align: center; padding: 8px 24px 72px; }
  .rxk-next-btn { appearance: none; background: #fff; border: 1px solid var(--rx-line); border-radius: 999px;
    padding: 14px 28px; font: inherit; font-weight: 700; font-size: 1.05rem; color: var(--rx-navy); cursor: pointer;
    transition: background .2s, border-color .2s; }
  .rxk-next-btn:hover { background: var(--rx-tint); border-color: var(--rx-navy); }
  .rxk-next-btn::after { content: "\\2192"; margin-left: 10px; }

  /* Home: teaser cards that open the other tabs */
  .rxk-teaser-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-top: 40px; }
  .rxk-teaser { appearance: none; text-align: left; font: inherit; cursor: pointer; background: #fff;
    border: 1px solid var(--rx-line); border-radius: var(--rx-radius); box-shadow: var(--rx-shadow);
    padding: 26px 24px 28px; transition: transform .2s, box-shadow .2s; }
  .rxk-teaser:hover { transform: translateY(-2px); box-shadow: var(--rx-lift); }
  .rxk-teaser h3 { margin: 0 0 8px; font-size: 1.2rem; letter-spacing: -.01em; color: var(--rx-navy); }
  .rxk-teaser h3::after { content: "\\2192"; margin-left: 8px; color: var(--rx-red); }
  .rxk-teaser p { margin: 0; font-size: .98rem; line-height: 1.55; color: var(--rx-ink); }
  .rxk-works-band .rxk-works { background: #fff; box-shadow: var(--rx-shadow); border: 1px solid var(--rx-line); margin-bottom: 0; }
  @media (max-width: 900px) { .rxk-teaser-grid { grid-template-columns: 1fr; } }
  @media (max-width: 560px) { .rxk-teaser-grid { grid-template-columns: 1fr; } }

  /* Funding: the headline total is a stat, not a button */
  .rxk-cost-stat { display: flex; flex-direction: column; align-items: center; gap: 4px; margin: 8px auto 36px; text-align: center; }
  .rxk-cost-stat .rxk-cost-btn-eyebrow { font-size: .8rem; letter-spacing: 2px; color: var(--rx-muted); opacity: 1; }
  .rxk-cost-stat .rxk-cost-btn-amt { font-size: 3.4rem; letter-spacing: -.02em; color: var(--rx-navy); }

  /* The bill */
  .rxk-draft-pill { display: block; width: max-content; margin: 0 auto 14px; padding: 6px 16px; border-radius: 999px;
    background: var(--rx-tint); border: 1px solid var(--rx-line); color: var(--rx-ink); font-size: .78rem;
    font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; }
  .rxk-bill-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; margin-top: 44px; counter-reset: bill; }
  .rxk-bill-card { counter-increment: bill; background: #fff; border: 1px solid var(--rx-line);
    border-radius: var(--rx-radius); box-shadow: var(--rx-shadow); padding: 30px 32px 32px; text-align: left; }
  .rxk-bill-card::before { content: counter(bill); display: grid; place-items: center; width: 36px; height: 36px;
    border-radius: 50%; background: var(--rx-navy); color: #fff; font-weight: 800; font-size: .95rem; margin-bottom: 16px; }
  .rxk-bill-title { margin: 0 0 8px; font-size: 1.3rem; letter-spacing: -.01em; color: var(--rx-navy); }
  .rxk-bill-card p { margin: 0; font-size: 1.02rem; line-height: 1.65; color: var(--rx-ink); }
  @media (max-width: 768px) { .rxk-bill-grid { grid-template-columns: 1fr; } }


  /* Buttons do not inherit the page font by themselves */
  .tfc-benefit-tab, .tfc-expand-btn, .tfc-btn, .rxk-cost-btn { font-family: inherit; }

  /* Contrast pass (WCAG AA): every text/background pair below measured < 4.5:1 (3:1 large) */
  a.fn { color: #0272B9; }
  @media screen { a.fn { color: #0272B9; } }
  .tfc-expand-btn, .tfc-cta-section .tfc-btn, .tfc-cta-section .tfc-btn:hover { background-color: #CD2C40; }
  .tfc-cta-section .tfc-btn { background: #CD2C40; }
  .tfc-cta-section .tfc-btn.tfc-btn-outline, .tfc-cta-section .tfc-btn.tfc-btn-outline:hover { background: none; }
  .tfc-tanf-option-num { color: var(--rx-muted); }
  .tfc-tanf-card--free .tfc-tanf-option-num { color: #067453; }
  .tfc-tanf-tag--good, .tfc-tanf-card--free .tfc-tanf-tag { color: #067453; }
  .rxk-cost-stat .rxk-cost-btn-eyebrow { color: var(--rx-ink); }
  .tfc-cost-title { color: var(--rx-navy); }
  .tfc-3d-bar-group:nth-child(1) .tfc-3d-bar-value, .tfc-3d-bar-group:nth-child(2) .tfc-3d-bar-value { color: var(--rx-navy); }
  .tfc-bar-fill.married { color: var(--rx-navy); }


  /* Quality pass: a real page heading, four-up stats, a soft tab transition */
  .rxk-h1 { display: contents; margin: 0; font: inherit; }
  .rxk-facts--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0 auto; }
  @media (max-width: 768px) { .rxk-facts--4 { grid-template-columns: 1fr 1fr; } .rxk-facts--4 .rxk-fact:nth-child(3) { border-left: none; } }
  @keyframes rxkIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .rxk-panel:not([hidden]) { animation: rxkIn .35s ease-out; }


  /* Sources: one bar, closed by default */
  .tfc-full-width.rxk-sources { padding: 20px 0 40px !important; }
  .rxk-sources-h2 { margin: 0; font-size: inherit; }
  .rxk-sources-bar { appearance: none; display: flex; align-items: center; justify-content: space-between; width: 100%;
    background: var(--rx-tint); border: 1px solid var(--rx-line); border-radius: 14px; padding: 18px 24px;
    font: inherit; font-weight: 700; font-size: 1.15rem; color: var(--rx-navy); cursor: pointer; text-align: left;
    transition: border-color .2s; }
  .rxk-sources-bar:hover { border-color: var(--rx-navy); }
  .rxk-sources-bar:focus-visible { outline: 2px solid var(--rx-blue); outline-offset: 2px; }
  .rxk-sources-bar .tfc-expand-icon { font-size: .8rem; transition: transform .3s ease; }
  .rxk-sources-bar.active .tfc-expand-icon { transform: rotate(180deg); }
  .rxk-sources .tfc-expand-inner { background: none; border: none; box-shadow: none; padding: 28px 4px 0; }


  /* Responsive: the sheet is fluid below its design width, the hero stacks, and the
     two wide graphics (funding timeline, cost table) scroll sideways inside their card */
  @media (max-width: 1230px) { .page { width: auto !important; max-width: 12.5in; } }
  /* 1200px = the sheet width: below it the engine releases every pinned element itself */
  @media (max-width: 1200px) {
    .tfc-hero { flex-direction: column; align-items: stretch; gap: 22px; padding: 28px 24px 64px !important; }
    /* [style] + .page lift this above the engine's own phone rule, which also sets width:auto !important */
    .page .tfc-hero .rxkeiki-logo[style] { position: static !important; left: auto !important; top: auto !important;
      width: min(100%, 460px) !important; max-width: 460px !important; margin: 0 auto !important; display: block;
      transform: none !important; }
    .tfc-hero-image-container { max-width: 640px; width: 100%; margin: 0 auto; }
    .tfc-hero-image { max-height: none; }
  }
  @media (max-width: 820px) {
    .rxk-tabs { justify-content: flex-start; padding: 0 6px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
    .rxk-tabs::-webkit-scrollbar { display: none; }
    .rxk-tab { padding: 15px 14px; font-size: .95rem; }
    .tfc-section-title { font-size: 1.75rem; }
    .tfc-section-subtitle { font-size: 1.05rem; }
    .rxk-facts { margin-top: -28px; }
    .rxk-fact { padding: 18px 22px; }
    .rxk-fact-value { font-size: 1.8rem; }
    .rxk-feature-grid, .rxk-bill-grid { gap: 16px; margin-top: 32px; }
    .rxk-bill-card, .rxk-feature-grid .tfc-scene-tag { padding: 24px 22px; }
    .rxk-works { padding: 22px 20px 8px; }
    .tfc-benefits-tabs { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
    .tfc-benefits-tabs .tfc-benefit-tab { padding: 9px 14px; font-size: .9rem; }
    .tfc-benefit-text-box { padding: 22px 20px; }
    .tfc-carousel-container { max-width: 100%; padding-bottom: 66px; }
    .tfc-carousel-slide { padding: 24px 14px; }
    .tfc-carousel-arrow { top: auto; bottom: 12px; transform: none; }
    .tfc-carousel-arrow:hover { transform: scale(1.08); }
    .tfc-carousel-prev { left: calc(50% - 54px); }
    .tfc-carousel-next { right: calc(50% - 54px); }
    .tfc-pullout-quote .tfc-quote-text { padding: 0 18px; font-size: 1.2rem; }
    .tfc-total-banner { padding: 22px 18px; }
    .tfc-total-amount { font-size: 2.6rem; }
    .tfc-tanf-card { padding: 24px 22px; }
    .rxk-fold-btn { width: 100%; justify-content: center; text-align: center; padding: 14px 18px; }
    .rxk-tl-scroll { overflow-x: auto; padding-bottom: 8px; -webkit-overflow-scrolling: touch; }
    .rxk-tl-scroll .rxk-timeline, .rxk-tl-scroll .rxk-bracket-row { min-width: 700px; }
    .rxk-cost-wrap { overflow-x: auto; }
    .rxk-cost { min-width: 640px; }
    .rxk-cost-title { padding: 16px 18px 6px; font-size: 1.05rem; }
    .rxk-cost-stat .rxk-cost-btn-amt { font-size: 2.6rem; }
    .rxk-endnotes { columns: 1; }
    .rxk-sources-bar { padding: 15px 18px; font-size: 1.05rem; }
    .tfc-cta-section { padding: 36px 20px; }
    .rxk-cta-logo { width: min(300px, 80%); }
    .rxk-next { padding: 8px 20px 56px; }
    .rxk-next-btn { padding: 13px 22px; font-size: 1rem; }
    /* the 3D poverty bars narrow to fit a phone card (top/side faces are relative, so the 3D look holds) */
    .tfc-chart-container { padding: 10px 6px; }
    .tfc-3d-chart { gap: 32px; }
    .tfc-3d-bar, .tfc-3d-bar-front { width: 56px; }
    .tfc-3d-bar-value { font-size: 1.05rem; }
    .tfc-3d-bar-label { width: 68px; white-space: normal; line-height: 1.2; font-size: .85rem; bottom: -54px; }
  }


  /* Print: every tab in order, the sources open, the navigation gone */
  @media print {
    .rxk-panel[hidden] { display: block !important; }
    .rxk-tabs, .rxk-next, .rxk-sources-bar .tfc-expand-icon { display: none !important; }
    .tfc-expand-content { max-height: none !important; overflow: visible !important; }
    .tfc-reveal { opacity: 1 !important; transform: none !important; }
    .rxk-panel { animation: none !important; break-before: page; }
    .rxk-panel:first-of-type { break-before: auto; }
    .tfc-full-width { break-inside: avoid; }
  }


  /* Home absorbed the Why Hawaii section; steps band reads white between two tinted ones */
  .tfc-full-width.rxk-band-white { background-color: #fff; }

  /* The $7,500 summary: total on top, then how it adds up */
  .tfc-total-banner { max-width: 960px; padding: 30px 34px 30px; }
  .rxk-sum-caption { display: block; margin: 26px 0 14px; font-size: .78rem; font-weight: 700; letter-spacing: 1.6px;
    text-transform: uppercase; color: var(--rx-muted); }
  .rxk-sum { display: flex; align-items: flex-start; justify-content: center; gap: 12px; text-align: left; }
  .rxk-sum-group { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; }
  .rxk-sum-group--sure { flex: 2 1 0; }
  .rxk-sum-row { display: flex; align-items: stretch; gap: 10px; flex: 1; }
  .rxk-sum-tile { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 4px; padding: 16px 18px 17px;
    border-radius: 14px; border: 1px solid var(--rx-line); background: var(--rx-tint); }
  .rxk-sum-tile--1 { background: rgba(238,48,60,.07); border-color: rgba(238,48,60,.28); }
  .rxk-sum-tile--2 { background: rgba(0,131,202,.07); border-color: rgba(0,131,202,.30); }
  .rxk-sum-tile--3 { background: #fff; border: 2px dashed #9FA0BD; }
  .rxk-sum-value { font-size: 1.9rem; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; color: var(--rx-navy);
    font-family: OkinaOpenSans, 'Libre Franklin', 'Franklin Gothic Heavy', Arial, sans-serif; }
  .rxk-sum-tile--1 .rxk-sum-value { color: #CD2C40; }
  .rxk-sum-tile--2 .rxk-sum-value { color: #0272B9; }
  .rxk-sum-label { font-size: .92rem; line-height: 1.4; color: var(--rx-ink); }
  .rxk-sum-op { flex: none; align-self: center; width: 26px; text-align: center; font-size: 1.7rem; font-weight: 700;
    line-height: 1; color: var(--rx-muted); margin-bottom: 38px; }
  .rxk-sum-op::before { content: "+"; }
  .rxk-sum-op--in { width: 20px; margin-bottom: 0; font-size: 1.4rem; }
  .rxk-sum-note { display: block; margin-top: 12px; padding-top: 10px; border-top: 3px solid var(--rx-navy);
    text-align: center; font-size: .95rem; font-weight: 700; line-height: 1.35; color: var(--rx-navy); }
  .rxk-sum-group--maybe .rxk-sum-note { border-top: 3px dashed #9FA0BD; color: var(--rx-ink); }
  @media (max-width: 820px) {
    .tfc-total-banner { padding: 24px 18px 24px; }
    .rxk-sum { flex-direction: column; align-items: stretch; gap: 6px; }
    .rxk-sum-group--sure, .rxk-sum-group { flex: none; }
    .rxk-sum-row { flex-direction: column; gap: 4px; }
    .rxk-sum-op { align-self: center; margin-bottom: 0; }
    .rxk-sum-value { font-size: 1.7rem; }
  }


  /* Summary only: an enrollment line, and the $500-a-month payments carry the weight */
  .rxk-enroll { display: inline-flex; align-items: center; gap: 10px; margin: 18px auto 0; padding: 9px 20px;
    border-radius: 999px; background: var(--rx-tint); border: 1px solid var(--rx-line); font-size: .98rem;
    font-weight: 600; color: var(--rx-navy); }
  .rxk-enroll::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--rx-red); flex: none; }
  .rxk-sum-group--sure { flex: 2.7 1 0; }
  .rxk-sum-group--maybe { flex: 1.5 1 0; }
  .rxk-sum-tile--1 { flex: 1 1 0; }
  .rxk-sum-tile--monthly { flex: 1.5 1 0; padding: 18px 20px 16px; }
  .rxk-sum-tile--2 { border-width: 2px; background: rgba(0,131,202,.10); border-color: #0272B9; }
  .rxk-sum-tile--monthly .rxk-sum-value { font-size: 2.7rem; line-height: 1; }
  .rxk-sum-per { display: inline-block; margin-left: 8px; font-size: 1.1rem; font-weight: 600; letter-spacing: 0;
    color: var(--rx-ink); font-family: OkinaOpenSans, 'Libre Franklin', 'Franklin Gothic Book', Arial, sans-serif; }
  .rxk-sum-tile--monthly .rxk-sum-label { margin-top: 6px; font-size: 1rem; color: var(--rx-navy); font-weight: 600; }
  .rxk-sum-total { display: block; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--rx-line);
    font-size: .88rem; color: var(--rx-ink); }
  .rxk-sum-same { display: block; margin-top: 20px; font-size: .95rem; color: var(--rx-ink); text-align: center; }
  @media (max-width: 820px) {
    .rxk-sum-tile--monthly { padding: 16px 18px 14px; }
    .rxk-sum-tile--monthly .rxk-sum-value { font-size: 2.3rem; }
    .rxk-enroll { padding: 8px 16px; font-size: .92rem; }
  }


  /* Stat tiles: icon, eyebrow, number, label. Used by the Home facts and the Evidence results */
  .rxk-facts { background: none; border: none; box-shadow: none; border-radius: 0; gap: 14px; max-width: 1040px; }
  .rxk-fact { background: #fff; border: 1px solid var(--rx-line); border-radius: 16px; box-shadow: var(--rx-shadow);
    padding: 20px 22px 22px; }
  .rxk-fact + .rxk-fact { border-left: 1px solid var(--rx-line); }
  .rxk-fact-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; margin-bottom: 14px; }
  .rxk-fact-icon::before { content: ""; width: 22px; height: 22px; background: currentColor;
    -webkit-mask-position: center; -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat;
    mask-position: center; mask-size: contain; mask-repeat: no-repeat; }
  .rxk-fact:nth-child(1) .rxk-fact-icon { color: #CD2C40; background: rgba(238,48,60,.10); }
  .rxk-fact:nth-child(2) .rxk-fact-icon { color: #0272B9; background: rgba(0,131,202,.10); }
  .rxk-fact:nth-child(3) .rxk-fact-icon { color: #AB3192; background: rgba(171,49,146,.10); }
  .rxk-fact:nth-child(4) .rxk-fact-icon { color: #067453; background: rgba(0,168,79,.12); }
  .rxk-fact-eyebrow { display: block; font-size: .84rem; font-weight: 600; letter-spacing: .2px; color: var(--rx-ink); }
  .rxk-fact-value { color: var(--rx-navy); margin-top: 4px; font-variant-numeric: tabular-nums; }
  .rxk-fact-label { margin-top: 4px; font-size: .95rem; }
  @media (max-width: 768px) {
    .rxk-fact + .rxk-fact, .rxk-facts--4 .rxk-fact:nth-child(3) { border: 1px solid var(--rx-line); }
    .rxk-fact { padding: 16px 18px 18px; }
  }
  /*ICON_CSS*/


  /* "What is RxKeiki?" lead box: a calm panel with a heart badge, not a red slab */
  .tfc-section-subtitle.tfc-subtitle-box { position: relative; box-sizing: border-box; max-width: 880px; margin: 0 auto 52px;
    padding: 34px 44px 34px 116px; background: var(--rx-tint); color: var(--rx-navy);
    border: 1px solid var(--rx-line); border-radius: 20px; box-shadow: none; text-shadow: none; text-align: left;
    font-size: 1.4rem; font-weight: 500; line-height: 1.5; letter-spacing: -.005em; }
  .tfc-subtitle-box::before { content: ""; position: absolute; left: 34px; top: 34px; width: 58px; height: 58px;
    border-radius: 50%; background: #fff; border: 1px solid var(--rx-line); }
  .tfc-subtitle-box::after { content: ""; position: absolute; left: 50px; top: 50px; width: 26px; height: 26px;
    background: #CD2C40; -webkit-mask-image: url("{_HEART}"); mask-image: url("{_HEART}");
    -webkit-mask-position: center; -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat;
    mask-position: center; mask-size: contain; mask-repeat: no-repeat; }
  .tfc-subtitle-box .tfc-subtitle-eyebrow { color: #CD2C40; opacity: 1; margin-bottom: 10px; font-size: .8rem; letter-spacing: 2px; }
  .tfc-subtitle-box strong, .tfc-subtitle-box b { font-weight: 700; color: var(--rx-navy);
    background-image: linear-gradient(rgba(238,48,60,.20), rgba(238,48,60,.20)); background-repeat: no-repeat;
    background-position: 0 92%; background-size: 100% .5em; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  @media (max-width: 820px) {
    .tfc-section-subtitle.tfc-subtitle-box { padding: 88px 24px 26px; font-size: 1.12rem; margin-bottom: 36px; }
    .tfc-subtitle-box::before { left: 24px; top: 24px; width: 50px; height: 50px; }
    .tfc-subtitle-box::after { left: 36px; top: 36px; width: 26px; height: 26px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .page *, .page *::before, .page *::after { transition: none !important; animation: none !important; }
    .tfc-reveal { opacity: 1 !important; transform: none !important; }
  }
"""

# Hearts are the guide's bullet ("ideal for ... bullet points"); Georgia for
# quotes. CSS-only, so nothing here needs a slot or a handle.
_HEART = ("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>"
          "<path d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 "
          "3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86"
          "-8.55 11.54L12 21.35z'/></svg>")
MODERN_CSS = MODERN_CSS.replace("{_HEART}", _HEART).replace("/*ICON_CSS*/", ICON_CSS)
BRAND_CSS = f"""
  .tfc-benefit-list li::before {{
    content: ""; width: 15px; height: 15px; top: 5px; left: 1px;
    background: currentColor;
    -webkit-mask: url("{_HEART}") center / contain no-repeat;
            mask: url("{_HEART}") center / contain no-repeat; }}
  .tfc-cta-section p.rxk-partner {{ font-size: 0.95rem; line-height: 1.5; margin: 36px auto 0;
    padding-top: 20px; border-top: 1px solid rgba(255,255,255,.45); max-width: 720px; }}
  .rxk-cost-note {{ margin: 14px 4px 0; font-size: 0.95rem; line-height: 1.5; color: #40417b; text-align: left; }}
  .rxk-works {{ background: #fff; border-radius: 16px; padding: 24px 32px 12px;
                margin: 0 0 32px; box-shadow: 0 2px 10px rgba(16,18,90,.08); }}
  .rxk-works-title {{ margin: 0 0 4px; font-size: 1.6rem; color: #10125A; }}
  .rxk-works-lead {{ margin: 0 0 16px; color: #4a5568; font-size: 1.05rem; }}
  .rxk-works-list {{ list-style: none; margin: 0; padding: 0; display: grid;
                     grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 4px 28px; }}
  .rxk-works-list li {{ position: relative; padding: 0 0 14px 28px; font-size: 1.05rem;
                        line-height: 1.45; color: #10125A; font-weight: 600; text-align: left; }}
  .rxk-works-list li::before {{ content: ""; position: absolute; left: 0; top: 4px;
    width: 18px; height: 18px; background: currentColor;
    -webkit-mask: url("{_HEART}") center / contain no-repeat;
            mask: url("{_HEART}") center / contain no-repeat; }}
  .rxk-works-1::before {{ color: #EE303C; }} .rxk-works-2::before {{ color: #0083CA; }}
  .rxk-works-3::before {{ color: #00A84F; }} .rxk-works-4::before {{ color: #AB3192; }}
  .tfc-pullout-quote .tfc-quote-text, .tfc-flint-lead, .tfc-highlight-box p {{
    font-family: {GEORGIA}; }}
"""

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

TAB_JS = """
(function () {
  var IDS = ['home', 'evidence', 'funding', 'bill'];
  function show(id, fromHash, quiet) {
    if (IDS.indexOf(id) < 0) id = 'home';
    IDS.forEach(function (k) {
      var p = document.getElementById('rxk-panel-' + k), t = document.getElementById('rxk-tab-' + k);
      if (!p || !t) return;
      var on = k === id;
      if (on) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    if (!fromHash && !quiet) { try { location.hash = 'rxk-' + id; } catch (e) {} }
    var bar = document.querySelector('.rxk-tabs');
    if (bar && !quiet) {
      var top = bar.getBoundingClientRect().top;
      if (top < 0) window.scrollTo({ top: window.pageYOffset + top - 8, behavior: 'smooth' });
    }
  }
  function fromLocation() {
    var m = /^#rxk-([a-z]+)$/.exec(location.hash || '');
    return m ? m[1] : null;
  }
  window.rxkSources = function (btn) {
    rxkToggle(btn, 'sources-content');
    btn.setAttribute('aria-expanded', btn.classList.contains('active') ? 'true' : 'false');
  };
  function openSourcesFor(hash) {
    if (!/^#en\\d+$/.test(hash || '')) return;
    var b = document.querySelector('.rxk-sources-bar');
    if (b && !b.classList.contains('active')) window.rxkSources(b);
    setTimeout(function () { var t = document.querySelector(hash); if (t) t.scrollIntoView({ block: 'center' }); }, 520);
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-rxk-tab]') : null;
    if (el) show(el.getAttribute('data-rxk-tab'));
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target.closest ? e.target.closest('.rxk-tab') : null;
    if (!t || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    var i = IDS.indexOf(t.getAttribute('data-rxk-tab')) + (e.key === 'ArrowRight' ? 1 : -1);
    i = (i + IDS.length) % IDS.length;
    show(IDS[i]);
    var nt = document.getElementById('rxk-tab-' + IDS[i]); if (nt) nt.focus();
    e.preventDefault();
  });
  window.addEventListener('hashchange', function () { var id = fromLocation(); if (id) show(id, true); else openSourcesFor(location.hash); });
  var first = fromLocation();
  if (first) show(first, true, true); else openSourcesFor(location.hash);
})();
"""

COUNT_JS = """
(function () {
  if (!('IntersectionObserver' in window) || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  var NUM = /\\d[\\d,]*(?:\\.\\d+)?/g;
  function render(final, e) {
    return final.replace(NUM, function (m) {
      var dec = (m.split('.')[1] || '').length;
      var v = parseFloat(m.replace(/,/g, '')) * e;
      if (dec) return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      return m.indexOf(',') > -1 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v));
    });
  }
  function run(el) {
    var final = el.getAttribute('data-final'), t0 = null, dur = 1100;
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = p < 1 ? render(final, e) : final;
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    setTimeout(function () { el.textContent = final; }, dur + 500);
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); run(en.target); } });
  }, { threshold: 0.6 });
  Array.prototype.forEach.call(document.querySelectorAll('.rxk-fact-value'), function (el) {
    var t = el.textContent;
    if (/\\d/.test(t)) { el.setAttribute('data-final', t); io.observe(el); }
  });
})();
""" if not EDIT else ""

EDIT_OVERRIDES = """
  /* DOCSYNC_EDIT only: the scroll-reveal IntersectionObserver above doesn't
     reliably fire inside the editor's iframe, which otherwise leaves every
     section but the hero at opacity:0 — invisible, not just un-editable. */
  .tfc-reveal { opacity: 1 !important; transform: none !important; }
""" if EDIT else ""


# ---- hero (with logo overlaid top-left) --------------------------------------
def hero() -> str:
    # The logo lives INSIDE the hero, absolutely positioned — so it sits on the
    # hero's background (not a separate white band above it) and its editor drag
    # coords are relative to the hero. It IS the headline: the old "RxKeiki" /
    # "Hawaiʻi" title text repeated what the logo already says, so it is gone
    # (Hawaiʻi stays in the badge beneath).
    logo_src = data_uri(HERE / "assets" / "rxkeiki-logo.png")
    return f"""
<div class="tfc-hero tfc-reveal"{L.sec("band.hero")}>
    <h1 class="rxk-h1">{img_el("header.logo", "rxkeiki-logo", logo_src, esc(C.text("header.logo.alt")))}</h1>
    <div class="tfc-hero-image-container">
        {img_el("hero.image", "tfc-hero-image", "https://images.squarespace-cdn.com/content/63c215f8a268791349c9f04a/1673931525935-N3GTMH2YO0HVT68BZOA0/unsplash-image-5zp0jym2w9M.jpg?content-type=image%2Fjpeg", esc(C.text("hero.image.alt")))}
    </div>
</div>"""


FACT_KEYS = ["1", "2", "3"]


def fact_tile(prefix: str, icon: str) -> str:
    """One stat tile: tinted icon, a short eyebrow, the number, a one-line label."""
    return (f'<div class="rxk-fact"><span class="rxk-fact-icon rxk-ic-{icon}" aria-hidden="true"></span>'
            f'<span class="rxk-fact-eyebrow">{C.t(f"{prefix}.eyebrow")}</span>'
            f'<span class="rxk-fact-value">{C.t(f"{prefix}.value")}</span>'
            f'<span class="rxk-fact-label">{C.t(f"{prefix}.label")}</span></div>')


def facts_strip() -> str:
    """Three headline numbers straddling the hero's bottom edge."""
    items = "".join(fact_tile(f"facts.{k}", ic) for k, ic in zip(FACT_KEYS, ("heart", "dollar", "calendar")))
    return f"""{L.spacer("facts")}<div class="rxk-facts"{L.attr("facts")}>{items}</div>"""


# ---- what is rxkids ----------------------------------------------------------
def what_is_rxkids() -> str:
    return f"""
<div class="tfc-full-width tfc-bg-white tfc-reveal"{L.sec("band.what")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("what.h2")}<h2 class="tfc-section-title"{L.attr("what.h2")}>{C.t("what.h2")}</h2>
            {L.spacer("para.what.body")}
            <p class="tfc-section-subtitle tfc-subtitle-box"{L.frame("what.body")}><span class="tfc-subtitle-eyebrow"{L.attr("what.eyebrow")}>{C.t("what.eyebrow")}</span>{C.slot_span("what.body", C("what.body"))}</p>

            <div class="rxk-feature-grid">
                {scene_tag("left", "what.scene.left")}
                {scene_tag("right", "what.scene.right")}
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
        <span class="rxk-feature-icon" aria-hidden="true"></span>
        <h3 class="tfc-scene-title">{C.t(f"{key}.title")}</h3><p>{C.t(f"{key}.body")}</p>
    </div>"""


# ---- benefits widget (6 tabs) -------------------------------------------------
BENEFIT_KEYS = ["health", "development", "housing", "food", "economic", "bonding"]
# The RxKeiki logo's rainbow, one per benefit tab (red, blue, green, orange,
# magenta, gold) — sampled from the logo PNG.
BENEFIT_COLORS = ["#EE303C", "#0083CA", "#00A84F", "#F7941D", "#AB3192", "#FFC20E"]
# White on red/blue/magenta; navy on green/orange/yellow (white on those is
# under 3.2:1). The same three headings take navy: orange and yellow on
# white are 2.2:1 and 1.6:1.
LIGHT_FILLS = {"#00A84F", "#F7941D", "#FFC20E"}
ACTIVE_FILL = {"#EE303C": "#CD2C40", "#0083CA": "#0272B9"}   # white text needs >= 4.5:1


def _benefit_rainbow_css() -> str:
    """Per-tab logo colour: an inactive tab shows its colour as a left rule;
    active, that colour fills the tab; its panel's bullets and sub-headings
    match. Gold takes dark ink for contrast; every other fill takes white."""
    out = []
    for i, col in enumerate(BENEFIT_COLORS, start=1):
        ink = "#10125A" if col in LIGHT_FILLS else "#FFFFFF"
        head = "#10125A" if col in LIGHT_FILLS else col
        out.append(
            f".tfc-benefits-tabs .tfc-benefit-tab:nth-child({i})::before {{ background: {col}; }} "
            f".tfc-benefits-tabs .tfc-benefit-tab:nth-child({i}).active::before {{ background: {ink}; }} "
            f".tfc-benefits-tabs .tfc-benefit-tab:nth-child({i}).active {{ background: {ACTIVE_FILL.get(col, col)}; border-left-color: {ACTIVE_FILL.get(col, col)}; color: {ink}; }} "
            f".tfc-benefits-display .tfc-benefit-content:nth-child({i}) .tfc-benefit-list li::before {{ color: {col}; }} "
            f".tfc-benefits-display .tfc-benefit-content:nth-child({i}) h3 {{ color: {head}; }}"
        )
    return "\n  ".join(out)


WORKS_KEYS = ["1", "2", "3", "4"]


def works_strip() -> str:
    """The guide's "Healthier Moms. Healthier Babies." message: four program
    results from its Brand Messaging page, hearts in the palette's colours."""
    items = "".join(
        f'<li class="rxk-works-{k}">{C.t(f"works.{k}")}</li>' for k in WORKS_KEYS)
    return f"""{L.spacer("works")}<div class="rxk-works"{L.attr("works")}>
                <h3 class="rxk-works-title">{C.t("works.title")}</h3>
                <p class="rxk-works-lead">{C.t("works.lead")}</p>
                <ul class="rxk-works-list">{items}</ul>
            </div>"""


def works_band() -> str:
    return f"""
<div class="tfc-full-width tfc-bg-blue rxk-works-band tfc-reveal"{L.sec("band.works")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {works_strip()}
        </div>
    </div>
</div>"""


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
<div class="tfc-full-width tfc-bg-blue tfc-reveal"{L.sec("band.stats")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("carousel.h2")}<h2 class="tfc-section-title"{L.attr("carousel.h2")}>{C.t("carousel.h2")}</h2>
            {C.html("carousel.lead", "tfc-section-subtitle")}

            <div class="tfc-carousel-container"{L.frame("panel.carousel")}>
                <button class="tfc-carousel-arrow tfc-carousel-prev" onclick="moveCarousel(-1)"{describe(C, "carousel.prev.desc", "Previous chart", role="")}>&#10094;</button>
                <button class="tfc-carousel-arrow tfc-carousel-next" onclick="moveCarousel(1)"{describe(C, "carousel.next.desc", "Next chart", role="")}>&#10095;</button>

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
    return f"""
<div class="tfc-full-width rxk-hiw-bg rxk-band-white tfc-reveal"{L.sec("band.how")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("steps.h2")}<h2 class="tfc-section-title"{L.attr("steps.h2")}>{C.t("steps.h2")}</h2>

            {L.spacer("steps.banner.amount")}
            <div class="tfc-total-banner"{L.attr("steps.banner.amount")}>
                <span class="tfc-total-label">{C.t("steps.banner.label")}</span>
                <span class="tfc-total-amount">{C.t("steps.banner.amount")}</span>
                <span class="rxk-enroll">{C.t("steps.enroll")}</span>
                <span class="rxk-sum-caption">{C.t("steps.sum.caption")}</span>
                <div class="rxk-sum">
                    <div class="rxk-sum-group rxk-sum-group--sure">
                        <div class="rxk-sum-row">
                            <div class="rxk-sum-tile rxk-sum-tile--1"><span class="rxk-sum-value">{C.t("steps.sum.1.value")}</span><span class="rxk-sum-label">{C.t("steps.sum.1.label")}</span></div>
                            <span class="rxk-sum-op rxk-sum-op--in" aria-hidden="true"></span>
                            <div class="rxk-sum-tile rxk-sum-tile--2 rxk-sum-tile--monthly"><span class="rxk-sum-value">{C.t("steps.sum.2.value")}<span class="rxk-sum-per">{C.t("steps.sum.2.per")}</span></span><span class="rxk-sum-label">{C.t("steps.sum.2.label")}</span><span class="rxk-sum-total">{C.t("steps.sum.2.total")}</span></div>
                        </div>
                        <span class="rxk-sum-note">{C.t("steps.sum.note.1")}</span>
                    </div>
                    <span class="rxk-sum-op" aria-hidden="true"></span>
                    <div class="rxk-sum-group rxk-sum-group--maybe">
                        <div class="rxk-sum-row">
                            <div class="rxk-sum-tile rxk-sum-tile--3 rxk-sum-tile--monthly"><span class="rxk-sum-value">{C.t("steps.sum.3.value")}<span class="rxk-sum-per">{C.t("steps.sum.3.per")}</span></span><span class="rxk-sum-label">{C.t("steps.sum.3.label")}</span><span class="rxk-sum-total">{C.t("steps.sum.3.total")}</span></div>
                        </div>
                        <span class="rxk-sum-note">{C.t("steps.sum.note.2")}</span>
                    </div>
                </div>
                <span class="rxk-sum-same">{C.t("steps.sum.same")}</span>
            </div>

            {L.spacer("steps.note")}<p class="tfc-steps-note"{L.attr("steps.note")}>{C.t("steps.note")}</p>

        </div>
    </div>
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


def cost_table() -> str:
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
    return f"""{L.spacer("cost.table")}<div class="rxk-cost-wrap"{L.attr("cost.table")}>
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
            <p class="rxk-cost-note"{C.slot_attr("cost.note")}>{C.text("cost.note")}</p>
        </div>"""


def cost_section() -> str:
    """The cost figures as their own band on the Funding tab (they used to sit
    behind a button on the page's single scroll). The headline total keeps the
    old button's slots, so its words and number stay editable where they were."""
    return f"""
<div class="tfc-full-width tfc-bg-blue tfc-reveal"{L.sec("band.cost")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("cost.h2")}<h2 class="tfc-section-title"{L.attr("cost.h2")}>{C.t("cost.h2")}</h2>
            {C.html("cost.lead", "tfc-section-subtitle")}
            {L.spacer("cost.button")}<div class="rxk-cost-stat"{L.attr("cost.button")}>
                <span class="rxk-cost-btn-eyebrow"{C.slot_attr("cost.button.eyebrow")}>{C.text("cost.button.eyebrow")}</span>
                <span class="rxk-cost-btn-amt"{C.slot_attr("cost.button.amt")}>{C.text("cost.button.amt")}</span>
            </div>
            {cost_table()}
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
    <div class="rxk-tl-scroll"{L.attr("tanf.timeline")}>
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
            {C.html("tanf.choice.summary", "tfc-section-subtitle tanf-choice-body")}

            <div class="tfc-expandable-section rxk-fold">
                {L.spacer("tanf.more.button")}<button class="tfc-expand-btn rxk-fold-btn" onclick="rxkToggle(this, 'tanf-more')"{L.attr("tanf.more.button")}><span{C.slot_attr("tanf.more.button")}>{C.text("tanf.more.button")}</span><span class="tfc-expand-icon">&#9660;</span></button>
                <div id="tanf-more" class="tfc-expand-content">
                    <div class="tfc-expand-inner">
                        {C.html("tanf.choice.body", "tfc-section-subtitle tanf-choice-body")}

                        <div class="tfc-tanf-compare">
                        {tanf_option_card("tanf.option1", "Option 1")}
                        {tanf_option_card("tanf.option2", "Option 2 · Recommended", free=True)}
                        </div>

                        {C.html("tanf.note", "tfc-tanf-note")}
                    </div>
                </div>
            </div>

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
    {img_el("cta.logo", "rxk-cta-logo", data_uri(HERE / "assets" / "rxkeiki-logo-white.png"), esc(C.text("header.logo.alt")))}
    {L.spacer("cta.title")}<h2{L.attr("cta.title")}>{C.t("cta.title")}</h2>
    {L.spacer("cta.body")}<p{L.attr("cta.body")}>{C.t("cta.body")}</p>
    {L.spacer("cta.link1")}<a href="https://rxkids.org/" target="_blank" class="tfc-btn"{L.attr("cta.link1")}>{C.t("cta.link1.label")}</a>
    {L.spacer("cta.link2")}<a href="https://rxkids.org/about/" target="_blank" class="tfc-btn tfc-btn-outline"{L.attr("cta.link2")}>{C.t("cta.link2.label")}</a>
    {L.spacer("partner.statement")}<p class="rxk-partner"{L.attr("partner.statement")}>{C.t("partner.statement")}</p>
</div>"""


# ---- sources ------------------------------------------------------------------
# The original page's citations were plain <a>[Source]</a> links a reader could
# click straight through; converting them to numbered [^id] superscripts (see
# BENEFIT_KEYS etc. above) needs somewhere those numbers resolve TO, or a
# reader has no way to find what "¹" refers to.
def sources_section() -> str:
    """The numbered notes live behind one bar, closed by default, so no tab ends
    in a wall of links. A footnote's popover carries its own text + link; this
    list is the full record (and opens itself for an #enN link)."""
    items = C.fn.endnote_items(L, new_tab=True)
    return f"""
<div class="tfc-full-width tfc-bg-white tfc-reveal rxk-sources"{L.sec("band.sources")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("endnotes.h2")}<h2 class="rxk-sources-h2"{L.attr("endnotes.h2")}><button type="button" class="rxk-sources-bar" aria-expanded="false" aria-controls="sources-content" onclick="rxkSources(this)"><span{C.slot_attr("endnotes.h2")}>{C.text("endnotes.h2")}</span><span class="tfc-expand-icon" aria-hidden="true">&#9660;</span></button></h2>
            <div id="sources-content" class="tfc-expand-content">
                <div class="tfc-expand-inner"><ol class="rxk-endnotes">{items}</ol></div>
            </div>
        </div>
    </div>
</div>"""


# ---- tabs: Home summary + four deeper pages, one embed -----------------------
TABS = ["home", "evidence", "funding", "bill"]
NEXT_TAB = {"evidence": "funding", "funding": "bill", "bill": "home"}


def tab_bar() -> str:
    btns = "".join(
        f'<button type="button" role="tab" class="rxk-tab" id="rxk-tab-{k}" aria-controls="rxk-panel-{k}" '
        f'aria-selected="{"true" if k == "home" else "false"}" tabindex="{"0" if k == "home" else "-1"}" data-rxk-tab="{k}">{C.t(f"tabs.{k}")}</button>'
        for k in TABS)
    return f"""{L.spacer("tabs")}<nav class="rxk-tabs" role="tablist"{describe(C, "tabs.desc", "RxKeiki sections", role="")}{L.attr("tabs")}>{btns}</nav>"""


def panel(tab: str, inner: str) -> str:
    hidden = "" if tab == "home" else " hidden"
    return (f'<section class="rxk-panel" id="rxk-panel-{tab}" role="tabpanel" '
            f'aria-labelledby="rxk-tab-{tab}"{hidden}>{inner}\n</section>')


def next_link(tab: str) -> str:
    return (f'{L.spacer(f"next.{tab}")}<div class="rxk-next"{L.attr(f"next.{tab}")}>'
            f'<button type="button" class="rxk-next-btn" data-rxk-tab="{NEXT_TAB[tab]}">'
            f'<span{C.slot_attr(f"next.{tab}")}>{C.text(f"next.{tab}")}</span></button></div>')


STAT_KEYS = ["1", "2", "3", "4"]


def evidence_stats() -> str:
    """Four headline results from the benefit bullets below it (same sources)."""
    items = "".join(fact_tile(f"evidence.stat.{k}", ic)
                    for k, ic in zip(STAT_KEYS, ("activity", "shield", "home", "smile")))
    return f"""
<div class="tfc-full-width tfc-bg-white tfc-reveal" style="padding-top:44px !important;padding-bottom:12px !important;"{L.sec("band.evstats")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("evidence.stats")}<div class="rxk-facts rxk-facts--4"{L.attr("evidence.stats")}>{items}</div>
        </div>
    </div>
</div>"""


TEASERS = ["evidence", "funding", "bill"]


def teasers() -> str:
    cards = "".join(
        f"""{L.spacer(f"teaser.{k}")}<button type="button" class="rxk-teaser" data-rxk-tab="{k}"{L.attr(f"teaser.{k}")}>
            <h3>{C.t(f"teaser.{k}.title")}</h3><p>{C.t(f"teaser.{k}.body")}</p></button>"""
        for k in TEASERS)
    return f"""
<div class="tfc-full-width tfc-bg-white tfc-reveal"{L.sec("band.teasers")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("teaser.h2")}<h2 class="tfc-section-title"{L.attr("teaser.h2")}>{C.t("teaser.h2")}</h2>
            <div class="rxk-teaser-grid">{cards}</div>
        </div>
    </div>
</div>"""


BILL_KEYS = ["1", "2", "3", "4", "5", "6"]


def bill_section() -> str:
    cards = "".join(
        f"""{L.spacer(f"bill.{k}")}<div class="rxk-bill-card"{L.attr(f"bill.{k}")}>
            <h3 class="rxk-bill-title">{C.t(f"bill.{k}.title")}</h3><p>{C.t(f"bill.{k}.body")}</p></div>"""
        for k in BILL_KEYS)
    return f"""
<div class="tfc-full-width tfc-bg-white tfc-reveal"{L.sec("band.bill")}>
    <div class="tfc-content-container">
        <div class="tfc-section" style="margin-bottom: 0;">
            {L.spacer("bill.status")}<span class="rxk-draft-pill"{L.attr("bill.status")}>{C.t("bill.status")}</span>
            {L.spacer("bill.h2")}<h2 class="tfc-section-title"{L.attr("bill.h2")}>{C.t("bill.h2")}</h2>
            {C.html("bill.lead", "tfc-section-subtitle")}
            <div class="rxk-bill-grid">{cards}</div>
            {L.spacer("bill.note")}<p class="tfc-steps-note"{L.attr("bill.note")}>{C.t("bill.note")}</p>
        </div>
    </div>
</div>"""


HOME_PANEL = f"""{hero()}
{facts_strip()}
{what_is_rxkids()}
{stats_carousel()}
{how_it_works()}
{works_band()}
{teasers()}"""

MAIN_BODY = f"""<div class="tfc-container">
{tab_bar()}
{panel("home", HOME_PANEL)}
{panel("evidence", evidence_stats() + benefits_widget() + next_link("evidence"))}
{panel("funding", tanf_section() + cost_section() + next_link("funding"))}
{panel("bill", bill_section() + next_link("bill"))}"""

# Citation numbering runs once, on the whole body assembled SO FAR — before the
# sources section exists (it has no [^id] tokens of its own, and needs the
# order this establishes to render its numbered list in the first place).
C.fn.order_by(L.endnote_order(), C.fn.cited(MAIN_BODY))

BODY = f"""{MAIN_BODY}
{sources_section()}
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
# but gives them no way to reach it. C.fn.linkify(pop=True) links each one: the
# href points at the endnote anchor, so a marker still works with JS off and in
# print, and the popover in FN_POPOVER_JS is pure enhancement on top.
NOTES = C.fn.endnotes()                          # [(text, url)] in numbered order
BODY = C.fn.linkify(BODY, pop=True)

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


SHEETS = ("".join(L.sheet(pid, BODY if pid == DESIGNED_PAGES else "")
                  for pid in L.page_order(DESIGNED_PAGES))
          + L.pagemeta(range(1, DESIGNED_PAGES + 1)))

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{C.text("title")}</title>
<meta name="description" content="{esc(C.text("title"))}: a proposed universal, no-strings cash program for Hawaiʻi moms and babies, modeled on Rx Kids.">
{FONT_LINK}
<style>
{OKINA_FACES}
  body {{ margin:0; background:#EDF1EE; }}
  .page {{ width:{L.page_w}in; min-height:{L.page_h}in; margin:0 auto;
           background:#fff; position:relative; overflow:hidden; }}
  {STYLE}
  {BRAND_CSS}
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
  .tfc-section > *:last-child:not(.rxk-feature-grid) {{ margin-bottom: 0 !important; }}
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
                    }}
  .rxk-frame {{ display: none; }}
  .rxk-inner {{ position: relative; margin: 0; background: #8E3B9C; }}
  /* The green (TANF) block: full height, its top shaped by the container's
     own curve. The orange lines are its internal cell separators, plus one on
     its right edge where it hands off to the purple. */
  .rxk-green-fill {{ position: absolute; left: 0; top: 0; height: 100%; z-index: 0;
      background:
        linear-gradient(90deg, transparent calc(25% - 1px), rgba(255,255,255,.55) calc(25% - 1px), rgba(255,255,255,.55) calc(25% + 1px), transparent calc(25% + 1px)),
        linear-gradient(90deg, transparent calc(50% - 1px), rgba(255,255,255,.55) calc(50% - 1px), rgba(255,255,255,.55) calc(50% + 1px), transparent calc(50% + 1px)),
        linear-gradient(90deg, transparent calc(75% - 1px), rgba(255,255,255,.55) calc(75% - 1px), rgba(255,255,255,.55) calc(75% + 1px), transparent calc(75% + 1px)),
        linear-gradient(90deg, transparent calc(100% - 2px), rgba(255,255,255,.55) calc(100% - 2px)),
        linear-gradient(#00A84F, #00A84F); }}
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
  .rxk-col-amt {{ font-size: 1.05rem; font-weight: 700; letter-spacing: -.2px; white-space: nowrap; }}
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
                       font-family: {FRANKLIN_HEAVY}; }}
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
                  border: 2px solid #00A84F; border-top: none;
                  border-radius: 0 0 10px 10px; }}
  .rxk-bracket-rest {{ flex: 9; }}
  .rxk-bracket-amt {{ position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
                      margin-top: 6px; white-space: nowrap;
                      color: #00A84F; font-weight: 800; font-size: 1.4rem; }}
  .tanf-choice-body {{ margin-bottom: 32px; }}
  .rxk-col--other {{ background: transparent; }}
  /* (A local `.page [style*="position:absolute"] {{ margin:0 }}` rule used to
     live here. docsync's Layout._style() now emits margin:0 itself, so every
     report on the engine gets it — see the comment there for why a margin on a
     positioned element compounds into its saved coordinate. hero.badge and
     hero.hawaii keep the coordinates that were compensated for it.) */
  {FN_CSS}
  {MODERN_CSS}
  {EDIT_OVERRIDES}
</style>
</head>
<body>
{SHEETS}
<script>
{SCRIPT}
{TAB_JS}
{COUNT_JS}
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

html = brand_colors(html)
_OUT.write_text(html)
print(f"wrote {_OUT} ({len(html):,} bytes)")
