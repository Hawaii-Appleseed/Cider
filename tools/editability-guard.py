#!/usr/bin/env python3
"""Stop an edit that makes something on a report uneditable, when it is made.

docsync.check knows whether every visible thing on a report has a handle
(strict bindings fail on any finding; the rest may not get worse than
docsync/editability-baseline.json). CI ran it after the fact, on its own,
with nothing requiring it. This runs it at the two moments a change is made:

  --hook    Claude Code's PostToolUse hook (.claude/settings.json). After an
            Edit/Write to a renderer, a project's content or layout, the
            engine or docsync.yml, check the reports that file feeds. A
            finding comes back to Claude as a blocking message (exit 2), so it
            gives the thing a handle before it goes on, not after a push.
  --staged  The git pre-commit hook (.githooks/pre-commit): the same check for
            the reports the staged files feed; a finding refuses the commit.
            This catches every committer, Claude or not.

What a file feeds: a binding's content, layout, renderer, the renderer's
project folder and engine files feed that binding; docsync/*.py (not the
editor), docsync.yml and the baseline feed every binding. Anything else feeds
none, and the guard says nothing.

Exit codes: 0 clean or nothing to check; 2 (hook) / 1 (staged) a finding.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def _rel(p) -> str | None:
    try:
        return Path(p).resolve().relative_to(ROOT).as_posix()
    except (ValueError, OSError):
        return None


def bindings_for(paths: list[str]) -> list[str]:
    from docsync.registry import load_registry
    bindings = load_registry()
    every = [b.id for b in bindings if b.editor is not None and b.editor.render]
    rels = [r for r in (_rel(p) for p in paths) if r]
    if not rels:
        return []
    engine = lambda r: ((r.startswith("docsync/") and r.endswith(".py")
                         and not r.startswith("docsync/editor/"))
                        or r in ("docsync.yml", "docsync/editability-baseline.json"))
    if any(engine(r) for r in rels):
        return every
    hit = []
    for b in bindings:
        if b.editor is None or not b.editor.render:
            continue
        ed = b.editor
        owned = {_rel(x) for x in [b.content, ed.render, ed.layout, ed.out, *(ed.engine or [])] if x}
        folder = _rel(Path(ed.render).parent)
        # report2027/ is the Budget Primer fixture: its renderer sits in tools/
        if folder and folder.endswith("/tools"):
            folder = folder.rsplit("/", 1)[0]
        if any(r in owned or (folder and r.startswith(folder + "/")) for r in rels):
            hit.append(b.id)
    return hit


def run_check(ids: list[str]) -> tuple[int, str]:
    args = [sys.executable, "-m", "docsync.check"]
    for i in ids:
        args += ["--id", i]
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def summary(out: str) -> str:
    keep = [l for l in out.splitlines()
            if l.startswith("FAIL") or "ERROR" in l]
    return "\n".join(keep[:40])


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else "--hook"
    if mode == "--hook":
        try:
            ev = json.load(sys.stdin)
        except ValueError:
            return 0
        ti = ev.get("tool_input") or {}
        paths = [ti.get("file_path") or ti.get("notebook_path") or ""]
    elif mode == "--staged":
        r = subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
                           cwd=ROOT, capture_output=True, text=True)
        paths = [str(ROOT / p) for p in r.stdout.split()]
    else:
        print(__doc__)
        return 0
    try:
        ids = bindings_for([p for p in paths if p])
    except Exception as e:                  # a broken registry is not this hook's to report
        print(f"editability-guard: skipped ({e})", file=sys.stderr)
        return 0
    if not ids:
        return 0
    code, out = run_check(ids)
    if code == 0:
        return 0
    msg = (f"docsync.check found a problem on {', '.join(ids)} after this change:\n"
           f"{summary(out)}\n"
           "Every visible thing on a report needs a handle — a slot, a movable, "
           "C.derived, a chart, a real table (the report-editor skill). Fix it "
           "rather than listing it in editability_ok or raising the baseline.")
    print(msg, file=sys.stderr)
    return 2 if mode == "--hook" else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
