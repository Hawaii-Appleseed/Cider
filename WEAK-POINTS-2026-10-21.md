# Cider weak points — 2026-10-21 (laptop, worktree `weak-points` off main @ 481b695)

**Fixed on the `weak-points` branch the same day, items 1–12 (the two
"noted only" ones under 12 excepted), each pinned by
`tests/editor/weak-points.spec.js` — 20 tests that fail against the editor
before the change and pass after.** The findings below are kept as found.
Each was reproduced live in the real editor on `uhero-trc-summary` with
Playwright (real keys and mouse, plus the pilot API) by throwaway probe
specs that printed what the editor did and asserted nothing. What already
worked is listed at the end so nobody re-checks it.

One finding was mine, not the editor's: the space-drag probe (10) pressed
below the viewport, so it could not have panned anything. The hand tool did
not exist either way, and does now.

## Ranked

### 1. A single pilot verb can leave the draft unbuildable while answering `ok: true`

`batch()` refuses a result the engine will not build and rolls it back
("the engine would not build the result, so nothing was changed —
LayoutError: box #1.x: None is not a number"). A verb called on its own
does not: `docsync.api.place(id, {x: NaN})`, `place(id, {x: '2in'})` and
`recolor(id, 'not-a-colour')` each return `ok: true`, write `null` /
the junk string into layout.json, the next render dies, the status bar
says "draft does not build" and the page goes blank until ⌘Z. Every MCP
and `/__pilot` call goes through this path (`_pilotOne` wraps a one-op
batch, so the engine check is apparently skipped for single ops — see
`_pilotOne` and `batch()` in edit.html). Also accepted silently:
`place(id, {w: 0})` (a zero-width, unreachable box), `addTextBox({w: -2})`
(a negative-width box, drawn as nothing; the engine builds it, so
`layout.py` has the same gap), `setSlot(key, {md: 'x'})` (a raw
`TypeError: v.split is not a function` instead of a validation error).

### 2. `setSlot` with a `[[marker]]` line refuses the write but reports `ok: true`

`writeSlot` refuses a slot marker inside slot text (console.warn plus a
status line), but `_pilotApplySetSlot` ignores that refusal and the render
that follows overwrites the status line with "unsaved changes". A pilot
(Claude, the MCP server, the Google Doc import) believes the words landed.

### 3. A fake ʻokina typed in the editor: the Save is refused with raw git, or ships

The editor converts nothing on commit: a straight or curly apostrophe typed
into Hawaiʻi or Oʻahu stays (U+0027 / U+2019), and straight quotes stay straight. On
Devin's Mac the global pre-commit lint then refuses the Save's commit, and
the editor shows `save failed: git commit failed:` + the hook's eleven
lines in `#stat`, which is one line with `white-space: nowrap` and
`text-overflow: ellipsis` and gets no `title` on this path (the file-watcher
and stale-server errors do) — so the person sees "save failed: git commit
failed:" and nothing of the fix. On the hub (R2 store, no git hook) and on
any machine without the global hook, the fake ʻokina ships to the published
page. The engine already has `docsync/okina.py` (fonts only) and the
lint's word list lives in `~/.config/git-hooks/okina-lint.py`; the editor
could apply the same word rules as words are committed, or the Save could
run `--fix` and say so.

### 4. ⌘⇧] / ⌘⇧[ do nothing; Cider's front/back is ⌘⌥] / ⌘⌥[

InDesign, Illustrator, Figma, Sketch and Canva all use ⌘⇧] for Bring to
front and ⌘⇧[ for Send to back. Both keydown handlers test `e.key ===
']'`, which with Shift is `}` on a US keyboard, so the chord falls through
silently (z order unchanged). ⌘⌥] works.

### 5. ⌘A with an object selected selects the chrome's text, not the objects

Not bound, so Chrome's select-all runs on the OUTER document: 157
characters of toolbar text turn blue and the object selection is
untouched. InDesign and Canva select every object (on the page / spread).

### 6. ⌘X is unbound, so an object cannot be cut and pasted onto another page

⌘C/⌘V/⌘D work (and a paste lands on the page in view, offset 0.2in each
time — good). ⌘X leaves the object where it is and sets no clipboard.

### 7. A group, or any multi-selection, has no handles

A single text box shows eight resize handles plus four rotate corners; a
group of two (⌘G) or two selected boxes shows none, and the floating strip
offers only Group / Duplicate / Lock / Delete. A group cannot be resized or
rotated as one, which every design tool allows.

### 8. Ctrl+Y does nothing

⌘⇧Z redoes. Hub users on Windows reach for Ctrl+Y; it is unbound.

### 9. Pasting a picture or words with nothing open does nothing; a dropped file is unhandled

With no field open, a paste event carrying a PNG file, or plain text, is
ignored (no box, no image, no status). Canva makes a picture or a text box
at the pointer. `dragover`/`drop` on `section.page` are not handled either
(both defaults ran), so a photo dragged from the Finder onto the page gets
Chrome's default. Unverified what that does inside this srcdoc iframe;
Chrome's default for a dropped file is to open it.

### 10. Space-drag does not pan; there is no hand tool

Holding Space and dragging on the page moved nothing (scroll unchanged).
The wheel and ⌘+/⌘-/⌘0 are the only ways to move around.

### 11. Tab in a table's last cell leaves the table instead of adding a row

Word, Google Docs and InDesign add a row. Here `stepCell` returns null
past the last row and the field closes with focus on the body.

### 12. Smaller

- Enter with a text box selected does nothing (Canva and Figma open the
  words). Not an InDesign expectation.
- Shift-drag on an already-selected single object does nothing (shift is
  the add-to-selection modifier; InDesign's shift-drag constrains the
  axis). Design choice, noted only.
- Seen twice and not reproduced in six targeted attempts: a click on a
  paragraph's words after an Escape commit opening nothing (no editor, no
  caret). All six variants of type / Escape / click-elsewhere / click-again
  reopened the words. Left as unconfirmed.

## What was checked and works

Option-drag duplicates. Dragging one of several selected objects moves
them all, and one nudge of several is one undo step. A locked element
refuses the arrow keys, a drag and Backspace, and its right-click menu
offers only Unlock. ⌘U underlines (`__words__` is underline in this
grammar). Escape keeps typed words (PR #14). ⌘Z inside an open field undoes
the typing and then stops harmlessly. A paste while page 3 is in view lands
on page 3. A box dragged past the page edge is clamped, and the west
handle stops at 0.40in. Drag distance is right at 200% zoom. The selection
survives a render and a Save, and ⌘Z after a Save still works.
`addTextBox` on a page that does not exist, `addTable` with no rows and
`setChart` with a non-number are refused with clear messages.
