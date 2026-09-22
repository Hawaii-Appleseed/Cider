---
name: report-editor
description: How to build or change ANY report served by the docsync draft editor so its elements stay user-editable and never clash — movable/resizable SVGs and graphics, detachable cards, text, shapes, images, groups, citations, collision-free placement. Use when adding, drawing, placing, or restyling anything in a report bound in docsync.yml, when elements overlap or collide, or when the user says an element "should be movable / editable" or "shouldn't clash."
---

# Building reports the draft editor can edit

Reports bound in `docsync.yml` render through their own `render_report.py` and
are edited live in the **docsync draft editor** (`docsync/editor/edit.html`).
The editor can move, resize, rotate, recolour, group and re-layer elements —
but ONLY elements rendered through the right hook. Raw markup is frozen: the
editor has no handle to select it. When you add anything, render it so the
user can grab it.

Two invariants govern everything this skill builds, and each has a mechanical
gate — neither is satisfied by eyeballing:

- **Every element is editable.** All text is a slot, every graphic goes
  through `graphic()`, prose never bakes into an SVG. Gate:
  `python3 -m docsync.check --id <slug>` shows a clean `edit-mode draft`
  line and the binding says `editability: strict` (see "the editability
  contract" below).
- **No element clashes with another.** Flow first, measured placement,
  grouped composition. Gate: the pilot `audit` verb comes back with zero
  issues (see "Placement: nothing clashes" below).

## The shared building blocks: `docsync.blocks`

Every project can import the engine's helpers — they are staged into the
browser engine automatically:

```python
from docsync.blocks import graphic, card, is_light_bg, pdf_button

# A movable/resizable/rotatable inline SVG. viewBox REQUIRED; w = default
# width in inches (until the user resizes; then layout.json wins).
{graphic(L, "page1.diagram", '<svg viewBox="0 0 200 120">…</svg>', w=2.4)}

# A coloured tile: bold title + bullets, both content.md slots. detachable=True
# renders title/bullets as their own movables (seed a default group, below).
{card(C, L, "page1.card.title", "page1.card.bullets", "#52796F",
      detachable=True, min_h=1.8)}

# ONCE, just inside <body>: the reader-facing "Download PDF" in the upper-right
# corner, plus the print CSS that makes the PDF come out right.
{pdf_button(L, bg="#52796F")}
```

- `L` is the project's `Layout`, `C` its `Content` — every renderer has both.
- `el_id`s must be unique and STABLE (`<page>.<name>`): they key layout.json;
  renaming one orphans wherever the user dragged it.
- Helpers are zero-stylesheet (styles inlined), so they work in a minimal
  scaffolded renderer with no CSS of its own.
- A project MAY keep bespoke equivalents (the Budget Primer's `card()` is
  CSS-styled); the *behavioural* hooks (`ds-graphic`, `ds-detachable`,
  `data-el`/`data-slot`) are what the editor reads either way.

## The one rule for SVGs / graphics

**Any free-standing SVG, diagram, icon-lockup, badge, or drawn graphic MUST go
through `graphic()`** — never a bare `<svg>` in the markup. Glyphs that live
inside another element and shouldn't move on their own stay inline.

**And no words go into a drawing as literals — the build refuses them.**
`graphic()` scans the SVG in edit mode (the editor's draft, and
`docsync.check`'s edit-mode pass) and raises `SvgLiteralError` for any
`<text>` that carries words and no hook. Every word inside a drawing is one
of exactly three things:

| The words are… | Write | The person gets |
|---|---|---|
| something they might rephrase (a legend entry, a step name, a bar caption, a note) | `svg_text(C, "<chart>.<what>", "<the wording>", x, y, size, fill, weight=, anchor=)` | double-click edits it on the page; the wording is the default until they do |
| a category or series name that comes from DATA (a department, a bill number, an income bracket) | `<text … {C.derived("<the command that remakes it>")}>` | click tells them where it comes from; it is never retyped |
| the drawing itself (a wordmark, a logo lockup) | `graphic(…, frozen="<why>")` — one declaration per graphic, with the reason | nothing; `docsync.check` lists every such declaration so it stays visible |

Data marks pass on their own: numbers, currency, percentages, a tick such as
`FY26`, `TY23`, `$5M`, `1st`, a month's three letters (`blocks.is_data_mark`).
A whole sentence never passes, not even under `C.derived` — a caption is prose
wherever its numbers came from; put it in a slot (`svg_text` inside, `C.html`
beside). Do not reach for `frozen=` to get past the error on a chart: the
error is the point, and the answer is `svg_text`.

## Making other elements editable

Everything editable shares one hook: `{L.spacer(el_id)}` before the element +
`{L.attr(el_id)}` on its tag stamps `data-el` (edit mode only) and applies any
layout.json position/size override.

| Want | Use | The user gets |
|---|---|---|
| Free-standing SVG/graphic | `blocks.graphic(L, id, svg, w=)` | move, 4-corner proportional resize, rotate |
| Coloured tile with text | `blocks.card(C, L, …, detachable=)` | recolour, move; pieces pull apart if detachable |
| Editable prose paragraph | `C.html(key, cls)` — stamps `data-slot` AND wraps a movable `para.<key>` | click-to-edit text; drag; resize |
| Editable heading / inline text | a slot: `C.t(key)`, or `C.slot_attr`/`C.slot_span` on a tag you build | click-to-edit text; drag; width resize |

**The `C()` trap — the #1 "why can't I edit this?" cause.** Bare `C(key)` (i.e.
`Content.__call__`) and `C.text(key)` emit prose with **no `data-slot`**, so the
editor has no click-to-edit hook — the text is frozen even when the `<p>` around
it carries `L.attr` (that only makes it *movable*, `data-el`, not *editable*).
For any prose the user should edit, render it through `C.html(key, cls)` (a
whole `<p>`) or wrap the inner text in `C.slot_attr`/`C.slot_span`/`C.t`. A `<p>`
with `data-el` but no `data-slot` is the tell.
**The third answer: `C.derived(source)`.** Some text is not the user's to
type — a tally, a rank, a computed share, anything whose authority comes from
the thing that produced it. Retyping it would only make the page disagree
with its own source. Stamp those spans with
`C.derived("python -m testimony stats")` — the argument is *how the value is
remade*, so the answer travels with the markup. It clears the editability
check (a declaration, not an oversight), and clicking the number in the
editor tells the reader where it comes from instead of doing nothing.

Use it for measured values only. It is not a way to quiet a finding on text
somebody simply forgot to wire — if a person could reasonably rephrase it,
it is prose and belongs in a slot. And it never excuses a sentence drawn
inside an SVG: a caption is prose wherever its numbers came from.

| Photo / raster image | an `<img>` with `L.attr` (see the primer's `img_el`) | move, corner resize, rotate, crop, replace |
| Rect / ellipse / line / text box / table | user adds from the editor; stored in layout.json | move, resize, restyle |
| Coloured background band (a full-width section) | `L.sec(el_id)` on the section tag — NOT `L.attr` (a band must never leave the flow) | bottom-edge grip: stretch taller, or drag back to natural height to reset; override lives in layout.json `sections` |

## Composing NEW visuals: separate primitives, grouped — never fused

Build a labelled box from a layout.json `shapes` rect + a `boxes` text box +
a `groups` entry (`["<shapeId>", "text.<boxId>"]`): it moves as one until the
user hits Ungroup (⌘⇧G) and detaches the text. Never bake sentences inside an
SVG or fuse text + background into one div. For a `card(detachable=True)`,
seed the default group `["card.<bullets_key>", "<title_key>", "<bullets_key>"]`.

## layout.json is an OVERRIDES layer

The renderer's design is the default; layout.json only speaks where the user
moved/resized/recoloured something (`positions`, `shapes`, `boxes`, `tables`,
`groups`, `endnote_order`, and the two stylesheets: `textStyles` — named
text styles a slot/box/table wears with `use` — and `objectStyles` — named
looks for a `shape`, `box` or `table`, each style saying its `kind`; an
object says `use: "<name>"` and its own keys still win, see
`docsync/INDESIGN_PARITY.md`). An empty file = the pristine design. Don't
hand-place by guessing inches — set a sensible default in the renderer and let
the user drag.

## Placement: nothing clashes

Two elements fighting for the same inches is the defect a reader sees before
any other. The discipline, in order of preference:

1. **The flow cannot clash — prefer it.** Content rendered in the renderer's
   own flow (slots, `graphic()`, `card()`, sections) lays out around itself;
   there is nothing to collide with. Reach for `addTextBox` / `addShape` /
   absolute placement only for genuine annotations — a callout, a stamp, a
   label riding a chart — never as a substitute for putting content in the
   renderer.
2. **Measure before you place.** Never guess inches. `inventory()` returns
   every element's bounding box in page inches; read the geometry, pick a
   spot that is actually empty, keep ~0.15in clear of neighbours, and stay
   inside the binding's `margins`. A default that lands "roughly there" and
   waits for the user to fix it is a clash you shipped.
3. **Group what belongs together.** Overlap inside a group is composition —
   `audit` deliberately skips it; the same overlap ungrouped is a collision.
   A lockup built from pieces (rect + text box + icon) gets a `groups` entry
   the moment it exists, not later.
4. **`audit` is the gate, and it must come back empty.** After any build-out
   or placement pass, run the pilot `audit` verb and fix every issue:
   `overlap` (two placed movables sharing >20% of the smaller), `covers-flow`
   (a placed box/table/dragged element parked on flow prose or a flow
   graphic), `off-sheet`, `print-overflow` (Save refuses this one outright),
   `rule-through-glyph`, `orphaned-group-member`, `uncited-source`. "Fix"
   means move to clear space or group with intent — never shrink text under
   the legibility floor or hide an element to dodge a finding.

A handoff with a non-empty `audit` is not done, exactly as a conversion with
`[editability]` findings is not done.

## Moving cited text (footnotes travel with it)

A citation is the literal token `[^source-id]`. Move the sentence WITH its
token — into another slot or a text box's `md` — and endnotes renumber by
first appearance in the new reading order automatically. Mid-move states are
edit-tolerant, publish-strict: an uncited source, a typo'd token (renders a
red ? naming the missing id), and an emptied bullet list all RENDER in edit
mode and REFUSE at publish. Never retype a token by hand — copy it exactly.

## Piloting the editor programmatically: `window.docsync.api`

When YOU (an AI, a script) are the one making changes in an open editor,
don't click and drag — drive the pilot API. It is the editor's own verbs,
blessed and held stable (`tests/editor/pilot-api.spec.js` and
`pilot-verbs.spec.js` are the executable contract). Same safety as the UI:
every mutator runs `pushHistory()` first (⌘Z undoes a pilot like a human),
writes land through the one `render()` with all its validation, and every
verb returns plain JSON — geometry in page INCHES — so no screenshot
round-trips.

**Prefer HTTP to a browser eval.** `POST /__pilot` relays a verb to the open
editor, so the whole loop is `curl` — no browser extension, no JS-string
escaping, no dependence on which tab is fronted. The verb still runs *inside*
the editor through `docsync.api`, so it is not an out-of-band write:

```bash
curl -s localhost:8010/__pilot -H 'Content-Type: application/json' \
  -d '{"project":"budget-primer","verb":"setSlot","args":["whopays.p1","…new markdown…"]}'
```

`{ok:true, result:{…}}` wraps the verb's own answer; `{ok:false}` means the
relay failed (no editor tab holding the live stream, or it never answered).
The same thing over MCP is `pilot(project, verb, args)` in
`docsync/mcp_server.py`, which unwraps the envelope for you.

Requires an editor tab open AND not backgrounded — a hidden tab stops leading
the live stream, and the relay then answers "no editor is listening". Bring
the tab forward rather than retrying.

Only when neither is available (no server) do you fall back to a JS eval in
the editor's top window. If you do eval, put SEVERAL `await docsync.api.*`
calls in ONE eval — each eval is a full round trip, and they compose fine.

Start with `inventory()` (or the cheaper headless `/__inventory`); act by the
ids it returns:

| verb | does |
|---|---|
| `status()` | `{dirty, editing, page:{w,h,pageless}, overflow, selected}` — cheap, poll it |
| `inventory()` | every page: elements `{id, kind, box, locked, text}`, slots `{key, text}`, plus sources and status |
| `audit()` | **every mechanical layout problem as data** — see below |
| `getSlot(key)` / `setSlot(key, md)` | a slot's markdown, read / replaced (renderer's grammar applies) |
| `setBoxText(id, md)` | a TEXT BOX's words — they live in layout.json, so `setSlot` cannot reach them |
| `setStyle(key, patch)` | typography for a slot key or `'text.N'`: `{size, font, weight, color, tracking, leading, italic, underline, align, case}`; `null` clears one |
| `place(id, {x,y,w,h})` | move/size in inches — placer's coordinate correction, clamps to the page like a drag; returns where it really landed |
| `recolor(id, fill)` | shape/box/mark id or `'page.<pid>'`; `null` resets to the design |
| `rotate(id, deg)` / `lock(id, on?)` | rotate about the centre (0 clears) / lock out dragging and `place()` |
| `master(page, name)` / `masterFrom(page, name)` / `detachMaster(page)` | master pages — **the person sees these called "shared layouts"**, so say that when you report what you did: a page uses a named set of boxes+shapes (`layout.masters`); `masterFrom` MOVES the page's own items into a new master; a master item renders as `<item>@<page>` and edits as ONE thing across pages (`setBoxText('text.folio@3', …)`); `{page}` in a master box is each page's number |
| `wrap(id, 'left'\|'right')` / `wrap(id, null)` | float an ANCHORED box or designed element beside its paragraph so the lines flow around it (a previous sibling in the same flow, never a child); null puts it back on the text. A wrapped object refuses `place()` and drags |
| `anchor(id, slotKey, {edge})` / `anchor(id, null)` | make a text box or designed element FOLLOW a paragraph (top, or `edge:'bottom'`) — it keeps its distance when the text reflows; null releases it where it stands. Not shapes or tables. Own history step; not a batch verb |
| `group(ids)` / `ungroup(id)` | tie 2+ elements so they move as one (membership is exclusive) / dissolve |
| `remove(ids)` / `duplicate(ids)` | the UI's own Delete and Duplicate, selection handled for you |
| `addTextBox({page,x,y,w,h,md,style,fill})` | returns `'text.<n>'` for further verbs |
| `addShape({page,kind,x,y,w,h,fill,stroke,sw,z,rx})` | a Shapes-panel shape (`rect\|ellipse\|line\|triangle\|arrow`) on ANY page — the way a hairline rule or panel lands on a page `duplicate()` can't reach |
| `applyScheme(idOrHex)` | retint the report to another house scheme ('slate' or a hex) — every use of the current topic colour swaps, one undo step; the Colors rail panel's Apply |
| `addPage(at?)` | blank page; returns its id |
| `duplicatePage(page)` | the strip's Duplicate page: a new page right after it, carrying the movable layer AND — for a designed page or a copy of one — the page's content as its own `copy.<id>.*` slots and elements (see `docsync/pagecopy.py`). Returns `{page, copied}`. Own history step; not a batch verb |
| `addSource(id, text, url)` / `addEndnotesSection()` | declare a source (cite via `[^id]` in slot text) / the synced endnotes section |
| `batch(ops)` | `[{verb, args, as?}]` — one history entry, one render. See below |
| `undo()` / `redo()` | the same history a human's ⌘Z walks |
| `save()` | presses the real Save; refuses (with the pages named) while content overflows the print cut. Push stays with the human |

