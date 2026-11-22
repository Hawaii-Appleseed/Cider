#!/usr/bin/env python3
"""Move one area of docsync/editor/edit.html into docsync/editor/parts/.

    python3 tools/editor-extract.py parts/pdf.js \\
        --from '// ---------------------------------------------- a PDF made in the browser' \\
        --to   '// =========================== pilot API'

The area is the lines from the first line that starts with --from up to (not
including) the first line after it that starts with --to. They go to the part
file unchanged, and one include line takes their place: `//@include parts/x.js`
for a .js part, `/*@include parts/x.css*/` for a .css one. The editor a browser
gets (docsync/editor_source.py) is then byte for byte what it was, and this
refuses to write anything if it would not be.

Moving an area out changes nothing at run time: the part is inlined back into
the same <script> (or <style>) at the same place, so hoisting, globals and the
order things run in are as they were. See docsync/editor_source.py.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from docsync.editor_source import EDITOR, assembled, assemble  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("part", help="parts/<name>.js or parts/<name>.css")
    ap.add_argument("--from", dest="start", required=True, help="the area's first line starts with this")
    ap.add_argument("--to", dest="end", required=True, help="the line after the area starts with this")
    a = ap.parse_args()

    if not a.part.startswith("parts/") or Path(a.part).suffix not in (".js", ".css"):
        ap.error("the part is parts/<name>.js or parts/<name>.css")
    dst = EDITOR.parent / a.part
    if dst.exists():
        ap.error(f"{dst.relative_to(ROOT)} already exists")

    text = EDITOR.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    try:
        i = next(k for k, l in enumerate(lines) if l.startswith(a.start))
        j = next(k for k in range(i + 1, len(lines)) if lines[k].startswith(a.end))
    except StopIteration:
        print("editor-extract: --from or --to matched no line", file=sys.stderr)
        return 1
    body = "".join(lines[i:j])
    inc = f"//@include {a.part}\n" if a.part.endswith(".js") else f"/*@include {a.part}*/\n"
    new = "".join(lines[:i]) + inc + "".join(lines[j:])

    before = assembled()
    parts = {a.part: body}
    after = assemble(new, lambda n: parts.get(n) if n in parts else
                     ((EDITOR.parent / n).read_text(encoding="utf-8") if (EDITOR.parent / n).is_file() else None))
    if after != before:
        print("editor-extract: the assembled editor would change; nothing written", file=sys.stderr)
        return 1
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(body, encoding="utf-8")
    EDITOR.write_text(new, encoding="utf-8")
    print(f"editor-extract: lines {i + 1}-{j} ({j - i} lines) -> docsync/editor/{a.part}; "
          f"edit.html is now {len(new.splitlines())} lines")
    return 0


if __name__ == "__main__":
    sys.exit(main())
