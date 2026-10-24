#!/usr/bin/env python3
"""Export through a real Chrome: the long-page PNG and the cold pageless PDF.

Two limits left by the export PRs (#28-#34):

* `/__export` PNG was clipped at 16000 device px, so a long pageless page at
  scale 2 came out with its bottom cut off. The shot is now taken in strips
  and joined (serve._stitch_pngs). Checked here by the page's own colour bands
  at the bottom and across every seam, and the stitcher alone against strips
  whose first rows use every PNG filter.
* the cold pageless PDF fallback (what runs when the warm Chrome fails) was
  never exercised. This forces it and requires ONE page of the measured size.

Needs PyMuPDF (`pip install pymupdf`, as CI has it) and a Chrome (CHROME_BIN,
the default Chrome.app, or Playwright's); the Chrome parts skip without one.

Run directly:  python3 report2027/tools/test_export_chrome.py
"""
import glob
import importlib.util
import os
import struct
import sys
import tempfile
import zlib
from pathlib import Path


HERE = Path(__file__).resolve().parent
FAILS = []


def check(label, got, want):
    ok = got == want
    print(("ok   " if ok else "FAIL ") + label + ("" if ok else f"  got {got!r} want {want!r}"))
    if not ok:
        FAILS.append(label)


def load_serve():
    spec = importlib.util.spec_from_file_location("serve_under_test", HERE / "serve.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def find_chrome(serve):
    cands = [os.environ.get("CHROME_BIN"), serve.CHROME]
    cands += glob.glob(os.path.expanduser("~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/*.app/Contents/MacOS/*"))
    cands += glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome"))
    return next((c for c in cands if c and Path(c).is_file() and os.access(c, os.X_OK)), None)


# ---- the stitcher alone ----------------------------------------------------
def png_tile(rows, w, ftypes, ctype=6):
    """A PNG whose row r is filtered with ftypes[r % len(ftypes)]."""
    bpp = 4 if ctype == 6 else 3
    raw, prev = b"", bytes(w * bpp)
    for r, row in enumerate(rows):
        f = ftypes[r % len(ftypes)]
        out = bytearray()
        for i, v in enumerate(row):
            a = row[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 0:
                p = 0
            elif f == 1:
                p = a
            elif f == 2:
                p = b
            elif f == 3:
                p = (a + b) // 2
            else:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                p = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
            out.append((v - p) & 255)
        raw += bytes([f]) + bytes(out)
        prev = row

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, len(rows), 8, ctype, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def stitch_alone(serve):
    import random
    import fitz
    rnd = random.Random(7)
    w = 9
    for ctype in (6, 2):
        bpp = 4 if ctype == 6 else 3
        for f in range(5):
            tiles_rows = [[bytes(rnd.randrange(256) for _ in range(w * bpp)) for _ in range(6)]
                          for _ in range(3)]
            tiles = [png_tile(rows, w, [f, 2, 4, 3, 1], ctype) for rows in tiles_rows]
            got = fitz.Pixmap(serve._stitch_pngs(tiles))
            ref = b"".join(fitz.Pixmap(t).samples for t in tiles)    # each strip as a decoder reads it
            same = (got.width, got.height) == (w, 18) and got.samples == ref
            check(f"stitch: strips whose first rows use filter {f} (colour type {ctype}) join exactly", same, True)


# ---- a long page through a real Chrome ---------------------------------------
BANDS = ["#d00", "#0a0", "#00d", "#da0", "#0aa", "#a0a", "#555", "#fa5"]
LONG_PX = 24000


def long_html(path):
    # pageless, 8 bands that tile the sheet, so a cut-off or a misplaced seam shows
    bands = "".join(f'<div style="height:{LONG_PX // len(BANDS)}px;background:{c}"></div>' for c in BANDS)
    path.write_text(f"""<!doctype html><meta charset=utf-8><style>@page{{size:8in auto;margin:0}}
html,body{{margin:0}}.page{{width:8in;display:block}}</style>
<body><section class="page">{bands}</section></body>""")


def hexrgb(c):
    c = c.lstrip("#")
    return tuple(int(ch * 2, 16) for ch in c)


def png_long(serve, tmp):
    f = tmp / "long.html"
    long_html(f)
    scale = 2.0
    c = serve._WarmChrome()
    try:
        data = c.png(f.resolve().as_uri(), scale)
    finally:
        c.close()
    import fitz        # only now: once imported it holds fds 3-6, and the warm Chrome's
    pm = fitz.Pixmap(data)     # pipe plumbing (pass_fds=(3, 4)) then fails to launch
    check("long png: full width at scale 2", pm.width, 768 * 2)
    check("long png: full height, not cut at 16000", pm.height, LONG_PX * 2)
    band = LONG_PX // len(BANDS) * 2
    bad = []
    for i, col in enumerate(BANDS):
        for y in (i * band + 3, (i + 1) * band - 4):        # just inside both edges of each band
            px = tuple(pm.pixel(10, min(y, pm.height - 1)))[:3]
            if max(abs(a - b) for a, b in zip(px, hexrgb(col))) > 3:
                bad.append((y, px, col))
    check("long png: every band (every strip and seam) is the right colour", bad, [])


# ---- the cold pageless PDF ---------------------------------------------------
def pageless_cold(serve, tmp):
    h = 3100
    f = tmp / "pageless.html"
    f.write_text(f"""<!doctype html><meta charset=utf-8><style>@page{{size:8in auto;margin:0}}
html,body{{margin:0}}.page{{width:8in;height:{h}px;background:linear-gradient(#fcc,#ccf)}}</style>
<body><section class="page"><p style="margin:0;padding:20px">pageless</p></section></body>""")
    f.write_text(serve._size_pageless(f.read_text()))
    serve._warm_pdf = lambda *a, **k: None             # force the one-shot launch
    serve.WARM_CHROME[0] = None

    class Stub:
        _chrome_capture = serve.Handler._chrome_capture
    data = serve.Handler._chrome_pdf(Stub(), f)
    check("cold pdf: warm Chrome was bypassed", serve.WARM_CHROME[0], None)
    import fitz
    doc = fitz.open(stream=data, filetype="pdf")
    check("cold pdf: exactly one page", doc.page_count, 1)
    r = doc[0].rect
    check("cold pdf: page is the sheet's width (8in = 576pt)", round(r.width), 576)
    check("cold pdf: page is the sheet's height (within 2px of the content)", abs(r.height - h * 0.75) <= 3, True)
    check("cold pdf: the text is on that page", "pageless" in doc[0].get_text(), True)


# ---- the web-page reports, as File ▸ Export makes them ---------------------
# our-mission, wfc-credits, rxkids and tfc-2027-priorities are 12.5in pageless
# sheets. Their PDFs used to be mostly blank Letter pages (a 160in sheet, then
# a Letter pagination of the phone reflow) set in the fallbacks for Manrope,
# Poppins and Libre Franklin, with our-mission's hero a hole where a WebGL
# canvas did not print. The real export path — the publish render, the fonts
# carried inline, the measuring script, the warm Chrome — must give ONE sheet
# at the design width, as tall as its content, with most of the text in the
# faces the page names (a web font Chrome embeds comes out as a Type3 font;
# a fallback keeps its own name).
WEB_PAGES = {
    # id: (height range in inches, families most text must be in)
    "our-mission": ((15, 40), ("Type3", "Poppins", "Manrope")),
    "wfc-credits": ((40, 120), ("Type3", "Poppins", "Manrope")),
    "rxkids": ((40, 200), ("Type3", "LibreFranklin", "Georgia")),   # print stacks all four tabs
    "tfc-2027-priorities": ((20, 60), ("Type3", "Poppins", "Manrope")),
}


def web_pages(serve, tmp):
    import subprocess
    import fitz
    root = HERE.parent.parent
    for pid, (hrange, fams) in WEB_PAGES.items():
        proj = root / "projects" / pid
        if not (proj / "render_report.py").is_file():
            print(f"skip {pid}: not in this checkout")
            continue
        out = proj / f"__export-test-{os.getpid()}.html"      # beside its assets, as the export does
        try:
            env = {**os.environ, "DOCSYNC_OUT": str(out)}
            env.pop("DOCSYNC_EDIT", None)
            r = subprocess.run([sys.executable, str(proj / "render_report.py")], cwd=str(root), env=env,
                               capture_output=True, text=True)
            check(f"{pid}: the publish render builds", r.returncode, 0)
            if r.returncode:
                continue
            html = serve._inline_webfonts(out.read_text())
            check(f"{pid}: the export carries its web fonts (no Google Fonts <link> left)",
                  bool(serve.FONT_LINK_RE.search(html)), False)
            out.write_text(serve._size_pageless(html))
            data = serve._warm_pdf(out, 1200)
            check(f"{pid}: the warm Chrome printed it", data is not None, True)
            if not data:
                continue
            doc = fitz.open(stream=data, filetype="pdf")
            check(f"{pid}: one continuous sheet", doc.page_count, 1)
            rect = doc[0].rect
            check(f"{pid}: the sheet is the design width (12.5in)", round(rect.width / 72, 2), 12.5)
            check(f"{pid}: the sheet is as tall as its content ({rect.height / 72:.1f}in)",
                  hrange[0] <= rect.height / 72 <= hrange[1], True)
            chars, right = 0, 0
            for b in doc[0].get_text("dict")["blocks"]:
                for line in b.get("lines", []):
                    for sp in line["spans"]:
                        n = len(sp["text"].strip())
                        chars += n
                        if any(f in sp["font"] for f in fams):
                            right += n
            check(f"{pid}: the text is set in the page's own faces ({right}/{chars} characters)",
                  chars > 500 and right / max(chars, 1) >= 0.9, True)
        finally:
            out.unlink(missing_ok=True)
    if serve.WARM_CHROME[0] is not None:
        serve.WARM_CHROME[0].close()
        serve.WARM_CHROME[0] = None


def main():
    serve = load_serve()
    chrome = find_chrome(serve)
    if not chrome:
        print("skip chrome parts: no Chrome found (set CHROME_BIN)")
    else:
        serve.CHROME = chrome
        with tempfile.TemporaryDirectory(prefix="export-chrome-") as t:
            png_long(serve, Path(t))
            web_pages(serve, Path(t))
            pageless_cold(serve, Path(t))
    stitch_alone(serve)
    print("FAILED: " + ", ".join(FAILS) if FAILS else "all ok")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
