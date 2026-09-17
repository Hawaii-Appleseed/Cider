# The draft editor vs Adobe InDesign — capability gap assessment

*Assessed 2026-09-17 against `docsync/editor/edit.html` (21.9k lines),
`docsync/layout.py`, `report2027/tools/serve.py`, the pilot API spec and the
110 Playwright spec files. Line numbers are current as of that date.*

## The one-paragraph answer

The editor is not a page-layout program in InDesign's sense; it is a
**web-first, git-backed, collaborative report editor** whose page model is a
Python renderer plus an overrides file. Where the two overlap — placing and
styling boxes, shapes, images, tables and charts on fixed pages, exporting a
PDF — the editor covers the everyday 80% a staff writer needs, and it beats
InDesign outright on collaboration, versioning, web/Squarespace output,
citation management, editable native charts and machine drivability. Where
InDesign is strong — **typographic control, long-document automation,
prepress output, and a reusable style system** — the editor has almost
nothing. Most of those gaps are structural (the document is HTML rendered by
Chrome) rather than features waiting to be added, so the honest framing is
"which InDesign jobs can move here" rather than "when will parity arrive".

## Scorecard

| Area | Editor today | Gap vs InDesign |
|---|---|---|
| Placing & transforming objects | Strong | Small |
| Images | Adequate | Medium |
| Shapes & drawing | Five primitives | Large |
| Typography | Basic character controls | Large |
| Paragraph & style system | None | Large (structural) |
| Pages, spreads, masters | Single pages only | Large |
| Long-document automation | Endnotes only | Large |
| Tables | Good | Small |
| Charts | Better than InDesign | None (advantage) |
| Colour | RGB hex, palettes, schemes | Large for print, none for web |
| PDF / prepress output | Chrome print-to-PDF | Large |
| Web / HTML output | Strong | Advantage |
| Collaboration & versioning | Strong | Advantage |
| Automation / scripting | Pilot API + MCP | Advantage |
| Find, spell, proofing | None | Medium |

## What the editor has (with evidence)

