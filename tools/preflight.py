#!/usr/bin/env python3
"""Make a fresh clone runnable, and say plainly what is missing when it is not.

    python3 tools/preflight.py        # run directly, or via `make -C report2027 setup`

Everything here is idempotent and safe to run on every `make live`. It exists
because the two things a new clone needs were documented in places you only
read after something already went wrong: the Python dependency (discovered by
a traceback) and the vendoring git hook (discovered by engine changes silently
not reaching the repos that vendor them).
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIN_PY = (3, 10)


def ok(msg: str) -> None:
    print(f"  \033[32m✓\033[0m {msg}")


def warn(msg: str) -> None:
    print(f"  \033[33m!\033[0m {msg}")


def check_python() -> bool:
    if sys.version_info < MIN_PY:
        warn(f"Python {'.'.join(map(str, MIN_PY))}+ required "
             f"(this is {sys.version.split()[0]}) — the tooling uses 3.10 syntax")
        return False
    ok(f"Python {sys.version.split()[0]}")
    return True


def check_pyyaml() -> bool:
    try:
        import yaml  # noqa: F401
    except ImportError:
        warn("PyYAML is missing — docsync.yml cannot be read.\n"
             "      python3 -m pip install -r requirements.txt")
        return False
    ok("PyYAML")
    return True


def check_hook() -> bool:
    """Arm .githooks if this checkout has not chosen a hooks path yet. Never
    overrides one someone set deliberately."""
    if not (ROOT / ".git").exists():
        return True                     # a tarball, not a checkout: nothing to arm
    cur = subprocess.run(["git", "-C", str(ROOT), "config", "--get", "core.hooksPath"],
                         capture_output=True, text=True).stdout.strip()
    if cur == ".githooks":
        ok("vendoring hook armed (core.hooksPath=.githooks)")
        return True
    if cur:
        warn(f"core.hooksPath is '{cur}', not '.githooks' — leaving it alone. "
             "Engine changes will not vendor automatically.")
        return True
    subprocess.run(["git", "-C", str(ROOT), "config", "core.hooksPath", ".githooks"],
                   check=False)
    ok("vendoring hook armed (core.hooksPath=.githooks)")
    return True


def check_registry() -> bool:
    """A per-machine projects.json is optional — without it every report in
    docsync.yml is still served, you just lose the start-page grid."""
    reg = ROOT / "docs" / "primer" / "projects.json"
    if reg.exists():
        ok("editor registry (docs/primer/projects.json)")
    else:
        ok("no docs/primer/projects.json — serving every report in docsync.yml "
           "(copy projects.example.json to customise the start page)")
    return True


def check_chrome() -> bool:
    """PDF export shells out to Chrome. Everything else works without it, so
    this is never fatal."""
    import os
    cand = [os.environ.get("CHROME_BIN"),
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            shutil.which("google-chrome"), shutil.which("chromium"),
            shutil.which("chromium-browser")]
    if any(c and Path(c).exists() for c in cand if c):
        ok("Chrome (PDF export)")
    else:
        warn("no Chrome found — everything works except PDF/PNG export. "
             "Set CHROME_BIN to point at one.")
    return True


def main() -> int:
    print("Cider preflight")
    hard = [check_python(), check_pyyaml()]
    check_hook()
    check_registry()
    check_chrome()
    if not all(hard):
        print("\n  Fix the items marked ! above, then try again.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