Mutators refuse while an inline text editor is open (`editing`) — close it
first. Coordinates clamp to the sheet, so read the RETURNED box rather than
assuming the request landed verbatim. `remove`/`duplicate`/`addPage`/
`addEndnotesSection` push their own history internally and cannot join a
batch; call them singly.

**`batch()` — the multi-edit fast path.** Verbs: `setSlot`, `setBoxText`,
`setStyle`, `place`, `recolor`, `rotate`, `lock`, `group`, `ungroup`,
`addTextBox`, `addShape`, `addSource`. Name an op with `as` and later ops can say `'@name'`
wherever an id goes, so create-then-place is ONE call:

```js
await docsync.api.batch([
  { verb: 'addTextBox', args: { page: 3, x: 1, y: 1, w: 2.5, h: 1, md: 'Note' }, as: 'note' },
  { verb: 'place',      args: ['@note', { x: 3, y: 2 }] },
  { verb: 'setStyle',   args: ['@note', { size: 11, color: '#52796F' }] },
])
```

ALL-OR-NOTHING throughout: ops without refs validate before anything mutates,
and a `@ref` op (which cannot be validated until its referent exists) is
validated at apply time — if it fails, the whole batch is rolled back from the
snapshot and the history entry withdrawn. Refs point BACKWARDS only.

