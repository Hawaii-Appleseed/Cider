#!/usr/bin/env python3
"""PreToolUse guard: keep Claude out of report TEMPLATE CODE unless it was unlocked.

Why (2026-10-28): Devin asked to restyle one box in the UHERO summary. Claude
treated it as a code change: edited the report's render_report.py, opened a Cider
worktree and pull request, pushed the hub. A document change belongs in the
document: the hub connector's edit_report / arrange_report, run through the open
editor. This hook makes the code path refuse by default.

The same file ships in three places, so it works with nothing to install:
  - Cider and the staff hub carry it in .claude/hooks/, wired in each repo's
    .claude/settings.json (applies to anyone running Claude Code in a clone)
  - Devin's ~/.claude/scripts/ copy covers sessions started outside the repos

Guarded, relative to the repo (any clone name) or under a primer-editor* /
staff-updates-internal* folder:
  - a report's template:   projects/<id>/render_report.py, projects/<id>/layout.json
  - the engine:            docsync/**, primer/<id>/engine/**
  - the hub's editor:      primer/edit.html, primer/collab-client.js
Fires on:
  - Write / Edit / MultiEdit / NotebookEdit of a guarded file
  - Bash that writes to one (sed -i, cp/mv/tee/redirect, a script that names it
    and writes) or starts the code path (cider-wt / tools/wt new|land,
    python3 -m docsync.hub without --dry-run)
Reading code and running a renderer to preview stay allowed.

Unlock: .claude/hooks/allow-template [minutes|off|status] in either repo
(default 120 minutes; one window per person, in ~/.cache). Only the person
opens it, never Claude. A deny is used, not ask: "ask" does not prompt in
bypassPermissions sessions.
"""
import json
import os
import re
import sys
import time

# GUARD_TEMPLATE_WINDOW replaces the window file in tests.
WINDOW = os.environ.get("GUARD_TEMPLATE_WINDOW") or os.path.expanduser("~/.cache/cider-wt/allow-template")
HOME = os.path.expanduser("~")

CODE = (r"(?:projects/[^/\s'\"]+/(?:render_report\.py|layout\.json)"
        r"|docsync/[^\s'\"]*"
        r"|primer/[^/\s'\"]+/engine/[^\s'\"]*"
        r"|primer/(?:edit\.html|collab-client\.js))")
REL = re.compile(r"^" + CODE, re.I)                                   # a repo-relative path
NAMED = re.compile(r"(?:primer-editor|staff-updates-internal)[^/\s'\"]*/(?:.*/)?" + CODE, re.I)
IN_CMD = re.compile(r"(?:^|[\s'\"=/(])" + CODE, re.I)                 # a code path inside a command
BARE = re.compile(r"(?<![\w./-])(?:render_report\.py|layout\.json|edit\.html)\b", re.I)

CODE_PATH_CMDS = re.compile(
    r"(?:cider-wt|tools/wt)\s+(?:new|land)\b"
    r"|-m\s+docsync\.hub\b(?![^;&|\n]*--dry-run)",
    re.I,
)
WRITES = re.compile(
    r"\bsed\s+-i|\btee\b|\bcp\b|\bmv\b|\brsync\b|\bpatch\b|\bgit\s+(?:apply|checkout\s+\S+\s+--)"
    r"|>\s*\S|\.write\(|write_text\(|open\([^)]*['\"]w",
    re.I,
)
PREVIEW = re.compile(r"^\s*(?:\S+=\S+\s+)*python3\s+\S*render_report\.py\s*(?:[;&|]|$)", re.I)


def unlocked() -> bool:
    try:
        return int(open(WINDOW).read().strip() or 0) > time.time()
    except (OSError, ValueError):
        return False


def deny(what: str) -> None:
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": (
            f"BLOCKED: {what}. This is report TEMPLATE / ENGINE code, locked by default. "
            "A change to a report's words, look or layout goes through the document instead: "
            "the hub connector's read_report, then edit_report (text) or arrange_report "
            "(remove, place, recolor, setStyle, addShape, charts, tables) while the report is "
            "open in the editor. If the editor truly cannot do it, say so to the user and ask; "
            "only the user unlocks code edits, by running .claude/hooks/allow-template in the "
            "Cider or hub repo (a 2-hour window). Do not open that window yourself."),
    }}))
    sys.exit(0)


def repo_root(path: str) -> str:
    """The project this session runs in, if the path is inside it."""
    root = os.environ.get("CLAUDE_PROJECT_DIR") or ""
    root = os.path.realpath(root) if root else ""
    return root if root and (path == root or path.startswith(root + os.sep)) else ""


def main() -> None:
    try:
        p = json.load(sys.stdin)
    except ValueError:
        return
    if unlocked():
        return
    tool = p.get("tool_name", "")
    ti = p.get("tool_input") or {}
    cwd = p.get("cwd") or os.getcwd()

    if tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        f = ti.get("file_path") or ti.get("notebook_path") or ""
        path = os.path.realpath(os.path.join(cwd, os.path.expanduser(f)))
        root = repo_root(path)
        if NAMED.search(path) or (root and REL.search(os.path.relpath(path, root))):
            deny(f"editing {path.replace(HOME, '~')}")
        return

    if tool == "Bash":
        cmd = ti.get("command") or ""
        if "allow-template" in cmd:
            deny("Claude may not open the template unlock window")
        m = CODE_PATH_CMDS.search(cmd)
        if m:
            deny(f"`{m.group(0).strip()}` starts the template/engine code path")
        if PREVIEW.match(cmd):
            return
        in_repo = repo_root(os.path.realpath(cwd)) or re.search(
            r"primer-editor|staff-updates-internal", cwd + " " + cmd, re.I)
        names_code = NAMED.search(cmd) or (in_repo and (IN_CMD.search(cmd) or BARE.search(cmd)))
        if names_code and WRITES.search(cmd):
            deny("a shell command that writes to template/engine code")


if __name__ == "__main__":
    main()
