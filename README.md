# primer-editor

The **docsync draft editor** — a single-file, browser-based WYSIWYG editor that
runs a report's *real* Python renderer in the browser via Pyodide, so what you
edit is exactly what the report will build. This repo is the editor's home:
its source, its engine, its tooling, and its tests all live here.

It ships with the **Hawaiʻi Budget Primer** as its bundled demo and test
fixture — the editor is nothing without a report to render, and the test suite
asserts against that report's real content.

## What's here

| Path | What it is |
|------|-----------|
| `docsync/editor/edit.html` | the editor itself (the canonical source; one file, no build step) |
| `docs/` | the editor's own shell — `start.html`, `sw.js`, `manifest.webmanifest`, `icons/` — plus, once built, each report's staged copy. **The staged parts are generated and untracked**: `edit.html`, `engine/`, and the built report are written by `make -C report2027 pub`, which the live server also runs on startup. Nothing here is published; the Budget Primer deploys from its own repo. |
| `docsync/*.py` | the **engine**: `content.py` / `layout.py` / `normalise.py` run in Pyodide; `stage.py` / `registry.py` assemble a project's engine beside the editor |
| `report2027/` | the bundled Budget Primer demo — `content.md`, `layout.json`, `tools/render_report.py`, data — that the editor renders and the tests exercise |
| `report2027/tools/serve.py` | the local live server: watch-rebuild-reload, plus `/__save` (commit locally) and `/__push` (send to GitHub) |
| `report2027/tools/make_launcher.sh` | builds a double-clickable macOS `.app` that boots the server and opens the editor |
| `tests/editor/` | the Playwright suite (276 specs) — runs against the real `serve.py` with GitHub fully mocked; never touches the network |

## Install

One line. Requires **Python 3.10+**, **git**, and — only for PDF/PNG export —
**Chrome**.

```
curl -fsSL https://raw.githubusercontent.com/dtomkatsu/primer-editor/main/install.sh | bash
```

That clones the repo to `~/primer-editor`, puts its Python dependencies in a
virtualenv **inside the checkout** (nothing system-wide, no sudo), and builds
`~/Applications/Budget Primer Editor.app`. Delete the directory and the app to
uninstall completely.

`PRIMER_HOME=/some/dir`, `PRIMER_PORT=8011` and `PRIMER_BRANCH=…` override the
defaults.

### The live report too

The editor alone serves its bundled fixture. To ALSO clone the live report
beside it and register it on the start page:

```
PRIMER_LIVE=dtomkatsu/BudgetPrimerFinal \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/dtomkatsu/primer-editor/main/install.sh)"
```

`PRIMER_LIVE_HOME`, `PRIMER_LIVE_ID` and `PRIMER_LIVE_NAME` override where it
lands and how it is registered. Re-running is safe: an existing clone is left
alone and the registry entry is merged, not clobbered.

### Staying current

Two independent things go stale, so there are two signals, deliberately
different in colour so they never read as one control:

- **The editor** — `tools/selfupdate.py` fast-forwards the checkout each time
  the app opens, and the server re-checks every 20 min (`UPDATE_POLL`). A
  sage `Update (n)` pill appears in the bar naming what is in it.
- **A report living in its own repo** — the server fetches each external
  project root every 5 min (`CONTENT_POLL`) and offers a blue
  `Update report (n)`, tooltipped with the incoming commit subjects.
  `/__pull` fast-forwards and rebuilds.

Both follow the same contract: check in the background, tell the person,
**never apply anything on its own** — a running editor holds unsaved work.
Both refuse rather than merge when the person has uncommitted changes or
unpushed commits, and say which it was. A report inside the editor's own
repo is left to the version chip, so two mechanisms never fast-forward one
checkout.

### Working with no repos at all

