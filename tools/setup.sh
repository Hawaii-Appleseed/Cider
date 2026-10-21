#!/usr/bin/env bash
# Make this checkout ready to work in — for anyone, not only on Devin's Mac.
# Claude Code runs it whenever a session opens here (.claude/settings.json,
# SessionStart); run it by hand after a plain `git clone` too.
#
#   tools/setup.sh
#
# 1. git hooks: core.hooksPath -> .githooks (post-commit vendors the engine to
#    the consumers a machine names in its own vendor.local.yml; none in a fresh
#    clone, so it does nothing there).
# 2. Node 22+ and python3 with PyYAML (docsync's tooling); notes what the tests
#    need on top: node_modules (npm ci) for Playwright, gh for `npm run test:ci`.
#
# Idempotent. Silent when there is nothing to do, else ONE line of status, and
# it always exits 0: a setup problem must never stop a session from opening.

cd "$(dirname "$0")/.." 2>/dev/null || exit 0
done_=() todo=()

# --- 1. hooks ----------------------------------------------------------------
if [ -d .githooks ] && [ "$(git config --get core.hooksPath 2>/dev/null)" != ".githooks" ]; then
  if [ "$(git worktree list --porcelain 2>/dev/null | grep -c '^worktree ')" -le 1 ]; then
    git config core.hooksPath .githooks && done_+=("git hooks installed (core.hooksPath=.githooks)")
  else
    # Several checkouts share this repo's config. One of them on a branch from
    # before .githooks existed would run NO hooks at all if this were set for
    # the repo, so set it for this checkout alone.
    git config extensions.worktreeConfig true \
      && git config --worktree core.hooksPath .githooks \
      && done_+=("git hooks installed for this checkout (core.hooksPath=.githooks)")
  fi
  [ "$(git config --get core.hooksPath 2>/dev/null)" = ".githooks" ] \
    || todo+=("could not set core.hooksPath; run: git config core.hooksPath .githooks")
fi

# --- 2. tools ----------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  todo+=("Node 22+ is not installed")
else
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "${major:-0}" -ge 22 ] 2>/dev/null || todo+=("Node 22+ (this is $(node --version 2>/dev/null))")
fi
if ! command -v python3 >/dev/null 2>&1; then
  todo+=("python3 is not installed")
else
  py=python3; [ -x .venv/bin/python ] && py=.venv/bin/python
  "$py" -c 'import yaml' 2>/dev/null \
    || todo+=("PyYAML for docsync: python3 -m pip install -r requirements.txt (or ./install.sh)")
fi
[ -e node_modules/@playwright/test ] \
  || todo+=("npm ci, then npx playwright install chromium, before the editor tests")
command -v gh >/dev/null 2>&1 || todo+=("the GitHub CLI (gh), signed in, for npm run test:ci")

# --- status ------------------------------------------------------------------
if [ ${#done_[@]} -gt 0 ] || [ ${#todo[@]} -gt 0 ]; then
  line="Cider setup:"
  for m in "${done_[@]}"; do line="$line $m;"; done
  for m in "${todo[@]}"; do line="$line NEEDS: $m;"; done
  echo "${line%;}"
fi
exit 0
