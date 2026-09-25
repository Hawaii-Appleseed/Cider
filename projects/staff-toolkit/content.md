<!--
  The Toolkit — the internal guide to the staff hub's tools.

  Not a research report: no org boilerplate, no copyright page, no author
  line. It is documentation of our own tools, so the endnotes point at where
  each thing is actually written down rather than at outside sources.

  Every heading and every paragraph here is a [[slot]] and editable in the
  draft editor. The two diagrams are drawn by render_report.py through
  graphic(), so they can be moved and resized but their contents are code —
  changing what a diagram SAYS is a change to render_report.py.
-->

[[title]]
The Toolkit

[[cover.eyebrow]]
HAWAIʻI APPLESEED · STAFF HUB

[[cover.h1]]
# The Toolkit

[[cover.deck]]
Every tool on the staff hub — what each one is for, how to use it, and why a
single Google sign-in covers all of them.

[[cover.stamp]]
September 2026 · Internal

[[cover.lead]]
THE STAFF HUB IS ONE WEBSITE with five tabs, and everything in this guide
lives on it. There is nothing to install, no second password, and no separate
account: you reach it at **staff-updates-internal.pages.dev**, sign in with
your Hawaiʻi Appleseed or Hawaiʻi Budget and Policy Center Google account, and
that session lasts about a month.[^hub] The first half is the groundwork:
choosing a Claude model, why there is a hub at all rather than just Claude,
what GitHub is for, and the four words people muddle for reaching a tool. The
second half is this hub itself, tab by tab, starting with what Cloudflare
keeps.

[[fig1.h]]
Figure 2. What Is In GitHub, And What Of It Is Public
[[fig1.note]]
Eight of the sixteen repositories are public — but not the ones with our own
work in them. The website's is public, and the two files GitHub Pages serves
from it are what the hub's Library is built from: read directly, with no
sign-in and no second copy kept here. Source: the README's "The Library" and
"Making a document on the hub".[^readme]

[[cover.read.h]]
### What GitHub is for
[[cover.read.p]]
**GitHub is the filing cabinet that never forgets.** Nothing in it is
overwritten. A change is saved as a **commit** — a snapshot with a date, an
author, and a sentence saying why — and a **repository** is one project's
folder plus every commit ever made to it. You edit on your own laptop, then
**push**, which sends your commits to the shared copy. That is the point: any
version can be brought back, and you can always see who changed what. These
words, and the rest of the vocabulary in this guide, are in the glossary at
the back.

**A report is one folder in a repository.** Its words, its layout and the
Python that draws it sit together in Cider — the folder the editor
opens — and Publish sends an edited report back as a commit of its own. A
push to the hub's own repository is what rebuilds the site, which is why a
new feature can appear without anyone sending you a link. That repository is
private: everything carrying our own work — attendance, strategy, the notes —
sits behind the gate.

[[cover.card.title]]
### Two things worth remembering

[[cover.card.bullets]]
- **Git seeds a document; the store keeps it.** The committed copy is what you see until the first Save. After that R2 is what staff read, and carrying a fresh copy across from GitHub will not change it.
- **Two speeds, on purpose.** Pages and code arrive by a push and a rebuild. Checkboxes, tasks, board cards and report edits are saved live, and are on everyone else's screen in seconds.
[[pcf.eyebrow]]
WHERE IT ALL RUNS

[[pcf.h1]]
What Cloudflare keeps

[[pcf.sub]]
The gate in front of everything, and the four places your work is kept.
[[pcf.foot]]
*Where it all runs*

[[fig2.h]]
Figure 5. Cloudflare — One Gate, And Four Stores Behind It

[[fig2.note]]
Nothing in this diagram touches GitHub: Pages is rebuilt by a push, but every
other arrow here is live. Source: the README's "Shared checkboxes", "The live
updates mirror", "The documents, on R2" and "The primer editor's rooms".[^readme]
[[cf.read.h]]
### What Cloudflare is for
[[cf.read.p]]
**Cloudflare serves the hub and remembers what you do.** Pages puts the pages
in front of you and rebuilds them whenever GitHub is pushed to; everything
under /api is a small program a page calls to fetch or save something.
Behind those sit the things that have to be live — **KV** for your checkboxes,
the task board, the comms board and the notes; **R2** for the documents in the
editor and every version of every one of them; and **the room**, where two
people editing the same report see each other type. One gate covers all of it:
Access checks your Google sign-in before anything is answered, including the
call your own Claude makes over MCP, which is why that needs no GitHub
account.
[[peval.eyebrow]]
CHOOSING A MODEL

