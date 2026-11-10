#!/usr/bin/env bash
# Exercises `tools/wt ship` (and `land` shipping by default) against throwaway
# repos: a fake Cider and a fake hub, each with a bare origin, a stand-in `gh`, and
# stubs for the two steps that need Cloudflare (WT_VENDOR_CMD, WT_HUB_CMD).
# Nothing real is touched or pushed.
#   tools/test-ship.sh
set -u
wt="$(cd "$(dirname "$0")" && pwd)/wt"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
# An isolated HOME: the ship lock and the ship-default switch live in
# ~/.cache/cider-wt, and a test must neither take the real lock nor read the real switch.
export HOME="$T/home"; mkdir -p "$HOME"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
unset WT_SHIP_DEFAULT WT_SHIP_FOREGROUND
g() { git -c user.name=t -c user.email=t@t "$@"; }
fails=0
ok()   { echo "ok   $1"; }
fail() { echo "FAIL $1"; shift; [ $# -gt 0 ] && printf '     %s\n' "$@"; fails=$((fails+1)); }

# --- fake Cider: a bare origin and a clone with one merged change on top
g init -q --bare "$T/cider.git"; g clone -q "$T/cider.git" "$T/cider" 2>/dev/null
echo a > "$T/cider/a"; g -C "$T/cider" add a; g -C "$T/cider" commit -qm "first"; g -C "$T/cider" push -q origin HEAD:main
g -C "$T/cider" branch -M main; g -C "$T/cider" branch -q --set-upstream-to=origin/main main 2>/dev/null
echo b > "$T/cider/b"; g -C "$T/cider" add b; g -C "$T/cider" commit -qm "Editor: the change under test (#1)"; g -C "$T/cider" push -q origin HEAD:main

# --- fake hub: an older editor, one report's engine, and a report's own page
g init -q --bare "$T/hub.git"; g clone -q "$T/hub.git" "$T/hub" 2>/dev/null
mkdir -p "$T/hub/primer/rep/engine/docsync"
echo old > "$T/hub/primer/edit.html"; echo v1 > "$T/hub/primer/editor-version.txt"
echo old > "$T/hub/primer/rep/engine/docsync/x.py"; echo old > "$T/hub/primer/rep/index.html"
echo old > "$T/hub/primer/rep/engine/manifest.json"
# a report that is live on the hub but not bound in the clean Cider copy
mkdir -p "$T/hub/primer/gone/engine/docsync"
echo old > "$T/hub/primer/gone/engine/manifest.json"; echo old > "$T/hub/primer/gone/engine/docsync/x.py"
g -C "$T/hub" add -A; g -C "$T/hub" commit -qm "start"; g -C "$T/hub" push -q origin HEAD:main; g -C "$T/hub" branch -M main

# --- stub for docsync.hub: writes a new editor, a new engine file, AND a report's own page
cat > "$T/hubcmd" <<'EOF'
#!/usr/bin/env bash
[ "${STUB_FAIL:-0}" = 1 ] && { echo "refused: words would vanish"; exit 1; }
while [ $# -gt 0 ]; do case "$1" in --into) into="$2"; shift ;; esac; shift; done
echo new > "$into/primer/edit.html"; echo v2 > "$into/primer/editor-version.txt"
echo new > "$into/primer/rep/engine/docsync/x.py"; echo new > "$into/primer/rep/index.html"
echo new > "$into/primer/rep/engine/manifest.json"
# the vendor run drops a report the clean copy does not know (as docsync.hub does)
rm -rf "$into/primer/gone"
# a report that is NEW to the hub: the run writes its engine, manifest and page
mkdir -p "$into/primer/newrep/engine/docsync"
echo new > "$into/primer/newrep/engine/manifest.json"; echo new > "$into/primer/newrep/engine/docsync/x.py"
echo new > "$into/primer/newrep/index.html"
# an engine file that changes with every Cider commit, so a later ship has something to carry
git rev-parse --short HEAD > "$into/primer/rep/engine/docsync/y.py"
EOF
chmod +x "$T/hubcmd"
echo staged > "$T/stagedmark"
export CIDER_DIR="$T/cider" CIDER_HUB_DIR="$T/hub" WT_VENDOR_CMD=true WT_HUB_CMD="$T/hubcmd"
# the stage step runs in the clean Cider copy, before the hub step
export WT_STAGE_CMD="cp $T/stagedmark ./STAGED"
hubhead() { git -C "$T/hub.git" rev-parse main; }
show()    { git -C "$T/hub.git" show "main:$1" 2>/dev/null; }

before=$(hubhead)
out=$("$wt" ship --dry-run 2>&1) && [ "$(hubhead)" = "$before" ] && echo "$out" | grep -q "nothing committed" \
  && ok "--dry-run pushes nothing" || fail "--dry-run pushes nothing" "$out"

out=$(STUB_FAIL=1 "$wt" ship 2>&1); rc=$?
{ [ "$rc" != 0 ] && [ "$(hubhead)" = "$before" ] && echo "$out" | grep -q "refused"; } \
  && ok "a refusal from the hub step pushes nothing" || fail "a refusal from the hub step pushes nothing" "rc=$rc" "$out"

out=$("$wt" ship 2>&1); rc=$?
[ "$rc" = 0 ] && [ "$(hubhead)" != "$before" ] && ok "ship pushes to the hub's main" || fail "ship pushes to the hub's main" "rc=$rc" "$out"
[ "$(show primer/edit.html)" = new ] && [ "$(show primer/editor-version.txt)" = v2 ] \
  && [ "$(show primer/rep/engine/docsync/x.py)" = new ] && ok "the editor files shipped" || fail "the editor files shipped"
[ "$(show primer/rep/index.html)" = old ] && ok "a report's own page did NOT ride along" || fail "a report's own page did NOT ride along"
[ "$(show primer/rep/engine/manifest.json)" = new ] && ok "a surviving report's manifest ships with its engine" || fail "a surviving report's manifest ships with its engine"
[ "$(show primer/gone/engine/manifest.json)" = old ] && [ "$(show primer/gone/engine/docsync/x.py)" = old ] \
  && ok "a report the clean copy does not know is left exactly as it is on the hub" || fail "a hub-only report was deleted"
echo "$out" | grep -q "left alone: 'gone'" && ok "and it says so" || fail "and it says so"
[ -z "$(show primer/newrep/engine/manifest.json)" ] && [ -z "$(show primer/newrep/engine/docsync/x.py)" ] \
  && [ -z "$(show primer/newrep/index.html)" ] \
  && ok "a report NEW to the hub is left off it, not half-shipped" || fail "a report NEW to the hub was half-shipped"
echo "$out" | grep -q "left alone: 'newrep' is a new report" && ok "and that says so too" || fail "and that says so too (new report)"
git -C "$T/hub.git" log -1 --format=%B main | grep -q "vendored from Cider" \
  && git -C "$T/hub.git" log -1 --format=%B main | grep -q "the change under test" \
  && ok "the commit names the Cider sha and the merged changes" || fail "the commit message"

[ -f "$T/cider-shipcopy/STAGED" ] && ok "every report is staged in the clean copy before the hub step" || fail "stage step ran in the clean copy"

head2=$(hubhead)
out=$("$wt" ship 2>&1); rc=$?
[ "$rc" = 0 ] && [ "$(hubhead)" = "$head2" ] && echo "$out" | grep -q "nothing to ship" \
  && ok "shipping the same editor again is a no-op" || fail "shipping the same editor again is a no-op" "rc=$rc" "$out"

# an unmerged worktree branch is refused
g -C "$T/cider" branch -q wip; g -C "$T/cider" worktree add -q "$T/cider-wip" wip 2>/dev/null
echo c > "$T/cider-wip/c"; g -C "$T/cider-wip" add c; g -C "$T/cider-wip" commit -qm wip
out=$("$wt" ship wip 2>&1); rc=$?
{ [ "$rc" != 0 ] && echo "$out" | grep -q "not in Cider's origin/main yet"; } \
  && ok "a branch that has not merged is refused" || fail "a branch that has not merged is refused" "rc=$rc" "$out"

# --- `land` ships by default where ship-default is on: a stand-in gh, one branch per case
mkdir -p "$T/bin"
cat > "$T/bin/gh" <<'EOF'
#!/usr/bin/env bash
# just enough of `pr view|create|merge` for `wt land`; the "merge" lands the branch on origin's main
case "$*" in
  "pr view "*"--json url,state"*) echo "https://example.test/pr/1" ;;
  "pr create "*)                  echo "https://example.test/pr/1" ;;
  "pr merge "*)                   exit 0 ;;
  "pr view "*"--json state"*)
    [ -n "${FAKE_MERGE_BRANCH:-}" ] && git -C "$FAKE_CIDER" push -q origin "$FAKE_MERGE_BRANCH:main" 2>/dev/null
    echo "${FAKE_PR_STATE:-MERGED}" ;;
  *) echo "fake gh: not expected: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$T/bin/gh"
