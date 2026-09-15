# primer-collab

Real-time collaborative editing for the docsync draft editor: one Cloudflare
Durable Object per project, holding a Yjs document that two or more browsers
edit at once.

Phase 0 (the file⇄document bridge) is in [PHASE0.md](PHASE0.md).
Phase 1 (the Worker), Phase 2 (the editor side), Phase 3 (presence) and
Phase 4 (the branch underneath, carets, typing together in one paragraph)
are described below.

```
collab/
  serialize.mjs        Phase 0: content.md + layout.json  <->  document
  src/auth.js          who may open a room, and the ticket that proves it
  src/index.js         the Worker: POST /auth, and the websocket gate
  src/room.js          the Durable Object: one project document
  src/persist.js       chunked snapshot storage
  client/session.mjs   Phase 2: the editor's mirror — shadow doc, diffs, undo
                       Phase 4: beforeRemote/onBaseSha hooks, cursors as relative positions
  build-client.mjs     bundles client/ + yjs -> docsync/editor/collab-client.js
  devserver.mjs        boots a throwaway `wrangler dev` for tests (or by hand)
```

## Running it

```bash
cd collab
npm install
npm run dev          # wrangler dev on :8787
npm test             # unit + end-to-end against a real Worker (~2 min)
COLLAB_E2E=0 npm test   # unit only, no wrangler
npm run build:client    # after touching client/session.mjs or ../serialize.mjs
```

The end-to-end tests boot a real `wrangler dev` (Miniflare — real Durable
Objects, real websockets, real storage) and drive it with two independent Yjs
clients — and, in `client.test.mjs`, two `CollabSession`s through the exact
API the editor calls. Nothing touches GitHub: tickets are minted locally with
the development signing secret.

The editor itself is exercised by `npx playwright test collab.spec.js
collab-drafts.spec.js` from the repo root: two browser contexts on one
project against a relay each spec boots for itself (so the other ~120 spec
files never pay for a Worker boot). `collab.spec.js` runs a local editor;
`collab-drafts.spec.js` runs a hosted one against the in-memory fake GitHub,
for the branch side of Phase 4.

The Phase 0 gate runs from the repo root and stays dependency-free:

```bash
npm run test:collab     # 72 assertions, ~1s
```

## How a browser joins a room

A room is one project in one repository, named `owner~repo~project` — `~`
because it is URL-unreserved and cannot appear in a GitHub owner or repository
name, so the three parts stay unambiguous inside one path segment.

```
POST /auth  {room, token}   ->  {ticket, exp, login}
GET  /parties/primer-room/<room>?ticket=<ticket>   (websocket)
```

**The GitHub token never appears in a URL.** It is POSTed once, over TLS, in a
request body. The Worker asks GitHub whether that token has push permission on
the room's repository — the same single call `edit.html`'s `tokenWhy()` already
makes — and returns a short-lived HMAC-signed ticket naming the room and the
login. The ticket is what rides the websocket query string, so a URL captured
in a log or a proxy is worthless 90 seconds later and cannot be replayed
against a different room. Tickets are stateless, so verifying one costs no
storage read.