[[peval.h1]]
Three models, and what effort costs

[[peval.sub]]
Start with Opus 5. Turn the effort up for long coding work, and leave it alone
for everything else.

[[peval.foot]]
*Choosing a model*

[[figmodels.h]]
Figure 1. The Three Models, And What Raising The Effort Buys

[[figmodels.note]]
Every price here is an API list rate, per million tokens or per task. On a
claude.ai or Claude Code subscription nobody is billed that way, so read them
as ratios: which model, and which effort, costs several times another. The
SWE-bench Pro scores are a subset both models largely saturate and are not
comparable to the public leaderboard, and Opus 5's medium row is derived
from the source's "about 2 points at medium for half the cost" against its
91.7% / $1.01 default.[^models][^cost]
[[eval.read.h]]
### What to take from this

[[eval.read.p]]
**Start with Opus 5.** It is the one to reach for on most work, and on the
coding subset above it matched Fable 5.1 at the default — 91.7% against 92.1%,
inside run-to-run noise — for about 15% less per solved task. Go to **Fable
5.1** for the hardest reasoning, for a job you expect to run for hours, or
when Opus 5 at a higher effort still falls short. Go to **Sonnet 5** for
simple work in bulk, when speed and cost matter more than the last few points.

**Effort is not a dial to leave turned up.** On long coding work it buys real
accuracy: Opus 5 gives up about 8 points at low and about 2 at medium, for
a quarter and a half of the cost. On research and knowledge work the curve is
nearly flat — Fable 5.1 scored about the same at low, medium and high
while the cost per task went from $4.66 to $7.12. The default is high on all
three models, so the saving is in turning it **down** where it buys nothing.

[[cover.contents.h]]
### What is in here

[[p2.eyebrow]]
WHERE THE WORK IS KEPT
[[p2.h1]]
What GitHub remembers
[[p2.sub]]
Every change to the code and the reports is saved, with a name on it. The
repository holding our own work is private. The website's is public, and the
Library reads from it.

[[p2.foot]]
*Where the work is kept*
[[cover.contents.02]]
Three models, and what effort costs

[[cover.contents.03]]
Why a hub, and not just Claude

[[cover.contents.04]]
What GitHub remembers

[[cover.contents.05]]
Setting up the GitHub CLI

[[cover.contents.06]]
Two routes, and only one of them writes

[[cover.contents.07]]
Connectors, the CLI, MCP servers and plugins

[[cover.contents.08]]
What Cloudflare keeps

[[cover.contents.09]]
Updates

[[p3.eyebrow]]
THE FIRST TAB

[[p3.h1]]
Updates

[[p3.sub]]
The all-staff meeting, turned into something you can search and check off —
without anyone copying anything across.

[[updates.p]]
UPDATES IS THE FIRST TAB and it is the all-staff notes doc, rearranged by
topic. Nobody copies anything across. You edit the notes doc as you always
have; the hub notices within about a minute and re-renders itself. Bullets are
grouped into cards by team, and a heading the parser has not seen before is
never dropped — it publishes as its own card in amber, with a note, so drift
in the notes doc shows up on the page instead of quietly losing content.

[[fig3.h]]
Figure 6. How An Edit To The Notes Doc Reaches The Page

[[fig3.note]]
Source: the README's "live updates mirror" and "Why syncNow takes a lock". The
committed copy reaches the page on the next rebuild; the live mirror reaches it
in seconds, which is why you rarely wait.[^readme]

[[updates.how.h]]
### What to do on this page

[[updates.how.p]]
**Check off a bullet** and it is checked off for everyone — the box is shared
state, not a note to yourself, so use it to mean the thing is done rather than
to mark your own place. **Open Coming up** to see what is dated in the next
couple of weeks without leaving the page. **Press Command-K** (Control-K on
Windows) anywhere on the hub for the search palette, which searches meeting
bullets, resources, certificates, media, published work, testimony and
positions at the same time. If a bullet is worth acting on beyond the meeting,
put it on the board rather than leaving it in the notes.

[[p4.eyebrow]]
DATES AND WHO IS DOING WHAT

[[p4.h1]]
Calendar and Tasks

[[p4.sub]]
One board, four views, and the dated bullets from the notes arriving on it
without anyone entering them twice.

[[p4.foot]]
*Calendar and Tasks* · *Subscriptions*

[[cal.h]]
### One page, four views

