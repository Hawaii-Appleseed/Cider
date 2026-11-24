#!/usr/bin/env python3
"""Bring the hub's fact ledger into docsync/ledger/.

The staff hub holds the fact ledger (its Facts page, a D1 store; the hub's
README, "Facts"). Editors on the hub read it live, but local editors, the
engine's own checks and every build GitHub makes (publish-sites.yml, the
editor suite) read the files in docsync/ledger/, so those files are brought
up to date from the hub: the hub's workflow `facts-to-cider.yml` fetches
/api/facts/area/<area>.json for every area into a folder, runs this over it
and pushes the result to the branch `hub-facts`, which `hub-facts.yml` here
turns into a pull request that merges itself once the gate passes.

    python3 tools/ledger_from_hub.py FETCHED_DIR [--ledger docsync/ledger]

Writes only an area whose facts changed (the files are partly hand-formatted;
an unchanged one is left byte for byte), keeps the order the file already has
and adds new facts after it, and prints one line per change. Refuses, writing
nothing, when:

  - a fetched file is missing or is not that area's,
  - the result would not load in docsync/ledger.py (a bad ledger stops every
    build at once), or
  - a fact this ledger has is missing from the hub. The hub cannot delete a
    fact, so that means the store answered wrong (emptied, a fallback, a bug),
    and copying it would take numbers out from under every report that uses
    them.

Exit 0 with nothing printed: already in step. Exit 0 with lines: written.
Exit 1: refused, and why.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from docsync import ledger as L  # noqa: E402


class Refused(Exception):
    pass


def _read(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def merged(area: str, mine: dict | None, theirs: dict) -> dict:
    """The hub's facts for one area, in this file's order, new ones after."""
    if not isinstance(theirs, dict) or theirs.get("area") != area or not isinstance(theirs.get("facts"), list):
        raise Refused(f"{area}.json from the hub is not the {area} file")
    hub = {f.get("id"): f for f in theirs["facts"] if isinstance(f, dict)}
    order = [f.get("id") for f in (mine or {}).get("facts") or []]
    gone = [i for i in order if i not in hub]
    if gone:
        raise Refused(f"{area}: the hub has no {', '.join(gone)}; it cannot delete a fact, "
                      "so its answer is wrong. Nothing written.")
    ids = order + [i for i in hub if i not in order]
    return {"area": area, "name": L.AREAS[area], "facts": [hub[i] for i in ids]}


def changes(area: str, mine: dict | None, new: dict) -> list[str]:
    """One line per fact that moved, for the commit and the pull request."""
    old = {f["id"]: f for f in (mine or {}).get("facts") or []}
    out = []
    for f in new["facts"]:
        o = old.get(f["id"])
        if o is None:
            out.append(f"+ {f['id']} ({area}): {f.get('shown') or f.get('value')}, {f.get('status', 'proposed')}")
        elif o != f:
            what = []
            if o.get("value") != f.get("value"):
                what.append(f"{o.get('shown') or o.get('value')} -> {f.get('shown') or f.get('value')}")
            if o.get("status") != f.get("status"):
                what.append(f"now {f.get('status')}")
            out.append(f"~ {f['id']} ({area}): {'; '.join(what) or 'details'}")
    return out


def sync(fetched: Path, ledger_dir: Path) -> list[str]:
    """Write the hub's ledger over ledger_dir. Returns the change lines."""
    plan: dict[str, dict] = {}
    lines: list[str] = []
    for area in L.AREAS:
        theirs = _read(fetched / f"{area}.json")
        if theirs is None:
            raise Refused(f"no {area}.json from the hub. Nothing written.")
        mine = _read(ledger_dir / f"{area}.json")
        new = merged(area, mine, theirs)
        if mine is not None and mine.get("facts") == new["facts"] and mine.get("area") == area:
            continue
        plan[area] = new
        lines += changes(area, mine, new) or [f"~ {area}.json: written"]
    if not plan:
        return []
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        for area in L.AREAS:
            body = plan.get(area) or _read(ledger_dir / f"{area}.json") or {"area": area, "name": L.AREAS[area], "facts": []}
            (t / f"{area}.json").write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        try:
            L.load(t)
        except L.LedgerError as e:
            raise Refused(f"the hub's ledger would not load here: {e}. Nothing written.") from None
    for area, body in plan.items():
        (ledger_dir / f"{area}.json").write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return lines


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("fetched", type=Path)
    ap.add_argument("--ledger", type=Path, default=L.DIR)
    a = ap.parse_args(argv)
    try:
        for line in sync(a.fetched, a.ledger):
            print(line)
    except Refused as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