**`audit()` — stop screenshotting for geometry.** Returns
`{issues:[{kind, page, ids, box, note}], counts}` for: `print-overflow` (the
same truth `save()` refuses on), `off-sheet` (a placed element past the page
edge — read from the layout store, because the page visually CLIPS exactly
what you are looking for), `overlap` (>20% of the smaller element covered;
grouped pairs are skipped, being composition not collision),
`orphaned-group-member`, and `uncited-source` (blocks publish). Reserve
screenshots for taste — and when you want one, `POST /__export` with
`{fmt:'png', page:N, scale:0.25}` returns a single ~50KB page instead of a
full-resolution zip of the whole document.

**Headless (no browser): `GET /__inventory?project=<id>`.** The same document
as data, from the FILES rather than the DOM — every slot's full markdown (not
the browser's 80-char snippet), every source with its citation count, the
geometry of everything placed, and unless `&elements=0`, every addressable
element/slot/fill id plus the page count (discovered by an edit-mode render,
cached per build). `docsync/mcp_server.py` wraps it as a stdlib-only MCP
server — `list_reports`, `status`, `style_guide`, `inventory`,
`get_slot`, `search`, `uncited_sources`, plus `pilot` for the writes.

The boundary worth knowing: layout.json stores geometry only for things
somebody PLACED, so an unmoved designed element has ids here but no
coordinates — those exist only once a browser lays the page out, which is
what `docsync.api.inventory()` (or `pilot` calling it) measures.