**Objects.** Text boxes with presets; rect/ellipse/line/triangle/arrow
(`#shapepop`, edit.html:2112); searchable icon library; images with upload,
client-side downscale to 2000px (`MAX_IMAGE_DIM`), crop, replace, flip,
brightness/contrast/saturation/grayscale, corner radius. Move, 8-handle
resize, rotate, numeric X/Y/W/H/scale/rotation (`#ar-pospop`). Group/ungroup,
duplicate, copy/paste, format painter (⌥⌘C/⌥⌘V), align to page or selection,
distribute, snap lines and draggable ruler guides, z-order with ⌘]/⌘[ and a
per-page Layers panel, lock, hide with Restore deleted. Opacity, one drop
shadow, linear/radial gradient fills, stroke weight/dash/arrowheads,
entrance animations replayed in Present mode.

**Typography.** Per slot or box: family (an allowlist of ~28 Google families,
`FONTS` layout.py:216), size 10.5–200px with a hard legibility floor, weight,
italic, underline, colour with eyedropper, left/center/right/justify,
letter-spacing, line-height, case (incl. Title Case), seven text effects.
Inline bold/italic/links, bulleted and numbered lists with nesting.

**Pages.** Add, duplicate, delete, hide, drag-reorder (when the renderer
declares pages). Sizes: Letter, Legal, A4, A3, Slide 16:9, Slide 4:3,
Pageless (`DOC_SIZES` edit.html:19738). Page fill colour. Bleed & crop marks
checkbox on PDF export (`#dl-marks` → `DOCSYNC_MARKS`).

**Tables.** Insert/delete/move rows and columns, header row, per-cell fill
and text, borders, fit-to-content, even widths, style presets, spreadsheet
style keyboard editing.

**Charts.** 13 native editable kinds (bar, stacked, row, pie, donut, line,
scatter, histogram, radar, funnel, packed circles, treemap) with a data grid,
palette recolour, axis/gridline toggles, in-place label editing.

**Citations.** `[^id]` tokens, a Sources panel, auto-renumbered endnotes by
reading order, a synced endnotes section, uncited-source audit at publish.

**Output.** PDF via headless Chrome (`_chrome_pdf` serve.py:2389), PNG per
page or zipped, self-contained HTML, a Squarespace paste-in block with media
queries frozen at design width, source zip, fullscreen Present mode, Publish
as a PR.

**Workflow.** Undo/redo on every mutation including pilot verbs, named
version history with on-page diff marks, Save = local commit, Push = GitHub,
comments with mentions/resolve, Suggesting mode with accept/reject all,
real-time co-editing (Yjs, presence, live carets, follow), share links and a
view-only roster on the hub, one-way Google Doc import, offline draft cache,
self-update with rollback, and a full pilot API over HTTP and MCP.

## The gaps, ranked by how much they matter for Appleseed's reports

### 1. No style system (paragraph, character, object styles)
InDesign's core productivity feature. Here every box carries its own style
dict; changing "all body copy to 10.5pt" means touching every box, or
`applyScheme` for colours only. The nearest things are the three text-box
presets, table presets, and `style_guide()` patterns that are copied at
insert time, not linked afterwards. Consequence: house-style drift across a
40-page report, and no "redefine style" to fix it.
*Feasibility: medium. A named-style layer in layout.json that boxes reference
by id, resolved in `text_css()`, fits the existing overrides model.*

### 2. No text flow: no threaded frames, no overset, no text wrap
A text box is an island. Long prose either lives in the renderer's flow
(where it reflows but cannot be pulled into columns or across pages by the
user) or in a fixed box that clips. There is no linked-frame chain, no
overset indicator beyond the print-overflow audit, no columns within a box,
and no wrap around an image or shape. This is the single biggest reason a
designer cannot lay out a text-heavy report the InDesign way.
*Feasibility: hard. CSS has no frame threading; it would be a bespoke
pagination pass in the renderer.*

### 3. Typographic fine control
Absent: kerning, hyphenation and H&J settings, space before/after paragraph,
first-line and hanging indents, drop caps, tab stops and leaders, baseline
grid, small caps, subscript, OpenType features (ligatures, old-style
figures), optical margin alignment, keep-with-next and widow/orphan control.
Also a fixed font allowlist with no way to load a licensed face such as
Glober. Rendered output is Chrome's line breaking, which is visibly looser
than InDesign's paragraph composer on justified columns.
*Feasibility: mixed. Space before/after, indents, small caps, hyphens and
OpenType toggles are one CSS property each and cheap. Kerning/H&J/baseline
grid/paragraph composer are not realistically reachable.*

### 4. No master pages, spreads, sections or auto page numbers
No parent pages for repeated running heads and footers; the template's
footer is a text box duplicated per page and edited by hand. No facing-page
spreads, so gutters and crossovers cannot be judged. No section numbering,
no auto page-number variable, no "continued on" text variables.
*Feasibility: medium for masters and page numbers (a per-report "on every
page" box list plus a `{page}` token); hard for spreads.*

### 5. Long-document automation
No generated table of contents (the template's contents page is typed by
hand and goes stale), no cross-references, no index, no running headers, no
footnotes at page foot (endnotes only), no conditional text, no book
assembly of multiple documents.
*Feasibility: TOC and page-number references are medium and high-value; the
rest is rarely needed for policy reports.*

### 6. Prepress and colour
Everything is sRGB hex; no CMYK, spot, tints, colour profiles, overprint or
separations. PDF export is Chrome's print engine: no PDF/X, no font embedding
control, no bleed geometry beyond the crop-marks flag, no packaging of fonts
and links, no preflight profiles, no tagged/accessible PDF and no alt-text
field on images. Images are downscaled to 2000px on upload, which is under
300ppi for anything wider than about 6.5in.
*Consequence: fine for web PDFs and office printing; a commercial print run
still needs a designer to rebuild or at least remediate the PDF. Accessible
PDF is a real gap for a public-interest publisher.*

### 7. Drawing tools
Five primitives with corner radius. No pen or Bézier paths, polygons, stars,
custom shapes, pathfinder, compound paths, blend modes, glows, bevels, inner
shadows, gradient feather, or non-rectangular image masks. Complex figures
are made outside and placed as SVG through `graphic()`.

### 8. Proofing
No find and replace, no spell check (the editor sets `spellcheck="false"` on
its inputs), no glyph panel, no change tracking beyond Suggesting mode. Find
and replace over slots and boxes is cheap to add and worth doing.

### 9. Image management
No links panel, no relink, no fitting commands (fit proportionally, fill
frame), no effective-ppi readout. Crop is manual only.

## Where the editor is ahead of InDesign

- **Collaboration and provenance.** Real-time co-editing, comments,
  suggesting mode, named history with on-page diffs, git commits behind
  every Save, view-only sharing. InDesign has none of this natively; InCopy
  and Cloud Documents are partial answers at extra cost.
- **Web output.** One document produces the PDF, a self-contained page, and
  a Squarespace block with responsive quirks frozen. InDesign's HTML export
  is unusable for this.
- **Live data charts and tables.** Native, editable, restyle-by-palette
  charts. InDesign has no charting at all.
- **Citations.** Endnotes that renumber as sentences move between slots.
- **Guardrails.** A legibility floor, print-overflow refusal at Save, the
  `audit()` collision check, and `docsync.check` in CI. InDesign relies on
  the designer.
- **Automation.** A stable verb API over HTTP and MCP, batched with undo, so
  an assistant can build or revise a report. ExtendScript/UXP is far heavier.
- **Zero cost, zero install for viewers, self-updating, offline-tolerant.**

## Recommendation

Treat InDesign and the editor as answering different questions. Keep
InDesign (or a contracted designer) for the small number of pieces that go
to a commercial press or need pixel-level typography. Move everything
web-first, collaborative or frequently revised (primers, briefs, one-pagers,
testimony analyses, slides) to the editor, which is already the direction
the templates point.

If effort goes into closing gaps, the order that buys the most for
Appleseed's actual output is:

1. Named text styles applied by reference (gap 1).
2. Cheap typography wins: paragraph space before/after, indents, small caps,
   hyphenation toggle, subscript (gap 3).
3. Repeat-on-every-page elements with a page-number token, and a generated
   contents page (gaps 4, 5).
4. Find and replace, then spell check via the browser's own checker (gap 8).
5. Alt text on images and a heading-order pass toward tagged PDF (gap 6).
6. Raise or make configurable the 2000px upload cap for print-bound reports.

Threaded text frames, spreads, CMYK and a paragraph composer should be
declared out of scope rather than half-built.
