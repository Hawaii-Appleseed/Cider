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
  - the engine:            docsync/** except docsync/editor/**, primer/<id>/engine/**
  - the hub's editor copy: primer/edit.html, primer/collab-client.js (vendored
    from Cider by docsync.hub; edit the source in docsync/editor/ instead)
Fires on:
  - Write / Edit / MultiEdit / NotebookEdit of a guarded file
  - Bash that writes to one (sed -i, cp/mv/tee/redirect, a script that names it
    and writes, git checkout/restore from another commit), or runs python3 -m docsync.hub --into the shared hub folder
Reading code (grep with `=>` or `2>/dev/null` included) and running a renderer
to preview stay allowed. python3 -m docsync.hub is open (2026-10-28 for a hub
worktree, 2026-11-03 for every other form, --help and --dry-run included): it
carries only code that already landed. Only `--into` the shared folder is refused.

Not guarded (Devin, 2026-10-28): Cider's own editor UI, docsync/editor/** —
how dragging, selecting and typing work is tool work, not one report's look,
and it needed an unlock for every fix. So `cider-wt new|land` is open too: a
worktree touches nothing by itself, and a template edit inside one is still
caught file by file.

Not guarded (Devin, 2026-11-10): the engine, docsync/**, INSIDE A LINKED GIT
WORKTREE. The incident above was one report's template, not the engine, and
engine work kept needing an unlock. A worktree edit reaches nobody until its
pull request passes CI and lands. A report's own template, the hub's vendored
copies (primer/<id>/engine/**, primer/edit.html) and anything in a main
checkout stay locked.

Unlock, either way, and only by the person, never Claude:
  - by saying so (2026-11-10): a message the person typed in this session in
    the last SPOKEN_MINUTES that asks for the code work in words — "fix the
    engine", "change the template", "template work" — opens it for that session
    only. The guard reads the session transcript and counts only entries the
    app marked as typed by a human: not tool output, pasted text, subagent
    prompts or messages from other sessions. "Don't touch the template" does
    not count. Claude writing to a transcript file is refused.
  - .claude/hooks/allow-template [minutes|off|status] in either repo (default
    120 minutes; one window per person, in ~/.cache), for every session.
A deny is used, not ask: "ask" does not prompt in bypassPermissions sessions.
"""
import datetime
import json
import os
import re
import subprocess
import sys
import time

# GUARD_TEMPLATE_WINDOW replaces the window file in tests.
WINDOW = os.environ.get("GUARD_TEMPLATE_WINDOW") or os.path.expanduser("~/.cache/cider-wt/allow-template")
# Where "this session was told its unlock was heard" is remembered, so the
# one-line notice shows once. GUARD_TEMPLATE_SAID replaces it in tests.
SAID = os.environ.get("GUARD_TEMPLATE_SAID") or os.path.expanduser("~/.cache/cider-wt/spoken")
SPOKEN_MINUTES = 120
HOME = os.path.expanduser("~")

CODE = (r"(?:projects/[^/\s'\"]+/(?:render_report\.py|layout\.json)"
        r"|docsync/(?!editor/)[^\s'\"]*"
        r"|primer/[^/\s'\"]+/engine/[^\s'\"]*"
        r"|primer/(?:edit\.html|collab-client\.js))")
REL = re.compile(r"^" + CODE, re.I)                                   # a repo-relative path
NAMED = re.compile(r"(?:primer-editor|staff-updates-internal)[^/\s'\"]*/(?:.*/)?" + CODE, re.I)
IN_CMD = re.compile(r"(?:^|[\s'\"=/(])" + CODE, re.I)                 # a code path inside a command
BARE = re.compile(r"(?<![\w./-])(?:render_report\.py|layout\.json)\b", re.I)
ENGINE = re.compile(r"^docsync/(?!editor/)", re.I)                    # the engine, from a worktree's top
TRANSCRIPT = re.compile(r"\.claude[^/\s'\"]*/projects/[^\s'\"]*\.jsonl\b", re.I)

CODE_PATH_CMDS = re.compile(r"-m\s+docsync\.hub\b(?![^;&|\n]*--dry-run)", re.I)
# The ship itself (Devin, 2026-10-28): `docsync.hub --into <a hub worktree>`
# only carries code that already passed this guard file by file and landed in
# Cider, so it is open. Into the shared hub folder itself it stays refused.
HUB_INTO = re.compile(r"--into[\s=]+['\"]?([^\s'\";&|]+)")
SHARED_HUB = os.path.realpath(os.path.join(HOME, "staff-updates-internal"))
# A redirect that writes: not `=>`, `>=`, `->`, `2>&1`, or `> /dev/null`.
# git checkout/restore writes only when it brings files from ANOTHER commit;
# putting them back as HEAD has them (`git checkout [-q] [HEAD] -- primer`,
# dropping what a ship rewrote) cannot introduce code (Devin, 2026-10-28).
WRITES = re.compile(
    r"\bsed\s+-i|\btee\b|\bcp\b|\bmv\b|\brsync\b|\bpatch\b|\bgit\s+apply\b"
    r"|\bgit\s+checkout\s+(?:-\S+\s+)*(?!HEAD\b|--)[^\s-]\S*\s+(?:-\S+\s+)*--"
    r"|\bgit\s+restore\b[^;&|\n]*--source[=\s]+(?!HEAD\b)\S"
    r"|(?<![=\d&>-])>>?(?![>=&])\s*(?!/dev/null\b)[^\s>&]|\.write\(|write_text\(|open\([^)]*['\"]w",
    re.I,
)