**Never write those files behind an open editor's back.** It holds the
document in memory, so an out-of-band write is overwritten by its next Save,
silently and un-undoably. That is exactly what `/__pilot` avoids: it does not
write from outside, it asks the editor to make the edit itself. Decide WHAT to
change with the read tools; make the change with a verb.

Reserve real clicks for what the API doesn't cover, and screenshots for
visual judgement only.

## "Make me a report from this text" — the house-style build-out

The Appleseed house style is DATA, not lore: `docsync.templates.style_guide()`
returns the fonts, page metrics, colour schemes and every pattern — section
heading, hairline, body, callout, pull-quote, figure caption, footer — as the
exact `style` dicts `addTextBox`/`setStyle` accept and `addShape` arguments.
It rides along on `GET /__templates`, and the MCP server serves it as
`style_guide`. Read it first; never invent fonts or sizes.

The flow when a user hands you text and asks for a report:

1. **Scaffold from a template, not blank**: `POST /__scaffold` with
   `{name, slug, template: 'appleseed-report' | 'appleseed-brief',
   scheme: 'blue'|'slate'|'teal'|'charcoal'}` (scheme optional — each
   template's default first in its `schemes` listing). The scaffold lands a
   cover with placeholder art, inside cover/contents, the executive-summary
   page, and — on the report — **page 4, the section page**: headline over a
   hairline, bold-caps lead-in, body, subheading, footer, already placed in
   the right styles.
2. **Fill what exists** with `setBoxText` (template words live in text boxes,
   so `setSlot` reaches only the title) — title, subtitle, date, TOC entries,
   the summary and section-page text.
3. **Each further section**: `addPage(<current page count>)` — the
   argument APPENDS (argless inserts after the page in view) — then one
   `batch()` of
   `addTextBox`/`addShape` ops copied from the style guide's patterns
   (heading at 0.7,0.7; hairline rect at y 1.62 filled with the topic
   colour; body at 15px over 7.1in; footer `"<n> · <TITLE>"`).
4. **Citations**: `addSource(id, text, url)` and `[^id]` tokens in the text.
5. **Check with `audit()`**, fix what it names, then `save()`. Push stays
   with the human.

## Editing the editor itself (`edit.html`)

Its whole stylesheet is one JS **template literal**: a backtick or `${…}` in a
CSS comment ends the literal early and kills the ENTIRE script — the editor
hangs at "loading the render engine…" with no console error. After ANY
`edit.html` change run a boot test (`npx playwright test boot-errors.spec.js`)
or at least `node --check` its inline script (`tools/test_render.py` does).
An isolated DOM check that a feature works is NOT proof the file still boots.

## Build & serve rules

- Each binding in `docsync.yml` names its ONE build command; run that, never
  hand-edit generated output (the rendered HTML, the staged `<dir>/engine/`).
- Re-stage after engine changes: `python3 -m docsync.stage --id <id>`.
- Never start or kill a dev server the USER owns (a server launched outside
  their login session cannot reach the keychain, so Push breaks) — ask them to
  relaunch their launcher app instead. Test servers on other ports are fine.
- If an editor origin wedges ("localhost won't load", server healthy), the
  escape hatch is `<origin>/reset.html` — it unregisters the service worker,
  drops caches, and reopens the editor.

## Bringing in an existing static page (e.g. a Squarespace embed)

`projects/rxkids/` is the pattern: copy the original HTML in untouched
(`original.html`), stage it via `editor.engine` in docsync.yml (the browser's
virtual filesystem only has what the manifest lists — a renderer reading a
file it forgot to declare fails with no file-not-found on disk to explain it),
and have `render_report.py` wrap its `<style>`/`<body>` almost verbatim in ONE
`section.page` sized to the page's own natural footprint (measure
`scrollHeight` first) rather than a print page. That gets it OPENABLE with
zero content loss. Making pieces of it editable — moving copy into slots,
wrapping art in `graphic()`/`card()` — is a separate, later pass.

