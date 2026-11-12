# The connector, against the editor

Scoped 2026-11-11. The goal (Devin): anything a person can do to a report in
the Cider editor, Claude can do through the hub connector (`read_report`,
`edit_report`, `add_section`, `arrange_report`, `new_report`,
`revert_report`, `open_in_editor`). This file is the gap matrix and the
order to close it in. Research only; nothing here is built yet.

State read at: Cider `main` 97ee705 (PR #122, layer verbs, merged); hub
`origin/main` 8bc8b84 (PR #12, layer verbs listed). Earlier notes that said
"no addImage, no removePage, no sendToBack" are **out of date**: all three
are on the hub now (`addImage` via url/src/≤40 KB data, `removePage`, and
`sendToBack`/`bringToFront`/`sendBackward`/`bringForward`/`setLayer`, plus
`behind`/`z` on addTextBox/addImage).

## How a human action reaches Claude: three layers

1. **The editor's own pilot API**: `window.docsync.api` in
   `docsync/editor/edit.html` (~33852), with `PILOT_BATCH_VERBS` (~33446) and
   `PILOT_SINGLE_VERBS` (~33782). The hub relays to it through the room
   (`hubPilot`, ~33790).
2. **The hub's allowlist**: `PAGE_VERBS` in
   `staff-updates-internal/functions/api/mcp.js` (~120). `arrangeReport`
   (~1305) refuses any verb not on it. That one list also builds the tool
   description and `read_report`'s `arrange_verbs`.
3. **Hub-side tools that do not go through the editor at all**: text
   (`editReport`), sections (`addSectionTool`), versions (`revertReport`),
   the shelf (`newReport`). These call the hub's own REST routes
   (`functions/api/docs/[[path]].js`, `functions/api/primer/[[path]].js`) as
   the person (`asPerson`).

So a gap is one of three kinds, from cheap to costly:

- **A. In the pilot, missing from `PAGE_VERBS`.** One entry per verb on the
  hub, plus a `verbOf` signature. No editor change.
- **B. A hub REST route exists, no MCP tool.** A new tool in `mcp.js` that
  calls the route through `asPerson`. No editor change, and no open editor
  needed.
- **C. Only in the editor's UI.** The editor first needs a pilot verb (a
  `_pilotValidate*`/`_pilotApply*` pair in `PILOT_BATCH_VERBS`, or a single
  verb), then kind A.

And one gap that is structural, not a verb (**D**): every page change needs
**a human to have the report open** in an editor tab. A person never has that
limit.

Legend: ✅ supported · ◐ partly · ❌ missing. The **Kind** column says which
of A–D closes the gap.

## Gap matrix

### Words, sources, sections

| Human action | Connector | Kind | Notes |
|---|---|---|---|
| Edit slot text (prose, headings, lists, bold/italic, links) | ✅ `edit_report` md / find-replace | — | Works with nobody open (store path). |
| Edit a text box's words | ✅ `setBoxText` | — | |
| Edit a table cell | ✅ `setCell` | — | |
| Edit chart text and labels | ✅ `setChart` | — | |
| Add a prose section (+ Section) | ✅ `add_section` | — | Only on pages the manifest opens. |
| Add a source and cite it | ✅ `edit_report` sources[] | — | |
| Edit, rename, reorder or delete a source (Sources panel) | ◐ | B/C | Renaming an id everywhere (`renameSource`), `moveSource` and `deleteSource` have no path. Editing the text works by rewriting `sources` with `edit_report`. |
| Add or sync the endnotes page | ✅ `addEndnotesSection` | — | |
| Continue endnotes on a new page | ❌ `continueEndnotes` | A* | It's on `docsync.api`, but in neither pilot set. |
| Insert variables, page number, cross-reference, linked text (text menu ▸ Insert) | ◐ | C | The `{var:…}` chips can be typed in markdown only if Claude knows the grammar. `setVariable` defines them (kind A). |
| Define variables | ❌ `setVariable` | A | |
| Conditional text (show only in print/web) | ❌ `setCondition` | A (+C for applying a condition to a span) | |
| Find & Change across the report (incl. GREP, style filters) | ◐ `edit_report` find/replace (one slot, one hit) | A | The pilot's `findChange` does the whole report. |
| Replace a font everywhere | ❌ `replaceFont` | A | |
| Writer's notes (add, edit, delete) | ❌ `setNotes` | A | Plus a read: `notes()`. |
| Change case, glyphs, special characters | ◐ | — | Can be typed in markdown. |
| Link a URL, change a link everywhere, link bare URLs | ◐ markdown links | A | `changeLink`, `linkBareUrls`. |
| Check links | ❌ `checkLinks()` | read | See the read-queries row. |
| Google Doc link / import | ❌ | C | Local editor only (`postLocal`). Probably out of scope on the hub. |

### Objects: place, look, order

| Human action | Connector | Kind | Notes |
|---|---|---|---|
| Move, resize, rotate, skew, flip, clear transforms | ✅ | — | |
| Nudge, scale %, group scale | ✅ (through `place`) | — | |
| Align, distribute, align-to | ✅ `align`/`distribute` | — | |
| Z-order (front/back/forward/backward/exact) | ✅ | — | Since PR #122 / hub #12. |
| Group, ungroup, lock, unlock | ✅ | — | |
| Duplicate, delete | ✅ | — | |
| Copy, paste, paste in place, cut | ◐ `duplicate` | — | Within one report. No path across reports except the library. |
| Copy style / paste style (format painter) | ❌ | C | `copyStyle`/`pasteStyle` are UI-only. |
| Step and repeat, transform again | ❌ `stepRepeat` | A | Transform again: C. |
| Fill colour (box, shape, page) | ✅ `recolor` | — | Hex, `@Swatch` (with a tint %), or a linear/radial/conic gradient: checked 2026-11-11 (`_pilotValidateFill`). |
| Gradient fill, named swatch | ✅ `recolor`, `defineSwatch` | — | Step 1. |
| Border colour/weight (shapes) | ✅ `setShape` stroke/sw | — | |
| Border dash, line ends (arrowheads) | ❌ | C | Inline in `layerMenu` (`shp.dash`, `shp.ends`). Widen `setShape`'s key list. |
| Opacity, blend mode | ❌ | C | `storeOf.alpha`, arrange-bar Transparency (19471). |
| Shadow, effects | ❌ | C | `shOwner.shadow` (6765), Effects popover (19579). |
| Corner radius | ✅ `setShape` r | — | |
| Polygon, star, QR code, icon | ❌ | C | `addShape` kinds are rect/ellipse/line/triangle/arrow. QR goes through `_pilotApplyAddShape({kind:'qr'})`, so it's nearly A. Icons need `addIcon`. |
| Shape options (sides, points) | ❌ | C | |
| Pen and paths, pathfinder, release compound | ❌ `addPath`, `pathfinder`, `release` | A | |
| Object styles (apply, save, drop, defaults, overrides) | ❌ `dress`, `defineStyle`, `dropStyle`, `duplicateStyle`, `setDefaultStyle`, `clearOverrides`, `dropUnusedStyles` | A | Plus reads: `styles()`, `overrides()`, `defaultStyles()`, `unusedStyles()`. |
| Load styles from another report | ❌ `loadStyles` | C-light | `loadStylesFrom` takes an internal object. Wrap `loadStyles(pid)` as a single verb. |
| Animations (fade, rise…), reveal, show states as tabs | ❌ | C | Inline in `layerMenu` (6535–6649). |
| Save to library, place from library | ❌ `saveToLibrary`/`placeFromLibrary` | A* | On the API. `saveToLibrary` reads the current SELECTION, so it needs `select` first or an ids argument. |
| Layers (new, hide, lock, move to, merge, delete) | ❌ `defineLayer`, `toLayer`, `dropLayer`, `mergeLayers`, `dropUnusedLayers` | A | |
| Accessibility description | ✅ `describeImage` | — | |
| Reading order | ❌ `setReadingOrder` | A | |

### Text boxes and typography

| Human action | Connector | Kind | Notes |
|---|---|---|---|
| Add a text box (heading/body presets) | ✅ `addTextBox` | — | Presets have no `kind`. Claude sets the style with `setStyle`. |
| Expandable box, PDF button box | ❌ | C | `addExpandable`, `addTextBox('pdfbtn')`. |
| Font, weight, size, colour, align, italic, underline, tracking, leading | ✅ `setStyle` | — | |
| Text style (apply a named one) | ◐ `setStyle {use}` | — | Undocumented in `PAGE_VERBS`. Add it to the signature. |
| Paragraph options (space before/after, indents, keep, widows, hyphenate, drop cap, small caps, OpenType, baseline shift, tab stops) | ✅ `setStyle` | — | Checked 2026-11-11: the ¶ panel's `paraSet` IS `setStyle(selected, patch)`, the same function the pilot calls, so every key works. The hub now documents them (step 1). Still unvalidated: the panel clamps, the pilot does not, and a misspelt key is ignored silently. |
| List options (marker, levels, continue) | ✅ `setStyle {list}` | — | |
| Rules above/below, paragraph border, shading | ✅ `setStyle` | — | `ruleAbove`, `ruleBelow`, `paraBorder`, `shade`, `paraPad`. |
| Box panel (border, padding, corners, columns, gap) | ❌ | C | Checked: `renderBoxPanel` writes the BOX object (`bx.border`, `pad`, `radius`, `cols`, `gap`), not its style, so `setStyle` cannot reach it. Background is `recolor`. Needs a `setBox(id, {...})` verb. |
| Character styles inside a run of words | ❌ | C | `applyCharStyle` works on a DOM selection. Needs a span grammar or a `charStyle(key, find, name)` verb. |
| Anchor a box to a paragraph, text wrap and wrap shape | ❌ `anchor`, `wrap` | A | |
| Thread frames, break a thread | ❌ `thread`, `unthread` | A | |
| Baseline grid | ❌ `setGrid` | A | |
| Fill with placeholder text | ❌ | C | Low value for Claude, who can write the words. |

### Pictures

| Human action | Connector | Kind | Notes |
|---|---|---|---|
| Upload/insert an image | ◐ `addImage` url / src / data ≤40 KB | B | A local file over 40 KB with no public URL has no path. Claude Code on the laptop hits this. Fix: a signed upload URL from the hub (`POST /api/docs/<room>/assets/<name>`), or raise the data cap. |
| Place an image the report already holds | ✅ `addImage {src}` | — | |
| Replace / relink a picture | ❌ `relink` | A | |
| Fitting (cover, contain…), fit frame to content | ◐ `fit` ✅, `fitFrame` ❌ | A | |
| Crop | ❌ | C | `cropMode` is a drag mode. Needs `crop(id, {x,y,w,h})`. |
| Brightness, contrast, mono filters | ❌ | C | Inline `setF` (6901). |
| Picture inside a shape | ❌ `shapeImage`, `pasteInto` | A | |
| Fade | ✅ | — | |
| Caption | ✅ (addTextBox + group) | — | |
| `new_report` copies assets | ❌ | B | A copy shows broken pictures. Fix in `createDoc` (`functions/api/primer/[[path]].js` ~128): copy the `assets/` prefix. |

### Charts and tables

| Human action | Connector | Kind | Notes |
|---|---|---|---|
| Add a chart, any type, data, title, format, reference lines | ✅ `addChart`/`setChart` | — | |
| Chart panel styling (axis/grid, series colours, background, saved looks) | ◐ `setChart` patch | — | Probably covered by the patch keys, but `PAGE_VERBS` documents only points/title/labels. Write down the keys. |
| Add a table, rows, header/footer, merges, column widths/alignment, banding | ✅ | — | |
| Insert/delete/move row or column | ◐ `setTable` (whole patch) | C-light | No row verbs (`tableInsertRow`, `tableMoveRow`…). Today Claude rebuilds the table. |
| Merge / unmerge / split cells, cell styles | ✅ | — | |
| Borders (all/outer/inner, thickness), presets | ◐ `setTable` | — | Check `setTable`'s keys against `tableWrite`. |
| Distribute rows, fit columns | ❌ | C | |
| Text ↔ table | ✅ | — | |

### Pages and the document

| Human action | Connector | Kind | Notes |
|---|---|---|---|
| Add a blank page, duplicate, remove/hide | ✅ | — | |
| **Reorder pages** (drag chips) | ❌ | C | `writeOrder` (15524) has no verb. Add `movePage(page, toIndex)`. |
| **Show a hidden page again** | ❌ | C | `removePage` hides with no way back. Add `showPage(page)` (the 👁 handler, ~16063). |
| **Page size** (File ▸ Resize) | ❌ | C | `applyDocSize` (31694). Add `setPageSize({id,w,h})`. |
| Page colour | ✅ `recolor("page.<pid>")` | — | |
| Margins and columns, guides | ❌ `setMargins`, `createGuides` | A | |
| Page numbering and sections | ❌ `setPageSection` | A | |
| Shared layouts (masters): apply, make, detach, override one item | ❌ `master`, `masterFrom`, `detachMaster`, `masterOverride` | A | Tell the person "shared layout". |
| Copy/paste page contents or style | ❌ | C | |
| Colour scheme | ✅ `applyScheme` | — | |
| Replace a colour everywhere, name colours as swatches | ❌ `replaceColour`, `nameAllColours`, `defineSwatch` | A | |
| Website publish settings (File ▸ Website) | ❌ | C | `layout.website` written inline (31185). |

### Review, history, publish, sharing

| Human action | Connector | Kind | Notes |
|---|---|---|---|
| Read comments | ✅ `read_report.context` | — | |
| **Add a comment, reply, resolve, edit, delete** | ❌ | B | Routes exist: `GET/POST /api/docs/<room>/comments`, `PATCH/DELETE …/comments/<id>`, `POST …/replies`. |
| **Suggest a change; accept or reject one** | ❌ | B | `{kind:'suggestion', change}` on POST comments; `status` on PATCH. A suggesting mode for Claude would let it propose instead of change: high trust value. |
| Version list, preview a past version | ◐ `revert_report check` lists recent ones | B | `GET …/history`, `…/history/<v>/content`. |
| Name a version | ◐ the `note` becomes the label of the next save | B | `PATCH …/history/<v> {label}`. |
| Restore a version | ✅ `revert_report` | — | Refused while someone has it open. A human can restore while in it. |
| Undo / redo in the open editor | ❌ | A* | `docsync.api.undo/redo` exist. Relaying them lets Claude take back its own `arrange_report` without a revert. |
| Save now / autosave | ◐ the hub autosaves 2 s after an edit | — | Fine as is. |
| **Publish** (one commit to git) | ❌ | B | `POST /api/docs/<room>/publish`. Gate it: confirm with the person. |
| **Download PDF / PNG / HTML / package** | ❌ | C + D | Needs a browser render. The open editor could hand back bytes (`doExport`) through the room; or headless (D). |
| Preflight, audit, hyperlinks, colours, fonts, picture links | ◐ `layout.new` on each arrange | read | The API has `preflight()`, `audit()`, `hyperlinks()`, `colours()`, `fontsInUse()`, `links()`, `styles()`. Room `/ask` answers only `inventory` (`collab/src/room.js` ~153). Widen the `/ask` allowlist and add a `check_report` tool. |
| Share: add/remove people, roles | ❌ | B | Share record in KV (`readShare`). Owner-only: gate it hard. |
| Rename, file in a folder, take off the list, restore, delete forever | ◐ `new_report` only | B | `PATCH/DELETE /api/primer/docs/<id>`, folders. |
| Present mode, zoom, guides view, hidden characters, panels | n/a | — | Viewing only. Nothing to change. |

## Plan, cheapest high-value first

Each step names what it touches. Run hub tests with `node dev/test_mcp.mjs`
and Cider tests targeted (never the full suite). After a hub tool change:
claude.ai → Connectors → Cider → **Refresh tools list**.

### Step 1: list the pilot verbs the hub already could relay (kind A). Hub only, one PR.

**Built 2026-11-11** on hub branch `connector-verbs` (7b6c177), not yet pushed: 43 verbs, documented setStyle/setChart/setTable keys, and the drift test. `findChange` is held back with `setSlot` (it rewrites slot text past edit_report's citation and heading checks); `loadStylesFrom` too (it takes an object only the editor builds).

`functions/api/mcp.js` `PAGE_VERBS`: add entries for the verbs the editor
already takes. Group them so the description keeps every verb name inside
its first ~1,900 characters. Put signatures in `arrange_verbs`, and move the
long ones out of the description into a new `PAGE_VERBS.more` that appears
only in `arrange_verbs`.

- Pages: `setMargins`, `createGuides`, `setPageSection`, `setReadingOrder`,
  `master`, `masterFrom`, `detachMaster` (alone), `masterOverride`, `setGrid`.
- Text flow: `anchor` (alone), `wrap` (alone), `thread`, `unthread`, `fitFrame` (alone).
- Pictures: `relink`, `shapeImage`, `pasteInto`.
- Paths: `addPath`, `pathfinder`, `release`.
- Repeats: `stepRepeat`.
- Colour: `replaceColour`, `nameAllColours`, `defineSwatch`.
- Styles: `dress`, `defineStyle`, `dropStyle`, `duplicateStyle`,
  `setDefaultStyle`, `clearOverrides`, `dropUnusedStyles`.
- Layers: `defineLayer`, `toLayer`, `dropLayer`, `mergeLayers`, `dropUnusedLayers`.
- Words: `findChange`, `replaceFont`, `changeLink`, `linkBareUrls`,
  `setVariable`, `setCondition`, `setNotes`.

Also document what already passes through: `setStyle {use}` and the
paragraph, box and list keys, once checked against `paraSet`/`objSet`/`listSet`.
Do the same for `setChart`'s and `setTable`'s full patch keys.

Check first: the `alone` set must match edit.html's `PILOT_SINGLE_VERBS`, or
a batch is refused. Kept in step "by hand" today, so add a test that reads
edit.html's two lists from the vendored copy and fails on a mismatch.

Value: about 45 verbs (masters, layers, styles, threads, anchors, find/change)
for about a day of work. No editor change, no Worker deploy.

### Step 2: comments and suggestions as tools (kind B). Hub only.

New tools in `mcp.js`: `comment_report` (start, reply, resolve, edit,
delete) and `suggest_edit` (a suggestion comment carrying the change, which
a person accepts in the editor). Both call
`functions/api/docs/[[path]].js` routes through `asPerson`. They work with
nobody open.

Value: high. Claude can answer a reviewer, close the threads it fixed, and
propose a change instead of making it. It's also how report-wide rules get
written down for colleagues' Claude (the `context.about` loop).

### Step 3: read queries through `/ask` (kind A on the room). Cider room plus hub.

**Built and live 2026-11-11:** Cider #123 (d019862: room `ASKS`, editor `ASK_READS`), relay deployed (primer-collab eb4644a2), hub 9047008 (`check_report`, default `preflight`). `checkLinks` left out: it needs the local server. Verified live on demo-report through a fresh session.

`collab/src/room.js` (~153): widen `what` from `inventory` to an allowlist
(`preflight`, `audit`, `hyperlinks`, `checkLinks`, `colours`, `fontsInUse`,
`links`, `styles`, `notes`, `overrides`, `stories`). edit.html's ask handler
answers through the same-named `docsync.api` reads. Hub: a `check_report`
tool (or `read_report {check: [...]}`). Needs a Worker deploy.

Value: Claude sees what Preflight shows a person before calling the report
done.

### Step 4: the page verbs nobody wrote (kind C, small). Cider editor plus a hub list entry each.

In `PILOT_SINGLE_VERBS` / `docsync.api`, each wrapping an existing function:

- `movePage(page, toIndex)` → `writeOrder` (15524).
- `showPage(page)` → the Hidden-group 👁 handler (~16063). This closes the
  loop `removePage` leaves open.
- `setPageSize({id?, name?, w, h})` → `applyDocSize` (31694).
- `continueEndnotes`, `saveToLibrary(name, ids)`, `placeFromLibrary`,
  `loadStyles(pid)`: already on the API. Add them to `PILOT_SINGLE_VERBS`
  (`saveToLibrary` takes ids instead of the selection).
- `undo`/`redo` as single verbs. Claude takes back its own step in the open
  editor.

### Step 5: widen the look verbs (kind C, medium). Cider editor.

- `setShape`: add `dash`, `ends`, `alpha`, `blend`, `shadow`. Lift them from
  the inline `layerMenu` writes (6714–6844). Widen opacity and shadow to
  boxes, pictures and tables (`storeOf`), perhaps as a `setLook(id, {...})`.
- `addShape` kinds: polygon, star (with sides/points), qr (`data`), icon (name).
- Picture: `crop(id, {x,y,w,h} | null)` and `filter(id, {brightness, contrast, mono})`.
- Table rows/columns: `tableRow(id, 'insert'|'delete'|'move', at, to?)`, the
  same for columns, plus `distributeRows`/`fitColumns`. These wrap the existing
  `tableInsertRow` and related functions.
- `animate(id, {kind, speed} | null)`.
- `copyStyle(from, [to])` as one verb (format painter).
- Website settings: `setWebsite({...} | null)` from `file-website` (31185).

### Step 6: images from Claude Code, versions, publish, shelf (kind B). Hub.

- Image upload over 40 KB: `addImage {upload: true}` returns a short-lived
  signed PUT URL to `/api/docs/<room>/assets/<name>`. Claude Code `curl`s the
  file, then places it with `src`. Or raise the cap for the `data` field.
- `new_report`: copy the source report's `assets/` (`createDoc`, ~128).
- `report_history`: list versions, read a past version, label one.
- `publish_report` → `POST …/publish`. Always `check` first, and say
  plainly what it commits.
- `manage_report`: rename, folder, take off the list, restore. Not "delete
  forever".
- Share changes: owner-only, and probably stay human. Note the decision
  either way.

### Step 7: no human in the loop (kind D). Bigger.

Every arrange verb needs a person's open tab today. Options:

- A **headless editor** that joins the room as a pilot when nobody is in:
  madison's Chrome with a service identity, or Cloudflare Browser Rendering
  started by the hub. It opens `edit?project=<id>`, applies, autosaves, and
  closes. This also unlocks exports (PDF/PNG) for Claude.
- Risks: a second pilot racing a person who opens the tab mid-edit (the room
  already picks one pilot), Access identity for the bot, and cost.

Decide this with Devin before building. It changes who is "in the room".

### Not planned

Viewing-only actions (zoom, present, panels, hidden characters), Google Doc
link/import (local editor), Discard/Push (local git), app update chips.

## Facts worth keeping

- The editor's pilot is ahead of the hub by about 45 batch verbs and 7 single
  verbs. The hub refuses them as "no verb" today, though the open editor
  would run them.
- `setStyle` in the editor passes ANY patch key through unchecked
  (`_pilotApplySetStyle`, ~32939). Some of what looks missing (paragraph and
  box options) may already work. The risk is the reverse: a wrong key writes
  junk silently.
- `hideDesignedPage` is reachable only from the API now. People can only
  un-hide.
- The tool description cap (~2,048 characters in Claude Code) is the
  constraint on listing about 100 verbs. The verb NAMES must fit, and
  signatures belong in `arrange_verbs`.