[[cal.p]]
The Calendar tab is one page in four views. **Board** is To do, In progress and
Done; **Week**, **Month** and **List** are the same cards by due date, and every
dated or timed bullet from the notes appears there on its own, with no one
entering it twice. Underneath the board is the **Publishing pipeline** — report
rollouts and blog posts, live, so a date moving there does not need a rebuild.
Drag a card between columns or across days and it moves for everyone.

[[cal.card.title]]
### Getting the board into your own calendar

[[cal.card.bullets]]
- Open a task and use **Add to my Google** — it copies into your own Google Calendar or Google Tasks and stays in step, both directions.
- It is not instant. A change on the board reaches your Google copy on the next tick, up to fifteen minutes later.
- The **Subscribe** button hands you a feed URL for the whole board or just your own tasks, for anything that reads calendar subscriptions.

[[p3.foot]]
*Updates*

[[p5.eyebrow]]
FINDING THINGS

[[p5.h1]]
Library, Resources, and search

[[p5.sub]]
Everything we have published, everything we have filed, and the one search box
that covers both.

[[lib.p]]
LIBRARY IS EVERYTHING WE HAVE PUBLISHED and everything we have filed, in one
list — the live site feeds plus the research corpus. It replaced two separate
tabs that carried the same reports and blog posts at different depths, which
meant guessing which one to open. Filter pills narrow the list and always carry
their count; jump pills move you down the page. If you are looking for a
specific publication, start here.

[[res.h]]
### Resources

[[res.p]]
Resources is the Drive side: staff documents, the most-linked files, and the
**Brand and media** band — the brand kit, event media and the blog pipeline.
The old Media tab redirects here, anchors and search terms intact. Thumbnails
for the brand kit are fetched only when you open that fold, so the page stays
quick.

[[search.h]]
### Two different searches, and when to use which

[[search.p]]
**Command-K** is the fast one: it matches titles and text across every source
on the hub at once and is the right reflex when you half-remember something.
**Content search** is the careful one — a hybrid of keyword, meaning and a
reranking pass over testimony, blog posts and publications, with a browsable
library and positions directory when you type nothing. Use Command-K to find a
document you know exists; use content search when you need every place we have
said something about a subject.

[[search.card.title]]
### Also on the hub, off the nav

[[search.card.bullets]]
- **The voting record** — per-legislator Hawaiʻi tax votes, 2022 to 2026, built from the Legislative Research Tool.[^legis] Deliberately not in the nav; it is reachable by its link, and Access gates it like every other page.
- **The certificate and positions data** behind the search palette, which is why a Command-K result can be something no tab shows you directly.

[[p5.foot]]
*Library* · *Resources* · *Search*

[[p6.eyebrow]]
WRITING AND DESIGNING

[[p6.h1]]
The report editor

[[p6.sub]]
Reports, briefs and one-pagers, edited in the browser, by more than one person
at a time.

[[ed.p]]
THE EDITOR TAB IS A REPORT EDITOR, and the documents in it are real designed
sheets rather than flowing pages: 8.5 by 11 inches, with a text column, a
figure that can be dragged, and a page count. You edit the words in place, and
you move things by selecting them. It runs on this hub rather than somewhere
else specifically so that it inherits your Google sign-in — the editor's own
authentication is GitHub, and most of the people who need to use it have no
GitHub account.[^readme] The engine itself, and the repository a brand-new
report gets built in, is Cider.[^cider]

[[ed.card.title]]
### The five things to know

[[ed.card.bullets]]
- **New document asks what to start from**, because a report is its renderer as much as its text. The copy borrows the engine of whatever you pick.
- **Save is a version, and every version is kept.** If a document moved underneath you, the save is refused rather than overwriting someone.
- **Command-G groups, Command-Shift-G ungroups.** A card's title and bullets move as one until you pull them apart.
- **A folder is only a label.** Filing a document does not move it and deleting a folder does not take its documents with it.
- **Take off the list is reversible; Delete for good is not.** The Removed shelf at the foot of the page puts anything back.

[[ed.rooms.h]]
### Editing at the same time as someone else

[[ed.rooms.p]]
Every document has a room, and everyone in it types into the same copy — the
way a Google Doc works, cursors and all. The hub shows you who is in a
document before you open it. There is no lock and no check-out, so the honest
advice is to look at who else is in there before you rearrange pages.

[[ed.share.h]]
### Who can open what

