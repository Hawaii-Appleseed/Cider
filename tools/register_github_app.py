#!/usr/bin/env python3
"""Register the GitHub App that "Connect GitHub" signs in through — one click.

    python3 tools/register_github_app.py [--name "Budget Primer Editor"]

Creating an App is an account-level change, so the click is yours: this opens
github.com with the whole form ALREADY FILLED IN (GitHub's App Manifest flow),
you press "Create GitHub App", and everything after that is automatic — the
code comes back here, gets converted, and the client id is written into
github-app.json where the server and every colleague's install read it.

Only the CLIENT ID is kept. The conversion also hands back a client secret and
a private key; the device flow needs neither, so they are deliberately dropped
rather than written to a file someone could commit.
"""
from __future__ import annotations

import argparse
import http.server
import json
import socket
import sys
import threading
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "github-app.json"

PAGE = """<!doctype html>
<meta charset="utf-8">
<title>Register the editor's GitHub App</title>
<style>
  body {{ font:15px/1.6 system-ui, sans-serif; color:#2F3E46; background:#EDF1EE;
         display:grid; place-items:center; height:100vh; margin:0; }}
  .card {{ background:#fff; padding:28px 32px; border-radius:14px; max-width:30em;
          box-shadow:0 4px 18px rgba(0,0,0,.10); }}
  h1 {{ font-size:19px; margin:0 0 .6em; }}
  button {{ font:600 15px system-ui; background:#6B9E78; color:#fff; border:0;
           border-radius:9px; padding:11px 20px; cursor:pointer; }}
  ol {{ padding-left:1.2em; }} li {{ margin:.4em 0; }}
</style>
<div class="card">
  <h1>Register “{name}”</h1>
  <p>The form on GitHub is already filled in. You will:</p>
  <ol>
    <li>press <b>Create GitHub App</b> on the page that opens,</li>
    <li>come straight back here — the client id is saved automatically.</li>
  </ol>
  <form action="https://github.com/settings/apps/new" method="post">
    <input type="hidden" name="manifest" value='{manifest}'>
    <button type="submit">Open GitHub and create it</button>
  </form>
</div>
"""

DONE = """<!doctype html>
<meta charset="utf-8">
<title>Done</title>
<style>
  body {{ font:15px/1.6 system-ui, sans-serif; color:#2F3E46; background:#EDF1EE;
         display:grid; place-items:center; height:100vh; margin:0; }}
  .card {{ background:#fff; padding:28px 32px; border-radius:14px; max-width:32em;
          box-shadow:0 4px 18px rgba(0,0,0,.10); }}
  code {{ background:#EFF3F0; padding:2px 6px; border-radius:5px; }}
  a.btn {{ display:inline-block; margin-top:14px; font:600 15px system-ui;
          background:#6B9E78; color:#fff; text-decoration:none;
          border-radius:9px; padding:11px 20px; }}
</style>
<div class="card">
  <h1>{title}</h1>
  {body}
</div>
"""


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--name", default="Budget Primer Editor",
                    help="App name — must be unique across GitHub")
    ap.add_argument("--url", default="https://github.com/Hawaii-Appleseed/Cider",
                    help="the App's homepage")
    a = ap.parse_args(argv)

    if CONFIG.is_file():
        try:
            cur = json.loads(CONFIG.read_text()).get("client_id", "")
        except json.JSONDecodeError:
            cur = ""
        if cur:
            print(f"  {CONFIG.name} already names client id {cur}")
            print("  Delete that file first if you really want a second App.")
            return 0

    port = _free_port()
    manifest = {
        "name": a.name,
        "url": a.url,
        "redirect_url": f"http://localhost:{port}/callback",
        # NO hook_attributes: supplying that object makes its own "url" key
        # required, and GitHub reports the omission as the confusing
        # "url wasn't supplied" — about the WEBHOOK url, not the homepage.
        # Left out entirely, webhooks are simply off, which is what we want.
        # Any account, so collaborators outside yours can sign in. Their access
        # is still their repo permission — this only lets them authenticate.
        "public": True,
        "default_permissions": {"contents": "write", "pull_requests": "write",
                                "metadata": "read"},
        "request_oauth_on_install": False,
    }
    # Single quotes wrap the HTML attribute, so escape those and nothing else.
    manifest_attr = json.dumps(manifest).replace("'", "&#39;")

    state = {"done": False, "code": None}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):        # quiet: this is a UI, not a log
            pass

        def _html(self, body: str, status: int = 200):
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body.encode())

        def do_GET(self):
            if self.path.startswith("/callback"):
                from urllib.parse import parse_qs, urlparse
                code = parse_qs(urlparse(self.path).query).get("code", [None])[0]
                if not code:
                    return self._html(DONE.format(
                        title="No code came back",
                        body="<p>GitHub did not send a code. Close this and run "
                             "the command again.</p>"), 400)
                try:
                    req = urllib.request.Request(
                        f"https://api.github.com/app-manifests/{code}/conversions",
                        method="POST")
                    req.add_header("Accept", "application/vnd.github+json")
                    with urllib.request.urlopen(req, timeout=20) as r:
                        app = json.loads(r.read().decode())
                except Exception as e:                    # noqa: BLE001 — show it
                    return self._html(DONE.format(
                        title="Could not finish the registration",
                        body=f"<p>{e}</p><p>The App may still have been created — "
                             "check github.com/settings/apps.</p>"), 500)
                # ONLY the client id. The secret and pem in this response are
                # not needed for the device flow and must never reach a file.
                CONFIG.write_text(json.dumps({
                    "_comment": "Public client id of the GitHub App that File > "
                                "Connect GitHub signs in through. Not a secret; "
                                "tracked so every install has it.",
                    "client_id": app["client_id"],
                    "name": app.get("name", a.name),
                    "html_url": app.get("html_url", ""),
                }, indent=2) + "\n")
                state["code"] = app["client_id"]
                state["done"] = True
                settings = (app.get("html_url", "") or "").replace(
                    "https://github.com/apps/", "https://github.com/settings/apps/")
                self._html(DONE.format(
                    title="Created — one checkbox left",
                    body=(f"<p>Client id <code>{app['client_id']}</code> is saved "
                          "in <code>github-app.json</code>.</p>"
                          "<p><b>Tick “Enable Device Flow”</b> on the App's settings "
                          "page (the manifest cannot set it), then press Save. "
                          "That is what lets people sign in with a code.</p>"
                          f"<a class=\"btn\" href=\"{settings}\" target=\"_blank\">"
                          "Open the App's settings</a>")))
                threading.Thread(target=srv.shutdown, daemon=True).start()
                return
            self._html(PAGE.format(name=a.name, manifest=manifest_attr))

    srv = http.server.HTTPServer(("127.0.0.1", port), H)
    url = f"http://localhost:{port}/"
    print(f"  Opening {url}")
    print("  Press the button there; this waits for GitHub to come back.")
    threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    srv.serve_forever()

    if state["done"]:
        print(f"\n  client id: {state['code']}")
        print(f"  written to {CONFIG.relative_to(ROOT)}")
        print("  Remaining: tick 'Enable Device Flow' on the App's settings page.")
        return 0
    print("\n  nothing was registered")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