export PATH="$T/bin:$PATH" FAKE_CIDER="$T/cider"
newbranch() { # <name> <file>: a worktree one commit ahead of origin/main
  g -C "$T/cider" fetch -q origin main
  g -C "$T/cider" worktree add -q -b "$1" "$T/cider-$1" origin/main 2>/dev/null
  echo "$1" > "$T/cider-$1/$2"; g -C "$T/cider-$1" add "$2"; g -C "$T/cider-$1" commit -qm "Editor: $1 (#9)"
}
cider_main() { git -C "$T/cider.git" rev-parse --short main; }
log() { cat "$HOME/.cache/cider-wt/ship-$1.log" 2>/dev/null; }

newbranch feat1 f1
out=$("$wt" land feat1 2>&1); rc=$?
{ [ "$rc" = 0 ] && echo "$out" | grep -q "Then: tools/wt ship feat1" && ! echo "$out" | grep -q "on by default"; } \
  && ok "land with ship-default off only lands, and says how to ship" || fail "land with ship-default off" "rc=$rc" "$out"

"$wt" ship-default on >/dev/null
[ "$("$wt" ship-default status)" = on ] && ok "ship-default on is remembered" || fail "ship-default on is remembered"

newbranch feat2 f2
before=$(hubhead)
out=$(WT_SHIP_FOREGROUND=1 WT_SHIP_POLL=1 FAKE_MERGE_BRANCH=feat2 "$wt" land feat2 2>&1); rc=$?
{ [ "$rc" = 0 ] && echo "$out" | grep -q "on by default here"; } \
  && ok "land with ship-default on says it will ship" || fail "land with ship-default on says it will ship" "rc=$rc" "$out"
{ [ "$(hubhead)" != "$before" ] && [ "$(show primer/rep/engine/docsync/y.py)" = "$(cider_main)" ] && log feat2 | grep -q "shipped, hub"; } \
  && ok "the merged update reached the hub with no ship command" || fail "the merged update reached the hub" "$(log feat2)"
