# The editor's UI and the pilot verbs: one code path per action

The pilot API (`docsync.api`, `PILOT_BATCH_VERBS` / `PILOT_SINGLE_VERBS` in
`docsync/editor/edit.html`) is how Claude and the hub's connector change a
report. Each batch verb is a `validate` and an `apply`, and `batch()` runs them
as one undo step with three guarantees on top:

1. **It refuses before it touches anything.** Every op is validated first; a bad
   one leaves no undo step and no "unsaved" mark, and says why.
2. **It puts back what the engine will not build.** After the render, a result
   that made `renderFailed` flip is rolled back and refused with the engine's
   words (unless the draft was already broken: the edit may be the fix).
3. **It refuses an object the page will never draw** (an add on a page whose
   renderer does not draw placed objects).

The UI made many of the same edits by calling the verb's core function inside
its own `changeDoc(() => core(...))`. That is one undo step and one render, but
none of the three guarantees above. This file is the inventory of where the two
paths overlap, what differed, what now goes through the verb, and what was left
alone and why.

## How the UI calls a verb

`uiVerb(verb, ...args)` runs `[{verb, args}]` through `docsync.api.batch()`,
the pilot's own path, minus its wait for an open inline editor (`uiBatching`:
a person clicking a menu row is not mid-sentence somewhere else, and the row
made the same edit through `changeDoc()` before). On a refusal it says the
verb's error through `tell(…, {kind: 'error'})` and returns `null`; otherwise it
returns the verb's result (`{replaced: 3}`, `{copies: [...]}`). `uiOps(ops)` is
the same for several ops in one step (Save this cell's look as… is
`defineCellStyle` + `cellStyle`). The caller repaints its panel and says what
happened, as before.

