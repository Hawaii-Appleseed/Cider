# Cider test report — 2026-10-19 (run on madison / devin-mini)

Branch `cider-test-2026-10-19` (worktree `~/repos/Cider-test`), made from
`laptop-main` (713d0b7). Nothing pushed; nothing committed in `~/repos/Cider`.
`main` (add50da, GitHub) was checked out as a second worktree,
`~/repos/Cider-main`, to attribute failures. 15 commits on the branch: 13
fixes, each with a regression test that fails before the fix, and 2 stale
specs repaired.

## What was run

### Python checks

| Check | Before | After |
|---|---|---|
| `python3 docsync/test_docsync.py` | died with `OSError: Too many open files` at macOS's default limit of 256 (this shell had a higher limit; the error reproduced with `ulimit -n 256`). Under a higher limit, 1 failure: `slotsOf` declared twice | all checks pass, also at `ulimit -n 256` |
| `python3 report2027/tools/test_render.py` | pass | pass (now also shoots two pages through real Chrome) |
| `python3 -m docsync.check` | 29 files, 0 failing, 12 with warnings | the same |
| `python3 -m docsync.chart_parity` | 24,497 renders, 0 differ | 24,497 renders, 0 differ |

### Playwright suite, here, `--workers=2`, in thirds (162 spec files, 54 per chunk)

| Chunk | First run (713d0b7 + early fixes) | Final run (branch head) |
|---|---|---|
| A (specs 1–54) | 313 passed, 6 failed, 72 did not run | 322 passed, 2 failed, 70 did not run |
| B (55–108) | 245 passed, 3 failed, 6 did not run | 252 passed, 1 failed, 6 did not run |
| C (109–162) | 358 passed, 0 failed | 360 passed, 0 failed |

The "did not run" tests are the serial collab files, which stop at their
first failure. Every failure in the final run is environmental on this Mac:

- **Collab specs on fixed ports.** `collab.spec` (8792), `collab-drafts`
  (8793) and `collab-hub` (8794/8798/8799/8800) collide with madison's
  long-running services: agent-room's node server on 8799, a Python service
  on 8794, Claude Voice on 8792. They pass with the ports shifted by 100
  (shifted only in the working tree for those runs, not committed):
  `collab` 25/25, `collab-drafts` passed, `collab-hub` 50/50 in 3 of the
  last 5 full runs. The other 2 runs each failed one test, a different one
  each time (a tile's box read null right after it became visible; a
  restore race). That file is intermittent here, not broken.
- **`ingest-notices`** needs PyMuPDF (`import fitz`), which this Mac lacks.
  With PyMuPDF installed into a scratch directory on `PYTHONPATH`: 7/7.
- **`collab.spec:557`** (both editors type in one paragraph) failed once
  under 2-worker load and passes alone.

Also set up here: `collab/` needs its own `npm ci` (its `node_modules` was
missing). `npm run test:ci` was not used.

### Attribution of the first run's failures

Each was run alone, on the branch and on main:

| Failure | On main too? | Cause | Resolution |
|---|---|---|---|
| arrange: "a grid cell moved…" | yes | the UHERO swap-table header it moved became a real table (28bcb70); also exposed a real anchor bug | test given its own grid (via `prepPreviewHtml`); anchor bug fixed, 3b384d3 |
| arrange: "a designed piece with a css margin…" | yes | rxkids' entrance animation replays after every render; the 150ms settle read mid-rise | editor fix, 77003c4 |
| edit-in-place: "a word wider than its box…" | yes | rxkids' `hero.title` became a logo (182718c) | test re-pointed at an over-long word in an h2, b72002d |
| collab-hub: "Editor" tab, "can edit", "modified" | yes | the staff hub renamed the tab to Cider (hub ec0f50b), dropped the "can edit" tag (8d9f66b) and capitalised "Modified" | spec updated, 040f556 |
| collab-hub: History | no, new | two `#history` buttons | fixed, c05f351 |
| collab / collab-drafts | env | ports, and `collab/node_modules` missing | see above |
| patched-scripted-pages: rxkids, our-mission | yes | note marks misplaced | fixed, fe60775 |
| ingest-notices | env | no PyMuPDF | see above |