A local install is complete in itself: the start page's **“+ New report”**
scaffolds a blank project straight onto disk (no repo, no token, no GitHub —
`docsync/new.py` via the server's `/__scaffold`), and **“Adopt existing…”**
registers any docsync repo already cloned on this computer by its folder
path (`/__adopt`). Inside the editor, **File ▸ Connect GitHub** signs the
computer in with a one-time code (the local server proxies the device flow,
so no relay worker is needed — just the one GitHub App client id via
`PRIMER_GH_CLIENT` or the manifest's `oauth` block), after which Push works
over https with no keychain setup.

## Onboarding a colleague

The zero-typing route — build a zip and send it:

```
./tools/make_installer_zip.sh          # -> dist/Budget-Primer-Editor-Installer.zip
```

Inside is a double-clickable **Install Budget Primer Editor** app (plus a
two-line README covering the unsigned-app Gatekeeper prompt). Opening it runs
the one-line installer above in a visible Terminal window with `PRIMER_LIVE`
preset, then opens the editor. The zip carries no code of its own beyond the
bootstrap, so it never goes stale — what installs is whatever is on `main`
that day.

Two things the installer cannot do for them:

- **Pushing to the website** needs write access to the report's repo — add
  their GitHub account as a collaborator, then have them run `gh auth login`
  once. Saving works without any of this; edits are never lost.
- Their commits sign with whatever git identity the machine has (macOS
  auto-derives one from the username). `git config --global user.name/email`
  makes it a real name.

### It updates itself

The server checks for updates in the background every 20 minutes — not just at
launch — and the editor's version chip (bottom of the toolbar) offers one the
moment it can be taken, naming what's in it. Publishing an update is a
`git push`; nothing here needs a release step.

**It will never lose your work.** What you have installed is a normal git
checkout you own: read it, edit it, commit, open a pull request. Save commits
locally, so an update REBASES your local commits on top of the incoming ones
when the files don't overlap — the common case — and only refuses (naming the
file) when they genuinely touch the same thing. It never fast-forwards over
uncommitted changes. Run `python3 tools/selfupdate.py --check` any time to see
where you stand.

**One bad update, undone in one click.** Every update records the version you
were on before it ran; the version chip's tooltip offers "go back" whenever
there's somewhere to go back to. `python3 tools/selfupdate.py --rollback` does
the same from a terminal.

### Or by hand

```
git clone https://github.com/dtomkatsu/primer-editor && cd primer-editor
python3 -m pip install -r requirements.txt
make -C report2027 live          # http://localhost:8010/primer/edit.html
```

`make live` runs `tools/preflight.py` first: it checks the Python version and
PyYAML, arms the vendoring git hook, and tells you if Chrome is missing. It is
idempotent — it runs on every start and only reports what needs attention.

Nothing else is required. There is no build step, no bundler, and no account:
the editor is one HTML file and the renderer is your report's own Python,
running in the browser via Pyodide.

Optional, macOS only — a double-clickable launcher:

```
./report2027/tools/make_launcher.sh   # -> ~/Applications/Budget Primer Editor.app
```

### Two files that are yours, not the repo's

| File | What it is |
|------|-----------|
| `docs/primer/projects.json` | which reports your start page lists, and where their files live on **this** machine. Untracked — copy `projects.example.json` if you want to customise it. Without it, every report in `docsync.yml` is still served. |
| `vendor.local.yml` | other repos on this machine that vendor this engine, synced by the post-commit hook. Untracked; `vendor.yml` ships empty so a clone never writes into a checkout it does not have. |

Where a report's **Save/Push** goes is recorded per project in its staged
`engine/manifest.json`. It defaults to your own checkout's `origin`, and the
editor asks the first time if there is none.

`make live` starts `serve.py`: it rebuilds the report on any change and reloads
the browser, so an edit shows in ~1s. **Save** writes the files and commits
*locally only*; **Push** is a separate, explicit trip to GitHub.

## Test it

```
npm ci
npx playwright install chromium   # the browser itself — npm ci does not fetch it
npm run test:affected             # the specs and checks YOUR change needs
npm run test:full                 # the whole editor suite, recording the impact map
python3 docsync/test_docsync.py       # the engine's own self-test
python3 report2027/tools/test_render.py   # render tolerances + edit.html syntax
```

The suite starts its own throwaway `serve.py` on port 8199 and mocks GitHub
entirely — it never touches the network or your real repo. It also regenerates
`docs/` on startup, so it works on a clone that has never been built, and
stages the default project's editor from the working tree before any test runs
(a machine whose `docs/primer/projects.json` points budget-primer at another
checkout otherwise tested whatever `edit.html` was staged last).

**Between pushes, run `npm run test:affected`, not the whole suite.** The full
suite is ~780 tests and ~20 minutes; most changes touch one feature.
`tools/affected.mjs` picks specs by what they *run*: `npm run test:full` records,
per spec, every `edit.html` function its tests called (V8 coverage) and every
engine function the renderer called inside Pyodide (`sys.monitoring`), into
`.impact/` (machine-local, gitignored). A change is carried into that run's line
numbers through a diff of the snapshot it kept, and selects the specs that ran
the function it is in. It prints each spec with the reason, and what no spec
exercises at all. `--since origin/main` covers unpushed commits, `--list` runs
nothing, and anything after a second `--` goes to Playwright. The rules, in
order of how often they fire:

| Changed | Runs |
|---|---|
| code inside a function | the specs that called it |
| a function no spec calls | nothing, and says so |
| a top-level `const`/`function` | the specs calling code that reads it |
| other top-level code, a fixture, the config | everything |
| editor CSS or markup | specs that name the selector or run code that does |
| `serve.py` | specs that use the route the change sits under |
| a comment, a docstring | nothing |

`boot-errors.spec.js` runs whenever something that boots the editor changed, and
the Python checks (seconds, all of them) run for any engine or report change. A
spec that drives no editor code declares what it depends on in a comment —
`// affected-by: docsync/layout.py projects/**` — and is picked by that. CI
still runs everything on every push. Rebuild the map (`npm run test:full`) when
the selections get broad; the picker prints how many commits old it is.

## The editor

Canva-style: a left rail (Text/Shape/Icon/Table/Chart) opens a docked panel
rather than a cramped popover; a contextual toolbar appears above the canvas
for whatever is selected; a bottom strip shows every page as a thumbnail and
can be collapsed when you don't need it (remembered per project). The
top-left **File** menu is where report-level actions live: Open (switch
between reports this server knows about), Resize (six standard doc sizes —
changing one re-renders the report at it, live), Google Doc, Download, and the
GitHub token.

**Google Doc** records which doc a report was drafted in, and **Import text
from the Doc** brings that text in: the server reads the doc and proposes where
each section lands — by its `[[key]]` markers if it has them, otherwise by
matching its headings to what the slots currently say — and you approve the
list row by row before anything is written. It is one-way; the doc is never
written to, and the whole import is a single undo. Clicking the report itself dismisses whatever menu or panel is open,
except the ones that describe your current selection (Table/Chart/Colour),
which stay open so you can keep working while they're up.

**Duplicate page copies the page** — all of it. A designed page's content is
the renderer's (Python draws it from `content.md`), so a duplicate takes a
snapshot of the page's pristine markup, moves every id and slot key under
`copy.<page>.`, writes each slot's words into `content.md` under the new key,
and files the markup on the new page's entry in `layout.json`
(`pages.blanks[].copy`). `docsync/pagecopy.py` redraws it from the current
words and layout on every render, so the copy's headings, cards and chart
labels edit, move, hide and recolour exactly like the original's, and the
published build carries it too. What a copy is not: the renderer — a chart in
the copy keeps the numbers it was drawn with, and a copied endnote list is
text, not the numbered endnotes.

**Labels inside a chart edit on the page — and cannot be anything else.**
`graphic()` refuses, at build time, any SVG text with words that is not a
slot, a declared derived value (`C.derived`) or a graphic declared frozen with
a reason; the draft does not render until it is fixed, and `docsync.check`
fails the push. A renderer draws a chart's legend
entries, step names and bar captions with `docsync.blocks.svg_text()` —
`data-slot` on the SVG `<text>`, words read through `C.text_or(key, default)`
so the renderer's own wording stands until someone rephrases it. Double-click
a label and a field floats over the glyphs; Enter writes the slot. A
document that never listed the label (a hub room seeded before it existed)
opens on the words the page shows, and the first edit writes the block.

## Architecture: one editor, many reports

The editor knows nothing about any particular report. Everything specific — the
renderer, what it reads, the page size, the palette — comes from
`engine/manifest.json`, staged beside the editor from `docsync.yml` by
`python3 -m docsync.stage`. A second report is a second registry entry, not a
second editor. The editor's landing page (`start.html`) can **connect** a new
repo or **adopt** an existing project, and each project records its own repo and
deploy branch.

### The shared engine

`docsync/` (the `content.py` / `layout.py` renderer) is a shared dependency: the
editor runs it in Pyodide, **and** a report repo's own build (`render_report.py`
→ `make pub`) imports it. This repo owns it. A report repo (e.g.
`BudgetPrimerFinal`) **vendors a synced copy** — the editor already stages a copy
of the engine into every project it serves, so the pattern is native. A report
repo keeps its own `serve.py` + vendored editor for the sub-second local
fast-loop; it refreshes them from here with a small sync script when it wants
the latest editor.

So: **editor development happens here**; reports pull updates when they choose,
and their fast local loop never depends on a network.

### On the staff hub

Staff who have no GitHub account use the editor on the internal hub
(`staff-updates-internal/primer/`), behind the Google sign-in they already
have. `python3 -m docsync.hub` vendors the editor and every project's engine
there, and the post-commit hook keeps that copy current — see
[collab/README.md](collab/README.md), "Served from the staff hub".

## Licence

MIT — see [LICENSE](LICENSE).