Known interop quirk: scroll-triggered reveal animations (an IntersectionObserver
or scroll-listener that adds an "active"/visible class) may not fire inside the
editor's iframe the way they do on the live site — confirmed on rxkids: the
hero (first section) revealed correctly, sections further down stayed at
opacity:0 even after scrolling. Not a build error; a rendering interop wrinkle
worth fixing (or stripping the reveal-gating for the editor context) if it
matters for editing that content.

## Handing over a conversion: the editability contract

A converted document (a PDF rebuilt as a renderer, a scaffolded page after
`propose`, any "make this editable" request) is **not done when it renders —
it is done when `python3 -m docsync.check --id <slug>` shows a clean
`edit-mode draft` line AND the binding says `editability: strict`** in
docsync.yml. Strict makes any future finding a build ERROR — CI
(report-checks.yml) fails the push — so the page cannot quietly regress.
Deliberate exceptions (page-number chrome, a data-frozen label) are listed
per exact string under `editability_ok:`, one reviewable decision per line;
never downgrade a binding to `warn` to get past a finding. `docsync.new` and
`docsync.ingest` write `strict` into every project they create;
`docsync.scaffold` writes `wip` (STAGE ONE is expected to be unwired) — the
STAGE TWO pass ends by flipping it to `strict`. The check builds the edit-mode
draft and finds the two shapes of silent uneditability that every earlier net
missed (the audit and the amber notice count wiring that EXISTS, never text
left with none):

