# What the editor typecheck found (2026-11-21)

`npm run typecheck` (`tools/typecheck-editor.mjs`) reads the script in
`docsync/editor/edit.html` with TypeScript, as plain JavaScript with loose
settings. This is what it said about the file at commit `ac57c08` (the `edit-wrapper` branch, which adds `changeDoc()`), the day the
check was added. Line numbers are `edit.html`'s at that commit.

## Real bugs: none found

The kinds of error the check keeps (a name that does not exist, a call with too
many arguments, a call of something that is not a function, a declaration made
twice, a use before the declaration, code that cannot run, a comparison that
cannot be true) found **no real bug** in the file as it stands. That is worth
saying plainly: the Playwright suite has already shaken these out of the code
that exists. The check earns its place on the next change, not this one.

It does work. In a copy of `edit.html` with two lines added, it reported all
four planted mistakes at their lines: a misspelt `renderStat(d)` (TS2552,
"did you mean `renderState`?"), `deleteSel(d, 1, 2)` (TS2554), `CHORDS()`
(TS2349) and a second `function __probe` (dup-function).

Those kinds flagged 10 lines, all false, in two shapes that `knownNoise()` in
the tool now lets through:

| Lines | Code | What it is |
| --- | --- | --- |
| 5976, 7818, 16790, 16791, 16793 | TS2349 | A list of `[label, function]` rows read back with destructuring (`CHORDS`, two menus). With no types written, each row is "an array of string or function", so the call is "not callable: not all constituents are". The functions are there. |
| 17231, 17243, 17245, 17252, 17314 | TS2554 | `$('text').onclick()` and its neighbours in the Insert palette: a button's handler run by hand. The DOM's type wants the event. The four handlers (lines 9568, 9779, 26626, 26645) take none. |

I also read every error of the other kinds that was not about a DOM type (about
110 lines) looking for a real mistake behind it. None is one. The ones that read
most like a mistake, all correct today:

- **24327, 24328** (`snapLines`): `xs` and `ys` start as lists of numbers and
  then take objects `{ v, a, b, k }`. Deliberate: `uniq()` at 24358 reads
  `l.v ?? l` and only merges spans when both are objects.
- **32763, 33874**: `isNaN(new Date(iso))`. Works (the date becomes a number);
  `isNaN(+d)` says the same without the complaint.
- **36760**: `throw new Error(r.status)` with a number. Works; the message is
  the status as text.
- **17368, 17386**: `setAttribute('aria-pressed', x === b)` with a boolean.
  Works; the DOM writes "true" or "false".

## What the check cannot see

- **A call with too few arguments.** TypeScript treats every parameter of a
  plain JavaScript function as optional, so `area(2)` for `area(w, h)` passes.
  Only too many is an error. JSDoc `@param` lines on a function turn this on
  for that function.
- **A misspelt property**: `layout.pagse`, `opts.maybee`. Nearly everything the
  editor passes around (`layout`, `source`, `M`, whatever `$()` returns once
  silenced) is untyped, and a property of an untyped thing is never wrong.
  This is where most of the remaining risk is, and types for `layout` and the
  manifest would be the next step that pays.
- **A value that may be null.** `strictNullChecks` is off; turning it on is
  thousands of errors.
- **`window.something`** made by assignment. TypeScript does not treat it as a
  global, which is why `docsync` is declared in `tools/typecheck-editor.d.ts`.

## The noise, and what would silence it

TypeScript has 882 errors for the file in all (`node tools/typecheck-editor.mjs
--every` prints them). None of these kinds is checked. By pattern, noisiest
first:

1. **`$()` returns `HTMLElement` (about 525 errors).** `$('out').contentDocument`
   alone is 262; `.value` 159, `.disabled` 54, `.checked` 16, then `.options`,
   `.placeholder`, `.contentWindow`, `.getContext`. One line fixes all of them:
   a JSDoc type on line 3806, `/** @type {(id: string) => any} */` above
   `const $ = id => document.getElementById(id);`. (A truer fix is typed
   helpers, `$in(id)` returning `HTMLInputElement` and `$frame(id)` returning
   `HTMLIFrameElement`, but that is a rewrite of about 500 call sites.)
2. **`querySelector` and friends return `Element` (about 140).** `.dataset` 64,
   `.hidden` 22, `.style`, `.offsetHeight`, `.blur()`, `.click()`. A small
   helper with a JSDoc return type (`/** @returns {HTMLElement} */ const q =
   (sel, root = document) => root.querySelector(sel)`) or the generic form,
   `d.querySelector(/** @type {'div'} */ …)`, where it matters.
3. **`e.target` is an `EventTarget` (about 25).** `.closest` 17, `.matches`,
   `.tagName`, `.value`. A one-line helper, `const targetEl = e =>
   /** @type {HTMLElement} */ (e.target)`.
4. **Properties the editor hangs on DOM nodes and on `window` (about 40).**
   `el.__dsH`, `el.__dsRO`, `el._mentions`, `window.__dsPyc`,
   `window.__dsSwallowed`. Declaring them in `tools/typecheck-editor.d.ts`
   (`interface Element { __dsH?: any }`, `interface Window { __dsPyc?: any }`)
   silences them with no change to `edit.html`.
5. **Options with defaults (about 45: TS2339, TS2353).** `function
   addTextBox({ w = 2.5, md = '' } = {})`-style signatures and `opts = {}`
   parameters get the type of their defaults only, so every other key
   (`page`, `x`, `y`, `fill`, `fnLabels`) "does not exist". A JSDoc `@param`
   with the real shape on each such function (about eight of them: lines 4662,
   37899, 37978, 38242 and the callers' targets).
6. **Lists of mixed rows (about 25: TS2349, TS2339, TS2322, TS2538).** The two
   shapes in the table above, plus `[['B', 1e9], …]` read as "string or number"
   (11215, 6090) and option lists (14928). `/** @type {[string, number][]} */`
   on the list.
7. **A boolean used as a number in a sort (11: TS2362, TS2363).**
   `(a.kind === 'command') - (b.kind === 'command')` at 21828, 23052, 33995.
   `+(…) - +(…)` or `Number(…)`.
8. **"Property does not exist on type never" (6).** A `let best = null` filled
   in from inside a `forEach` callback (17513, 19211): TypeScript does not see
   the assignment. A `for … of` loop, or `/** @type {any} */ let best = null`.
9. **JSDoc that reads as a tag (2: TS1003).** "@-mentions" in a `/** … */`
   comment at 33843 and 34034.

Items 1 and 4 together take the count from 882 to about 320 with one line in
`edit.html` and a few in the `.d.ts`. After 1 to 3, TS2339 on the editor's own
object shapes (item 5 and the few like it) would be clean enough to add to the
kinds checked, and that is the kind that catches a misspelt property.
