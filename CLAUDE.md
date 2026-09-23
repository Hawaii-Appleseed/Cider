# primer-editor — the docsync draft editor engine

> Deeper playbook: the **`report-editor` skill** (`.claude/skills/report-editor/`)
> — load it when building or changing anything a report's user should be able
> to edit. This file is the always-on summary.

## Default to driving the editor, not editing files

When the user asks for a visual/content change — move, resize, restyle,
retext, recolor an element, swap an image, adjust a chart — **drive
`edit.html`** instead of editing `content.md` / `layout.json` / any file
directly. That is what the editor is *for*: a drag writes `layout.json` and
nothing else, Save is a local commit the user reviews before Push, and the
browser session has no reach into `docsync/*.py` or the renderer even by
accident.

**Drive it through `window.docsync.api`, not through clicks.** The editor
exposes a pilot API — one JS eval per action, same safety as the UI (every
verb runs `pushHistory()` first so ⌘Z undoes it, writes land through the one
`render()` with all its validation, and every verb returns plain JSON with
geometry in page inches so no screenshot round-trips are needed). The loop
is: `docsync.api.inventory()` once to learn every element id, slot key and
bounding box, then act by id:

```js
await docsync.api.setSlot('whopays.p1', '…new markdown…')
await docsync.api.place('cover.logo', { x: 1, y: 4 })   // inches; clamps like a drag
await docsync.api.recolor('page.3', '#FFF6D8')          // null = reset
await docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 2.5, md: 'Note' })
await docsync.api.select('cover.logo')                  // as a click would; null clears
docsync.api.save()      // presses the real Save; Push stays with the human

// Several edits as ONE undo step and ONE render — batch() over separate
// calls whenever the edits are related. All-or-nothing: a bad op refuses
// the whole batch before anything mutates. Verbs: setSlot, place, recolor,
// addTextBox, addSource — not addPage/addEndnotesSection, which push their
// own history internally and so cannot join one.
await docsync.api.batch([
  { verb: 'setSlot', args: ['whopays.p1', '…new markdown…'] },
  { verb: 'place', args: ['cover.logo', { x: 1, y: 4 }] },
])
```

**Prefer HTTP over a browser eval.** `POST /__pilot` relays a verb to the open
editor, so the whole loop is `curl` — no browser extension, no JS escaping, no
dependence on which tab is fronted. The verb still runs *inside* the editor
through `docsync.api`, so it is not an out-of-band write:

```bash
curl -s localhost:8010/__pilot -H 'Content-Type: application/json' \
  -d '{"project":"budget-primer","verb":"audit"}'
```

Needs an editor tab open and not backgrounded; it says so plainly otherwise.

**Without a browser at all** — a CI check, a shell script, an MCP client —
read the document over HTTP: `GET /__inventory?project=<id>` returns every
slot's full markdown, every source with its citation count, the geometry of
everything placed, and (unless `&elements=0`) every addressable element id.
`docsync/mcp_server.py` wraps both halves as an MCP server (stdlib only:
`claude mcp add primer -- python3 docsync/mcp_server.py`) — read tools plus
`pilot`. Don't write content.md/layout.json directly while an editor is open
when a pilot verb can express the change — the verbs get validation, one
render, and ⌘Z for free. For a change the pilot CANNOT express (a NEW slot
key, or renderer + content edited together — `setSlot` refuses unknown keys),
the sanctioned file route exists: **announce first** with
`POST /__agent/change {"project": id, "by": "Claude", "summary": …}`, then
edit the files. Live mode adopts external edits into open editors (that is
what "edits here and from Claude land in the same files" means): a same-file
conflict prompts the user to choose, and the announce records base=HEAD so
the "Claude edited this" chip can rewind the whole change. Editing the files
withOUT announcing still gets adopted but surfaces as an anonymous
"edited outside the editor" chip — always announce.