The two intermittents named in the brief (content-update's boot hang,
toolbar's font-pick wedge) did not show in either full run.

A chunk-1 run also left a `wrangler dev` relay orphaned on 8793: when
`collab-drafts`' `beforeAll` timed out, its `afterAll` had nothing to stop.
I killed it. Worth a guard in that spec.

### Real exports (serve.py's own functions, real Chrome, every bound report)

Script: `_parse_pages` edge cases; for each report's published page,
`_only_pages` per page, the first plus last pages together, and a cold
one-shot print, all through `--print-to-pdf` / the warm Chrome, with pages
counted by pypdf; and `_page_alone` → `_chrome_png_one` for pages 1, 2 and
the last.

- `_parse_pages`: 11/11 cases right ("3", "3-5", "1,4-6", spaces, "0", "5-3",
  "a", "", "1-", "1,,2", past the end).
- PDFs: on all 14 reports, the single-page counts sum to the whole PDF, the
  range PDF counts are right, and cold equals warm. Pageless reports print
  as several sheets, as they should (rxkids 23, our-mission 11,
  tfc-2027-priorities 5).
- PNGs were wrong before the fix (ebedc5c): see bug 3. After it, every page
  is its own width (816 or 1200px at scale 1) in its desktop layout. I
  looked at screenshots of the primer pages 1, 2 and 12, eviction page 12,
  rxkids, our-mission and tfc. Three paged pages come out a little taller
  than 11in because their content is taller on screen: primer p12 (1067px),
  rxkids-fiscal p1 (1069), staff-toolkit p2 (1072).

### Hands-on (Playwright with real mouse and keys, every bound report)

A driver (kept out of the repo) opened all 14 reports and, with real
clicks, drags and keys:

- booted them and checked every page rendered;
- typed into a slot, then undid and redid the typing;
- drag-moved an object and resized it by its handle, then undid both;
- swept every item of the right-click menus (on an object, in words being
  typed, on a page), the File menu and the Download menu, flagging any item
  with no observable effect or any console error;
- opened the Layers, Colours, Hyperlinks, Links, Preflight and History panels;
- clicked every button on the contextual card for a new text box, shape and
  table.

A second driver ran each of today's features through its UI on
staff-toolkit, my-report and eviction-code-guide; the Budget Primer and
retitc were used for Paste Into and the Chart panel. Screenshots were looked
at where looks mattered.

Results:

- **Boot:** all 14 reports boot and render every page. Typing, undo and redo
  work on every report with slots. Move, resize and undo work everywhere.
- **Features by UI:**
  - 57: key object with Align to "key object" and a 0.5in gap distribute.
  - 64: Linear → Apply gradient, and Save as gradient swatch.
  - 82: Link to a place, after fix 1cbc3bb.
  - 83: PDF page range sent as typed.
  - 85: the Layers panel.
  - 51: ⌘↩ Quick Apply.
  - 55: Sub-levels and Numbering continues, after fix 0eda328.
  - 58: picture into a shape from a picture box, after fix 568d000.
  - 63: Story editor edits and undo.
  - 50: Save to library, then place.
  - 84: "Show only in" print/web.
  - 65: Copy style / Paste style.
  - 67: Glyphs inserts ʻokina.
  - 69: History panel.
  - 71: JPEG, selection and package rows produce downloads.
  - 72: ⌥-measure reads "0.50in across".
- **Chart panel:** opened from the card's Chart button on the primer and
  retitc; editing a value redraws the chart and undo restores it.
- **Every menu item** in the sweeps did something, with three exceptions.
  The flags that were my driver's mistakes are not listed here.

## Bugs found and fixed

All of these are on the branch, each with a test that fails before the fix
and passes after (checked by swapping the old `edit.html` back in).

1. **test_docsync leaked file descriptors** (2d49493). `mkstemp()` was
   called eight times without closing its fd. One `_tmp_json()` helper now
   closes the fd and removes the file at exit.
2. **History panel labelled every text edit "no visible change"**
   (0ba14d6). Found by test_docsync's duplicate-function check. The History
   panel's own `slotsOf()` (an object) was overridden by suggestion mode's
   (a Map). There is now one `slotsOf`. Test: polish.spec.
3. **Page PNG export was wrong on most reports** (ebedc5c). Found in the
   real-export run. Every page was shot in an 816×1056 window:
   - at exactly 816px the engine's phone rule (`max-width:` the page's
     width) fires, so on eviction-code-guide's endnotes page every moved
     element dropped into the flow;
   - 12.5in reports (rxkids, our-mission, tfc) came out cropped and in
     their tablet layout;
   - the primer's own phone rule (850px) would fire at any page-width
     window.

   The warm Chrome now shoots at a 1600px window (or wider than the page),
   clipped to `section.page` and scaled to undo a desktop zoom. The one-shot
   fallback uses the page's CSS width plus one pixel, so its PNG is one
   pixel wider; there's no image library in serve.py to crop it. Test: in
   test_render.py, an 8.5in and a 12.5in page through real Chrome.
