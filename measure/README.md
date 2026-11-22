# The headless editor (`measure/`)

The staff hub's connector lays out a report **nobody has open** by handing the
job to this: the hub's own deployed editor, opened headless in Chromium on that
report, running the job with the functions an open tab runs for the same
request (`hubPilot()` for `arrange_report`'s ops, the `docsync.api` reads for
`check_report` and `read_report … measure: true`). It answers with what that
editor measured on the page it rendered (`layout.new`, fit, element boxes) and
the files it ended with; the hub saves those as the person. The design, and why
it runs here rather than on Cloudflare, is in `server.mjs`'s header and in the
hub's `functions/api/mcp.js` ("the headless editor").

It holds **no secret**. Each job carries a door the hub signed (one person, one
report, three minutes), and every file the editor asks the hub for is fetched
through `GET <hub>/api/mcp?door=…&path=…`. A job whose door the hub refuses
fails on its first file. Writes never leave the page: non-GET requests are
refused here, and the room's websocket is closed.

## Where it runs

Devin's Mac mini (`madison`), always on:

- folder: `~/repos/cider-measure`, a detached worktree of `~/repos/Cider`
  (`git -C ~/repos/Cider worktree add --detach ~/repos/cider-measure origin/main`),
  with `node_modules` a link to `~/repos/Cider/node_modules` (Playwright and
  its Chromium are already there for the editor's tests);
- service: `org.hiappleseed.cider-measure` (this folder's plist, copied to
  `~/Library/LaunchAgents`), which runs `run.sh`: move to `origin/main`, then
  `node measure/server.mjs` on 127.0.0.1:8797; log
  `~/Library/Logs/cider-measure.log`;
- reached at `https://devin-mini.tailc81d10.ts.net:8443/cider-measure` through
  the Mac mini's Tailscale Funnel (`tailscale funnel --bg --https=8443
  --set-path /cider-measure http://127.0.0.1:8797`; Logic Companion keeps `/`
  on that port). 8443 because a Cloudflare Worker's fetch reaches only a few
  HTTPS ports and a Funnel offers only three; it is the address the hub calls
  by default (`MEASURER_URL` overrides it; `off` turns it
  off and the tools refuse as they did before).

Restart it to pick up a new `server.mjs`:
`launchctl kickstart -k gui/$(id -u)/org.hiappleseed.cider-measure`.
Health: `curl -s https://devin-mini.tailc81d10.ts.net:8443/cider-measure/health`.

## Test

`tests/editor/measure-hub.spec.js` runs the whole loop locally: a
`wrangler pages dev` hub with this tree's editor vendored in, the relay, and this
server; the connector's `arrange_report`, `read_report` and `check_report` with
nobody in the room, a report made with `new_report` and never opened, and a
forged job. It needs the hub checked out beside the clone (CI's `hub` job has it).