Full verb list and contract: `pilot-api.spec.js` is the executable spec;
the `report-editor` skill documents it. Reserve clicking/dragging for what
the API doesn't cover, and screenshots for visual judgement calls only.

Only edit repo files directly when the user's instruction is explicitly about
the files or the code — "edit content.md", "fix the renderer", "change how
tables render", "update layout.py", or similar. If a request is ambiguous
("make the intro shorter"), prefer the UI; it is reversible in the same way a
human's own edit would be, and never risks touching engine code that vendors
out to every consumer repo on commit (see below). Say which mode you're in if
it isn't obvious from the request.

This repo is the **canonical home of the editor engine**: `docsync/` (content,
layout, blocks, stage, fragment), `docsync/editor/edit.html`, and
`report2027/tools/serve.py`. The `report2027/` report here is a **test
fixture** — a full copy of the Budget Primer used by the Playwright suite —
not the live report. The live report lives in `~/BudgetPrimerFinal`, which
**vendors** engine files from here.

Rules that bite:

- **Engine changes are made HERE, and vendoring is automatic.** A commit that
  touches `docsync/` or `report2027/tools/serve.py` triggers
  `.githooks/post-commit`, which runs `python3 -m docsync.vendor`: it copies
  every git-tracked engine file (the package IS the manifest — no list to
  maintain) into each consumer in `vendor.yml`, restages that repo's editors,
  and commits the engine paths there (local only; deploying stays each repo's
  own Push). New consumer repo = one line in vendor.yml. Fresh clone of THIS
  repo = run `git config core.hooksPath .githooks` once. The vendor refuses a
  consumer whose engine paths are dirty — engine edits must never originate
  in a consumer, and content/design changes in a report repo never flow back.
- **`docs/` is generated, not source.** Each report's `edit.html` and
  `engine/` there, and the built report itself, are written by
  `make -C report2027 pub` (which the live server runs on startup) and are
  untracked. Edit `docsync/editor/edit.html` and re-stage; never edit a staged
  copy. Only the editor's shell — `start.html`, `sw.js`, icons, the manifest —
  is tracked under `docs/`.
