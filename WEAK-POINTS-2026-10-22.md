# Cider weak points, second pass — 2026-10-22 (laptop, worktree `audit2` off main @ af042ab)

The first pass (WEAK-POINTS-2026-10-21.md) drove the editing surface:
chords, handles, paste, drag. This pass went to the places it did not —
the paths that would hurt a person most when they go wrong: Save and
Push failing, two people in one document, File ▸ Download, a long
report, Find & Change, and the first run with no project yet. Six areas,
each driven in the real editor by throwaway probe specs (`PROBE name:
{json}` lines, asserting nothing) against endpoints routed to the
failure under study, a real relay under Miniflare, a real headless
Chrome for the export sweep, and `budget-primer` grown to 52 pages by
the pilot API.

**Fixed on the `audit2` branch (PR #26), items 1–23, each pinned by a
test that fails on the editor before the change and passes after**:
`tests/editor/save-failure-paths.spec.js` (7), `export-failures.spec.js`
(7), `find-and-new-report.spec.js` (5), `page-jumps.spec.js` (4), a test
each in `collab.spec.js` and `collab-hub.spec.js`, and an engine check
in `docsync/test_docsync.py`. What was found but left stands at the end,
with why.

## Ranked

### 1. Words typed while a Save was in flight were marked saved and never sent

A Save takes a build's worth of time. `original = source` ran when the
answer came and read the CURRENT source — so anything typed in between
was baselined as saved: the button went grey, `beforeunload` had
nothing to guard, and the late words lived only in the tab. Reproduced
with a 2.5s `/__save`: `dirty:false`, `source === original`, the late
words in the source and in no request. The baseline now moves to
exactly what was sent, and `markDirty` keeps the rest. (edit.html
`$('save').onclick`)

### 2. Push stayed live during a Save and ran first

`/__push` fired while `/__save` was still building: the push sent the
commit BEFORE this one, the status said "pushed", then "saved locally"
over it, and the button read "Push (2)" — the person believed the
latest save was out. On the real server the two gits would also race.
A `saving` flag now disables Push (and refuses a scripted press) until
the save has landed; `setPushState` and `markDirty` respect it.

### 3. A commit a hook refused left the words on disk and called them Claude's

The ʻokina lint refuses the Save's commit (first pass, item 3). The
files were already written and built, so the version bumped, the
editor's `_pull` found disk ≠ original and source ≠ original, and the
status line changed from the hook's reason to "Claude changed the same
thing you have unsaved — Discard to take the disk version, or Save to
keep yours". Discard would have taken the person's own uncommitted
text; Save looped. serve.py's `_save` now rolls the files back exactly
as it does for a draft that does not build, and answers "nothing was
saved — your words are still here in the editor" with the hook's
reason; `_pull` also stops calling "the disk holds exactly my unsaved
words" a clash. The server half is tested through the real `/__save`
on a scratch repo the spec adopts, past the suite's block by a header
(`X-Primer-Test-Save`, like `/__pull`'s).

### 4. A dead or crashed server showed a parser's words

A 500 page: "save failed: Unexpected token '<', "<h1>Intern"... is not
valid JSON". A refused connection: "save failed: Failed to fetch". Same
for Push. `postLocal` now says whose fault it is ("the live server hit
an error (500)", "the live server is not answering") and that the words
are still here, with the way back (relaunch the editor app, then Save).

### 5. A server that stopped answering was never mentioned while idle

With `/__ping` and `/__events` refused for seven seconds the status
line still said "live — edits here and from Claude land in the same
files"; a person typed into a dead server for as long as they liked and
learned at Save. Three missed polls now say so (and the follower tabs
hear it through the leader's relay); it stands down when the server is
back.

### 6. A failed export was announced as downloaded, and a junk file saved

`/__export` routed to a 500 page, a 404, an empty 200 or plain text: PDF
said "downloaded Demo-Report.pdf" and saved the error page as a .pdf;
PNG saved an 18-byte zip; JPEG, selection and package then died with
"invalid zip data". Only a JSON body counted as failure. One
`exportAnswer()` now wants a good status and the kind of body asked
for, says "nothing was downloaded" with the status and the body's first
words, and every export path uses it. (The test server's export mock
now answers PNG/JPEG with a real zip of real PNGs, as the stricter check
requires.)

### 7. rxkids' PDF and PNG carried mid-animation numbers; the PNG was white below the fold

The page's count-up (`.rxk-fact-value`, an IntersectionObserver) and
scroll-reveal (`.tfc-reveal{opacity:0}`) ran under Chrome's virtual
time with nobody scrolling: the PNG read "3,680 / $1,118 / 1–3 months"
for 14,808 / $4,500 / 6–12 months and was blank from the stat cards
down; the PDF read "4,757". The capture now emulates
`prefers-reduced-motion` before navigating, which the page honours
(its own rule puts every reveal at its end state and skips the
counting). Verified against a real server: the PNG reads the right
numbers and 88% of its rows are painted. A page that does NOT honour
reduced motion would still animate; none of the bound ones is such.

### 8. The Squarespace block stripped the scripts and kept the animation's start state

Pasted, rxkids was the nav, three cards and 2,500px of white: thirteen
sections at `opacity:0` waiting for an observer the block never runs.
And a dark-mode host flipped tfc-2027-priorities' words light on its
white sheet, because `@media (prefers-color-scheme: dark)` was left
standing as "undecidable". `mediaFeature` now decides
prefers-reduced-motion as reduce and prefers-color-scheme as light, as
it decides a width: the block is a still of what the editor showed.

### 9. Export filenames title-cased the id

`Rxkids.pdf`, `Tax-Testimony.pdf`, `Dotax-Itep.pdf`: the registry
built every name from the id. It now carries the binding's own `name:`
("RxKids Hawaiʻi"), which the start page shows too.

### 10. A half-closed socket was never noticed: both tabs said "live" while nothing crossed

Under Miniflare, `ws.close()` on one side leaves the socket CLOSING
with no close event — exactly what a proxy that swallows the close, a
laptop lid or a TCP peer that simply stops does in production. The
provider learns of a drop only from a close event, and y-partyserver's
provider has no last-message timeout. A's chip said "● live · 2", B's
"· 1", neither's edits reached the other, indefinitely (45s watched; a
reload of B did not help; only the 10-minute idle sleep/wake did).
`CollabSession` now asks the room for a resync every 10s and watches:
a socket CLOSING/CLOSED for more than 2s, or an open one silent for 30s,
is taken away the way `wake()` already does for the sleep path, and the
provider reconnects; the browser's `online` event does the same at
once. Never on a deliberate `disconnect()` (`shouldConnect` false).

### 11. A restore wiped a colleague's unsaved words and told them the opposite; their ⌘Z then corrupted the document for everyone

A restores a version; B had unsaved words in another paragraph. B's
words vanish, B's status says "a collaborator saved the shared draft —
it holds what is on screen", Save goes grey. B presses ⌘Z and both
editors get `# A SECOND REPORT# A SECOND REPORT`: B's undo step was
"replace old→new" and undoing it after the restore re-inserts the old
text beside the restored copy. Now: a restore is flagged on the room's
meta (`setBaseSha(sha, {restored: true})`), every editor clears its
undo history when the flag lands, and B is told "a collaborator
restored an earlier version, which replaced the edits you had not
saved — ask them, or bring the newer version back from History". Not
done (see "Left"): asking the room first whether anyone holds unsaved
words, and restoring as a per-slot diff so untouched slots keep
concurrent edits. Both done since: each editor says `unsaved` in its
presence once it has written words no Save has recorded, and `hubRestore`
names those people in the confirm (and which paragraphs the restore would
replace); the restore itself is a 3-way per-slot merge
(`mergeRestore`, collab/ydoc.mjs), so a paragraph the restored version
does not change keeps what is typed in it, and the saved baseline is the
restored version, so those words stay unsaved for everyone. The hub's
`restore()` still leaves the room to the editor.

### 12. Replying to a comment before the hub had answered dropped the reply

A card shows at once under a provisional id; a reply typed under it
went to `/comments/pending-…/replies` and came back "reply not added:
no such comment", words gone. One round trip's window, normally. The
reply now waits for the card's real id (left on the card as
`__clientId` by `hubCommentsMerge`) and then posts.

### 13. A click on a page chip could navigate the whole editor away

The strip's thumbnails are live clones of the sheets, links included,
and nothing stopped a click reaching one: on budget-primer's page 12,
21 links cover 39% of the chip, and a click in the middle of it opened
capitol.hawaii.gov in the editor's tab (with unsaved words the
`beforeunload` prompt stood between; clean, the editor was simply
gone). `.chip-view` is `pointer-events:none`; the chip takes the click.

### 14. Jumping to a page never arrived

A chip, a Layers row and Find's "Show me" all used
`scrollIntoView({behavior:'smooth'})`, which scrolls every ancestor: it
pushed the stage band out, the band-return listener handed it back
with an instant `scrollTop` write, and that write cancelled the smooth
scroll in flight. A 12-page jump ended on page 1 (headless) or page 4
(headed). One `jumpTo(el, block)` now scrolls the report's own window,
which the band listener leaves alone.

### 15. Undo history was capped at 60 steps and nothing said so

80 nudges, 85 ⌘Z: 60 undone, 25 × "nothing to undo", the document not
back at its start. A snapshot is 20–35KB and the heap was flat, so
memory was not the reason. 200 now, and the Undo button's title says
"the last 200 steps are kept".

### 16. The Find list truncated silently

"481 hits" in the header, 40 places × 4 hits shown, no word about the
rest — and Change all covers every hit, so a person approving from the
list approved places they could not see. The list now ends "… and N
more places not shown here — Change all covers them too", and a group
with more than four hits says how many more.

### 17. "Whole words" knew no Hawaiian letters

`\b` is ASCII: with Whole words on, `ʻāina` found 0 (loose: 1), `lā` 0,
`$419` 0. Unicode-aware edges (`(?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])`,
flag `u`), with the old edges as the fallback for a GREP pattern the `u`
flag refuses.

### 18. A Change all the slot refused was reported as changed

A replacement that makes a line a `[[marker]]`, or a malformed sources
line: `writeSlot` refuses it and says why, and `findReplaceAll` then
wrote "changed 1 hit in 1 place" over that. `writeSlot` now returns
false on a refusal and the message counts them: "1 place refused the
change — …".

### 19. A citation naming no source rendered as "0392"

In edit mode a `[^typo]` draws a red "?" link; `linkify()` then ran
`re.findall(r"\d+")` over that inner HTML, pulled `0392` out of the
colour `#C0392B`, and replaced the marker with inert text "0392". Any
typo'd citation did this, not only one Find renamed. `linkify` leaves a
marker that is already a link alone, and reads digits from text only.
(docsync/content.py; checked in test_docsync.py)

### 20. The one-pager template could not be created

"Hawaiʻi Appleseed one-pager" → Create → forty seconds → a traceback in
the status bar ("box #15.style.size: 10px is 7.5pt in print — below the
7.875pt legibility floor") and the person left on their previous
report, with the project folder and the binding already written: the
next try with the same title said "already exists". The footer box is
11px now, and `_scaffold` takes a project back when its first build
fails (the folder, the staged copy, and the binding when docsync.yml is
still exactly what create() left) and says "nothing was created". The
rollback itself has no automated test — no shipped template fails its
first build any more, which is the point — and was exercised by hand.

### 21. New-report refusals and slugs

A 500 from `/__scaffold` read "could not create it: Unexpected token
'<'" (now through `postLocal`, so it says the server hit an error);
`slugifyReport("Probe ʻŌlelo Hawaiʻi")` was `probe-lelo-hawai-i` (now
`probe-olelo-hawaii`: marks off, ʻokina dropped). Not done: keeping the
dialog open with the error in it, so the title and template are not
lost on a refusal.

### 22. An unknown `?project=` silently opened the default report

`edit.html?project=probe-nope` booted budget-primer under that URL with
nothing said. The idle line now says `no report called "probe-nope" on
this server — this is budget-primer. File ▸ Open lists the rest`.

### 23. A Save's commit failed where git had no identity

Found by the PR's own CI: on a runner (or a colleague's fresh machine)
with no `user.email`, the Save's commit fails with "Author identity
unknown *** Please tell me who you are" and the editor shows that as
the save failure. `_identity()` now supplies `-c user.name/user.email`
when none is configured — the GitHub login from File ▸ Connect GitHub
with GitHub's noreply address, else the account on this computer. A
configured identity is untouched. (Pinned by the hook test, which runs
on a scratch repo with no identity.)

## Found and left

- **Web-page reports export as mostly blank sheets** (export sweep):
  our-mission (`page: [12.5, 160]`) renders `.page{min-height:160in}`, so
  its PNG is 2400×16000 with content in the top fifth, its PDF eleven
  letter pages of which eight are empty, 35MB because one image is
  embedded per page; wfc-credits the same shape. rxkids/tfc/wfc PDFs are
  a letter pagination of the mobile reflow (no `@page`), with cards cut
  at breaks, and page ranges are refused ("the report has 1 page"). These
  are the renderers' own `min-height:{page_h}in` and the bindings' sheet
  sizes (`projects/*/render_report.py`, `docsync/scaffold.py:182`); the
  fix is pageless bindings (`h: null`) and an `@page{size: W auto}` for
  web pages — a change to four reports' renderers, outside an editor
  audit.
- **The package never includes fonts** ("0 of 0 font files"):
  `inlineEverything` keeps Google Fonts as `<link>`s, so `fontFaces()`
  finds no `@font-face`. The self-contained primer HTML also links
  `primer.js` relatively. Both are `exportPackage`/`inlineEverything`
  work with a design question (ship woff2 or keep the link).
- **Find never looks at the sources list** (`findTargets` takes only
  slots with a `[data-slot]` in the DOM; `sources` has none), so a
  source title or URL gets "Nothing found", and renaming a citation
  renames the prose token but not its `[id]:` line. "Show me" scrolls to
  a slot but highlights nothing; hits in cells and boxes are not
  clickable. Worth its own pass with the Find panel's owner.
- **The report template never uses the typed title** ("YOUR REPORT
  TITLE HERE", footers "YOUR REPORT"); the typed name goes only to
  `[[title]]` and the window. `docsync/templates` + `new.create()`.
- **The Layers panel does not follow the page while open** (title stays
  "Layers — page 1" after scrolling to page 52 until reopened);
  `railThumbs()` clones every sheet on every render (28ms at 50 pages,
  linear). Neither hurts at today's sizes.
- **Zero projects is unreachable from the UI** (no way to forget a
  project); with an empty registry the editor still boots the default
  engine while Open says "no other reports". start.html handles it.
- **Suspected, not confirmed**: on the report/brief templates the first
  click on the cover opens the full-bleed photo box, so the first
  keystrokes land beside `![Cover photo placeholder]`; a local-mode
  network blip shows the server-gone line (item 5) while the collab chip
  still says live.

## What was checked and works

**Save/Push**: a hung `/__save` times out at 30s with a clear line
(first pass); `GIT_TERMINAL_PROMPT=0` plus a 45s cap means a credential
prompt with no terminal fails in seconds with the way out; a draft that
does not build is rolled back with the old bytes; a non-fast-forward
push says "push rejected — the remote has commits this machine
doesn't"; the deploy-branch confirm asks before fast-forwarding many
commits. **Collab**: two people typing in the same paragraph — at both
ends and inside each other's sentences — lose nothing, keep their
carets, and agree with the room; a relay restart with a paragraph open
shows "○ offline" and delivers every offline keystroke on reconnect; a
comment posted in A and replied to by B the instant it appears lands on
the right thread and survives both reloads. **Export**: the page-range
parser accepts "2-3", "3", "1,3", " 1 - 2 " and refuses "3-1", "0",
"a", "1,,2", "1-", ",1" with the documented words; PDF, PNG, JPEG, HTML
and the block are right on twelve of fifteen bound reports (the three
exceptions are the web pages above); selection exports crop correctly;
charts and real tables survive HTML and the block everywhere; the block
measures its design width (816/1020/1200) and scales and centres.
**Big report**: typing is a contenteditable with one render at commit
(83ms on budget-primer, 108ms in a table cell, 150ms at 52 pages);
sixty undos all come back at ~110ms each (172ms at 52 pages); the
Layers panel builds in under 2ms with 80 objects and reorders by drag;
addPage is flat at 120–230ms from page 13 to 50; the Save body is 20KB
(49KB at 52 pages) and the worst frame gap in flight 40ms; Find lists
481 hits in a millisecond and changes them all in 318ms; boot is 2.7s
warm. **Find & Change**: bold prose, bold in a cell, link text and URL,
citation tokens, headings, boxes and cells are all found; a URL
fragment changes without breaking the link; `$1 \ * [ (.*) $& ʻ` are
written literally in plain mode; a fake ʻokina in the replacement is
fixed; a longer cell reflows; Change all is one undo step and lands in
the Save payload; ⌘F with a field open commits the words first.
**Templates**: an empty title is blocked; cancel creates nothing; blank,
report and brief scaffold in 2–3s with logos, scheme, footers and page
numbers; typing, add page, Save, Download HTML and reopen from Open all
work on a new report.
