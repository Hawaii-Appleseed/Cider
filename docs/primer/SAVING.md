> **2026-10-30:** the hosted GitHub-API mode (draft branches, Share links, Publish via PR, device-flow sign-in) described below was removed; the staff hub is the only shared runtime and the local server is the dev loop.

# Saving & collaboration — scope

How the draft editor should save and share work when it's used across **many
projects, by more than one person**. Grounded in how saving works today, then a
phased plan.

> **Status: Phase 1 is implemented** (steps 1–3, 5, 6 below — everything but
> the per-branch preview build, which the editor sidesteps: a Share link opens
> the editor itself pointed at the draft branch, so the draft renders locally
> through Pyodide with no Actions workflow at all). The editor now has three
> verbs — **Save draft** (one atomic commit to `draft/<project>/<user>`),
> **Share** (copy a `?draft=…` link anyone can open), **Publish** (open + merge
> a PR into main). Discard with nothing unsaved deletes the whole draft; a
> reload picks your draft back up automatically; a raced save retries once on
> the mover's tip.
>
> **Phase 2 is implemented on the editor side**: "Sign in with GitHub" via the
> OAuth device flow (a code + an approve click; tokens auto-refresh for ~6
> months), with the paste-a-token prompt kept as fallback. GitHub's login
> endpoints send no CORS headers (verified empirically), so the flow runs
> through a ~40-line stateless relay (`oauth-relay.js` — holds no secret;
> device flow needs only the public client id). Dormant until the manifest
> gains an `oauth` block — `OAUTH_SETUP.md` has the two ~5-minute
> account-bound steps (create the GitHub App, paste the relay worker).
>
> **Phase 3 (Option C, real-time) is under way in `collab/`** — see
> [`collab/README.md`](../../collab/README.md). Phases 0–2 are done: a
> Cloudflare Durable Object holds one Yjs document per project, and the
> editor mirrors `source`/`layout` off it, so two people edit one report at
> once and ⌘Z undoes only your own edits. Switched on per project by a
> `"collab": {"url": …}` entry in `projects.json`; not deployed yet.

---

## 1. How saving works today

The editor (`docs/primer/edit.html`) loads a per-project **manifest**
(`engine/manifest.json`: `id`, `repo`, `branch` — the deploy branch drafts fork
from and publish to, defaulting to `main` — and the paths of `content.md` /
`layout.json`), renders the report locally through the real Python renderer via
Pyodide, and on **Save** writes back to GitHub.

Two save modes:

- **Local dev** — POSTs `{content, layout}` to `/__save` on the dev server,
  which commits LOCALLY only. No token. A separate **Push** button (`/__push`)
  sends whatever is committed to GitHub, on your own schedule — several local
  saves can land before one push. (Only when the editor is served by that
  server.)
- **GitHub** — the real path. Uses a **fine-grained PAT** kept in
  `localStorage['docsync-pat']`. On Save it builds a list of changed files
  (`content.md`, and `layout.json` if the visual layer changed) and issues **one
  `PUT contents/<path>` per file, each a separate commit, each `branch: main`**,
  each fetching the file's current `sha` first for optimistic concurrency.
  Uploaded images are a third `PUT` to `main`. A commit to `main` triggers the
  site rebuild and the Google-Doc sync.

### Why this doesn't scale to collaboration

The 55-vs-3 commit fork this document was written after is the failure mode in
the wild, not a hypothetical:

1. **Everyone commits straight to `main`.** No isolation. Two people (or two
   machines) editing at once race on the same files. The only guard is the
   `sha` check → a raw **409** with no resolution UI; the loser silently
   re-saves over, or diverges into a fork.
2. **Non-atomic save.** `content.md` and `layout.json` go as **two separate
   commits**. A failure between them, or two people interleaving, leaves `main`
   in a half-updated state (prose from one edit, layout from another).
3. **PAT per browser.** Each collaborator must mint a fine-grained token with
   Contents:write and paste it in. High friction, no identity (commits aren't
   attributed to the real author), and a write token sits in `localStorage`.
4. **No sharing primitive.** "Share a draft" = push to `main` and tell someone
   to look at the live site. There is no draft URL, no preview, no review.
5. **One repo per deployment.** `repo` is fixed in the manifest. "Many
   projects" today means many separate editor deployments.
6. **Publish == Save.** Every Save is a publish (rebuilds the live site). There
   is no staging between "I'm drafting" and "this is live."

---

## 2. Goals

- **No clobbering.** Concurrent editors never overwrite each other silently.
- **One Save = one atomic change.** Prose + layout move together or not at all.
- **Low-friction identity.** A collaborator signs in once; commits are theirs.
- **Share a draft as a link.** Someone can see the draft without it being live.
- **Draft ≠ publish.** Explicit, reviewable step to go live.
- **Many projects, one editor.** Pick a project; the editor retargets.
- **Keep the good parts.** Local-first Pyodide render, content.md as source of
  truth, git as the durable store and history.