# What the person has to say. A code noun with a change verb before it in the
# same sentence, the noun followed by "work/change/fix", or "in the engine".
_NOUN = r"(?:engine|docsync|templates?|render_report(?:\.py)?|layout\.json)"
_VERB = (r"(?:chang\w*|edit\w*|updat\w*|fix\w*|modif\w*|rewrit\w*|patch\w*|unlock\w*|refactor\w*"
         r"|work(?:ing)?\s+on|add\w*\s+(?:\w+\s+){0,4}to|build\w*\s+(?:\w+\s+){0,4}into|teach)")
ASKS = re.compile(
    rf"\b{_VERB}\b[^.?!\n]{{0,60}}?\b{_NOUN}\b"
    rf"|\b{_NOUN}\s+(?:work|code|change|fix|edit|update)s?\b"
    r"|\b(?:in|into)\s+the\s+(?:cider\s+)?(?:engine|docsync)\b",
    re.I,
)
HINT = re.compile(r"engine|docsync|template|render_report|layout\.json", re.I)
NEGATED = re.compile(r"(?:\bdon'?t|\bdo\s+not|\bnever|\bwithout|\bnot|\bno\s+need\s+to|\binstead\s+of)\b[^.?!\n]{0,25}$", re.I)
NOT_TYPED = re.compile(r"<(system-reminder|pasted_content|command-[a-z]+|local-command-[a-z]+|task-notification)\b.*?</\1[^>]*>", re.I | re.S)


HUB_MODULE = re.compile(r"-m\s+docsync\.hub\b", re.I)


def hub_into_shared(cmd: str, cwd: str) -> bool:
    """`--into` names the shared hub folder itself."""
    m = HUB_INTO.search(cmd)
    if not m:
        return False
    return os.path.realpath(os.path.join(cwd, os.path.expanduser(m.group(1)))) == SHARED_HUB


def hub_ship_ok(cmd: str, cwd: str) -> bool:
    """`docsync.hub --into <dir>` where <dir> is a hub worktree, not the shared folder."""
    m = HUB_INTO.search(cmd)
    if not m:
        return False
    into = os.path.realpath(os.path.join(cwd, os.path.expanduser(m.group(1))))
    return into != SHARED_HUB and os.path.isdir(into)
PREVIEW = re.compile(r"^\s*(?:\S+=\S+\s+)*python3\s+\S*render_report\.py\s*(?:[;&|]|$)", re.I)


def unlocked() -> bool:
    try:
        return int(open(WINDOW).read().strip() or 0) > time.time()
    except (OSError, ValueError):
        return False