- **`edit.html`'s stylesheet is a JS template literal** — a backtick or `${…}`
  even in a CSS comment kills the whole script (editor hangs at "loading the
  render engine…", no console error). After any edit: `npx playwright test
  boot-errors.spec.js`, or minimum `node --check` the inline script
  (`report2027/tools/test_render.py` does this).
- **Shared building blocks live in `docsync/blocks.py`** (`graphic()`,
  `card(detachable=…)`, `is_light_bg`) — zero-stylesheet, importable by any
  project renderer, staged into the browser engine automatically. Add new
  reusable capabilities there, not in one report's renderer.
- **Tests:** `npx playwright test` (editor behaviour; ~425 specs),
  `python3 docsync/test_docsync.py` (engine round-trip),
  `python3 report2027/tools/test_render.py` (render tolerances + edit.html
  syntax guard),
  `python3 -m docsync.chart_parity` (after ANY change to `chart_svg()`: draws
  20k charts with the working tree's engine and with HEAD's and prints what
  moved — a published report must not move because the engine grew, and every
  render it reports has to be accounted for in `docsync/CHART_PARITY.md`),
  `python3 -m docsync.check` (every report's rendered OUTPUT:
  citation integrity, unrendered markdown, chart content outside its viewBox,
  text below the legibility floor — plus an `edit-mode draft` pass per binding
  that builds with DOCSYNC_EDIT=1 and warns on DEAD TEXT (visible strings with
  no data-slot/data-el hook) and FROZEN PROSE (sentences drawn inside an SVG),
  plus: words in a `<foreignObject>`, empty `data-fixed`/`data-restates`
  declarations, slot hooks the renderer never read or that hold words the
  slot never served (held to `DOCSYNC_SLOTLOG`), and text only the PUBLISH
  build has (it builds both modes and diffs them).
  A conversion/ingestion is not done until that line is clean AND its binding
  says `editability: strict` (findings become ERRORS, so CI fails a push that
  regresses; deliberate exceptions go in `editability_ok`, one exact string
  per line; scaffolds start as `wip`) — see the report-editor skill's
  "editability contract" section).
  Run the last one after touching any renderer — it walks docsync.yml, so a
  new report is covered the day it is bound, and it caught two shipped pages
  whose sources were built and never placed. Errors fail; warnings don't.
  `make -C report2027 validate` chains the older three but its build_data step
  needs fixture data files this repo doesn't carry — run them directly.
  If you inherit a full-suite failure, attribute it by
  running the suspect spec IN ISOLATION with and without your change —
  never from one full-suite run. Two known intermittents remain under
  parallel load (content-update's documented boot hang on a freshly adopted
  project — see the note in that spec — and toolbar's font-pick wedge);
  both pass in isolation. The old docsync.yml scaffold race (zz-spec-*
  residue, stomped registries) is FIXED: server writes hold a cross-process
  lock and specs clean up surgically — see tests/editor/fixtures/
  host-state.js before writing any spec that scaffolds or adopts.
- **Text size has a floor, and it is stated in POINTS.** `docsync/layout.py`
  holds `MIN_TEXT_PT` / `MIN_LABEL_PT` / `MIN_SUBLABEL_PT`; everything else
  converts off them. This exists because one page carries three units and
  only one is what the reader sees: CSS px (x0.75 = pt on paper), SVG user
  units in the page's INCH system (x72 = pt — a chart label written as `0.07`
  was five-point type), and `.page{zoom:1.25}` above 1120px, which flatters
  every desktop review and applies to neither the PDF nor a phone.
  `_check_text()` REFUSES an authored size under the floor rather than
  clamping it; `_lfs()` floors every chart label, so shrinking a chart box no
  longer shrinks its type into nothing; the editor's stepper stops at 10.5px.
  Two gates, both already in CI: `docsync.check`'s `check_text_size` reads
  sizes out of the markup, and `tests/editor/text-legibility.spec.js`
  measures COMPUTED sizes at phone/tablet/desktop/print — the only place the
  sheet's mobile scale-down and the CSS cascade are visible at all. **If you
  add a size anywhere, work it out in points first.** The phone case is held
  up by `blocks.py`'s `chart_scroll()` / `chart_scroll_css()`: an SVG with a
  viewBox shrinks with the sheet and its text goes with it, so below the
  sheet's own width a chart stops shrinking at the point its smallest label
  reaches the floor and its wrapper scrolls instead (the shape `mobile_css()`
  already uses for a too-wide table), with CSS-only scroll shadows so a
  clipped figure reads as scrollable rather than broken. **A chart added
  without that wrapper fails text-legibility.spec.js at 375px** — wrap it,
  passing the smallest font-size it uses in its own user units.
- **Never launch or kill a dev server the user owns**; Playwright starts its
  own throwaway servers and that's fine.
- **Real-time collaboration lives in `collab/`** (`collab/README.md` is the
  design record: Phases 0–4 done, the relay deployed, and the editor served
  from the staff hub by `python3 -m docsync.hub` — its docstring is the
  contract; the hook runs it after every engine or project commit, and
  FAILS if a project's page links a file its hub copy lacks. On the hub
  the document lives in R2 via `/api/docs`, decided once in
  `docStoreDecide()`; Publish there = one commit to `hub/<id>` by the
  Worker's `src/export.js`, nightly sweep too — the Worker holds the only
  GitHub credential on that path; Share… there is the hub's share list,
  and a viewer is told `view only` — the room and store enforce it;
  History/Comments there read the hub's store, not the Yjs doc). The editor's state model is
  deliberately untouched — `source`/`layout` are MIRRORED onto a Yjs doc by
  `collab/client/session.mjs`: `renderOnce()` flushes local → doc as a diff,
  `collabAdopt()` paints doc → local, and in a session `pushHistory()` marks
  an undo step on a `Y.UndoManager` instead of snapshotting. So a new
  mutation site needs nothing special AS LONG AS it ends in `render()` and
  starts with `pushHistory()`. Two rules: after touching
  `collab/client/session.mjs` or `collab/serialize.mjs`, run `cd collab &&
  npm run build:client` — `docsync/editor/collab-client.js` is a committed
  bundle the editor `import()`s, and only `collab.spec.js` notices it being
  stale; and `?collab=` / `?collabroom=` are honoured by a LOCAL editor only,
  because the page POSTs the GitHub token to whatever `collab` names.
- A report is bound in **`docsync.yml`** (id, content, build command, editor
  block); `python3 -m docsync.stage --id <id>` stages the editor + engine next
  to that report's published dir.
- **A project can name the Google Doc it was drafted in** (`doc:` on its
  binding; set it from File ▸ Google Doc, not by hand). File ▸ Import text
  from the Doc reads that doc and proposes where each section lands — by its
  `[[key]]` markers if it has them, otherwise by matching its headings to what
  the slots currently say. One-way: the doc is never written to, so there is no
  conflict to detect, and the approved rows apply as ONE pilot `batch` — one
  undo step, the same validation as typing them. Matching lives in
  `docsync/docimport.py` (pure, tested in `test_docsync.py`); the endpoints are
  `/__doc` and `/__doc/import`, and they are local-only because
  docs.google.com serves no CORS headers. The old two-way `docsync.sync` is
  not what this is and is not coming back.
- **Report templates live in `docsync/templates/`** (registry + logo assets;
  engine files, so they vendor to consumers like the rest of the package).
  "+ New report" offers them beside the blank canvas — editor File ▸ Open ▸
  New report and start.html both read `GET /__templates`; `/__scaffold`
  takes a `template` field; `docsync.new.create(template=…)` does the work.
  A template is DATA riding the one blank renderer (layout.json + palette +
  copied assets), never a different renderer. The three shipped templates
  are digested from Hawaiʻi Appleseed's PUBLISHED 2025–26 reports
  (hiappleseed.org/research — "A Fairer Tax Code" Jan 2026, "Keiki Ride
  Free" Feb 2026, "Pedestrian Head Start" Mar 2026, "Stalled" Oct 2025)
  and the cycle's web one-pagers: report (tax-blue #1E6194 cover/contents/
  body), policy brief (charcoal #232322 + gold #FDCF21), one-pager. The
  PDFs set Glober + Source Sans Pro. Glober is commercial (Fontfabric,
  $39/style — scoped 2026-08, no free weights); report/brief display is
  Barlow (OFL, same DIN-grotesque genre, checked against the real specimen,
  and already the live primer's own display face per layout.py's
  BRAND_FONTS). Source Sans 3 IS Source Sans Pro (Adobe OFL, renamed at
  v3). Only the one-pager keeps the website brand pair Manrope/Poppins.
  Palettes ride the bindings (which is what fills every colour
  menu's swatches); the logo SVGs land in the project's assets — Insert
  image lists a project's bundled images (manifest `images`, staged by
  docsync.stage into `docs/<id>/assets/`) before offering the file dialog.
  `font_link()` scans box styles as well as slot styles, and the scaffolded
  renderer emits it. If you add a template, keep every element inside the
  page (`check_bounds()` refuses a draft that hangs off it — that would
  brick the first render). Templates carry colour SCHEMES (the topic
  colours; `create(scheme=)`, both pickers offer them), and the report's
  page 4 is the replicable SECTION PAGE. The whole house style is data:
  `docsync.templates.style_guide()` — patterns as ready `addTextBox`/
  `addShape` dicts plus the build-out recipe — rides on `GET /__templates`
  and the MCP `style_guide` tool. When a user says "make a report from this
  text", start there (the report-editor skill's "Make me a report from this
  text" section is the walkthrough).
- **Bringing in a static HTML page**: `python3 -m docsync.scaffold page.html
  --id <slug>` does STAGE ONE (openable) automatically — project dir, wrapper
  renderer, docsync.yml binding, build + stage. Then `python3 -m
  docsync.propose --id <slug>` mechanically wires every substantial text
  leaf as an editable slot (worked example: `projects/our-mission`). The
  remaining STAGE TWO judgment work (renames, chrome pruning, widget
  restructuring) and what's still automatable is scoped in
  `docsync/STAGE2_AUTOMATION.md`.
  **Do not call a project done — or hand it back as "ready to edit" —
  once propose finishes.** Slots and movable images are all it wires;
  everything else in the page (stat cards, poll bars, any structural
  "content box") stays completely inert: no selection, no floating mini
  toolbar, and nothing anywhere says so unless you do. `propose` prints
  this same warning at the end of every run — it is not a courtesy note.
  Before finishing an ingestion, either do the STAGE TWO widget pass
  (`docsync/blocks.py`'s `graphic()`/`card()`, the report-editor skill)
  or tell the person plainly what remains unwired and why. The editor
  itself now carries a standing amber notice for this (`#s2` /
  `checkStage2()` in `edit.html`, keyed off `body.slotted.html` in the
  engine list, dismissible per project) — a net for the case this gets
  skipped anyway, not a substitute for saying so.