4. **Two `#history` buttons** (c05f351). Found by collab-hub's History test
   (strict mode). The new undo-History button (69) reused the id of the
   hub's saved-versions History. So on the hub the versions button never
   showed, and ⏱ also opened the versions panel. The undo button is now
   `#steps`. Test: test_docsync refuses an id given twice in the editor's
   markup.
5. **A report's entrance animation replayed on every edit** (77003c4).
   Found through arrange.spec. rxkids' panels fade in and rise 8px (.35s)
   after every render, so the page flickered at each keystroke. `wire()`
   now finishes one-shot CSS animations on new nodes. Published pages are
   untouched.
6. **Anchored pieces landed one border-width too low** (3b384d3). Found
   through arrange.spec. ANCHOR_JS measured the containing block from
   outside its border; UHERO's figure grid has a 2px top border, so a 0.1in
   nudge became 0.121in. It now subtracts `clientTop`. This changes the
   bytes of the two reports that ship the script (primer, rxkids); full-page
   renders of both are pixel-identical before and after.
7. **Note marks in the wrong place** (fe60775). Found through
   patched-scripted-pages.spec, which failed on main too.
   - our-mission's note is on words in a hidden carousel panel, so its mark
     sat in the page corner.
   - rxkids' mark was placed before the fonts and pictures settled, and
     stayed 30px off.

   Marks now skip undrawn words and are redrawn once fonts and images load.
8. **Library overlay couldn't be closed with Escape, and both new overlays
   had a squeezed head** (930fa08). Found hands-on.
   - File ▸ Library opened a full-screen overlay with focus on the page, so
     Escape didn't reach it and the whole editor was blocked until Done.
     Done now takes focus.
   - Library's and Story editor's head buttons stretched (`.sw-default`),
     folding the title and note into columns of single words.
9. **Escape closed no menu or panel** (d19e0c3). Found hands-on. File,
   Download, Resize, Colours, Layers, Hyperlinks, Links, History, Notes and
   Preflight only closed on a click away. Escape now closes them, unless a
   modal is up or the key comes from a field inside the pop, and keeps the
   selection. Test: file-menu.spec.
10. **HTML export replaced the web-font link with a 404 page** (5eff208).
    Found hands-on: a 404 during every HTML download.
    - `inlineEverything` joined `https://fonts.googleapis.com/…` onto the
      project folder. `fetch` doesn't throw on a 404, so the server's error
      page went into a `<style>` and the fonts were lost. The existing
      "no links left" assertion passed *because* of the bug.
    - Absolute stylesheet links now stay links, and only stylesheets that
      fetched OK are inlined.
    - The Squarespace block, which drops all links, now carries the
      report's web-font links.

    Tests: export-html.spec.
11. **"Link to a place in this report" offered no places on most reports**
    (1cbc3bb). Found hands-on. It missed `<h1 data-el><span data-slot>`,
    the usual way renderers draw a heading. staff-toolkit (30 headings),
    retitc (6) and the primer (9) had nothing to link to. I checked that a
    published build links to such a span correctly. Test: parity-64-82.spec.
12. **Type-card buttons were dead while typing** (0eda328). Found hands-on.
    A press on the card ends the typing on pointerdown, and the card swaps
    its B/I/U group for a narrower one at once. So Case, colour, spacing,
    ¶ Paragraph (where numbered lists are set), effects and Reset slid 116px
    out from under the pointer before release, and no click reached them.
    A button that has moved away from the pointer at mousedown now gets the
    click on release. Test: numbered-lists.spec.
