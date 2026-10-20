"""Publish a project's page to a public site that lives in ANOTHER repository.

A Cider project is saved into the checkout the editor runs from. A website
(the Estimates pages, a one-pager that is not on the staff hub) lives in a
different repo and is deployed from there — so the editor's own Push cannot
reach it. A binding that declares a `publish:` block closes that gap:

    publish:
      repo: Hawaii-Appleseed/Census-Forecaster     # owner/name, a git URL, or a local path
      branch: main                                 # the branch the site deploys from
      command: python3 projects/my-page/publish_site.py --site "$CIDER_SITE/site" --write
      paths: [site/my-page/index.html]             # the only files a publish may change
      when: save                                   # save | push  (default push)
      url: https://hawaii-appleseed.github.io/Census-Forecaster/my-page/

When the trigger fires the engine

  1. keeps its OWN clone of the site repo (~/.cider/publish/…), reset to the
     remote branch every time — never the person's working checkout, which may
     be on another branch or hold unfinished work;
  2. runs `command` from the Cider checkout with CIDER_SITE pointing at that
     clone, so the command writes the page(s) into it;
  3. stages ONLY `paths`, commits, and pushes the branch. Nothing else the
     command touched is committed, and an unchanged page commits nothing.

The remote's own deploy (GitHub Pages, a workflow) does the rest. A publish
that fails never undoes the Save that triggered it: the work is still saved
locally and the message says the public site was not updated, and why.

The command is whatever turns the project into the site's page. Nothing here
knows what a page looks like, so a new kind of site needs a new command, not a
new engine.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
from dataclasses import dataclass
from pathlib import Path

_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


@dataclass
class Result:
    ok: bool
    changed: bool
    message: str
    sha: str = ""
    url: str = ""


def home() -> Path:
    """Where the engine's clones of public-site repos live."""
    return Path(os.environ.get("CIDER_PUBLISH_HOME") or Path.home() / ".cider" / "publish")


def _origin(repo: str) -> str:
    """owner/name -> its GitHub URL; an existing directory or a URL as written."""
    local = Path(os.path.expanduser(repo))
    if local.is_dir():
        return str(local)
    if re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        return f"https://github.com/{repo}.git"
    return repo


def clone_dir(repo: str, branch: str) -> Path:
    return home() / (re.sub(r"[^A-Za-z0-9._-]+", "_", repo.strip("/")) + "@" + branch)


def _git(cwd: Path, *args: str, auth: list[str] = (), path_env: str = "", timeout: int = 90) -> str:
    # Never ask for a credential: a detached server has nobody to answer, and a
    # prompt would hang the Save. A missing credential fails in seconds, named.
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0",
           "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=10"}
    if path_env:
        env["PATH"] = path_env
    try:
        r = subprocess.run(["git", *auth, "-C", str(cwd), *args], capture_output=True,
                           text=True, env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"git {args[0]} timed out after {timeout}s") from None
    if r.returncode != 0:
        raise RuntimeError(f"git {args[0]} failed: {(r.stdout + r.stderr).strip()[-800:]}")
    return r.stdout


