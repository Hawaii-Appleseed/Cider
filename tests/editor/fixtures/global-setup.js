// Runs once before the suite.
//
// 1. Stage the default project's editor from THIS working tree. Almost every
//    spec opens /primer/edit.html, which serve.py serves from docs/primer/.
//    The server's startup rebuild is what normally refreshes that copy, but a
//    machine whose docs/primer/projects.json points budget-primer at another
//    checkout (local_root: ~/BudgetPrimerFinal) rebuilds THAT checkout instead,
//    and docs/primer/ here kept whatever edit.html and engine were staged last.
//    Measured 2026-09-22: the suite was testing an edit.html two commits old,
//    so an uncommitted editor change was not under test at all. CI has no
//    projects.json and was unaffected. The report's published copy is the
//    committed one, copied as `make -C report2027 pub` does, without the
//    render (which rewrites a tracked file).
//
// 2. With DS_IMPACT=map, snapshot the files the impact map will be written in
//    the coordinates of (see impact.js and tools/affected.mjs).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');

module.exports = async () => {
  execFileSync('python3', ['-m', 'docsync.stage', '--id', 'budget-primer'], { cwd: ROOT, stdio: 'ignore' });
  for (const f of ['index.html', 'primer.css', 'primer.js']) {
    fs.copyFileSync(path.join(ROOT, 'report2027/web', f), path.join(ROOT, 'docs/primer', f));
  }

  if (process.env.DS_IMPACT === 'map') require('./impact-map').snapshot();
};