13. **Shift-click couldn't extend a selection from words being typed**
    (568d000). Found hands-on; pre-existing on main. A click types in a
    box, so "click this, shift-click that" never selected two objects, which
    is the way to Align, Distribute or Put the picture inside a shape.
    A shift-press now leaves the words (keeping them) and extends the
    selection. Test: smart-arranging.spec.

Also repaired (stale tests, not code): 040f556 (collab-hub matched to the
hub's wording), b72002d (edit-in-place). The arrange grid-cell test was
re-pointed in 3b384d3, and the css-margin test passes again after 77003c4.

**Published bytes:** all 14 reports were built with `DOCSYNC_DATE` pinned,
before (713d0b7) and after. 12 are byte-identical. budget-primer and
rxkids differ only by the ANCHOR_JS change (bug 6), and render
pixel-identical.

## Found and left (for Devin)

- **retitc page 3 overflows into its source footer**, on screen and in the
  printed PDF. The last paragraph runs over the pinned "Source: DOTAX
  Table A-5…" footer. The editor shows "1 page cut in print"; `docsync.check`
  doesn't flag the overlap. This is page content (too much for the sheet),
  so I left it to you. Screenshot:
  `/private/tmp/claude-502/-Users-devinthomas-repos-Cider-test/c636ee97-ea4f-4b78-8531-b67d43dde637/scratchpad/shots/retitc-p3-pdf.png`
- **our-mission's three.js hero never runs.** The source page had an import
  map to `./assets/vendor/three.module.js`. The renderer keeps only `<style>`
  from the head, and the vendored file was never brought into the project.
  The published page throws `Failed to resolve module specifier "three"` on
  every load (and the editor on every render) and falls back to the CSS
  mark. The fix is to vendor three.js (~1MB) into the project or drop the
  effect; that's your call.
- **No page menu on five reports.** demo-report, tax-testimony, dotax-itep,
  uhero-trc-summary and retitc write `<section class="page">` by hand,
  without `data-page`/`data-fill`. Right-clicking a bare page there gives
  nothing: no Duplicate, Margins, Guides, Reading order or Page colour. This
  needs wiring in each renderer (`L.sheet`, or `L.fill_attr` plus a page
  id), which changes their bytes, so I left it.
- **Paste Into (58) works only from a picture box**, a text box holding an
  image. A renderer-drawn picture (the primer's branch photos) offers no
  "Put the picture inside this shape". That seems to be the intended scope.
- **A long object menu can run under the page strip.** The menu's
  flip-to-fit measures the frame, which extends behind the bottom page
  strip, so its last items (Forward / Backward / Send to back) can be hidden
  near the bottom of the window. Cosmetic.
- **A 404 in the console on every boot** of a project whose base isn't its
  id (demo-report's is `demo`): boot's speculative `engine/manifest.json`
  fetch. It's deliberate ("costs one wasted 404"), but it's the only console
  error most reports show.
- **History rows reading "no visible change".** Some steps (Quick Apply
  "Bring to front" on something already at the front) push a history step
  that changes nothing. Minor.
- **Collab specs use fixed ports that collide on madison** (8792, 8794,
  8799). Making them overridable by environment variable would let the
  suite pass here. collab-drafts can also leave a wrangler relay running
  when its `beforeAll` times out.
- **The `#rail-head` id is given twice**, once in the markup and once for
  the rail's "Hidden" separator. It's used only for styling, so it's
  harmless.

## Not tested

- The real hub (Cloudflare Access, R2 store, Worker publish): only the local
  collab relay and hub-check servers the specs start.
- Google Doc import, GitHub Push and Publish, Token, Connect GitHub,
  Open/New report and New window. These were skipped in the menu sweep
  because they leave the editor, write outside it, or need a person.
- Squarespace paste into a real Squarespace page. The exported block was
  only checked as text (scoped CSS, font links).
- Firefox and WebKit (`ALL_BROWSERS`): Chromium only.
- Typing into text-box-only reports (eviction-code-guide, my-report,
  itep-act24-estimate) by the driver. Moving, resizing and the menus were
  covered there, and box typing is covered by the existing specs.