[ ! -d "$T/cider-feat2" ] && ok "and its worktree was removed" || fail "and its worktree was removed"

# without WT_SHIP_FOREGROUND the wait-then-ship is a process of its own: land returns at once
newbranch feat3 f3
before=$(hubhead)
out=$(WT_SHIP_POLL=1 FAKE_MERGE_BRANCH=feat3 "$wt" land feat3 2>&1); rc=$?
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  log feat3 | grep -q -E "shipped|nothing for the hub" && break; sleep 1
done
{ [ "$rc" = 0 ] && [ "$(hubhead)" != "$before" ] && [ "$(show primer/rep/engine/docsync/y.py)" = "$(cider_main)" ]; } \
  && ok "the background ship still lands the update on the hub" || fail "the background ship" "rc=$rc" "$out" "$(log feat3)"

newbranch feat4 f4
before=$(hubhead)
out=$(WT_SHIP_FOREGROUND=1 "$wt" land feat4 --no-ship 2>&1); rc=$?
{ [ "$rc" = 0 ] && echo "$out" | grep -q "Not shipped (--no-ship)" && [ -z "$(log feat4)" ] && [ "$(hubhead)" = "$before" ]; } \
  && ok "--no-ship skips one landing" || fail "--no-ship skips one landing" "rc=$rc" "$out"

newbranch feat5 f5
before=$(hubhead)
out=$(WT_SHIP_FOREGROUND=1 WT_SHIP_POLL=1 STUB_FAIL=1 FAKE_MERGE_BRANCH=feat5 "$wt" land feat5 2>&1); rc=$?
{ [ "$(hubhead)" = "$before" ] && log feat5 | grep -q "NOT shipped"; } \
  && ok "a refused ship is logged as NOT shipped, and pushes nothing" || fail "a refused background ship" "rc=$rc" "$out" "$(log feat5)"

# ships take turns: a live holder makes the next one wait, then give up; a dead one is taken over
mkdir -p "$HOME/.cache/cider-wt/ship.lock"; sleep 60 & holder=$!
echo "$holder" > "$HOME/.cache/cider-wt/ship.lock/pid"
out=$(WT_SHIP_LOCK_TRIES=2 WT_SHIP_LOCK_POLL=0.2 "$wt" ship 2>&1); rc=$?
{ [ "$rc" != 0 ] && echo "$out" | grep -q "another ship"; } \
  && ok "a second ship waits for the first, then gives up and says so" || fail "a second ship waits for the first" "rc=$rc" "$out"
{ kill "$holder"; wait "$holder"; } 2>/dev/null
out=$(WT_SHIP_LOCK_TRIES=2 WT_SHIP_LOCK_POLL=0.2 "$wt" ship 2>&1); rc=$?
{ [ "$rc" = 0 ] && [ ! -d "$HOME/.cache/cider-wt/ship.lock" ] && [ "$(show primer/rep/engine/docsync/y.py)" = "$(cider_main)" ]; } \
  && ok "a dead holder's lock is taken over, the update the refused ship missed goes out, and the lock is released" \
  || fail "a stale lock" "rc=$rc" "$out"

[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
