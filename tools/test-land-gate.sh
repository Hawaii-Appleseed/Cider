#!/usr/bin/env bash
# Exercises `tools/wt land --check-only` (the hub-spec gate) without pushing.
# Run from a Cider worktree on a branch that is ahead of origin/main:
#   CIDER=<main clone> tools/test-land-gate.sh <worktree-name>
set -u
name="${1:?usage: test-land-gate.sh <worktree-name>}"
wt="$(cd "$(dirname "$0")" && pwd)/wt"
fake=$(mktemp -d); mkdir -p "$fake/functions/api/collab"
fails=0
t() { # t <label> <expect-rc> <expect-grep> -- env... args...
  local label="$1" rc="$2" pat="$3"; shift 4
  local out; out=$(env "$@" 2>&1); local got=$?
  if [ "$got" = "$rc" ] && printf '%s' "$out" | grep -q -- "$pat"; then echo "ok   $label"
  else echo "FAIL $label (rc=$got, want $rc /$pat/)"; printf '%s\n' "$out" | sed 's/^/     /'; fails=$((fails+1)); fi
}
L="$wt land $name --check-only"
t "unrelated files skip"      0 "not needed"        -- WT_GATE_FILES="tools/wt" $L
t "docsync/editor triggers"   0 "Hub spec: passed"  -- WT_GATE_FILES="docsync/editor/edit.html" PRIMER_HUB_DIR="$fake" WT_HUB_SPEC_CMD=true $L
t "collab/ triggers"          0 "Hub spec: passed"  -- WT_GATE_FILES="collab/src/x.js" PRIMER_HUB_DIR="$fake" WT_HUB_SPEC_CMD=true $L
t "serve.py triggers"         0 "Hub spec: passed"  -- WT_GATE_FILES="report2027/tools/serve.py" PRIMER_HUB_DIR="$fake" WT_HUB_SPEC_CMD=true $L
t "collab spec triggers"      0 "Hub spec: passed"  -- WT_GATE_FILES="tests/editor/collab-x.spec.js" PRIMER_HUB_DIR="$fake" WT_HUB_SPEC_CMD=true $L
t "docsync/other no trigger"  0 "not needed"        -- WT_GATE_FILES="docsync/check.py" $L
t "hub absent: warn, continue" 0 "Hub spec NOT RUN" -- WT_GATE_FILES="collab/x" PRIMER_HUB_DIR="$fake/none" $L
t "failure refuses"           1 "FAILED"            -- WT_GATE_FILES="collab/x" PRIMER_HUB_DIR="$fake" WT_HUB_SPEC_CMD=false $L
t "skip flag is loud"         0 "NOT RUN, by explicit" -- WT_GATE_FILES="collab/x" PRIMER_HUB_DIR="$fake" WT_HUB_SPEC_CMD=false $L --skip-hub-spec
rm -rf "$fake"
[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
