#!/usr/bin/env node
// The editor changes a document one way: changeDoc() in the editor (docsync/editor/edit.html and its parts),
// which marks the undo step, runs the change, marks it for saving and redraws.
// A change that spans two events (a drag, a slider) takes beginChange() instead.
// Before it, every feature ran those steps itself (pushHistory(), the change,
// markDirty(), `await render()`) in about 230 places, and a site that missed
// or reordered one made a change that could not be undone or was never saved.
//
// The old sites are being moved over a batch at a time. This counts the bare
// pushHistory() calls that are left and fails when there are MORE than
// tools/edit-ratchet.json allows, so new code cannot add to them. When a batch
// brings the count down, run it with --write to lower the bar.
//
//   node tools/edit-ratchet.mjs           check
//   node tools/edit-ratchet.mjs --write   record today's (lower) count
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// The editor as a browser gets it: edit.html with its parts inlined
// (tools/editor-source.cjs); a line is reported in the file a person edits.
const { assembled, loc } = createRequire(import.meta.url)('./editor-source.cjs');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = join(root, 'tools/edit-ratchet.json');

/** Lines that call pushHistory() themselves: not comments, not its own
 *  definition, and not the one call each inside changeDoc() and
 *  beginChange() (the step for a change that spans two events: a drag, a
 *  slider, crop mode). */
export function bareCalls(text) {
  const lines = text.split('\n');
  const out = [];
  let inChangeDoc = false;
  lines.forEach((l, i) => {
    if (/^(async function changeDoc|function beginChange)\(/.test(l)) inChangeDoc = true;
    else if (inChangeDoc && /^}/.test(l)) inChangeDoc = false;
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (/\bfunction pushHistory\(/.test(l) || inChangeDoc) return;
    const n = (l.replace(/\/\/.*$/, '').match(/\bpushHistory\(\)/g) || []).length;
    for (let k = 0; k < n; k++) out.push(i + 1);
  });
  return out;
}

let ED;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const calls = bareCalls((ED = assembled()).text);
  const allowed = JSON.parse(readFileSync(BASE, 'utf8')).pushHistory;
  if (process.argv.includes('--write')) {
    if (calls.length > allowed) {
      console.error(`edit-ratchet: ${calls.length} bare pushHistory() calls, more than the ${allowed} allowed; --write only lowers the bar.`);
      process.exit(1);
    }
    writeFileSync(BASE, JSON.stringify({ pushHistory: calls.length }, null, 2) + '\n');
    console.log(`edit-ratchet: bar set to ${calls.length} (was ${allowed}).`);
  } else if (calls.length > allowed) {
    console.error(`edit-ratchet: ${calls.length} bare pushHistory() calls in the editor (docsync/editor/edit.html and its parts); ${allowed} allowed.`);
    console.error('A change to the document goes through changeDoc(() => { ... }), which does the undo step,');
    console.error('the save mark and the redraw itself. Lines that call pushHistory() directly:');
    console.error('  ' + calls.map(n => loc(ED, n)).join(', '));
    process.exit(1);
  } else {
    console.log(`edit-ratchet: ${calls.length} bare pushHistory() calls (bar ${allowed})`
      + (calls.length < allowed ? '; run with --write to lower the bar.' : '.'));
  }
}
