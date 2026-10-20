#!/usr/bin/env python3
"""Publish the Cider project as the Estimates site's credits page.

    python3 projects/wfc-credits/publish_site.py --site ~/Census-Forecaster/site
    python3 projects/wfc-credits/publish_site.py --site ~/Census-Forecaster/site --write

The project's own build (render_report.py) wraps the page in a fixed-width
editor sheet and drops the site's web fonts, so it is not what gets published.
This takes the page's content from the project as the site's own markup
(WFC_SITE=1: the site's tables and endnotes, the document's slot text and
citations) and puts it inside the site's existing page shell, so the published
page keeps its fonts, stylesheet links, responsive layout and head.

Without --write it only reports how the result differs from the live file.
"""
from __future__ import annotations

import argparse
import base64
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOGOS = ("appleseed-logo-cropped.png", "appleseed-footer-logo-white.png")


def render(out: Path) -> str:
    env = dict(os.environ, WFC_SITE="1", DOCSYNC_OUT=str(out))
    env.pop("DOCSYNC_EDIT", None)
    subprocess.run([sys.executable, str(HERE / "render_report.py")], env=env, check=True,
                   stdout=subprocess.DEVNULL)
    return out.read_text(encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", required=True, type=Path, help="the Census-Forecaster site/ directory")
    ap.add_argument("--write", action="store_true", help="overwrite site/working-family-credits/index.html")
    args = ap.parse_args()
    target = args.site / "working-family-credits" / "index.html"
    shell = target.read_text(encoding="utf-8")

    with tempfile.TemporaryDirectory() as td:
        built = render(Path(td) / "page.html")
    inner = re.search(r'<section class="page"[^>]*>(.*)</section>\s*</body>', built, re.S).group(1)
    # The editor's mobile-layout rules for placed objects ride along at the end of
    # the sheet; the site has none, so they are dropped rather than published.
    inner = re.sub(r"\s*<style>@media screen and \(max-width:12\.5in\).*?</style>\s*\Z", "", inner, flags=re.S)
    for name in LOGOS:       # the project carries the logos inline; the site links them
        data = base64.b64encode((args.site / "assets" / name).read_bytes()).decode()
        inner = inner.replace("data:image/png;base64," + data, "../assets/" + name)
    inner = inner.replace('href="https://hawaii-appleseed.github.io/Census-Forecaster/"', 'href="../index.html"')

    m = re.search(r"(<body[^>]*>)(.*)(</body>)", shell, re.S)
    out = shell[:m.start(2)] + "\n" + inner.strip("\n") + "\n" + shell[m.end(2):]
    if out == shell:
        print("no change: the project and the live page agree")
        return
    print(f"{len(shell):,} -> {len(out):,} bytes")
    if args.write:
        target.write_text(out, encoding="utf-8")
        print(f"wrote {target}")


if __name__ == "__main__":
    main()