Two allowlists bound the surface: `ALLOWED_ORIGINS` (which pages may request a
ticket at all) and `ALLOWED_REPOS` (which repositories this Worker serves —
without it, push access to *any* repository would mint a ticket for a room
named after someone else's).

## The document

The shape Phase 0 established, as Y types:

```
Y.Doc
├─ blocks: Y.Array<Y.Map>    { kind, key, text: Y.Text, pad, lead, gap }
├─ layout: Y.Map<id, Y.Map>  positions, shapes, boxes, tables
└─ meta:   Y.Map             { baseSha }
```

Per-slot `Y.Text` is what makes two people typing in the same paragraph merge
character by character instead of one overwriting the other — proven by the
`converge on concurrent edits` test, which has both clients edit one slot
simultaneously and asserts both edits survive on both sides.

## The server does not talk to GitHub

The Phase 1 scope had the Durable Object bootstrap an empty room by reading
`content.md` and `layout.json` from the draft branch. It doesn't. **The first
client to arrive seeds the room from the files it has already fetched to render
the page.** Reasons, in order of weight:

1. A server-side fetch needs a GitHub credential of its own. Any design where
   a shared server holds a token that can read — and eventually write — the
   repository is strictly worse than one where the credential never leaves the
   browser that owns it.
2. It would only work for public repositories, or force a service token for
   private ones. primer-editor's consumers include private repositories.
3. It is redundant work. The first browser into a room already has both files.

Exactly one connection is granted the seed. The grant is a synchronous
check-and-set inside the Durable Object, which runs one task at a time, so no
lock is needed; the room then records in storage that it has been seeded, so
reconnecting to an empty-but-seeded room does not re-seed it. Tested by
`exactly one connection is granted the seed`.

## Persistence

`onSave()` writes `Y.encodeStateAsUpdate` to Durable Object storage, chunked at
48 KB. Chunks are written before the meta key and stale chunks deleted after
it, so an interrupted write leaves the previous complete snapshot readable
rather than a half-written mixture. `onLoad()` restores it. Tested by
`the document survives every client leaving`, which disconnects every client,
waits out the save debounce, and reconnects a fresh one.

Saving to git remains the browser's job and keeps its current meaning: Save
serializes the document through `docToFiles()` and commits to the shared
`draft/<project>` branch; Publish opens and merges the PR. The Durable Object
is the live workspace; git stays the record. `meta.baseSha` is the commit the
live document was built from, which is how Phase 4 will detect that the branch
moved underneath a session.

## Hibernation is off, and the client lets go instead

A hibernating Durable Object drops its isolate between messages, and a Yjs room
must hold the whole document in memory to apply an update — so every message
would pay a full reload. Hibernation stays off for that reason.

What it costs: a room bills wall-clock GB-s while a websocket is open, at
128 MB, whether or not anybody is typing. That is 0.125 GB-s per second **per
room** — not per person, so two people in one document cost what one costs.
Against the free plan's 13,000 GB-s/day it works out at about 29 hours of one
room being open, or half that across two.

Which sounded bounded until you notice what a tab does: **one document left
open overnight is ~10,800 GB-s, most of a day's budget spent on nobody
editing.** The original note here said to revisit with a measurement rather
than a guess. The measurement was arithmetic, and it did not need a week.

So the socket is no longer something a tab holds for as long as it is open.
`CollabSession` drops it after ten minutes with no input, or two minutes off
screen, and takes it back the moment anything happens (`idleMs` / `hiddenMs`,
`0` for never). Yjs is what makes that safe: both documents stay in memory
while the socket is gone, local edits keep landing in the shadow, and the
reconnect merges them — the same path a network blip already takes, walked on
purpose. See "sleeping an idle tab" in `client/session.mjs` for the three
choices that are easy to get wrong:

- **Activity is measured in the session**, from document and presence changes,
  not read off the editor's `idle` flag — that one is wired to three events on
  the top window, so typing inside the report iframe does not always reset it.
- **A collaborator's edit counts as activity.** Duration is per room, so they
  hold it awake regardless: leaving would save nothing and would drop the
  reader of a document mid-sentence. The saving only ever comes from a room
  where everyone has stopped.
- **`provider.connect()` will not open a socket while the provider holds one**,
  and it only lets go when a close *event* arrives. A handshake that never
  completes strands the session asleep with no way back — Miniflare does this
  under the tests, a proxy that swallows the close does it in the wild.
  `sleep()` remembers the socket it killed so `wake()` takes that one, and
  only that one, away.

The status is `asleep`, never `offline`: nothing failed, and the band the
editor draws over the page for a broken relay would be a lie.

**The other half is on the hub**, which asks rooms who is in them: waking a
room runs `onStart` before any handler, and `PrimerRoom.onLoad` reads the whole
snapshot back out of storage — so a shelf of eleven documents deserialized
eleven documents every time it was drawn. The hub now remembers occupancy for
ten seconds (`roomStatus`); its README has the rule about which callers may use
it and which must keep asking.

Revisit hibernation only if the dashboard still shows duration you cannot
account for. It probably will not.

## Deploying

Not deployed yet — this is deliberate, and it is the one step that needs a
human. To put it up:

```bash
cd collab
npx wrangler secret put COLLAB_SECRET     # any high-entropy string
npx wrangler deploy
```

`COLLAB_SECRET` only ever signs connection tickets. `wrangler dev` has no
secrets bound and falls back to a fixed development value, which is safe
precisely because it is well known: a ticket signed with it is worthless
against a deployed Worker.

After deploying, put the `*.workers.dev` URL into each project's entry in
`docs/primer/projects.json` as `"collab": {"url": …}`, alongside the existing
`"oauth"` entry. That is the whole switch: an editor opening that project
joins its room (Phase 2 below); a project without it is exactly as before.

## Phase 2 — the editor is in the room

`edit.html` joins a room when a project is marked shared: `"collab": {"url":
"https://….workers.dev"}` on its `projects.json` entry (or in its manifest).
No flag, no session — the editor is exactly what it was.

### The editor's state model is untouched

`edit.html` keeps its whole editing state in two plain values, `source` (the
content.md text) and `layout` (the parsed layout.json), and mutates them from
some 250 places before calling the one `render()`. The Phase 2 scope said
"route writes through a `tx()` wrapper"; rewriting every one of those sites
against Y types would have been a rewrite of the editor. Instead the editor
keeps its values and `client/session.mjs` **mirrors** them:

```
editor  --flush(files)-->   shadow Y.Doc  --update-->  net Y.Doc  --ws-->  room
editor  <--onFiles(files)-- shadow Y.Doc  <--update--  net Y.Doc  <--ws--  room
```

- **Out.** `renderOnce()` calls `collabFlush()` before it does anything else,
  so every local edit — whatever code path made it — becomes one document
  transaction. The write is a *diff*, not a replacement: a slot edit is one
  delete + one insert around the changed span of its `Y.Text` (common prefix
  and suffix untouched); a layout move sets one key in a nested `Y.Map`; a
  shape added is one splice of a `Y.Array`; a section moved replaces only the
  blocks that moved (longest-in-order run kept). That is what lets two people
  edit one paragraph at once — the Playwright spec proves the same-slot merge
  through the real editor.
- **In.** A collaborator's change reaches the editor as the whole document
  (`onFiles`), which sets `source`/`layout` and renders — never while the
  editor is *busy*: an inline text editor open, a pointer held down (a drag),
  a dialog up. The change waits and lands at the next quiet moment, so
  nobody's caret or drag is pulled out from under them.
- **Undo.** The snapshot stack yields to a `Y.UndoManager` on the shadow
  document, tracking only this editor's own origin: ⌘Z undoes *my* last edit
  and leaves everyone else's alone — a snapshot restore cannot express that.
  `pushHistory()` keeps its exact meaning (the boundary between undo steps);
  in a session it marks one instead of copying state.

### Why two documents

A local change is computed as a diff against what the editor last saw, and
that diff is positions into slot text. Positions are only meaningful against
the exact document the editor's copy was derived from — and the network
document moves under a remote edit at any moment, in particular while someone
is mid-sentence and has not committed yet. The **shadow** document is a
replica that only advances when the editor is ready to look, so a diff always
applies to precisely the text it was computed against; Yjs then merges the
resulting update into the network document against whatever arrived in the
meantime. That is the CRDT doing the one thing it exists to do; the
alternative — transforming positions through the remote delta by hand — is
re-implementing Yjs badly.

### Joining

After the first paint, `startCollab()` asks the relay for a ticket (the same
`POST /auth` as Phase 1, with the token Save already uses), imports
`collab-client.js` from beside the page, and opens the session with the files
on screen. The seed handshake is Phase 1's: the first editor in seeds the
room from those files; everyone after adopts the room, whatever their own
copy said. A seeded-but-empty room (storage gone) is refilled from the
arriving editor rather than adopted as blank.

A chip in the bar (`#collab`) says `● live · N`, `○ offline` (edits are kept
and sent when the relay is back — Yjs queues them), `⚠ not shared` with the
reason on hover, or `Sign in to collaborate` when the project is shared but
this browser holds no token. `docsync.api.status().collab` carries the same
for a pilot or a test.

Save is unchanged: it commits what is on screen — which is now what everyone
sees — to the saver's own draft branch, and records the new commit as
`meta.baseSha` for Phase 4.

### Developing against it locally

A local editor (served by `serve.py`) accepts two URL parameters, **local
mode only**: `?collab=http://127.0.0.1:8787` points it at a loopback relay,
and `?collabroom=<tag>` suffixes the room name so runs do not share a room.
A hosted editor ignores both — the page POSTs its GitHub token to whatever
`collab` names, so it must never come from a link. `?collab=0` opens a
shared project alone.

Such an editor has no GitHub token and needs none: the Worker accepts a
`dev:<login>` token **only** when no `COLLAB_SECRET` is bound — that is,
under the development signing secret, which a deployed Worker never uses.

```bash
cd collab && node devserver.mjs 8787        # a relay with fresh storage
# then open  http://localhost:8010/primer/edit.html?collab=http://127.0.0.1:8787
```

### The bundle

`docsync/editor/collab-client.js` is generated (`npm run build:client`) from
`client/session.mjs` + yjs + y-partyserver's provider, and committed: the
editor is a single file with no build step, and this is the one dependency it
cannot load from a CDN as-is. It lives under `docsync/` so it vendors to every
consumer like the rest of the engine, and `docsync.stage` copies it beside
`edit.html`. The Node tests import the source; the Playwright spec is what
catches a stale bundle.

## Phase 3 — presence

Awareness (y-partyserver fans it out; nothing server-side changed) now
carries what each editor is doing, and every other editor paints it:

| Field | Set from | Painted as |
|---|---|---|
| `login`, `color` | the ticket; colour hashes off the login | a dot per person in the `#collab` chip |
| `sel` | `selIds` | a ring in their colour on each selected element, with a name tag — an outline on placed HTML, an overlay box (`.ds-peer-box`, as `paintSel` draws one's own) on a shape, chart, icon or line in the page's SVG |
| `page` | `selPage` (a selected page background) | a halo on that page |
| `view` | `collabViewPage()` — the page in the middle of their window | nothing on the page; the avatar says *reading page 6* and a click goes there. A person with nothing in hand is still somewhere |
| `slot` | the inline editor open here (`data-slot` on a paragraph host, `data-el` on a text box, the table cell's id) | `name · typing` on that paragraph, and a coloured bar down its left edge |
| `cursor`, `anchor` | the caret, and the other end of a text selection when there is one — both as relative positions (Phase 4) | a caret bar; between the two, a translucent band in their colour, one per wrapped line (`.ds-peer-range`) |
| `drag`, `boxes` | a pointer down on a selection; the live inch box of each thing being moved | the tag reads `name · moving`, and the box is drawn WHERE THEY HAVE IT — the document does not change until the drop, so without this a two-second drag was two seconds of nothing and then a jump |
| `idle` | no key, pointer or wheel anywhere in this editor for five minutes | the avatar dims and reads `name · away`, their marks fade, and the chip counts the people who are actually at the document (the title still says the tab is open) |

The editor publishes from one poll (`collabPresence()`, 4×/s, sent only when
something changed) rather than from hooks at every selection and edit site;
`collabPaintPeers()` is idempotent and runs after every render (from
`wire()`) and every awareness change, so marks survive a re-render. Rings go
on HTML elements only — an outline on an SVG child paints around the whole
page-sized viewport (the same reason `paintSel` uses an overlay for shapes).

Colours are **stable, not unique**: a person keeps theirs from one day to
the next because it hashes off the login, and with eight colours two people
can share one — the name tag disambiguates. All eight are saturated: the set
used to end in a brown and a blue-grey, and the blue-grey was within a shade
of the slate every Appleseed report is set in — a ring in it was found by
reading the DOM, not by looking. Name tags are 11px on a pale keyline so a
word reads over the line of prose it inevitably sits on. Opening a paragraph a
collaborator is already typing in is allowed (the CRDT merges both) but
announced in the status row: *grace is also editing this paragraph — both of
your edits will be kept*. Presence leaves with the person: closing the tab
removes the awareness state, and the provider's disconnect path clears it
for a dropped connection.

`?collabas=<name>` names a local editor in a dev room (two tabs on one
machine would otherwise both be `local`); local mode only, like `?collab=`.

A **move** is the one gesture that cannot merge: both sides write a whole
value into layout.json, so the last drop wins and the other is simply gone.
Taking hold of something a collaborator has selected says so
(`collabWarnHeld`) at the moment it can still be undone. Blocking it would be
wrong — two people nudging the same figure is ordinary — but silence was too.

The room says WHO is in it (`status.here`), not only how many: the hub's list
page draws a face per person on a document's tile, and a count cannot say
whose. It asks `/api/collab/here?rooms=…` there — never the document store,
which enumerates only what has been SAVED and so would have left out the
documents somebody is most likely to be in.

A new presence field is added in three places or it is silently dropped:
the editor's `collabPresence()`, the session's `setPresence()` (which names
the fields it sends, so nothing stray rides into everyone's awareness), and
`peerOf()`. Tests: `collab.spec.js` — a shape A has in hand is boxed in B and
goes when she lets go; a reader with nothing in hand is *reading page N* in
B's bar and a click goes there; the words A selects are a band in B, and a
caret alone when she collapses it.

## Phase 4 — the branch underneath, carets, and typing together

Three things, each answering one of Phase 3's known gaps.

### One draft branch for the room

A shared project — one with a relay — saves to **one** draft branch,
`draft/<project>`, rather than `draft/<project>/<user>`: everyone in the room
edits one document, so they save it to one place, and a Save by anyone is a
Save for everyone. The editor's `draftBranchFor()` makes the choice;
`resolveDraft()` opens the shared branch when it exists; the title reads
`shared draft`. Discard on a shared draft says so before deleting it.

When a collaborator saves, the room learns it through `meta.baseSha`
(`onBaseSha` in the session; `collabSaved()` in the editor): the other
editors reset their "unsaved changes" to the document as it stands — that is
what was committed, to within a keystroke — pick up the branch if they
loaded from the deploy branch before it existed, and say who did it. The
status API's `collab.baseSha` and `collab.branch` carry the same.

### The branch moved underneath

`meta.baseSha` is the commit the live document was built from: set by the
seeding editor from the tip it loaded (`collabLoadedSha()` — a shared, hosted
editor with a token asks GitHub once; anyone else seeds null), and by every
Save since. Before committing to a branch that already existed, Save compares
the branch tip with it (`collabBranchStillOurs()`). If they differ, a commit
landed **outside** the session — a push from a laptop, a docsync tool, an
editor that was not in the room — and a plain fast-forward would silently
replace it with what the room holds. So it is said, with both short SHAs and
where to look, and the person chooses: *Save over it*, or cancel. Nothing is
merged: the two are whole files, and the room's copy is what everyone has
been looking at. A branch Save just created (forked from the deploy branch)
is not checked — the deploy branch moving for another project in the same
repository is not this project's branch moving.

### Carets

Presence now carries `cursor: {slot, rel}` — the caret in the paragraph an
editor has open, as a Yjs **relative position** (`cursorAt()` /
`resolveCursor()` in the session). A relative position names a character,
not an offset, so it stays put while text is inserted and deleted around it,
on this side and every other; when the slot itself is replaced (a section
moved), it resolves to nothing and the caret is simply not drawn.

The editor finds its own caret by marking the DOM selection's focus with a
private-use character in a *clone* of the contenteditable and running the
same `htmlToMd()` the commit runs (`collabHostCaretIndex()`); it draws a
collaborator's by walking the paragraph's text nodes by visible characters
(`collabCaretDom()` — markdown syntax carries no glyphs, a footnote chip is
skipped), then painting a bar in their colour into the page overlay, like a
shape's selection ring. Close enough for a caret; a guess past the end lands
at the end.

### Typing together in one paragraph

An open **paragraph** editor is no longer `busy`. Its words are flushed live
from the presence tick (`collabLiveFlush()`, 4×/s, only when they changed):
the host's DOM through `htmlToMd()`, overlaid on `source` at that slot, diffed
into the document like any other edit — so a collaborator sees the words
land as they are typed, not at the commit. `collabFlush()` overlays the same
way, so a render mid-edit (a citation added) cannot read the live words as
deleted.

A collaborator's change now lands while the paragraph is open
(`collabAdopt()`'s paragraph path): `source`/`layout` take it at once, no
render — nothing repaints under an open editor; `finish()` renders — and if
the document's words for *that* slot changed, the host is rebuilt in place
from the merged markdown with the caret put back (`collabRefreshHost()`).
The caret survives because the session calls `beforeRemote` just before a
remote update lands: the editor flushes its live words *first*, so its diff
is against the text it typed into and Yjs merges the two as concurrent
operations, and notes its caret as a relative position, which resolves to
the right spot afterwards. Mid-IME-composition the rebuild waits for
`compositionend`. Escape still means keep nothing: what was flushed live is
undone as this editor's own step (`collabDiscardLive()`), which leaves a
collaborator's words in the same paragraph standing.

Every other inline editor — a text box, a table cell, a chart label — holds
its words in layout.json, where the smallest thing the document holds is the
WHOLE string. Those still wait (`collabBusy`), and they cannot merge: the
second write replaces the first.

**So they are settled by a person rather than by whoever saved last.** That
loss used to be silent, and doubly so: the editor holds a collaborator's
change back while such an editor is open, so the person typing was never shown
the words their commit was about to replace. At the commit the value the ROOM
holds is compared with the value this editor opened on — `collab.netFiles()`,
which is `files()`'s twin for exactly this case: the shadow deliberately does
not have the held update, and the net does. If somebody changed it meanwhile,
the question names both versions and whose the other one is, and the person
keeps one (`collabFieldOpen` / `collabFieldSettle` / `collabFieldNote`, which
says whose words won *after* the render that adopted them — markDirty's own
line would otherwise be the last word on the row). Opening one of these now
says "words here cannot be merged, so you will be asked which version to
keep", where it used to promise both edits would be kept: true of a paragraph,
and never true here.

**Keeping your own means writing it AFTER theirs**, not instead of theirs: two
concurrent writes to one key are resolved by the document and not by the
person, so a write issued while their change was still held could lose to it —
the very coin toss the question replaced. `collab.drainNow()` lands the held
update first and the choice goes on top; every caller re-finds what it is
writing into, because a landed change replaces `layout` wholesale. Caught by
the full spec run and not by that test on its own: with one test in flight the
ordering happened to fall the right way.

The sources slot waits too: `writeSlot()` validates it line by line at the
commit, and a half-typed line must not reach the room.

### What changed while you were away

Two people in one document at the same moment is the exception here; the
collaboration this staff actually has is asynchronous, and the editor said
nothing about it. The hub's list page could say a document had CHANGED since
this browser last looked (it compares the store's version with
`primer-seen:<room>`) — and inside a forty-paragraph report that fact was
unusable.

So on the hub, an editor whose `primer-seen:<room>` names a version older than
the one it just loaded fetches that version's content from the store's
history, diffs it against what is on screen with the history panel's own
`hubHistoryDiff()`, and marks the paragraphs that moved. An amber chip in the
bar counts them, walks them one click at a time, and clears them with its ✕
(`hubSinceLoad`, `.ds-since`). Silent when there is nothing to say: a first
visit, a version already seen, a change that was not in the words, or a
history the store can no longer produce.

Its own class, not the history panel's `.ds-hist-changed`: that one is cleared
wholesale whenever the panel repaints, and the two marks answer different
questions.

Tests: `client.test.mjs` — a cursor holds through inserts and deletes around
it and dies with its slot; `beforeRemote` runs just before a remote update,
with the old text still in place; a collaborator's Save is announced and our
own is not; a cursor published by A resolves in B and moves with B's edits.
`collab.spec.js` — a text box two people edited at once is settled by a
person: B is shown both versions and whose the other is, keeping theirs drops
B's words in both editors, keeping mine writes B's over the change that landed
meanwhile, and a box nobody else touched commits with no question at all.
Words reach A while B's
caret drawn at their end, and Escape takes them back; both editors type in
the same paragraph at once, each sees the other's words land around its own
caret, and both keep theirs; a remote edit to another slot lands in B's
source under an open editor and paints when it closes.
`collab-drafts.spec.js` — the room knows the commit it was built from; a Save
goes to the shared branch and disables everyone's Save; a commit landing
outside the session is named in a confirm, cancel leaves the branch alone,
and *Save over it* commits on top of it.

### The AI at work

`#agentnote` was already the past tense — *Claude edited this*, with a
rewind. Phase 4 adds the present tense: a purple, pulsing `#agentlive` chip,
**✦ Claude is editing…**, while an automated editor is changing the report,
and a *✦ Claude · editing* tag on the paragraph or element it is touching,
drawn the way a collaborator's typing spot is. Three sources feed it
(`agentTouch()` in the editor):

- a pilot op running in this tab (`runPilotOps`), named by verb and target —
  the ordinary shape of an AI edit through the MCP server;
- an agent that announced itself to the local server (`POST /__agent/change`),
  and every disk change adopted while that announcement is fresh;
- a collaborator's editor doing either: presence carries `agent` and the room
  paints it with **· via \<login\>**, so a change that arrives from Claude
  through grace's tab is never mistaken for grace's own.

It clears itself — a few seconds after the last pilot op, longer after an
announced agent's last change. `docsync.api.status().agent` carries the same,
and `collab.peerList[].agent` who is relaying one. Tested end to end in
`collab.spec.js`: a pilot op in B shows in A as *Claude is editing · via
grace* with the tag on the paragraph, clears when it is done, and a person's
own edit says nothing of the kind.

## A second front door: the staff hub

Everything above authenticates against GitHub. The Hawaiʻi Appleseed staff hub
authenticates against Google, through Cloudflare Access, and most of the people
who would use the editor have no GitHub account at all. So the hub has a door
of its own onto the *same rooms*:

```
              ticket (GitHub push)              Access session (Google SSO)
browser ──▶ primer-collab Worker  ──┐      ┌──  hub /api/collab/<room>  ◀── browser
                                     ├─ PrimerRoom ─┤
            /parties/primer-room/…  ─┘  Durable Object └─  functions/api/collab/[room].js
```

The room is untouched. Both doors decide who you are and hand it over on the
same two headers — `x-collab-login` and `x-collab-ro` — which is all the room
has ever read. `isReadOnly` finally has something that sets it: the hub's share
list maps *viewer* to `ro: 1`.

**Why the hub binds the class rather than proxying to the Worker.** The Access
session is a first-party cookie on the hub's hostname; a request from the hub to
`*.workers.dev` would not carry it, and third-party cookie blocking would finish
the job even with `SameSite=None`. There is no zone on the account to give the
Worker a same-site hostname, and a Durable Object cannot be defined inside a
Pages project. So the class stays here and the hub binds it —
`PRIMER_ROOM = PrimerRoom @ primer-collab`.

The client side is one option. `CollabSession` takes a `path` instead of a
`party`, and no `ticket`:

```js
new CollabSession({ host: 'hub.example', room, path: `/api/collab/${room}`, files })
```

`path` is the WHOLE path — y-partyserver's `prefix` is used verbatim and the
room is **not** appended to it, so a path that stops at `/api/collab` puts every
document in one room. `client.test.mjs` pins both shapes for that reason.

### Checking the hop

```bash
node hub-check.mjs [--hub ../../staff-updates-internal]
```

Not part of `npm test`: it needs the hub repo checked out and boots two
wranglers — a `wrangler dev` holding the class, a `wrangler pages dev` over the
hub with the binding — then drives the result with real `CollabSession`s. It
watches the refusals refuse, the identity arrive in the room's `here`, two
clients converge, a viewer's write get dropped *by the room* while they keep
receiving, and the document survive everyone leaving.

Two things it cost an hour to learn, both worth keeping:

- **Run `wrangler pages dev` from the hub's directory, not this one.** From
  here it reads `wrangler.jsonc`, merges in the *local* `PrimerRoom` binding,
  and dies complaining that the Pages shim does not export the class — a
  message about the entrypoint that has nothing to do with the mistake.
- **`fetch()` cannot send an `Upgrade` header.** undici refuses it outright, so
  every refusal check has to go through `node:http` or it looks like a
  client-side `TypeError` rather than the status the Function returned.

Locally the Access header is forgeable, and `hub-check.mjs` forges it. In
production the edge strips `Cf-Access-Authenticated-User-Email` from inbound
requests and re-signs it, which is the only reason the Function may trust it.

## Served from the staff hub

The hub's door (above) only helps if the editor is on the hub's origin, and it
is: `python3 -m docsync.hub` vendors it into
`staff-updates-internal/primer/` — one `edit.html`, one `collab-client.js`, one
`sw.js`, a `projects.json`, and an `engine/` + `assets/` per project — from every binding
here with an `editor:` block (unless it says `hub: false`) and from every
consumer in `vendor.yml` / `vendor.local.yml`, each staged by its own vendored
`docsync.stage`. The hub's path comes from `hub:` in `vendor.local.yml`, and
the post-commit hook runs it after `docsync.vendor`, so the hub's working tree
is always current; committing there is a person's act, because a push there is
a deploy. The list page, `primer/index.html`, is the hub's own file and is
never written by the vendor.

What differs for an editor served there, and nothing else does:

- It has the editor's **service worker** beside it (`sw.js`, vendored since
  2026-09-05). The worker keeps Pyodide's ~30MB runtime cache-first in Cache
  Storage and the shell network-first; before, the file lived only in the
  engine repo's untracked `docs/primer/`, so on the hub `register('sw.js')`
  404'd silently and a cold open paid the whole CDN download whenever the
  browser's HTTP cache had let it go. The manifest link carries
  `crossorigin="use-credentials"` for the same reason a hub fetch does: without
  cookies the Access edge bounced it to sign-in, two seconds per open for
  nothing. Measured warm on 2026-09-05 (Chrome, fast link): the demo report
  is live 4.7s after navigation, the budget primer 3.7s; every network fetch
  is done by ~3.5s and the rest is Pyodide's start and the first render.
  **`/api/` is network-only there** (since 2026-09-10, `primer-shell-v8`), and
  so is any request that says `{cache:'no-store'}`. Before, the hub's API fell
  through to the worker's generic same-origin branch — cache-first,
  revalidated behind — so every poll of a document's comments answered with
  the poll before it: a suggestion showed up on the other editors a poll
  late (fifteen seconds with the panel open, a minute without), and a thread
  resolved a moment ago came back open from the stale copy until the poll
  after cleared it again. The hub's own pages had been evicting the entry by
  hand before each `hubFetch` GET; the editor never did.
- Its registry entry says `"collab": {"path": "/api/collab", "me": "/api/me"}`
  instead of `"url"`. `collabDoor()` in `edit.html` returns the one or the
  other; on a path the editor mints no ticket and asks for no token — the
  socket goes to `location.origin + path + '/' + room`, and the Access
  session the page already carries is what the door checks. `/api/me` names
  the person for presence; the room itself learns the login from the header
  the door set and trusts nothing the client says.
- The manifest's `repo` is canonicalised to the source checkout's origin
  (`Hawaii-Appleseed/…`), because that is the room's name and the hub serves
  only those spellings.
- The document itself lives in the hub's store, not in git. The same door
  names it — `"docs": "/api/docs"` — and `docStoreDecide()` in `edit.html`
  settles it ONCE at boot, right after local mode is known: on that path the
  document is loaded from `/api/docs/<room>` over the vendored copy, Save
  PUTs it back, an image upload POSTs to `…/assets/<name>`, and the git
  verbs (draft branch, Share, Publish, Push) hide. The store's version stamp
  plays the part a commit sha played: it seeds the room's `meta.baseSha`, a
  Save carries it as `base`, and a store that moved past it (a Save from a
  session this browser was not in) answers 409 and the person chooses —
  `collabBranchStillOurs`'s rule, on a store that cannot merge either. Every
  Save is kept whole under `history/<version>/`. No GitHub credential
  anywhere in a hub-served editor. Server side: the hub's
  `functions/api/docs/[[path]].js` (R2 binding `PRIMER_DOCS` → bucket
  `primer-docs`) and `functions/primer/[id]/assets/[name].js`, which serves
  an uploaded image at the very path the layout names, ahead of the vendored
  file. Pipeline reports (the Budget Primer) still BUILD from git and are
  vendored from their repo's checkout; what staff edit on the hub is the
  store's copy of that, and nothing flows back to git until step 05's export.

Proof: `npx playwright test collab-hub.spec.js` vendors this tree's editor
into the hub checkout beside this repo, boots the same two wranglers
`hub-check.mjs` does (with local R2), and opens the editor in two browser
contexts carrying Access identities — the list page names the project, both
are live in one room as the people Access says they are, an edit crosses, a
Save lands in the store and the other editor learns the version, a fresh
editor loads the stored document, an upload is served at the project path,
and no token was asked for. The `history:` tests take versions further:
both editors clean on a restore, a Save on top of one, the confirmation
refused, a restore from either side, unsaved edits superseded, a reload and
a fresh editor opening on the restored version, the viewer's read-only list,
and naming from the dialog. Skipped when the hub is not checked out beside
this repo. The handlers alone: `node dev/test_docs.mjs` in the hub — its
"edges of restore and naming" section covers the refusals (viewer, bad
version, nothing saved), what a restore carries (paths, seeded_from, no
label), a content-only version leaving the layout alone, restoring the
current version, the 409 for a session that missed a restore, and names
(trimmed, cut at 80, cleared, surviving a later Save, on the store and the
summary when current).

## Export to git (step 05)

What the store gives up by leaving git — a log, blame, a diff on github.com,
a clone as an off-Cloudflare backup — comes back on a schedule instead of the
hot path. `src/export.js` writes ONE commit of a document's current state to
`hub/<project>` in its repository: the two files at the paths the editor
recorded in meta on every Save (`paths`), every uploaded image as a blob at
the assets path, parented on the branch's tip, the branch made from the
deploy branch the first time. `docs/<room>/export.json` remembers the last
version exported, so an unchanged store writes nothing. The deploy branch is
never touched: a pipeline report builds from main on a machine, and an
editor-native one is published by a person merging what this wrote.

Two ways it runs, both in this Worker, because this is the one place a
GitHub credential may live — `GITHUB_EXPORT_TOKEN`, a fine-grained PAT with
Contents read/write on the repositories in `ALLOWED_REPOS` and nothing else:

- **Publish, from the hub.** The editor's Publish on the store path POSTs
  `/api/docs/<room>/publish`; the hub's Function asks this Worker's
  `POST /export/<room>` with the shared `EXPORT_KEY` (a secret on both sides)
  and hands the answer back — the commit's sha and URL, or the refusal in
  words. The key lets a caller cause a commit of what the store already
  holds and nothing else.
- **Nightly**, `0 14 * * *` UTC (04:00 Hawaiʻi): `scheduled()` sweeps every
  room and exports the ones whose version the branch lacks. A room failing
  fails that room only.

`GITHUB_API` (a var) points the Worker at a test double. `export.test.mjs`
drives the export against an in-memory Git Data API: first export makes the
branch and commits files and assets, an unchanged store is silent, a new
version is one more commit on the same branch, main is untouched, no
recorded paths is a refusal, the sweep survives one failure.

## Who may open it, and as whom (step 06)

The hub's share record (`functions/api/collab/share/`) was enforced from the
day the door opened — a viewer's socket is read-only in the room, and the
store refuses their Save. What step 06 adds is the editor SAYING so and
letting people change it:

- **Share…** on the store path opens the share dialog: a default for everyone
  through Access (can edit / view only / no access) and named exceptions.
  Anyone who can edit can re-share; a viewer sees the record and cannot
  change it. Sharing outside the staff domains is not a row — the dialog
  says it is a change to the hub's sign-in.
- **A viewer is told.** `hubShareLoad()` reads the record at boot: the chip
  says `· view only`, Save and Publish stay off, an upload is refused before
  it starts, and the status line says edits here are not kept. The room and
  the store enforce; the editor only spares the person the surprise.
- **Names.** `/api/me` on the hub answers `{email, name}`, the name from the
  staff roster (`data/staff.json`) — so presence says "Abbey" rather than an
  address. It rides awareness as `name` beside `login` (the identity stays
  the email); `peerOf()` passes it through and the chip prefers it. No
  avatars: the roster has none, and Access's identity endpoint was not
  relied on for a picture it may not carry.

## Versions, comments, and what changed (step 07)

- **History** on the store path lists every Save (`/api/docs/<room>/history`),
  lets an editor name a version (`PATCH …/history/<v>` `{label}`) and bring
  one back (`POST …/restore` `{version}`). A restore is a NEW version on top
  — nothing saved is lost, and the log reads "restored from …". The editor
  adopts the files the way a collaborator's change lands and records the
  version the way a Save does, so the room gets it through `meta.baseSha`.
  An editor holding unsaved edits when a collaborator restores gets the
  restored files and is told "a collaborator saved" — its edits are
  superseded, as by any Save from the room. (This needed a fix in
  `session.mjs`: a remote update that lands the document on exactly the
  state an editor was LAST HANDED was dropped as "nothing new", even when
  that editor had flushed its own edits since — which is precisely what a
  restore does. `#localSinceEmit` now says so; `client.test.mjs` pins it.)
- **Version history as Docs' side panel.** History is a panel beside the
  page (`#hpanel`, the comments panel's frame; on a wide window it takes the
  gutter the stage makes room for — `hubGutterSync()` decides that for both
  panels, and only one is open at a time), not a dialog, so the page stays in
  view while a person reads the differences. Every Save, newest first,
  grouped by day ("Today", "Yesterday", the date); "Named only" keeps the
  ones someone named. A row is the version: a click opens what it changed
  against what is on screen — `slotsOf()` reads the `[[key]]` blocks of
  that version's `content.md` and of `source`, each paragraph whose plain
  words differ is listed with the words that went struck and the words on
  screen underlined (`suggestSplit`, the suggestion cards' own diff), plus
  the paragraphs only on one side and whether the layout differs; with
  unsaved edits on screen the summary says "unsaved edits included", since
  that is what it is compared against. "Mark what changed on the page"
  outlines those paragraphs in the report (`.ds-hist-changed`, repainted on
  every render from state) and is a checkbox because a marked-up page is
  not always what someone wants while reading. Restore and naming are the
  same rows' controls as before (Restore closes the panel and asks, as it
  did). A new version landing (a Save here or elsewhere, a restore) reloads
  the list — only a NEW version: the room re-announces the same one as
  people come and go, and a reload then rebuilt the rows under someone
  typing a name (the spec caught it); nor does the list ever rebuild while
  a name box has focus.
- **Autosave on the hub.** With the store as the record, a quiet two
  seconds after an edit is a Save (`hubAutosaveSchedule`, armed from
  `markDirty`, so every mutation site gets it for free): the room already
  carries the live document, so nothing was ever lost — this only takes the
  button out of people's minds, the way Docs never has one. Not while a
  paragraph or box editor is open (a half-typed sentence is not a version),
  not while a Save is in flight or a dialog is up (it re-arms), and not
  after a 409 or a failure until a press of Save settles it — an automatic
  Save must never ask a question or keep failing quietly, so it holds and
  the status line says "press Save". One 409 is not that: two editors in a
  room both autosave two seconds after the same change, and the one that
  lost the race used to be told the document "changed outside this
  session" and had its autosave paused (seen on rxkids-fiscal, 2026-09-10:
  two Saves of one state, 70 ms apart, by two people). A version the room
  already records as saved, or whose saver is in the roster, is adopted as
  saved instead (`collabSavedByPeer`, waiting up to 1.5 s for the room's
  record to catch the answer up). The button stays, reading "Saved ·
  just now" after one lands and "Saved" once that is old news. Per
  browser, on unless turned off in the File menu
  (`localStorage['primer-autosave']`); the hub spec runs with it off, since
  it presses Save itself and counts versions, and one test turns it on.
- **Who is where, by name.** A collaborator's selection has always been
  ringed in their colour with a tag, their open paragraph marked, their caret
  drawn (Phase 3); the tag now says the person — the roster's name, else the
  local part of the address — never a whole email.
- **Who is here, at a glance, and going to them.** The chip's dots are
  avatars: an initial in the person's colour (the colour of the ring around
  what they have selected), a small amber dot when they are typing, and a
  title that says where — "Ada · typing on page 2. Click to go there; click
  again to follow". `collabPeerPlace()` finds the place: the paragraph they
  are typing in, else what they have selected, else the page they are on;
  the page number is the section's position in the document. A click
  scrolls there (`collabGoTo`, centred, only when it is not already in
  view — and instantly, as Docs jumps: a smooth scroll was cancelled by the
  editor's other scroll writes, and the click went nowhere) and says so in
  the status line. A second click on the same
  avatar **follows**: every presence tick that finds their place out of
  view scrolls to it (`collabFollowTick`, from `onPeers`), the chip says
  "following Ada", the avatar wears a ring. Following stops when the person
  here turns the wheel, touches, clicks or keys through the page — the
  gesture, not the scroll event, since this editor's own scrolls fire that
  too — when they click the avatar again, or when the one followed leaves
  ("Ada left the session"). Nothing new is published: it is all read from
  the presence the room already carries.
- **Share, laid out as Docs lays it out.** The dialog opens on the link —
  the document's own address (`hubDocLink()`: the page's URL with only
  `project` kept, so a comment or a tab being open is not what gets pasted
  into Slack) with a Copy button; the clipboard refused means the field is
  selected and the status line says so. Under it, who has access, each with
  a face (the comments' avatar: initial, colour by address, name from the
  roster on hover): the owner first with "Owner" (a label, not a lock —
  `canShare` is still "anyone who can edit"), the named people with a role
  each and a × (the address field offers the staff roster as you type, a
  `<datalist>`, and the face follows what is typed), and "Everyone on the
  hub" closing the list with the default role. No "notify by email": the
  hub cannot send mail, and a box that did nothing would be worse than none
  (ROADMAP, "Needs a human").
- **Comment on this element.** The arrange strip (what an element shows when
  selected) carries a comment button on the store path: one click opens the
  panel with that element named as the anchor and the box focused. The
  panel puts comments on the current selection first, under "On the
  selection", and the strip's button glows when the selection already has
  open comments. `docsync.api.select(ids)` selects the way a click does, so
  a pilot (or a spec) can do the same.
- **Comments**, the way Google Docs does them. Threads live beside the
  store's files (`comments.json`), not in the Yjs document — a note about
  the document is not part of what renders or exports. A thread is on a run
  of words in a paragraph (`anchor` + `quote`), on a paragraph or element
  (`anchor`), or on the document. What a person sees: the quoted words
  highlighted in the report (CSS Custom Highlight API; a whole-paragraph
  thread gets a count badge instead), a "＋ Comment" pill beside a text
  selection in the open paragraph, ⌘⌥M on whatever is in hand, cards with
  an avatar, name and time, ordered as the document reads, a click on the
  highlight raising the card and a click on the card flashing the words, a
  checkmark to resolve and a ⋮ menu (Edit for the author, Delete for the
  author or the owner, Show, Copy link — `?comment=<id>` opens the editor
  on that thread), replies threaded under the first message, "Marked as
  resolved by …" on a resolved thread and a reply to it reopening it,
  @-mentions picked from the staff roster (`/data/staff.json`, plus whoever
  is in the room) and a **For you** tab for threads that name you or answer
  you. Anyone who may open the document may comment, reply and resolve;
  only the author rewords; the author or the owner deletes. The panel
  refreshes itself every 15 s while open, presence carries a change the
  moment it happens, and a refresh never runs under someone typing a reply.
  Server side, every change to `comments.json` is one read-modify-write
  conditional on the etag the read saw (R2 `onlyIf`), retried when someone
  wrote meanwhile — two replies in the same second both survive.
- **Suggesting**, Google Docs' Suggesting mode. The bar's Editing ▾ switch
  becomes Suggesting ▾: an edit is proposed, not made. Every mutation in
  the editor starts with `pushHistory()` and ends in `render()`; in this
  mode the first takes a copy of the files, the render shows the change
  locally without flushing it to the room, and a quiet spell after the
  last render turns before → after into a thread of kind `suggestion`
  (beside the comments, so replies, mentions, Show and For you come free)
  with the change recorded as per-paragraph words before and after plus
  layout entries (`suggestDiff`), then puts the files back the way the
  room has them. The page shows the proposal inline — words to go struck
  through in red, words to come underlined in green (an `<ins>` the
  paragraph editor strips before it opens), a dashed outline on an element
  to move or change — and the card says "Replace … with …" / "Move X"
  with Accept and Reject for an editor, Withdraw for whoever suggested it.
  The card and the marks appear the moment the quiet spell ends — drawn from
  what was done here, as a `.pending` card the way a new comment's is, while
  the POST runs alongside the revert render; the hub's answer takes the
  card's place (a refusal takes it away and says so), and the panel is not
  polled for what it was just handed. A proposal whose change already stands
  in the document is not drawn: an Accept reaches the other editors through
  the room before the hub says the thread is decided, and in that gap the
  new words would have shown twice, once as the paragraph and once more in
  green after it. Accepting applies the change through the editor's own path (`writeSlot`,
  the layout entry, one `pushHistory`, one render, so it is one ⌘Z and
  reaches the room like any edit), after saying so when the paragraph was
  rewritten since. A **viewer** is put in Suggesting and kept there: the
  room drops their writes anyway, and this gives them a voice. Server
  side, `status` (open / accepted / rejected) is decided by an editor,
  withdrawn by its author, and `resolved` follows it. **Accept all / Reject
  all** sit above the panel's list for an editor with two or more open, ask
  once, and then run each through its own path — so every Accept is its own
  undo step and its own render, and one whose paragraph was rewritten since
  still asks about itself. And a proposal is counted where people look: the
  hub's summary already answered `open_suggestions`, so the list page's tile
  says "N suggested", its count line adds them up for the documents this
  person may edit, and the Editor tab's badge counts them with the reason in
  its title (a viewer's own suggestions never pull them in — a proposal
  waits on an editor).
- **Comments in the margin.** On a window 1100px or wider the panel is a
  gutter beside the page — `body.cmt-margin` gives `#stage` a right margin
  the width of the gutter and `applyZoom()` refits the page into what is
  left, the one time a panel is allowed to move the page (a card has to line
  up with the words it is about, so it needs its own column, not a float
  over the page's right third). Inside, `#cpanel-list` is a positioning
  box and `hubMarginLayout()` places every card by hand: at its anchor's
  top on screen (the quote's Range when the words are highlighted, else
  the element; the iframe's rect and scale turn page pixels into screen
  pixels, as the "+ Comment" pill does), never over the card before it, a
  thread on the document at the top, one whose words are gone or one that
  is resolved trailing the rest under the "N resolved" line; a card whose
  words have scrolled off the top goes with them, out of sight, as in Docs.
  The thread in hand sits at its exact place and the others are pushed up
  or down to clear it — but never out of the gutter: Docs' margin runs the
  whole document, ours is a window on it, so when the cards above have no
  room left it is the card in hand that gives way and sits lower (a card
  whose words are on the page must stay reachable; the first cut of this
  pushed them off the top and a ⋮ landed on the canvas). The gutter starts
  where the stage does and its head is kept short, so the band of page with
  no margin beside it is as thin as it can be. A scroll of
  the report (a listener on the iframe's window, one layout per frame), a
  zoom (`applyZoom` ends by asking for one), a window resize and a card
  changing height (a ResizeObserver: a reply box opening restacks the
  rest) all move the cards and nothing else — they are never rebuilt for
  that, so a reply being typed is never disturbed. Each card is moved by
  `transform`, not `top` (a composite, not a layout of the gutter), and a
  layout reads everything it needs — the iframe's rect, the list's, the
  panel's, every anchor's — before it writes anything: a write between two
  reads made the browser lay the page out again for the second, twice a
  frame, which was the lag the cards had behind a scrolling page. Heights
  come from the ResizeObserver, each card observed once when it appears.
  Nor does a render rebuild the list: cards are kept by thread id (and
  separators by their words) when nothing the card shows has changed —
  `hubCommentsRenderInner` reconciles the list into the new order,
  touching only what moved — so a click on the page (which re-renders the
  panel for the "On the selection" tag) leaves every card where it was;
  rebuilding them put each one back at the top of the gutter to glide down
  again, which read as the cards reshuffling. A card that is rebuilt
  starts where the old one stood, and a card placed for the first time
  takes its place without gliding (`.fresh`). A `List` / `Margin`
  switch in the panel's head is the person's choice, kept in
  `localStorage['primer-comments-view']`; below 1100px the width decides
  and the panel is the ordered list it always was, which at 375px fits
  inside the phone (pinned by the hub spec).
  Three details finish it. The **new comment is a card at its anchor** too,
  not a foot to the panel — but only once it is in use (the box focused,
  holding words, or quoting a selection), since an empty box beside the
  words would push every card below it down for nothing; it moves the
  moment it is used rather than at the next refresh, the cursor goes back
  after the move (moving a node blurs what is inside it), and the move is
  flagged so the blur it causes cannot ask for another render — that was a
  loop which took the cards out from under every click. A **line** joins
  the card in hand to its words across the ground between page and gutter,
  drawn only when both ends are on screen and never for a resolved thread,
  which has no highlight to point at. A card **taller than the gutter
  scrolls inside itself** rather than being cut off at the bottom edge.
  Resolved threads stay in the margin, trailing the open ones under the
  "N resolved" line: they have no words to sit beside any more, and the
  panel is the only place they can be found again.
  And every change shows **at once**: a new comment is a provisional card
  (`.pending`, in hand) the moment Add is pressed, a reply, a resolve, an
  edit or a deletion is shown as it will stand, and the hub is asked after
  — its answer to a change is the thread itself, which takes the shown
  one's place (`hubCommentsMerge`) with no second round trip to read the
  list back; a refusal puts things back as they were and says so in the
  status line (a refused reply comes back into an open box). Posting used
  to wait for the POST and then a GET of the whole list before anything
  appeared, which read as the button not working.
- **For you, where people already look.** A mention or a reply used to be
  seen only by opening the document. The store's summary (`GET /api/docs`)
  now answers, per person, `for_you` — the open threads that name them
  (someone else did, in the thread or a reply) or are theirs and answered by
  someone else — and `for_you_at`, when the newest of those last moved. One
  rule, `threadForYou` in `assets/docs.js`, shared by the API and its tests;
  the editor's `hubCommentForMe` is its twin and must stay so, or a badge
  would point at a tab that shows nothing. The list page wears an amber
  "N for you" on the tile (a click opens the editor with `?comments=you`,
  the panel on the For you tab), the count line says it, and the Editor
  tab's badge counts documents that want you — changed, or new for you —
  with the title saying which. "New" is decided the way "changed" is: the
  editor records `localStorage['primer-seen-you:<room>']` = that same
  activity time when the For you tab is shown, so a badge rests once you
  have looked and wakes when the thread moves again. Nothing is sent
  anywhere: the hub has no mail path (its only outbound is the Apps
  Script's Slack webhook), so a daily digest is left as a human decision
  (ROADMAP, "Needs a human").
- **What changed since you looked.** The editor records the version it
  showed as `localStorage['primer-seen:<room>']`. The hub's `GET /api/docs`
  answers every document the person may open with its version, who saved
  it, and its open comments; `primer/index.html` marks the ones that moved
  and sorts them first, and the Editor tab on every hub page wears the count
  (`assets/nav.js`, the calendar badge's pattern). No email, no push: a badge
  where people already look, on data the store already had.

## What can go wrong, and what happens

The obvious ways comments, Save, the live session and the editor's
operations fail, and what was done about each (all under test):

- **Two people change the comments at once.** Was: last writer wins, the
  other's reply silently gone. Now: conditional writes with retry
  (`mutateComments`), pinned by "two replies at once: neither is lost".
- **The hub sign-in expired.** Access answers every request with its sign-in
  page — 200 and HTML. Was: a Save read that as success with no version,
  cleared the unsaved mark, and the words never reached the store. Now:
  `hubJson()` guards every hub call (load, Save, restore, history, naming,
  share, publish, upload, comments); a Save says "signed out of the hub —
  reload this page", stays unsaved, and the draft cache keeps the words.
  Pinned by "an expired sign-in cannot pass for a Save".
- **A collaborator's change lands the document exactly where you last
  saw it** (a restore, an undo of your edit from their side). Was: dropped
  as "nothing new" while you kept superseded words. Now: `#localSinceEmit`
  in the session. Pinned in `client.test.mjs` and the hub spec.
- **The room is behind the store.** Someone saved from outside the session
  (or restored while the room slept): the room's document is older than the
  store's, and what is on screen is the room's. Was: only discovered at
  Save, as a 409. Now: said on joining ("this session holds an older version
  than the store"); Save still asks before replacing it.
- **The store moved under a Save.** 409 with who and when; the person
  chooses; `force` says they did. Nothing merges — the two are whole files.
- **A comment's words were rewritten.** The quote no longer matches: the
  thread falls back to a badge on its paragraph; Show still finds the
  paragraph. A paragraph or element removed altogether: Show says so.
- **The comments could not be refreshed** (offline, a 5xx). Said once in
  the status line while the panel is open, not on every poll; the panel
  keeps what it had.
- **A refresh while typing a reply.** Deferred until the box loses focus;
  a poll never eats a half-written reply.
- **No Highlight API** (an older browser). Quoted threads show as badges on
  their paragraph; everything else is the same.
- **The websocket drops.** The editor keeps working on its own copy; the
  provider reconnects and Yjs merges what both sides did meanwhile
  (tested: "a session that reconnects does not re-seed and picks up what it
  missed"). And it SAYS so: a band above the page — "Working offline — your
  edits are kept here and shared when the session is back" — drawn by
  `renderNotices` from the chip's status (so a render never loses it), not
  dismissible because it goes on its own, and "back in the session — what
  you did offline is shared now" in the status line when it does (the relay
  spec drops A's socket, edits, reconnects, and watches B get the words).
  The room's storage gone: the next editor refills it from what it holds
  rather than adopting nothing.
- **A Save while another is in flight.** The button is disabled for the
  duration, so a second click cannot carry the old base.
- **A suggestion's paragraph was rewritten before it was accepted.** Said
  at Accept, with the choice to apply over it or not. A proposal whose
  words can no longer be drawn inline (an SVG heading, a rewritten
  paragraph) gets the dashed outline, and one that cannot be drawn never
  stops the others.
- **The document is too large, the layout is not JSON, an upload is not an
  image.** Refused with the reason (413 / 400 / 415), said in the status
  line, nothing written.

## Known gaps, for later

- **Nothing merges an outside commit.** The moved-branch check names the
  commit and lets the person choose; folding it in would need a three-way
  merge on slot text, which the document's per-slot `Y.Text` could express.
- **Carets, not selections.** Only the focus point is shared; a highlighted
  range would be a second relative position and a painted rectangle per
  line.
- **Text boxes still hold.** A box's markdown is one scalar in a `Y.Map`;
  making it a `Y.Text` would let two people type in one box the way they
  now can in one paragraph.
- **Comments do not follow a rename.** A comment is anchored to a slot key or
  element id; a renderer that renames one leaves the comment on the document.
- **Export is one-way.** Nothing merges a commit someone makes on `hub/<id>`
  back into the store; the store is the live copy and the branch its record.
- **No read-only ticket on the GitHub door.** `/auth` always sets `ro: false`,
  because that permission model is binary (push or no access). The hub's door
  does set it — a *viewer* in its share list connects `ro: 1` — so the
  enforcement is now exercised; it is only this route that has nothing to say.