## Recent architecture (2026-07), so you don't rediscover it

- **The Squarespace block is a FROZEN render, not a responsive one.**
  `exportHtml(true)` emits a fixed-width design scaled into the host's column,
  so anything in the CSS that re-asks a question about the viewport is a leak:
  once pasted, it is answered by *Squarespace's* page, not by the report.
  Three things therefore happen at export time, in `edit.html`:
  `flattenMedia()` resolves every width-conditional `@media` at `VIEW_W` (the
  width the report is composed against) and inlines the winner — the primer's
  own `@media (min-width:1120px){.page{zoom:1.25}}` used to fire on a desktop
  host page and blow the sheet up 25% inside a wrapper built for 1×, with
  `overflow:hidden` eating the right-hand inch; `freezeViewportUnits()` turns
  `vw` lengths into px at the same width; and `measureDesignWidth()` renders
  the export offscreen and reads the width off `section.page` instead of
  taking it from the manifest, so a resize, a zoom or a bleed page can't put
  the wrapper and its contents at different sizes. `@media print` is dropped
  (a fragment in someone else's page is not a printed sheet). The scaled box
  is centred in the column — pinned left, a wide column read as skewed.
  **If you add a report-level media query or a `vw` length, it will be
  resolved, not carried** — that is deliberate. Chrome that should adapt
  (toolbars, download bars) belongs OUTSIDE `section.page`, which is the only
  element the design width is measured from.
- **Page resize is real, not cosmetic.** `layout.py`'s `Layout` reads an
  optional `"page": {"w": 8.5, "h": 11}` (or `"h": null` for pageless) from
  layout.json and emits matching `.page`/`@page` CSS via `layer()`'s
  `_page_style_once()` — so the preview, the published HTML and the printed
  PDF all agree. The editor's `File ▸ Resize` writes that field and calls
  `syncPageSize()`, which keeps the JS globals `PAGE_W_IN`/`PAGE_H_IN` (every
  clamp, guide and align rule) in step. **`syncPageSize()` must run in
  `boot()`**, not in `restoreCachedDraft()` — a stray anchor once put it in
  the wrong one and a resized report silently kept the OLD geometry for every
  drag/clamp rule while rendering the new sheet. If you touch boot-time
  layout normalisation, grep for `syncPageSize()` and confirm both call
  sites still make sense before you commit.
- **The File menu** (`#file` / `#filepop`) is the top-left entry point:
  Open (switch project — the old `#proj` `<select>` is gone), Resize, and
  Download/Token moved in from the bar (same ids, same handlers). `+ Section`
  is hidden via `#add { display:none }` only — still fully wired.
- **Auto-update + rollback** (`tools/selfupdate.py`, `serve.py`'s
  `/__update` and `/__rollback`, the editor's version chip `#ver`/`#upd`):
  an update REBASES the user's local Save commits on top when their files
  don't overlap with the incoming ones, refuses (naming the file) when they
  do. `apply_update()` records the pre-update SHA in
  `.primer-previous-version` (gitignored) so `--rollback` can `reset --hard`
  back to it — safe there specifically because that commit already includes
  the user's own prior saves. The server checks in the background every 20
  min (`UPDATE_POLL`), not just at launch.
- **Dismiss-on-outside-click** (`closeOnOutsideClick` /
  `closeOnOutsideClick`'s per-render twin `bindOutsideClose`): a click
  inside the report iframe does NOT bubble to the parent document, so it
  needs its own listener, rebound every render. Table/Chart/Colour panels
  are deliberately exempt (`RAIL_PICKERS` only covers Text/Shape/Icon) —
  they describe a selection and are used WHILE clicking the canvas. A click
  while any `dialog[open]` exists is ignored outright.
- **Chrome is one system now**: `--canvas` is the single grey behind the
  report, the contextual toolbar card, and `#work`'s background (the last
  one exists specifically so the rail's rounded corners don't show white
  wedges). `--r-ctl`/`--r-card`/`--r-edge` are the only three border-radius
  values anything should use. `--rail-w` is border-box — if you add another
  surface anchored to `left: var(--rail-w)`, this is why it lines up.
- **Contextual strip never shows an element's raw id** (`cover.logo` etc.)
  — it showed a count or nothing, with the id on `title=` only. If you add a
  new selection-summary field, keep that rule.
- **Page strip folds and remembers per project**
  (`localStorage['primer-rail-folded:'+M.id]`, restored in `boot()`).
- **Duplicate page copies a DESIGNED page's content (2026-09).** The
  renderer owns designed content, so the editor snapshots the page's pristine
  edit-mode markup (a render with none of the document's overrides on that
  page), moves every hook under `copy.<bid>.` and stores it on the blank
  page's entry (`layout.pages.blanks[].copy.html`), writing each slot's words
  into content.md under the new key. `docsync/pagecopy.py` redraws it from
  `Layout.layer()` — the one call every renderer emits inside every sheet —
  so no renderer changed. Rules: a new `docsync/*.py` module must be added
  to `stage.PACKAGE` or the draft dies with ModuleNotFoundError while the
  published build is fine (this one bit); `copy.` is a reserved id/key
  prefix; `Content` binds itself to its Layout (`bind_content`), which is
  how the layer reaches the words. **Words inside a chart are slots now**:
  `blocks.svg_text()` puts `data-slot` on the `<text>` and reads through
  `C.text_or(key, default)` (the renderer's wording stands when the document
  lacks the slot — a seeded hub room never shows a "new slot" marker in a
  chart); the editor edits an SVG slot in a floated field (`editSvgSlot`),
  and `edit()` seeds a slot the document has not got from the words on the
  page. rxkids-fiscal is the worked example (38 chart labels, the benefit
  pills as one list slot).
- **Words inside a drawing are refused at the build (2026-09-21).**
  `blocks.graphic()` raises `SvgLiteralError` in edit mode for any `<text>`
  with words and no hook — so the editor's draft does not render and
  `docsync.check` fails until each label is `svg_text` (a slot), carries
  `C.derived(…)` (a category/series name from data; never a sentence), or
  the graphic is declared `frozen="<why>"` (listed by the check, always
  visible). `is_data_mark` / `is_sentence` in blocks.py are the one rule,
  shared with check.py. Publishing never refuses. This exists because the
  check's old sentence-only warning let 224 labels across five reports
  ship frozen; all five now pass with zero literals. The staff toolkit's
  `_t()` helper routes every diagram label through a slot keyed by the
  wording's slug — the pattern for any renderer with a label helper.
- **A figure's DESCRIPTION is content, and a figure INSIDE a drawing is data
  (2026-09-21).** Two shapes the hook-counting could not see, both now
  editability findings that follow `editability: strict`.
  `aria-label` / `alt` / an SVG `<title>` are words in an ATTRIBUTE, so no
  slot on the element's text reaches them — and under `role="img"` a screen
  reader is told the description and nothing inside, so it is the WHOLE
  figure for anyone not looking at it. `blocks.describe(C, key, default)`
  makes it a slot (`data-desc`, read through `C.text_or`, so published bytes
  are unchanged until somebody edits one and no room needs reseeding);
  `blocks.slot_descriptions(C, html, prefix)` does a whole static body at
  once, keyed in document order — tfc-2027-priorities' 38 CSS bars go
  through it. Brand art and site nav are declared in the binding's
  `editability_ok`, not wired.
  The second: making a chart's labels slots made a NEW failure possible —
  retype `$3.0M` to `$4.1M` and the bar keeps its height, so the drawing
  disagrees with itself silently. `blocks.is_quantity` (the one rule, shared
  with check.py) flags a slotted `<text>` that states a figure;
  `svg_text(…, restates="<how it is remade>")` declares where the number
  comes from, exactly as `C.derived` does, and a SENTENCE is exempt — a
  caption is prose wherever its numbers came from. Worked examples:
  rxkids-fiscal (17), staff-toolkit (15), retitc and dotax-itep.
  **Still open:** a `data-desc` slot has no click target in the editor
  (an attribute carries no element to float a field over), so a description
  is edited through content.md or the MCP connector, not on the page.
- **Every text box moves and resizes, and a click in text types there
  (2026-09-22).** Reported on tfc-2027-priorities: a single click selected
  every word in the field (edit() selected the host's contents), and not one
  of its 141 fields could be moved — docsync.propose wired each as a slot and
  never as an object. The interaction model is now a slide tool's: a press
  that does not travel TYPES, with the caret where it landed (`caretAt`,
  `typeOnClick` from startDrag's release); a press that travels MOVES; the
  handles resize; Escape leaves the words and keeps the box selected (the way
  to align, lock or delete it — shift-click also selects without typing);
  and while the words are open, a grip under the box (`.ds-movegrip`) moves
  it without closing them. Groups still take a click to select, a second to
  drill in, a third to type; words inside a drawing keep their double-click.
  The guarantee has three nets: `docsync.check`'s IMMOVABLE TEXT (a
  `data-slot` with no `data-el` on it or above it — an error under
  `editability: strict`), the editor's own `#immov` chip and `audit()`'s
  `immovable-text` issues, and `tests/editor/text-boxes-move.spec.js`, which
  opens every bound report and drags a field on each strict one. The fixes
  that go with it: an imported page's markers are filled by
  `blocks.fill_markers` (every field, or the unit it is a piece of, gets
  `field.<key>`; published bytes unchanged until something moves), a list
  the renderer builds goes in `C.movable(key, markup)` (the `para.<key>`
  block C.html uses), and a moved flow element's strut holds its MARGIN box
  (`reserveMargin`/`reserveInline`, `strut_extra`) — a border-box strut let
  the line under a moved heading rise by the heading's margin. The live
  Budget Primer in ~/BudgetPrimerFinal still has 23 such fields (legend,
  table headers, the process ring's labels); its binding is `warn`, so they
  show as a warning there until its renderer is wired.
- **A rewritten test that only asserts a CSS declaration (`justify-content:
  center`, a class name, a boundingBox read right after a CSS transition
  starts) can pass against the exact bug it's meant to catch.** This bit us
  three times in one session — always verify a new/rewritten assertion FAILS
  on the pre-fix code before trusting it, not just that it passes on the fix.