---

## 3. Options

### A. Branch-per-draft + PR (GitHub-native, no new infra)  ← recommended first
Save commits to a **draft branch** (`draft/<project>/<user>`), not `main`.
Three verbs replace one Save:
- **Save draft** → atomic commit of content+layout to the user's draft branch
  (via the Git Data API: blobs → tree → one commit → update ref).
- **Share** → copy the draft's **preview URL** (a per-branch build) and/or open
  a PR.
- **Publish** → open/merge the PR into `main` (which rebuilds the live site).

- *Pros:* isolation (no clobber), atomic commits, real review, attribution via
  PR, history = git. Zero backend — GitHub does it all. Directly prevents the
  fork we hit.
- *Cons:* PAT friction remains (until Option B). Per-branch preview needs an
  Actions workflow. Branch/PR concepts must hide behind the three buttons for
  non-technical authors.

### B. GitHub App + OAuth (identity & tokens solved)
A tiny serverless endpoint (Cloudflare Worker / Vercel function) backs a GitHub
**App** installed on the project repos. Collaborators **sign in with GitHub**;
the endpoint mints a short-lived, repo-scoped token (or commits on their
behalf). Editor calls the endpoint instead of holding a PAT.

- *Pros:* no manual tokens; commits attributed to the real user; central
  permissions; multi-repo is "which repos is the App installed on." Can later
  host locking/presence.
- *Cons:* one small service to host and maintain. Best layered **on top of A**.

### C. Real-time multiplayer (CRDT / Yjs + periodic commit)
Live co-editing with presence; a sync server holds the live doc and commits to
GitHub as the durable/publish store.

- *Pros:* best possible collaboration UX; clobbering is impossible.
- *Cons:* heaviest; overkill for a report edited occasionally. Only if
  simultaneous editing becomes the norm.

---

## 4. Recommendation — phased

**Phase 1 — branch-per-draft, atomic, shareable (Option A).** Highest value,
no new infrastructure, and it fixes the exact failure we just untangled.
1. Retarget Save from `main` to `draft/<project>/<user>`.
2. Make Save **atomic** — one commit for content+layout via the Git Data API,
   replacing the two-`PUT` sequence.
3. Add **Save draft / Share / Publish**. Share copies a preview link; Publish
   opens or merges a PR to `main`.
4. Add an Actions workflow that builds a **per-branch preview** so a draft URL
   exists to share.
5. **Conflict handling:** on a stale-ref push, fetch, show "N changes landed
   since you started," offer rebase-onto-latest or open the diff — never a bare
   409.

**Phase 2 — GitHub App + OAuth (Option B).** Remove manual PATs; real identity
and attribution; multi-repo permissioning. Serverless, short-lived tokens.

**Phase 3 — presence/locking, or CRDT (Option C).** Only if concurrent editing
becomes common. Cheap interim: a soft lock ("Devin is editing — opened 4m ago")
written to the draft branch, before committing to full CRDT.

**Multi-project (spans all phases):** make the editor take a `?project=<id>`
that selects a manifest from a small registry, so one deployed editor serves
every report instead of one deployment per repo.

> **Implemented.** `projects.json` beside the editor maps ids to the directory
> holding each report's `engine/` — relative, or an absolute URL to another
> GitHub Pages site (Pages sends CORS). With more than one entry a picker
> appears in the bar; every URL the editor writes carries `?project=`, so
> draft links, reloads and post-publish resets stay inside their project, and
> a `<base>` tag points a switched project's assets at its own directory.
> Adding a report = deploy its engine dir + one line in `projects.json`:
>
> ```json
> {
>   "budget-primer": { "name": "Budget Primer FY2026–27", "base": "" },
>   "next-report":   { "name": "Next Report",
>                      "base": "https://user.github.io/NextReport/editor" }
> }
> ```
>
> Each project's manifest already names its own `repo`, so drafts, publishes
> and tokens all target the right repository per project.

---

## 5. Concrete first steps (Phase 1, in order)

1. **Atomic commit helper** — replace the per-file `PUT contents/*` loop with a
   `commitTree(repo, branch, [{path, content}], message)` using the Git Data
   API (create blobs → base tree → new tree → commit → `PATCH refs/heads/...`).
   Self-contained; testable against a scratch branch.
2. **Branch selector + `Save draft`** — derive `draft/<project>/<user>`,
   auto-create from `main` if absent, commit there. `#save` becomes `Save
   draft`.
3. **`Share`** — button that copies the preview URL (once the preview workflow
   exists) and offers "open a PR."
4. **Preview workflow** — Actions job building each `draft/**` branch to a
   preview path.
5. **`Publish`** — open/merge the PR to `main`; keep today's rebuild-on-`main`.
6. **Conflict UX** — replace the raw 409 with a fetch + summary + choice.

Each step ships and is verifiable on its own; none needs a backend. Phase 2
layers auth on top without reworking Phase 1.