[[ed.share.p]]
**A document nobody has narrowed is editable by everyone who gets through
Access**, and that is deliberate: the share record exists to restrict a
document, never to be the thing that grants access in the first place. Anyone
who can edit can also re-share. Sharing outside the two staff domains is not
something the dialog can do — a partner organization or a consultant needs a
Cloudflare change, so ask rather than assuming it will cover it.

[[p6.foot]]
*The report editor*

[[p7.eyebrow]]
THE REST

[[p7.h1]]
Your own Claude, and what to do when something breaks

[[p7.sub]]
The thing here that saves the most time, and what to check before reporting
something as broken.

[[mcp.p]]
THE HUB IS AN MCP SERVER, which means your own Claude can read and edit the
reports in the editor as you. Nothing gets installed and the hub holds no
model key — the subscription you already have does the thinking. It is the
fastest way to draft into a report: ask for a section and watch it land, with
everyone else in the room watching too.

[[mcp.card.title]]
### Adding it

[[mcp.card.bullets]]
- **On claude.ai** (Pro, Max or Team): Settings, then Connectors, then Add custom connector, and give it the hub's /api/mcp address — on a Team plan an administrator can add it once for everyone.[^mcp]
- **In Claude Code**: run claude mcp add --transport http hub followed by the same address.
- You will be sent through the ordinary Google sign-in, and everything Claude then does is done as you — it can only reach the documents you can.

[[subs.h]]
### Calendar subscriptions

[[subs.p]]
The hub can hand out two subscribable calendars — every dated bullet from the
notes, and the task board by due date, optionally just your own tasks. Both are
off unless switched on, each has its own token, and the Subscribe button only
lists the ones that are live. A subscription URL carries its token, so treat it
the way you would treat a private calendar link and do not post one in a public
channel.

[[broke.h]]
### When something looks wrong

[[broke.p]]
**If a page will not let you in**, the question is almost never permission —
everyone on either staff domain is allowed automatically — so check which
Google account the browser used. A stuck session can serve a stale refusal
after the cause is fixed; sign out of Access and retry in a private window.
**If Updates looks stale**, give it a minute: there is a five-minute safety
net behind the instant path. **If a data file looks wrong, do not fix it by
hand** — everything under data/ is generated and overwritten. Say something
instead.[^readme]
[[p7.foot]]
*Your own Claude* · *When something breaks*

[[pmcp.eyebrow]]
FOUR WORDS FOR NEARLY ONE THING

[[pmcp.h1]]
Connectors, the CLI, MCP servers and plugins

[[pmcp.sub]]
Three of these are the same machinery seen from different places. The fourth
is a bundle that can contain it.

[[pmcp.foot]]
*Connectors, the CLI, MCP servers and plugins*

[[figstack.h]]
Figure 4. What Each Of The Four Actually Is

[[figstack.note]]
Sources: Anthropic's own documentation on custom connectors, on MCP in Claude
Code, and on creating plugins.[^connectors][^ccmcp][^plugins]

[[stack.read.h]]
### Telling them apart

[[stack.read.p]]
**The MCP server is the thing itself** — one address speaking one protocol.
This hub is one, at /api/mcp, and everything below is a way of reaching it.

**A connector and claude mcp add are two doors onto that same server.** On
claude.ai you add a connector under Settings; in Claude Code — a program you
type commands at, in a terminal — you run claude mcp add --transport http.
Same server, same address, different app — and if you signed in to Claude Code
with your claude.ai account, the connectors you added there are already
available. Anthropic verifies the pre-built connectors, Google Workspace and
the like; a **custom** connector is any remote MCP server that has not been
through that, which is what this hub is.

**A plugin is not a door.** It is a bundle, it is Claude Code only, and it is
installed from a marketplace: skills, agents, hooks, commands, LSP servers,
background monitors — and, if it wants one, an .mcp.json file. That last part
is an MCP server, which is why these four words get muddled. The test: to reach
one service you want a connector or claude mcp add; to hand somebody a
working setup, you want a plugin.

[[cover.contents.10]]
Calendar and Tasks

[[pgh.eyebrow]]
IF YOU NEED THE REPOSITORIES

[[pgh.h1]]
Setting up the GitHub CLI

[[pgh.sub]]
Most people never need this. If you do, it is a few commands — and one step
only somebody else can do for you.

[[pgh.foot]]
*Setting up the GitHub CLI*

[[gh.p]]
THE EDITOR LIVES ON THIS HUB so that nobody needs a GitHub account to write a
report. You need one only if you are going to work with the files themselves —
reading the code, running the renderer, or letting Claude Code commit and push
the way Figure 2 draws it. **gh** is GitHub's own command-line tool, and it is
the shortest path from nothing to a copy of a repository on your laptop.

