# Cider weak points, third pass — 2026-10-23 (Mac mini, worktree `audit3` off main @ 813bddc)

The first two passes drove the editing surface (chords, handles, paste, drag)
and the paths that hurt when they fail (Save/Push, collaboration, export, Find,
first run). This pass took what neither had: comments and suggestions,
tables and charts, image upload and replacement, keyboard-only and
screen-reader reach, a phone-width window, offline behaviour, a 100+ page
report, ʻokina and kahakō everywhere they are typed or stored, and the work
that landed in PRs #28–#34 (pageless export, font embedding, forget-project,
the restore merge). Each area was driven in the real editor with Playwright
(throwaway probe specs that printed what the editor did and asserted
nothing), against budget-primer, our-mission (pageless), and a 120-page
report built with the pilot API.

**Fixed on the `audit3` branch, items 1–18, each pinned by a test in
`tests/editor/audit3.spec.js` that fails on the editor before the change and
passes after** (the first 17 tests were run against the old edit.html and all 17 failed;
the font-timeout test would hang to the test timeout without the change). What was found and left stands at the end, with why.

## Ranked

### 1. `setChart` and `setStyle` answered `ok: true` over "This draft does not build"

The first pass fixed this for `place`, `recolor` and the rest, by routing them
through `batch()`, which rolls back a result the engine refuses. `setChart`,
`setStyle` and `fit` never went through it: `setChart(id, {type: 'nonsense'})`,
`{series: []}`, `{series: [{data: ['x', 1]}]}`, `setStyle(id, {size: 'abc'})`,
`{color: 'nope'}`, `{weight: 'heavy'}`, `{align: 'sideways'}` each returned ok,
left the canvas on a traceback and the draft unsavable until ⌘Z. Every
MCP/connector call and `/__pilot` goes through these verbs. A shared
`_pilotGuarded()` now snapshots, applies, renders and, if the engine refused,
puts the document back, withdraws the history step and says what the engine
said (the same words `batch()` uses). `setBoxText(id, 5)` also threw a raw
`TypeError: md.trim is not a function`; it is validated.

### 2. A fake ʻokina typed in capitals or at a sentence start shipped

`fixOkina` matched case-sensitively: `HAWAI'I` (a heading), `OAHU'S`,
`'Ōlelo`, `'Āina` and `'Ohana` at the start of a sentence all stayed as
straight apostrophes. Matching is now case-insensitive and the fix keeps the
typed case letter by letter. `Ni'ihau` and `ʻōiwi`-style words were missing;
Niʻihau is added.

### 3. A kahakō typed as letter + U+0304 was stored decomposed

Text pasted from a Mac file name, a PDF or dictation can carry `a` + U+0304.
It draws as a detached bar in most of the report's fonts, and a search for ā
does not find it. `fixOkina` now composes (NFC) whenever a combining mark is
present, so every path that already ran it (slots, boxes, cells, the pilot)
stores one character.

### 4. ʻokina fixing stopped at the prose: chart titles, labels, series names and table cells made by a pilot or the Chart panel kept the typed apostrophe

`fixOkina` ran in `writeSlot`, box text and the cell editor. A chart's title,
labels and series names (`addChart`, `setChart`, the Chart panel) and a
table's cells (`addTable`, `setTable`, a pasted grid) were written straight.
`Hawai'i` ended up in layout.json and on the published page. `renderOnce` now
walks the layout's own words through the same fixer (ids, paths, links and
fonts are skipped), the one place every one of those writes passes.

### 5. A second picture with an existing name overwrote the first

The server (and the hub) write an upload by file name. Every pasted
screenshot is `image.png`, a phone's is `IMG_0001.jpg`: the second upload
replaced the first, and the first picture changed everywhere it was placed.
A name the report already uses (`projectImages()`) now gets eight hex
characters of the file's bytes.

### 6. A picture named with a kahakō or ʻokina lost its letters: `Hōkūleʻa.jpg` → `h-k-le-a.jpg`

The client's name rule replaced every non-ASCII run with a hyphen. A kahakō
now folds to its plain vowel and an ʻokina goes (`hokulea.jpg`), as the
report's own URLs do.

### 7. Replace image kept the crop of the old picture

