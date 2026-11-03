#!/usr/bin/env bash
# Exercises `tools/wt ship` against throwaway repos: a fake Cider and a fake hub,
# each with a bare origin, and stubs for the two steps that need Cloudflare
# (WT_VENDOR_CMD, WT_HUB_CMD). Nothing real is touched or pushed.
#   tools/test-ship.sh
set -u
wt="$(cd "$(dirname "$0")" && pwd)/wt"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
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
g -C "$T/hub" add -A; g -C "$T/hub" commit -qm "start"; g -C "$T/hub" push -q origin HEAD:main; g -C "$T/hub" branch -M main

# --- stub for docsync.hub: writes a new editor, a new engine file, AND a report's own page
cat > "$T/hubcmd" <<'EOF'
#!/usr/bin/env bash
[ "${STUB_FAIL:-0}" = 1 ] && { echo "refused: words would vanish"; exit 1; }
while [ $# -gt 0 ]; do case "$1" in --into) into="$2"; shift ;; esac; shift; done
echo new > "$into/primer/edit.html"; echo v2 > "$into/primer/editor-version.txt"
echo new > "$into/primer/rep/engine/docsync/x.py"; echo new > "$into/primer/rep/index.html"
EOF
chmod +x "$T/hubcmd"
export CIDER_DIR="$T/cider" CIDER_HUB_DIR="$T/hub" WT_VENDOR_CMD=true WT_HUB_CMD="$T/hubcmd"
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
git -C "$T/hub.git" log -1 --format=%B main | grep -q "vendored from Cider" \
  && git -C "$T/hub.git" log -1 --format=%B main | grep -q "the change under test" \
  && ok "the commit names the Cider sha and the merged changes" || fail "the commit message"

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

[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