[[gh.card.title]]
### From nothing to a checkout

[[gh.card.bullets]]
- **Ask to be added first.** Every repository with our work in it is private, so nothing below will find them until somebody with access has added you to the Hawaiʻi Appleseed organization on GitHub. This is the only step you cannot do yourself.
- **Install it.** On a Mac, run brew install gh. Windows and Linux instructions are on the GitHub CLI site.[^ghcli]
- **Sign in.** Run gh auth login, then choose GitHub.com and HTTPS. It opens a browser to finish, and keeps the token in your system keychain rather than a file on disk.
- **Check it took.** Run gh auth status. It names the account you are signed in as, and what it is allowed to do.
- **Take a copy.** Run gh repo clone Hawaii-Appleseed/staff-updates-internal. That puts the hub's own files in a folder on your laptop.

[[gh.after.h]]
### What that gets you

[[gh.after.p]]
A folder you can point Claude Code at. From there it can edit files, commit
them, and push — and the push is what rebuilds the site. Nothing else in this
guide depends on it: the hub, the editor, the board and your own Claude all
work with no GitHub account at all, which is the whole reason they were built
this way.

[[pdesk.eyebrow]]
GITHUB FROM THE CLAUDE APP

[[pdesk.h1]]
Two routes, and only one of them writes

[[pdesk.sub]]
One route can read a repository but not change it. The other works on your own
copy, where a pull request comes from.

[[pdesk.foot]]
*GitHub from the Claude app*

[[figroutes.h]]
Figure 3. Reading A Repository, And Changing One

[[figroutes.note]]
Drawn rather than screenshotted on purpose: a picture of the app is right
until its next release, and cannot be recoloured when the palette moves.
Sources: Anthropic on the GitHub connector, and gh itself.[^ghconn][^ghcli]

[[routes.h]]
### Which route you want

[[routes.p]]
**To read a repository, use a connector.** In a chat or a Project, the plus
button offers **Add from GitHub**, and you pick the files or folders you want.
Claude then has their names and contents, and can answer questions about them.
That is all it does: no commit history, no issues, no pull requests, and
nothing written back. People lose time waiting for it to open a pull request
it cannot open.

**To change a repository, use Claude Code.** The Code tab works on a real copy
on your machine — the one the GitHub CLI sheet sets up — so it can branch,
commit and push the way Figure 2 draws it, and open a pull request when the
work is ready. Anything that ends in a change to the files goes this way.

[[pr.h]]
### What a pull request is

[[pr.p]]
**A pull request is a set of commits offered for review before they join the
main line.** It sits on its own branch, so nothing in it changes what is
deployed until somebody merges it. That is the point: a change can be read and
argued with while it is still cheap to change. From the Code tab, gh pr create
opens one from the branch you are on and prints its address; gh pr diff shows
what is in it, gh pr review records an opinion, and gh pr merge finishes it.
**Merging stays a person's act** — nothing in this guide merges anything on
your behalf.

[[pgloss.eyebrow]]
THE WORDS

[[pgloss.h1]]
What the words mean

[[pgloss.sub]]
Every term in this guide that is not plain English, in one place.

[[pgloss.foot]]
*What the words mean*

[[gloss.a]]
**Access** — Cloudflare's gate. It checks your Google sign-in before any page
or any /api call on the hub is answered.

**API** — a small program a page calls to fetch or save something. Everything
under /api on this hub is one.

**branch** — a line of commits kept apart from the main one, so work in
progress does not change what is deployed.

**checkout** — the copy of a repository sitting on your own machine, which you
edit and then push from.

**CLI** — a program you type commands at instead of clicking. Claude Code is
one; so is gh.

**commit** — one saved change in GitHub: a snapshot with a date, an author and
a sentence saying why.

**connector** — how claude.ai attaches to an MCP server. You add one under
Settings.

**deploy** — Cloudflare rebuilding and re-serving the site after a push. It
takes a minute or two.

**Durable Object** — the piece of Cloudflare that holds one live thing for
everybody at once. Each document's room is one.

**effort** — how hard you ask a Claude model to think. Five settings, low to
max; the default is high.

**KV** — Cloudflare's fast store for small things: checkboxes, tasks, the
comms board, the live notes.
[[gloss.b]]
**marketplace** — the list a Claude Code plugin is installed from. Anthropic
runs two; a team can host its own.

**MCP** — the protocol Claude uses to reach a tool outside itself. This hub
speaks it at /api/mcp.

