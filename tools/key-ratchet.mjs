#!/usr/bin/env node
// The editor's keyboard shortcuts have one owner: `keymap` in
// docsync/editor/edit.html, one pair of listeners per document (the chrome,
// and the report's iframe) and a table of bindings that says, for each, its
// scope (popup, text, global: the order they run in), whether it runs while
// a key is going into a field, and which document it hears. Before it, about
// forty listeners each decided that for themselves, and two could act on one
// key.
//
// This counts the keydown/keyup/keypress listeners added outside the keymap
// and fails when there are MORE than tools/key-ratchet.json allows. What is
// left is a listener on ONE element owned by one popup or one open field
// (its own Enter and Escape). When a change brings the count down, run it
// with --write to lower the bar.
//
//   node tools/key-ratchet.mjs           check
//   node tools/key-ratchet.mjs --write   record today's (lower) count
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// The editor as a browser gets it: edit.html with its parts inlined
// (tools/editor-source.cjs); a line is reported in the file a person edits.
const { assembled, loc } = createRequire(import.meta.url)('./editor-source.cjs');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = join(root, 'tools/key-ratchet.json');

const LISTEN = /\baddEventListener\(\s*['"`](?:keydown|keyup|keypress)['"`]/g;
const ONKEY = /\.onkey(?:down|up|press)\s*=(?!=)/g;

/** Lines that add a key listener themselves: not comments, and not inside
 *  the owner (from `const keymap = (() => {` to its closing `})();`). */
export function keyListeners(text) {
  const out = [];
  let inOwner = false;
  text.split('\n').forEach((l, i) => {
    if (/^const keymap = \(\(\) => \{/.test(l)) inOwner = true;
    if (inOwner) { if (/^\}\)\(\);/.test(l)) inOwner = false; return; }
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    const code = l.replace(/\/\/.*$/, '');
    const n = (code.match(LISTEN) || []).length + (code.match(ONKEY) || []).length;
    for (let k = 0; k < n; k++) out.push(i + 1);
  });
  return out;
}

let ED;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = keyListeners((ED = assembled()).text);
  const allowed = JSON.parse(readFileSync(BASE, 'utf8')).keyListeners;
  if (process.argv.includes('--write')) {
    if (found.length > allowed) {
      console.error(`key-ratchet: ${found.length} key listeners outside the keymap, more than the ${allowed} allowed; --write only lowers the bar.`);
      process.exit(1);
    }
    writeFileSync(BASE, JSON.stringify({ keyListeners: found.length }, null, 2) + '\n');
    console.log(`key-ratchet: bar set to ${found.length} (was ${allowed}).`);
  } else if (found.length > allowed) {
    console.error(`key-ratchet: ${found.length} key listeners outside the keymap in the editor (docsync/editor/edit.html and its parts); ${allowed} allowed.`);
    console.error('A shortcut is a binding: keymap.bind((e, d) => …, { scope, inText, when, doc, phase, type }).');
    console.error('Lines that add a key listener themselves:');
    console.error('  ' + found.map(n => loc(ED, n)).join(', '));
    process.exit(1);
  } else {
    console.log(`key-ratchet: ${found.length} key listeners outside the keymap (bar ${allowed})`
      + (found.length < allowed ? '; run with --write to lower the bar.' : '.'));
  }
}