`layout.img[id].crop` frames the old photo. Laid over one of another shape it
shows the wrong part or zooms on nothing. A replacement starts uncropped; the
frame, fit and filters stay.

### 8. Keyboard only: ⌥] / ⌥[ never left page 1

They walk the objects of one page, wrapping inside it. A keyboard alone could
reach the cover's three objects and nothing else (twelve pages, ~100 slots):
the pointer was the only way anywhere. The walk now goes on to the next
page's first object (back: the previous page's last), wrapping at the ends of
the report, and scrolls the page into view.

### 9. Escape closed a menu and dropped focus on `<body>`

File, Layers and the other pops: Tab into the menu, Escape, and the next Tab
starts again from the top of the window. Focus returns to the button that
opened it (`pop.__opener`, set by `togglePop`).

### 10. The status line was invisible to a screen reader

`#stat` is where every outcome appears ("saved", "refused …", "draft does not
build") and was a bare `<span>`. It is `role="status" aria-live="polite"`.
(It speaks "rendering…" and then the result on every edit; polite means it
waits for the person to stop, and the result is the line that matters. A
separate quieter region for the render chatter is the finer fix — left.)

### 11. Phone width: Bold, Italic and Underline sat 630px along a sideways-scrolling type strip

At 375px the text strip is 1262px wide inside a 308px window. A selection
needs B/I/U more than the font picker; they were four swipes away. They lead
the strip at ≤600px (`order:-1`).

### 12. A pageless report let `place()` put a box 175in below the end of the sheet

A pageless document's `PAGE_H_IN` is the 200in sentinel. our-mission's sheet
is 24in; `place(id, {y: 5000})` answered ok with `y: 199.41`, and the box was
drawn past a sheet that is `overflow:hidden`: gone. The drag placer, a
group's clamp and the resize clamp all used the sentinel. `pageBottomIn(page)`
measures the drawn sheet for a pageless document and is used by all three.

### 13. `addTable` off the page was accepted

A chart, a shape and a box off the page are refused by the engine ("extends
past page 3"); a table is not, so `addTable({x: 50, y: 800})` saved a table
nobody can see and only `audit()` knew. Refused at the verb.

### 14. Deleting a header row turned the first body row into a header

`tableDeleteRow` clamped `headerRows`/`footerRows` to the new row count but did
not take one off when the deleted row was inside them: delete row 0 of a table
with `headerRows: 2` and the count stayed 2, so a body row became a header
(and a deleted footer row left the count too high). A row removed from the
header or footer takes one off its count; one inserted inside joins it.

### 15. Hawaiian names refused where they are asked for

The New swatch, gradient swatch and cell-style dialogs, and Add section's
short name, accepted only `A-Za-z0-9 _-`: "Ōhiʻa red" was refused, and a
section named "Hōkūleʻa" became `h-k-le-a`. `asciiName()` folds a kahakō and
drops an ʻokina first ("Ohia red", "hokulea").

### 16. Search did not know Hawaiian letters outside Find

The sources manager's search and the comment `@` picker matched with a plain
`toLowerCase().includes`: "aina" did not find ʻāina, "kaleo" did not find
Kāleo. Both fold (`foldHaw`).

### 17. Forgetting a report with the server gone showed the parser's words

`forgetProject` used a bare `fetch` + `r.json()`: a dead server read "could not
forget X: Failed to fetch", an error page read "Unexpected token '<'". It goes
through `postLocal` like Save and Push.

### 18. A font host that never answers hung the package export

`inlineWebFonts` (PR #28) fetched the Google Fonts stylesheet and each face with
no timeout. A blackholed network (a captive portal, a firewall that drops)
waited as long as the browser would. Ten seconds each now, then the `<link>`
stays and the README says so, as for a refusal.

## Found and left

- **Comments and suggestions were not driven live.** They live behind the hub
  (`collab-hub.spec.js` boots wrangler against `staff-updates-internal`), and
  `collab/node_modules` is installed in neither this worktree nor the main
  clone on this Mac, so `Cannot find package 'ws'`; those specs run on GitHub
  only. Read statically instead: mentions render as text nodes (no markup
  injection), a reply under a provisional card waits for the real id (second
  pass), and resolved/deleted threads are covered by 20 existing tests. Not
  fixed: comment text and a suggestion's inserted words do not pass through
  `fixOkina` (a comment saying "Hawai'i" keeps the straight quote; it is not
  published).
- **The Find dialog has no ʻokina/kahakō-insensitive mode.** Searching `aina`
  does not find ʻāina and `Hawaii` does not find Hawaiʻi. That is correct for
  a Change all, but a "match Hawaiian spellings" option is what a policy
  editor wants. Sources and `@` search fold now; Find needs a UI option.
- **Phone width: the left tool rail covers 67px of every page and the page
  strip 90px at the bottom** (375×667), and the top bar scrolls sideways to
  its second half (zoom, layers, present). Usable, not good. A collapsed rail
  at ≤600px is a layout decision.
- **Screen-reader reach is partial.** There is a keyboard path now (⌥] to walk
  objects, Enter to open the words, Escape to leave), but the page is an
  `<iframe>` of plain markup: paragraphs have no role or tab stop, a selection
  is announced only through `#stat`, and there is no "page 3 of 12" landmark.
  The Story editor (File ▸ Story editor) is the screen-reader route to prose
  and was not tested with an actual reader.
- **A blackholed font host stalls the editor's own first render** (the report's
  Google Fonts `<link>` inside the srcdoc blocks the iframe's load): found
  while writing item 18's test, where a never-answering `fonts.googleapis.com`
  route held the first render past 75s. A refused connection is fine; a
  dropped one is rare. Fix is preloading with a timeout or a `font-display`
  swap in the editor's copy.
- **Offline**: the shell caches (v8) and a warm boot works, but `engine/*` is
  network-only by design, so offline the editor says "the dev server is not
  running … this page came from the offline cache" and draws nothing. That is
  the documented trade; there is no read-only offline view of the last render
  (`ds-preview-v1` held 0 entries after a boot under the test fixture, so the
  warm-boot preview may not be written there — unconfirmed).
- **Rotate/skew with `NaN`, a string or 1e9 answer ok** (they build; the
  value is clamped or ignored). Harmless, not a validation error.
- **Setting `setStyle size: NaN` or `leading: -4`** builds; no refusal.
- **The upload server still overwrites by name** (serve.py `_upload`); item 5
  closes it from the client. A hub that was never given the new editor, or any
  other client of `/__upload`, can still clobber.

## What was checked and works

**Large report.** 117–122 pages (blank and duplicated content pages) built
with `addPage`/`duplicatePage`: adding a page is 150–250ms flat from page 1 to
105, a full render 157–207ms, undo 162–177ms, audit 6–9ms, preflight 31–41ms,
the Layers panel 27–33ms, the heap 139–148MB, layout.json 8KB, and a scroll to
the end of 157,000px settles in 20ms. Nothing degrades with page count.
**Tables.** Deleting every row or column of a table with merges, column
widths, per-cell fills and aligns leaves a valid 1×1 table (the menu disables
the last); merges shrink, drop or shift with their lines; `colw`/`colAlign`
splice; `rowh` splices; a merge off the table, a `colw` of the wrong length
and a header count above the row count are refused by the engine and rolled
back with the engine's words. **Charts.** Negative, ragged, longer-than-labels,
null, all-zero, huge (1e30), duplicate-label, one-point line and a pie with a
negative value all build. **Images.** A non-image or undecodable file is
uploaded as it is (the browser's decode failure is swallowed, the file kept),
SVG is not rasterised, and a file over 2000px is shrunk and says by how much;
a drop or paste of a picture lands at the pointer on the page in view.
**Accessibility.** Every button, input and select in the chrome has an
accessible name (labels, `aria-label` or title); dialogs are native `<dialog>`
(focus-trapped, Esc-closable); every `<img>` in the report has an `alt`.
**Pageless (PR #28).** our-mission is one 24in sheet; Add page, the endnotes
section and the arrange commands measure the drawn sheet, not the sentinel.
**Forget-project (PR #29).** Forgetting the open report goes to the start
page, the registry keeps a tombstone, adopting the folder brings it back, a
refusal leaves the list alone. **Restore merge (#31).** The existing 2-editor
specs cover the confirm that names who holds unsaved words and the per-slot
merge; not re-driven here (hub specs, above). **Offline.** With the service
worker active and the network cut, `edit.html` loads from the shell cache and
says plainly why nothing draws, rather than hanging on "loading the render
engine…".