**Pages** — the Cloudflare service that serves this site and rebuilds it
whenever GitHub is pushed to.

**plugin** — a bundle for Claude Code, installed from a marketplace: skills,
agents, hooks, and sometimes an MCP server.

**push** — sending your commits from your laptop to the shared copy on GitHub.

**R2** — Cloudflare's file store. The editor's documents, and every version of
them, live here.

**repository** — one project's folder on GitHub, together with every commit
ever made to it.

**the room** — the live shared copy of a document open in the editor.
Everyone in it types into the same thing.

**SSO** — signing in once with your Google account and being recognised
everywhere after that. Access uses it.

**terminal** — the text window on your own computer where a CLI runs.

**token** — a long secret string that stands in for a password. Treat one the
way you would treat a password.
[[cover.contents.11]]
Library, Resources, and search

[[cover.contents.12]]
The report editor

[[cover.contents.13]]
Your own Claude, and what to do when something breaks

[[pend.foot]]
*Where this is written down*

[[foot.running]]
THE TOOLKIT

[[endnotes.h2]]
Where this is written down

[[sources]]
[hub]: The staff hub — https://staff-updates-internal.pages.dev
[readme]: The hub's README — https://github.com/Hawaii-Appleseed/staff-updates-internal/blob/main/README.md
[cider]: Cider, the report engine — https://github.com/Hawaii-Appleseed/Cider
[legis]: Legislative-Research-Tool — https://github.com/Hawaii-Appleseed/Legislative-Research-Tool
[models]: Anthropic, Models overview — https://platform.claude.com/docs/en/models/overview
[cost]: Anthropic, Optimizing for cost and intelligence — https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence
[connectors]: Anthropic, About custom connectors — https://support.claude.com/en/articles/11175166-about-custom-connectors-remote-mcp
[ccmcp]: Anthropic, MCP in Claude Code — https://code.claude.com/docs/en/mcp
[plugins]: Anthropic, Create plugins — https://code.claude.com/docs/en/plugins
[ghconn]: Anthropic, Using the GitHub connector with Claude — https://support.claude.com/en/articles/10167454-using-the-github-connector-with-claude
[ghcli]: GitHub CLI — installation for every platform — https://cli.github.com
[mcp]: "Ask your own Claude", in the README — https://github.com/Hawaii-Appleseed/staff-updates-internal/blob/main/README.md

[[cover.contents.14]]
What the words mean

[[pwhy.eyebrow]]
WHY ANY OF THIS EXISTS

[[pwhy.h1]]
Why a hub, and not just Claude

[[pwhy.sub]]
Claude does the thinking. The hub is where the shared things live — and where
the people who never open Claude can still see them.

[[pwhy.foot]]
*Why a hub, and not just Claude*

[[why.p]]
A FAIR QUESTION, and worth answering before any of the machinery: if we all
have Claude, why is there a website at all? Because most of what follows is
shared — one board, one calendar, one set of checkboxes that everybody sees
change at the same moment. A Claude Project is a good place to keep the
context for a conversation. It is not a place the whole staff can stand in
front of at once.

[[why.card.title]]
### What the hub has that a Claude Project does not

[[why.card.bullets]]
- **A board everyone sees at once.** To do, In progress and Done, with due dates and four views of the same cards. Drag one and it moves for everybody, in seconds.
- **A calendar other apps can subscribe to.** The dated bullets and the task board hand out feed URLs that Google Calendar reads. You cannot subscribe to a conversation.
- **Checkboxes that mean the thing is done.** They are shared across staff, not a note to yourself about where you got to.
- **A way in for people who do not open Claude.** The hub is a website behind a Google sign-in. Everyone on either staff domain gets in, whether they use Claude or not.
- **A record that outlives the chat.** Every document is versioned in the store and every version is kept.

[[why.gh.h]]
### Where GitHub comes in

[[why.gh.p]]
**GitHub is not what runs the board** — that is Cloudflare's, and its own
sheet draws it. GitHub's job is narrower, and it is about the code: every
change to the site and to the report engine is saved with a name, a date and
a reason, nothing is ever overwritten, and any version can be brought back.
Its second job is the deploy. A push to the hub's own repository is what
rebuilds the site, which is how a change one person makes becomes the page
everybody else opens.

**And Claude still reaches all of it.** The hub is an MCP server, so your own
Claude can read and write the reports as you. The choice was never Claude or
the hub. It is Claude, plus a shared place for the things a conversation
cannot hold.