def _fresh_clone(cfg, auth, path_env) -> Path:
    """The engine's clone, identical to the remote branch (its own, so a hard
    reset loses nothing of anyone's)."""
    d = clone_dir(cfg.repo, cfg.branch)
    if not (d / ".git").exists():
        d.parent.mkdir(parents=True, exist_ok=True)
        r = subprocess.run(
            ["git", *auth, "clone", "--quiet", "--branch", cfg.branch, _origin(cfg.repo), str(d)],
            capture_output=True, text=True, timeout=300,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0", **({"PATH": path_env} if path_env else {})})
        if r.returncode != 0:
            raise RuntimeError(f"could not clone {cfg.repo}: {(r.stdout + r.stderr).strip()[-600:]}")
    else:
        _git(d, "fetch", "--quiet", "origin", cfg.branch, auth=auth, path_env=path_env)
        _git(d, "checkout", "--quiet", "-B", cfg.branch, f"origin/{cfg.branch}", path_env=path_env)
        _git(d, "reset", "--quiet", "--hard", f"origin/{cfg.branch}", path_env=path_env)
        _git(d, "clean", "--quiet", "-fd", path_env=path_env)
    # A machine with no git identity (a fresh install, CI) still has to be able
    # to commit; one with an identity is left alone.
    try:
        _git(d, "config", "user.email", path_env=path_env)
    except RuntimeError:
        _git(d, "config", "user.name", "Cider", path_env=path_env)
        _git(d, "config", "user.email", "cider@users.noreply.github.com", path_env=path_env)
    return d


def _run_command(cfg, root: Path, site: Path, pid: str, path_env: str) -> None:
    env = {**os.environ, "CIDER_SITE": str(site), "CIDER_PUBLISH_PROJECT": pid}
    if path_env:
        env["PATH"] = path_env
    r = subprocess.run(cfg.command, shell=True, cwd=str(root), env=env,
                       capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        tail = (r.stderr.strip() or r.stdout.strip()).splitlines()[-6:]
        raise RuntimeError("the publish command failed: " + " | ".join(tail))


def _attempt(cfg, root, pid, trigger, auth, path_env) -> Result:
    site = _fresh_clone(cfg, auth, path_env)
    _run_command(cfg, root, site, pid, path_env)
    missing = [p for p in cfg.paths if not (site / p).exists()]
    if missing:
        raise RuntimeError("the publish command did not write: " + ", ".join(missing))
    _git(site, "add", "--", *cfg.paths, path_env=path_env)
    if subprocess.run(["git", "-C", str(site), "diff", "--cached", "--quiet"]).returncode == 0:
        return Result(True, False, f"the public site already matches ({cfg.repo})", url=cfg.url)
    msg = cfg.message or f"{pid}: publish from Cider ({trigger})"
    _git(site, "commit", "--quiet", "-m", msg, "--", *cfg.paths, path_env=path_env)
    sha = _git(site, "rev-parse", "--short", "HEAD", path_env=path_env).strip()
    _git(site, "push", "--quiet", "origin", f"HEAD:{cfg.branch}", auth=auth, path_env=path_env)
    return Result(True, True, f"published to {cfg.repo} ({sha})", sha=sha, url=cfg.url)


def run(cfg, root: Path, pid: str, trigger: str, *, auth: list[str] = (), path_env: str = "") -> Result:
    """Publish once. Returns a Result either way; never raises."""
    d = str(clone_dir(cfg.repo, cfg.branch))
    with _LOCKS_GUARD:
        lock = _LOCKS.setdefault(d, threading.Lock())
    with lock:
        try:
            try:
                return _attempt(cfg, root, pid, trigger, auth, path_env)
            except RuntimeError as e:
                # Someone else pushed between our fetch and our push: take the
                # new tip and make the page again, once.
                if "rejected" in str(e) or "fetch first" in str(e):
                    return _attempt(cfg, root, pid, trigger, auth, path_env)
                raise
        except (RuntimeError, OSError, subprocess.SubprocessError) as e:
            return Result(False, False, str(e))


# ---- the hub's route: a GitHub Actions job (see .github/workflows/publish-sites.yml)

def _overlay(root: Path, binding, ref: str) -> list[str]:
    """Take the project's own source files — and only those — from `ref`.

    The staff hub's Publish commits what the editor saved (content, layout,
    assets) to a branch `hub/<project>` of this repository. The job runs this
    repo's TRUSTED code from the default branch and overlays just those files
    from the hub branch: the branch also carries a docsync.yml, and a command in
    it must never be run with a publish credential in the environment.
    """
    ed = binding.editor
    wanted = [binding.content]
    if ed and ed.layout:
        wanted.append(ed.layout)
    if ed:
        wanted.append(ed.assets or (ed.out.parent / "assets"))
    took = []
    for p in wanted:
        rel = os.path.relpath(p, root)
        if rel.startswith(".."):
            raise RuntimeError(f"{binding.id}: {p} is outside the repository")
        if _git(root, "ls-tree", "-r", "--name-only", ref, "--", rel).strip():
            _git(root, "checkout", ref, "--", rel)
            took.append(rel)
    return took


def main(argv: list[str] | None = None) -> int:
    """`python3 -m docsync.publish --hub-branch hub/<id>` — publish one project
    now, from what the hub saved. Exit 0 also when the project has nothing to
    publish to (the hub exports every project; most are not websites)."""
    import argparse
    ap = argparse.ArgumentParser(prog="python3 -m docsync.publish", description=main.__doc__)
    ap.add_argument("--id", help="the project's binding id")
    ap.add_argument("--hub-branch", help="hub/<id>, the branch the hub's Publish wrote")
    ap.add_argument("--ref", help="take the project's source files from this ref (default origin/<hub-branch>)")
    ap.add_argument("--site-repo", help="publish to this repository instead of the binding's (tests, forks)")
    ap.add_argument("--token-env", default="SITE_PUBLISH_TOKEN",
                    help="the environment variable holding a token that can push to the site repo")
    a = ap.parse_args(argv)
    pid = a.id or (a.hub_branch or "").removeprefix("hub/")
    if not pid:
        ap.error("--id or --hub-branch is required")
    root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(root))
    from docsync.registry import RegistryError, get
    try:
        b = get(pid)
    except RegistryError as e:
        print(f"::notice::{e} — nothing to publish")
        return 0
    cfg = b.publish
    if cfg is None:
        print(f"::notice::{pid} has no publish: block — nothing to publish")
        return 0
    if a.site_repo:
        cfg.repo = a.site_repo
    ref = a.ref or (f"origin/{a.hub_branch}" if a.hub_branch else "")
    try:
        if ref:
            print("source files from", ref + ":", ", ".join(_overlay(root, b, ref)) or "(none)")
        token = os.environ.get(a.token_env, "")
        if not token and not Path(os.path.expanduser(cfg.repo)).is_dir():
            raise RuntimeError(
                f"{a.token_env} is not set — add a token that can push to {cfg.repo} "
                f"as that repository secret (Settings > Secrets and variables > Actions)")
        auth = (["-c", f"url.https://x-access-token:{token}@github.com/.insteadOf=https://github.com/"]
                if token else [])
        r = run(cfg, root, pid, "hub", auth=auth)
    except RuntimeError as e:
        print(f"::error::{e}")
        return 1
    print(("::notice::" if r.ok else "::error::") + r.message + (f" — {r.url}" if r.ok and r.url else ""))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(f"**{pid}**: {r.message}" + (f" — {r.url}" if r.ok and r.url else "") + "\n")
    return 0 if r.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