`tools/verb-ratchet.mjs` counts the UI calls to a verb's core still outside
the pilot section (`// pilot verbs: begin` … `// pilot verbs: end`) and CI fails
when the count rises (the "Verb ratchet" step in `editor-tests.yml`); `--write`
lowers the bar, `--list` names each one. A line that carries
`// verb-ratchet: <why>` is not counted: two do, `linkBareUrls(true)` (a count
for the button's label, not an edit) and `pruneDefaults`' `setDefaultStyle`
(a step inside another core's edit). The bar is 1: Distribute rows over a
RANGE of rows, which the verb (`tableRow 'even'`, the whole table) cannot say.

## Inventory

Legend: **routed** = now calls the verb; **left** = still its own path, with the
reason. "Differences" are between the UI path as it was and the verb.

Taken on main at 4245575 (2026-11-21), before the change. Line numbers are that
commit's.

### Routed: panel, menu and dialog actions that called the verb's core 1:1

Each of these was `changeDoc(() => core(args))` (or the table menu's `item()`,
which wraps its row in `changeDoc`). Now each calls `uiVerb(verb, …)`.

| UI action | Where | Verb | What differed |
|---|---|---|---|
| Colours ▸ Replace… | `coloursRender` | `replaceColour` | none in the input (the dialog validates the same way); no engine guard |
| Colours ▸ Name N unnamed as swatches | `coloursRender` | `nameAllColours` | no engine guard |
| Styles ▸ Delete unused… | `deleteUnusedDialog` | `dropUnusedStyles` | no engine guard |
| Styles ▸ Duplicate | `styleHousekeeping` | `duplicateStyle` | none (the dialog checks the name) |
| Text/object style ▸ Use for new … | type pop, object-style pop | `setDefaultStyle` | none |
| Text style ▸ Clear overrides | type pop | `clearOverrides` | none |
| Notes ▸ Add / Edit note | `addNoteDialog` | `setNotes` | **bug:** on a key content.md does not hold, `setSlotNotes` returns false, the change returned `undefined`, and `changeDoc` kept an empty undo step and marked the report unsaved. The verb refuses: "a slot that exists". |
| Page ▸ Numbering section… | `pageSectionDialog` | `setPageSection` | none (dialog validates) |
| Page ▸ Reading order… | `readingOrderDialog` | `setReadingOrder` | none |
| Object ▸ Step and Repeat… | `stepRepeatDialog` | `stepRepeat` | none; no engine guard on up to 100 new objects |
| Links ▸ Relink… | `linksRender` | `relink` | no engine guard |
| Hyperlinks ▸ Change… / Link bare addresses | `hyperlinksRender` | `changeLink` / `linkBareUrls` | no engine guard |
| Find ▸ Fonts ▸ Replace with | `renderFindFonts` | `replaceFont` | **bug:** a font used in 0 places still left an empty, dirty step |
| Layers panel: show/hide, lock, ⇣ to layer, merge, delete, delete unused | `docLayersRender` / `layerWrite` | `defineLayer`, `toLayer`, `mergeLayers`, `dropLayer`, `dropUnusedLayers` | none in the input; no engine guard |
| Right-click ▸ Change on this page only / Back to the shared layout | object menu | `masterOverride` | none |
| Right-click ▸ Convert text to table | object menu | `textToTable` | a refusal was handled by hand (`{...t, ok:false}`); the verb throws and rolls back |
| Right-click ▸ Transform ▸ Clear transformations | object menu | `clearTransforms` | none |
| Right-click ▸ Pathfinder ▸ … | object menu | `pathfinder` | the menu checks `union` only, not the op picked (same rules today) |
| Right-click ▸ Release compound | object menu | `release` | none |
| Right-click ▸ Put the picture inside this shape / Picture inside ▸ … | object menu | `pasteInto` / `shapeImage` | the verb checks `fit`/`align` values |
| Right-click ▸ Break thread after this frame | object menu | `unthread` | none |
| Click-to-thread | `threadWire` | `thread` | already called `_threadValidate` itself |
| Table menu ▸ Merge cells | `tableMenu` | `mergeCells` | **bug:** a merge across another merge's edge said the error and still left an empty undo step marked unsaved |
| Table menu ▸ Unmerge / Split cell ▸ h, v | `tableMenu` | `unmergeCells` / `splitCell` | none |
| Table menu ▸ Add/Delete/Move row or column, Fit columns to content, Distribute rows (whole table) | `tableMenu` | `tableRow` / `tableCol` | the menu disables the rows the verb would refuse |
| Table panel ▸ ↑ Row, ↓ Row, − Row, ← Col, → Col, − Col | `renderTablePanel` (`tableVerb`) | `tableRow` / `tableCol` | none |
| Tab out of a table's last cell (a new row) | `tableAppendRow` | `tableRow` | none |
| Table menu ▸ Cell style ▸ (name) / No cell style / Save this cell's look as… | `tableMenu` | `cellStyle`, `defineCellStyle` + `cellStyle` (one step) | Save as… held its step open across the name dialog; now the dialog comes first and the edit after |
| Table menu ▸ Convert table to text | `tableMenu` | `tableToText` | **bug:** a refusal said the error and left an empty, dirty step |

Two of the bugs above are one: `changeDoc` withdraws its step only when the
change REFUSES (`false` / `{ok:false}`), so a change that quietly did nothing
kept an empty step and marked the report unsaved. `batch()` closes its step
with `beginChange().commit()`, which withdraws any step that left the
document as it found it.

What every routed action gains: validation before anything is touched (a
refusal leaves no undo step and no unsaved mark, and is said in red), the
rollback when the engine will not build the result, and one code path with the
pilot, so `pilot-api.spec.js` and the hub's connector tests now cover the UI's
edit too.

### Fixed beside the routing: the type toolbar made no undo step

`wireType()` wrote every type control as
`setStyle(selected, …); markDirty(); await render()`: no `changeDoc`, no
`beginChange`. That is size, tracking, leading and colour, the size stepper,
the two sliders, the colour pop, text style, font, weight, case, italic,
underline, alignment, effects, Reset and every row of the ¶ popover. ⌘Z after
a size change undid the edit BEFORE it, or nothing. The fields' `input` events
also wrote live, ahead of any step. Now each control is one step: a one-shot
control (`typeSet`) opens a step, writes, and commits; a live one opens its
step on the first `input` (`liveWrite`) and commits on `change`
(`liveCommit`). A step that changed nothing is taken back, so a slider let go
where it was grabbed leaves none. The baseline grid's default (written when
the ¶ popover's grid box is first ticked) now goes in the same step as the
slot's own switch; it used to be written outside any step.

### Left alone, and why

**Live gestures.** Drags (`startDrag`, resize handles, the rotate handle, ruler
guides), sliders (alpha, shadow, stroke weight, corner radius, tone, the Box
panel), crop mode and point editing write the document a frame at a time
between a press and a release (`beginChange` / `slideStep`). A verb is one
validated change with one render; running it per frame would render per frame.
They commit through `beginChange`, which is the right seam for them.

**Guides, margins and the baseline grid** (`addGuideHere`, `addGuideDialog`,
`createGuidesDialog`, `marginsDialog`, `gridField`): they change no page the
engine builds, so they commit with `{render: false}` and redraw only the guide
layer. Through a verb they would pay a full render for nothing, and the engine
guard has nothing to guard. Known wrinkle: adding a guide that already exists
leaves an empty step (the core returns the position either way).

**Where the UI and the verb do different things on purpose, or the verb is
narrower than the UI:**

- *Type toolbar vs `setStyle`/`setType`*: fixed for undo (above), but still
  calls the core, not the verb: the verb refuses while an inline editor is open,
  and the toolbar is used exactly then.
- *Chart panel vs `setChart`*: about 30 handlers through `chartWrite`, several
  live. Same core (`chartApply`). Not guarded against an engine refusal; a
  candidate for `uiVerb` once each handler is checked against `setChart`'s
  patch validation.
- *Control bar X/Y/W/H/scale/rotate vs `transform`, Position panel vs `place`,
  `rotate`, `skew`*: same core (`applyFrameChange`), but the fields clamp where
  the verb refuses (W/H to 0.1in, angles normalised to ±180), and they record
  `lastXform` for Transform Again. Routing them would turn a clamp into a
  refusal under a person's typing.
- *Right-click / Control bar look (alpha, blend, shadow) vs `setLook`*: the
  defaults differ (shadow offset 0.05 in the menu, 0.06 in the bar), and the
  bar's Remove writes `shadow: null` so a style's shadow stops drawing, which
  the verb's `null` (delete the key) does not do. **That is a verb gap**, not
  something to route the UI into.
- *Animate menu vs `animate`*: the menu offers `bars` only on bar charts; the
  verb takes it anywhere.
- *Shape outline/corners vs `setShape`*: the menu's corner slider stops at
  0.4in and the bar clamps to 0-2 where the verb refuses.
- *Text-frame fields vs `setFrame`*: same core (`applyBoxFrame`), the fields
  clamp gap and inset where the verb refuses.
- *Type in an open editor vs `setRun`*: the UI styles the live DOM of an open
  editor; the verb rewrites markdown. Different mechanisms.
- *Cell typing vs `setCell`, box typing vs `setBoxText`, slot typing vs
  `setSlot`*: the inline editors, which own a step from open to close.
- *Insert tools vs `addTextBox`/`addShape`/`addChart`/`addTable`*: presets,
  panels that open after, and defaults that differ (a polygon is 2in tall from
  the panel, 1in from the verb). Worth unifying, as its own change.
- *Find/Change ▸ Change all vs `findChange`*: the UI counts `writeSlot`
  refusals and reports them; the verb ignores them. **A verb gap.**
- *Sources panel vs `addSource`/`editSource`*: the UI takes a source with no
  URL and checks the scheme; the verb requires a URL and does not check it.
- *Insert section vs `addSection`*: the UI renames a taken slug (`-2`), the
  verb refuses.
- *Swatch "+" vs `defineSwatch`*: the UI's "+" silently overwrites a swatch
  of the same name.
- *Lock, group/ungroup, dress, define/redefine style, fit/fitFrame, describe
  image, setTable dialog, layers drag order (`setZ`), variables dialog*: either
  the UI already calls the same function the verb does (`applyFitting`,
  `toggleLockSel`, `wearObjStyle`, `writeMdAlt`), or the UI acts on the whole
  selection where the verb takes one id (ungroup), or the shapes differ
  (Redefine style MERGES, the verb's `defineStyle` REPLACES; the variables
  dialog rewrites the whole map).
- *Single verbs (`remove`, `duplicate`, `align`, `distribute`, `anchor`,
  `wrap`, `addPage`, `duplicatePage`, `removePage`, `movePage`)*: the verbs ARE
  the UI functions (`deleteSel`, `duplicateSel`, `alignSel`, …) behind a thin
  wrapper: already one path.

**Differences found and not fixed here** (each a follow-up of its own):

1. The anchor click (`anchorWire`) ignores the `{ok:false}` `anchorSet` returns,
   so a refused anchor fails silently.
2. The page strip's × has no last-page check; `removePage` refuses it.
3. Dropping a page-strip chip where it already was leaves an empty, dirty step;
   `movePage` checks for that.
4. `recolor`, `setShape`, `setFrame` and the Control bar's `transform` skip the
   lock and wrap checks the verbs make on one side or the other: the verbs
   refuse locked items for `place`/`setShape` but `recolor` does not, while the
   UI skips locked items for fills but not for corner radius.
5. Reset crop leaves an empty `layout.img[id]`; the verb prunes it.
6. `applyTypeStep` (the type-size keys) floors size at 6px; the stepper and the
   engine floor at 10.5px.
