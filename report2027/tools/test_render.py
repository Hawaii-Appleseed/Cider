#!/usr/bin/env python3
"""Render-level regression tests (run by `make -C report2027 validate`).

The one guarantee here: moving text around never breaks the LIVE PREVIEW. Cut a
sentence to paste it elsewhere and, for those few seconds, the source it cited
has nothing pointing at it. In edit mode that must NOT crash the build (it made
a routine move feel like a "critical error"); at publish time it still must, so
a source that stays orphaned — a citation typo, a real dangling def — is caught
before it ships.
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent          # report2027/tools
REPORT = HERE.parent                            # report2027
CONTENT = REPORT / "content.md"
FAILS = []


def render(content_path, edit_mode):
    """Run render_report.py against a content file; return (ok, output)."""
    env = dict(os.environ, DOCSYNC_CONTENT=str(content_path))
    if edit_mode:
        env["DOCSYNC_EDIT"] = "1"
    else:
        env.pop("DOCSYNC_EDIT", None)
    with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as f:
        env["DOCSYNC_OUT"] = f.name
    r = subprocess.run([sys.executable, "tools/render_report.py"],
                       cwd=str(REPORT), env=env, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout + r.stderr)


def check_editor_js():
    """The editor's inline <script> is one giant JS blob whose stylesheet is a
    template literal — a stray backtick or ${...} in a CSS COMMENT ends the
    literal early and kills the WHOLE script, so the editor boots to a frozen
    "loading the render engine…" with no console error the tests here would
    see. `node --check` catches it in a second. Skipped if node is absent."""
    import re
    import shutil
    if not shutil.which("node"):
        return
    edit = REPORT.parent / "docsync" / "editor" / "edit.html"
    if not edit.exists():
        return
    html = edit.read_text()
    scripts = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S)
    if not scripts:
        return
    blob = max(scripts, key=len)                      # the editor script
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(blob)
        js = f.name
    r = subprocess.run(["node", "--check", js], capture_output=True, text=True)
    os.unlink(js)
    if r.returncode != 0:
        FAILS.append("edit.html inline script has a JS syntax error (a backtick or "
                     "${...} inside the stylesheet template literal?):\n" + r.stderr.strip()[:500])


def _png_page_tests(_sv):
    """A page's PNG (INDESIGN_PARITY.md 71) through real Chrome: as wide as
    the page — a 12.5in page used to be shot in an 816px window, cropped and
    in its tablet layout — and never in the phone layout, whose rule
    (max-width: the page's own width) fired at exactly 816px and released
    every moved element into the flow. Skipped without Chrome or PIL."""
    try:
        from PIL import Image
    except ImportError:
        return
    if not Path(_sv.CHROME).exists():
        return
    import io
    d = Path(tempfile.mkdtemp(prefix="png-page-"))
    shooter = _sv.Handler.__new__(_sv.Handler)
    try:
        for w_in, x_in in ((8.5, 6), (12.5, 11)):
            html = ("<html><head><style>body{margin:0}"
                    f".page{{width:{w_in}in;height:11in;position:relative;background:#fff}}"
                    f"@media screen and (max-width:{w_in}in){{[data-placed]{{position:static!important}}}}"
                    "</style></head><body>"
                    '<section class="page"><div data-placed style="position:absolute;'
                    f'left:{x_in}in;top:5in;width:1in;height:1in;background:#f00"></div></section>'
                    "</body></html>")
            f = d / f"w{w_in}.html"
            f.write_text(_sv._page_alone(html, 1))
            png = shooter._chrome_png_one(f.resolve().as_uri(), 1, 1.0)
            if not png:
                FAILS.append(f"page PNG ({w_in}in): Chrome produced nothing")
                continue
            im = Image.open(io.BytesIO(png)).convert("RGB")
            want = (round(w_in * 96), 1056)
            px = im.getpixel((round((x_in + 0.5) * 96), round(5.5 * 96))) if im.size == want else None
            if im.size != want or px != (255, 0, 0):
                FAILS.append(f"page PNG ({w_in}in): {im.size} with {px} at the moved "
                             f"square, wanted {want} and red")
    finally:
        import shutil
        shutil.rmtree(d, ignore_errors=True)
        if _sv.WARM_CHROME[0] is not None:
            _sv.WARM_CHROME[0].close()
            _sv.WARM_CHROME[0] = None


def main():
    check_editor_js()
    src = CONTENT.read_text()
    # Pick any footnote citation the fixture has, and drop just that token so the
    # source it names is orphaned while everything else stays valid.
    # Pick a footnote whose source is cited exactly ONCE, so dropping that one
    # citation fully orphans its source (a multiply-cited source would stay
    # cited by its other references).
    import re
    from collections import Counter
    counts = Counter(re.findall(r"\[\^([a-z0-9-]+)\]", src))
    single = next((tok for tok, n in counts.items()
                   if n == 1 and f"[{tok}]:" in src), None)
    assert single, "fixture has no singly-cited footnote to test with"
    token = f"[^{single}]"
    orphaned = src.replace(token, "")            # remove the lone citation → its source is now uncited

    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(orphaned)
        draft = f.name

    ok_edit, out_edit = render(draft, edit_mode=True)
    if not ok_edit:
        FAILS.append("edit mode should TOLERATE an orphaned source (mid-move), "
                     f"but the build failed:\n{out_edit[-400:]}")

    ok_pub, out_pub = render(draft, edit_mode=False)
    if ok_pub:
        FAILS.append("publish mode should REFUSE an orphaned source, but the build passed")
    elif "never cited" not in out_pub:
        FAILS.append(f"publish failed for the wrong reason:\n{out_pub[-400:]}")

    # Sanity: the untouched fixture builds clean in publish mode.
    ok_clean, out_clean = render(CONTENT, edit_mode=False)
    if not ok_clean:
        FAILS.append(f"the untouched fixture should build, but it failed:\n{out_clean[-400:]}")

    # --- a MISTYPED citation (paste that gained a space / lost a hyphen) ------
    typoed = src.replace(token, f"[^{single.replace('-', ' ')}]")
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(typoed)
        typo_draft = f.name
    ok_edit2, out_edit2 = render(typo_draft, edit_mode=True)
    if not ok_edit2:
        FAILS.append("edit mode should TOLERATE an unknown citation id (typo mid-paste), "
                     f"but the build failed:\n{out_edit2[-400:]}")
    ok_pub2, out_pub2 = render(typo_draft, edit_mode=False)
    if ok_pub2:
        FAILS.append("publish mode should REFUSE an unknown citation id, but the build passed")
    elif "has no entry under [[sources]]" not in out_pub2:
        FAILS.append(f"typo'd citation failed publish for the wrong reason:\n{out_pub2[-400:]}")
    os.unlink(typo_draft)

    # --- cutting the LAST bullet out of a card (mid-move empty list) ----------
    import re as _re
    m2 = _re.search(r"\[\[[a-z0-9.]+\.bullets\]\]\n(- [^\n]*\n)\n", src)
    if m2:
        emptied = src.replace(m2.group(1), "", 1)
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
            f.write(emptied)
            empty_draft = f.name
        ok_edit3, out_edit3 = render(empty_draft, edit_mode=True)
        if not ok_edit3:
            FAILS.append("edit mode should TOLERATE an emptied bullet list (mid-move), "
                         f"but the build failed:\n{out_edit3[-400:]}")
        ok_pub3, _ = render(empty_draft, edit_mode=False)
        if ok_pub3:
            FAILS.append("publish mode should REFUSE an empty bullet list, but the build passed")
        os.unlink(empty_draft)

    os.unlink(draft)

    # A PDF of some pages (INDESIGN_PARITY.md 83): the range is parsed and
    # checked before a build; the sheets left out are hidden, not removed, so
    # page numbers count as they do in the whole report.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import serve as _sv
    for spec, n, want in (("3", 5, [3]), ("2-4", 5, [2, 3, 4]), (" 1, 4-5 ", 5, [1, 4, 5]),
                          ("6", 5, "the report has 5 pages"), ("4-2", None, "not a range"),
                          ("a", None, "a range like"), ("0", None, "from 1 upward")):
        got = _sv._parse_pages(spec, n)
        if not (got == want if isinstance(want, list) else isinstance(got, str) and want in got):
            FAILS.append(f"_parse_pages({spec!r}, {n}) = {got!r}, wanted {want!r}")
    html = ("<html><head></head><body>" + "".join(
        f'<section class="page" data-page="{i}"><p>{{p{i}}}</p></section>' for i in range(1, 5)) + "</body></html>")
    only = _sv._only_pages(html, [2, 3])
    if (only.count("data-ds-skip class=\"page") != 2 or only.count('<section class="page"') != 2
            or "section.page[data-ds-skip]{display:none" not in only.split("</head>")[0]):
        FAILS.append("_only_pages should hide pages 1 and 4 and keep 2 and 3:\n" + only)
    alone = _sv._page_alone(html, 3)
    if (alone.count("data-ds-skip class=\"page") != 3 or "body>:not(section.page):not(:has(section.page))" not in alone
            or alone.index("section.page{margin:0") > alone.index("</head>")):
        FAILS.append("_page_alone should keep page 3 alone at the top-left:\n" + alone[:400])
    _png_page_tests(_sv)
    for req, msg in (({"pages": "2-x"}, "a range like"), ({"fmt": "png", "pages": "2"}, "for a PDF"),
                     ({"pages": "2-3"}, None), ({"pages": ""}, None)):
        got = _sv._export_bad_args(req)
        if (msg is None) != (got is None) or (msg and msg not in got):
            FAILS.append(f"_export_bad_args({req}) = {got!r}, wanted {msg!r}")

    # The library of pieces (INDESIGN_PARITY.md 50): add replaces by name,
    # delete takes one out, a bad piece is refused, and the file is atomic.
    lib = Path(tempfile.mkdtemp()) / "lib.json"
    old_env = os.environ.get("CIDER_LIBRARY"), os.environ.pop("PRIMER_TEST_SAFE", None)
    os.environ["CIDER_LIBRARY"] = str(lib)
    try:
        r1 = _sv._library_change({"op": "add", "piece": {"name": "A", "items": [{"kind": "box", "data": {}}]}})
        r2 = _sv._library_change({"op": "add", "piece": {"name": "A", "items": [{"kind": "shape", "data": {}}]}})
        r3 = _sv._library_change({"op": "add", "piece": {"name": "B", "items": []}})
        r4 = _sv._library_change({"op": "delete", "name": "A"})
        if not (r1["ok"] and len(r2["pieces"]) == 1 and r2["pieces"][0]["items"][0]["kind"] == "shape"
                and not r3["ok"] and r4["ok"] and r4["pieces"] == [] and _sv._library_read() == []):
            FAILS.append(f"library add/replace/refuse/delete went wrong: {r1} {r2} {r3} {r4}")
    finally:
        if old_env[0] is None:
            os.environ.pop("CIDER_LIBRARY", None)
        else:
            os.environ["CIDER_LIBRARY"] = old_env[0]
        if old_env[1] is not None:
            os.environ["PRIMER_TEST_SAFE"] = old_env[1]

    if FAILS:
        print("RENDER TESTS FAILED:\n" + "\n\n".join(FAILS))
        sys.exit(1)
    print("render tests passed")


if __name__ == "__main__":
    main()