- **dead text** — visible strings with no `data-slot`/`data-fixed`/`data-el`
  ancestor: carried-over widget markup, stat cards, footers. Wire them,
  declare measured values with `C.derived(…)`, or call them chrome out loud.
  Reach for `editability_ok` last: it matches on the exact string, so a list
  of tallies there goes stale the first time the numbers are regenerated —
  that is what `C.derived` exists to avoid.
- **frozen prose** — sentences drawn inside an SVG. The graphic moves; the
  sentence can only be changed by editing the renderer. Captions and notes
  render as slots BESIDE the graphic (`C.html`), never inside it — and any
  WORDS that must sit inside the drawing (a legend entry, a step name, a
  bar's caption) go through `blocks.svg_text()`, below, so they edit in place.

Two conversion rules that prevent the warnings in the first place:

1. **Only data-derived marks live inside a chart as literals** (axis ticks,
   tick values). Anything a person would rephrase — a legend entry, a step
   label, a bar caption — is drawn with
   `svg_text(C, "<chart>.<what>", "<the renderer's wording>", x, y, size, fill,
   weight=, anchor=)`: `data-slot` on the `<text>`, words read through
   `C.text_or(key, default)` so a document that never listed the label still
   renders the renderer's wording and publishing does not raise. The editor
   floats a field over the glyphs on double-click (`editSvgSlot`). Captions,
   takeaway lines and method notes stay slots OUTSIDE the `<svg>` (`C.html`).
   A value label may be an `svg_text` too, defaulted from the DATA constant —
   say at handoff that retyping it changes the label and not the bar.
2. **Match the chart to its nature.** A *presentational* chart (numbers the
   user may legitimately retype) should be a native editor chart — a
   layout.json shape `kind:"chart"` (bar/column/pie/donut), fully editable in
   the Chart panel. A *model-driven* chart (numbers reproduced from a
   pipeline, e.g. rxkids-fiscal's TANF figures) stays a `graphic()` with DATA
   constants in the renderer — retyping "$52.1M" by hand would make the chart
   lie — but then SAY SO at handoff: tell the user those figures change by
   re-running the model, not by clicking.

The handoff message itself must state what is editable how: double-click
edits text, click selects/moves, which graphics are data-frozen and why.

## Where code lives

The engine (`docsync/`, `edit.html`, `serve.py`, this skill) is canonical in
the **primer-editor** repo; report repos vendor copies. Fix engine bugs there
first, then copy over. Report content (its pages, prose, its renderer's
bespoke design) is owned by each report's repo and never flows back.
