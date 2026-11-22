#!/usr/bin/env node
// The editor's status line (#stat) has one owner: tell() in
// docsync/editor/edit.html, which sets the words, the tooltip, the red look,
// a colour flash and the timers that undo them, and decides which message
// wins when two arrive close together (an error is not wiped by a routine
// line a moment later). Before it, about 400 places wrote the element
// themselves and whichever ran last won.
//
// This counts the direct writes to #stat left outside the owner — its words
// (textContent/innerHTML), tooltip (title), look (classList, style), and any
// `const x = $('stat')` alias, which hides writes from the count — and fails
// when there are MORE than tools/status-ratchet.json allows. Reading the
// element, and its dataset flags, are not writes to the line. When a change
// brings the count down, run it with --write to lower the bar.
//
//   node tools/status-ratchet.mjs           check
//   node tools/status-ratchet.mjs --write   record today's (lower) count
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'docsync/editor/edit.html');
const BASE = join(root, 'tools/status-ratchet.json');

const EL = String.raw`\$\(\s*['"]stat['"]\s*\)|document\.getElementById\(\s*['"]stat['"]\s*\)`;
const WRITE = new RegExp(String.raw`(?:${EL})\s*\.\s*(?:(?:textContent|innerHTML|innerText|title)\s*\+?=(?!=)|classList\s*\.\s*(?:add|remove|toggle|replace)\b|className\s*=(?!=)|style\b)`, 'g');
const ALIAS = new RegExp(String.raw`\b(?:const|let|var)\s+[\w$]+\s*=\s*(?:${EL})\s*[;,\n]`, 'g');

/** Lines that write #stat themselves: not comments, and not inside the
 *  owner (tell/sayHeld/untell, from `var STAT_HOLD_MS` through the end of
 *  watchStat, which keeps the "Live" look in step with the words). */
export function directWrites(text) {
  const lines = text.split('\n');
  const out = [];
  let inOwner = false, ownerEnds = false;
  lines.forEach((l, i) => {
    if (/^var STAT_HOLD_MS\b/.test(l)) inOwner = true;
    if (inOwner) {
      if (/^\(function watchStat\(\)/.test(l)) ownerEnds = true;
      if (ownerEnds && /^}\)\(\);/.test(l)) { inOwner = false; ownerEnds = false; }
      return;
    }
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    const code = l.replace(/\/\/.*$/, '');
    const n = (code.match(WRITE) || []).length + (code.match(ALIAS) || []).length;
    for (let k = 0; k < n; k++) out.push(i + 1);
  });
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const writes = directWrites(readFileSync(SRC, 'utf8'));
  const allowed = JSON.parse(readFileSync(BASE, 'utf8')).statWrites;
  if (process.argv.includes('--write')) {
    if (writes.length > allowed) {
      console.error(`status-ratchet: ${writes.length} direct status-line writes, more than the ${allowed} allowed; --write only lowers the bar.`);
      process.exit(1);
    }
    writeFileSync(BASE, JSON.stringify({ statWrites: writes.length }, null, 2) + '\n');
    console.log(`status-ratchet: bar set to ${writes.length} (was ${allowed}).`);
  } else if (writes.length > allowed) {
    console.error(`status-ratchet: ${writes.length} direct writes to #stat in docsync/editor/edit.html; ${allowed} allowed.`);
    console.error('The status line is said through tell(text, { kind, title, ms, sticky, keep, flash, click }),');
    console.error('which owns its words, look and timers. Lines that write #stat directly:');
    console.error('  ' + writes.join(', '));
    process.exit(1);
  } else {
    console.log(`status-ratchet: ${writes.length} direct status-line writes (bar ${allowed})`
      + (writes.length < allowed ? '; run with --write to lower the bar.' : '.'));
  }
}
