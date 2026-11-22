#!/bin/bash
# Start the headless editor from the latest Cider main, for launchd.
#
# The folder is a DETACHED worktree of the Mac mini's Cider clone, kept for
# this alone (measure/README.md), so moving it to origin/main never touches
# anybody's branch or edits. The editor itself is not taken from here: every
# job opens the hub's deployed editor through the hub's door. Only this
# server's own code follows main, and only when it restarts.
set -u
cd "$(dirname "$0")/.." || exit 1
if git fetch -q origin main 2>/dev/null && git diff --quiet && git diff --cached --quiet \
   && git cat-file -e origin/main:measure/server.mjs 2>/dev/null; then
  git checkout -q --detach origin/main || true
fi
exec node measure/server.mjs