def engine_in_worktree(path: str) -> bool:
    """`path` is engine code (docsync/**, not the editor) in a LINKED git worktree."""
    d = os.path.dirname(path)
    while d and not os.path.isdir(d) and d != os.path.dirname(d):
        d = os.path.dirname(d)
    try:
        out = subprocess.run(
            ["git", "-C", d, "rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir"],
            capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return False
    lines = out.stdout.splitlines()
    if out.returncode != 0 or len(lines) != 3:
        return False
    top, gitdir, common = (os.path.realpath(os.path.join(d, x)) for x in lines)
    if gitdir.lower() == common.lower():          # the main working tree
        return False
    rel = os.path.relpath(os.path.realpath(path), top)
    return bool(ENGINE.match(rel))


def bash_engine_in_worktree(cmd: str, cwd: str) -> bool:
    """Every code path the command names is engine code in a linked worktree."""
    if BARE.search(re.sub(r"\S*/(?:render_report\.py|layout\.json)", "", cmd)):
        return False
    m = re.match(r"\s*cd\s+(['\"]?)([^\s'\";&|]+)\1\s*(?:&&|;)", cmd)
    if m:
        cwd = os.path.join(cwd, os.path.expanduser(m.group(2)))
    hits = [t for t in re.findall(r"[^\s'\"=();|&<>]+", cmd)
            if REL.search(t) or NAMED.search(t) or IN_CMD.search(t)]
    if not hits:
        return False
    return all(engine_in_worktree(os.path.realpath(os.path.join(cwd, os.path.expanduser(t))))
               for t in hits)


def typed_text(entry: dict) -> str:
    """The words a human typed in this transcript entry, or ''."""
    if entry.get("type") != "user" or entry.get("isSidechain") or entry.get("isMeta"):
        return ""
    origin = entry.get("origin")
    if origin is not None and (not isinstance(origin, dict) or origin.get("kind") != "human"):
        return ""
    c = (entry.get("message") or {}).get("content")
    if isinstance(c, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in c):
            return ""
        c = "\n".join(b.get("text") or "" for b in c if isinstance(b, dict) and b.get("type") == "text")
    if not isinstance(c, str):
        return ""
    c = NOT_TYPED.sub(" ", c).strip()
    return "" if c.startswith("<") else c


def asks_for_code(text: str) -> bool:
    return any(not NEGATED.search(text[:m.start()]) for m in ASKS.finditer(text))


def spoken(p: dict) -> bool:
    """The person asked for template/engine code work, in words, in this session, lately."""
    path = p.get("transcript_path") or ""
    if not path:
        return False
    cutoff = time.time() - SPOKEN_MINUTES * 60
    try:
        with open(os.path.expanduser(path), encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if '"user"' not in line or not HINT.search(line):
                    continue
                try:
                    e = json.loads(line)
                    ts = datetime.datetime.fromisoformat(str(e.get("timestamp")).replace("Z", "+00:00")).timestamp()
                except (ValueError, TypeError):
                    continue
                if ts >= cutoff and asks_for_code(typed_text(e)):
                    return True
    except OSError:
        return False
    return False


def heard(p: dict) -> None:
    """Allow, and tell the person once per session that their words opened the lock."""
    sid = re.sub(r"[^\w-]", "", str(p.get("session_id") or "")) or "session"
    mark = os.path.join(SAID, sid)
    if os.path.exists(mark):
        return
    try:
        os.makedirs(SAID, exist_ok=True)
        open(mark, "w").close()
    except OSError:
        pass
    print(json.dumps({"systemMessage": (
        "Template/engine code is unlocked for this session: you asked for that work in your "
        f"message. It closes {SPOKEN_MINUTES} minutes after you last asked.")}))


def deny(what: str) -> None:
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": (
            f"BLOCKED: {what}. This is report TEMPLATE / ENGINE code, locked by default. "
            "A change to a report's words, look or layout goes through the document instead: "
            "the hub connector's read_report, then edit_report (text) or arrange_report "
            "(remove, place, recolor, setStyle, addShape, charts, tables) while the report is "
            "open in the editor. If the editor truly cannot do it, say so to the user and ask. "
            "Engine code (docsync/**) is open inside a cider-wt worktree; a report's template "
            "and the hub's vendored copies are not. Only the user unlocks those: by asking for "
            "the template or engine change in their own message, or by running "
            ".claude/hooks/allow-template in the Cider or hub repo (a 2-hour window). "
            "Do not open that window yourself."),
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
    tool = p.get("tool_name", "")
    ti = p.get("tool_input") or {}
    cwd = p.get("cwd") or os.getcwd()

    # A session transcript is where "the person said so" is read from: Claude
    # does not write to one, whatever window is open.
    if tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        f = ti.get("file_path") or ti.get("notebook_path") or ""
        if TRANSCRIPT.search(os.path.realpath(os.path.join(cwd, os.path.expanduser(f)))):
            deny("Claude may not write to a session transcript")
    elif tool == "Bash":
        cmd = ti.get("command") or ""
        if TRANSCRIPT.search(cmd) and WRITES.search(cmd):
            deny("Claude may not write to a session transcript")

    if unlocked():
        return

    if tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        f = ti.get("file_path") or ti.get("notebook_path") or ""
        path = os.path.realpath(os.path.join(cwd, os.path.expanduser(f)))
        root = repo_root(path)
        if NAMED.search(path) or (root and REL.search(os.path.relpath(path, root))):
            if engine_in_worktree(path):
                return
            if spoken(p):
                return heard(p)
            deny(f"editing {path.replace(HOME, '~')}")
        return

    if tool == "Bash":
        cmd = ti.get("command") or ""
        if "allow-template" in cmd:
            deny("Claude may not open the template unlock window")
        # docsync.hub is open (Devin, 2026-11-03): only a ship into the SHARED hub
        # folder, which is usually on somebody's branch, stays refused.
        m = HUB_MODULE.search(cmd)
        if m and hub_into_shared(cmd, cwd):
            deny("`docsync.hub --into` the shared staff-updates-internal folder (use a hub worktree)")
        if PREVIEW.match(cmd):
            return
        in_repo = repo_root(os.path.realpath(cwd)) or re.search(
            r"primer-editor|staff-updates-internal", cwd + " " + cmd, re.I)
        names_code = NAMED.search(cmd) or (in_repo and (IN_CMD.search(cmd) or BARE.search(cmd)))
        if names_code and WRITES.search(cmd):
            if bash_engine_in_worktree(cmd, cwd):
                return
            if spoken(p):
                return heard(p)
            deny("a shell command that writes to template/engine code")


if __name__ == "__main__":
    main()
