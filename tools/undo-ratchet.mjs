#!/usr/bin/env node
// The editor keeps ONE undo history (`history` in docsync/editor/edit.html)
// with two backends behind it: snapshot stacks when editing alone, the shared
// document's Y.UndoManager in a session. They live between the markers
//   // history backends: begin   …   // history backends: end
// and nothing outside them should know which one is running. Before this, the
// two paths were forked by hand at every use (`collab ? collab.canUndo() :
// past.length`), and the forks disagreed: a refused action cost the redo list
// alone but not in a session; a rolled-back pilot batch left an empty undo
// step in a session but not alone.
//
// This counts the lines OUTSIDE the backends that still reach into either
// one, and fails when there are more than tools/undo-ratchet.json allows:
//   - the session's undo internals: collab.mark / undo / redo / canUndo /
//     canRedo / undoManager / forgetHistory, collabSteps, collabStepBefore;
//   - the local stacks: past.* / future.* (length, push, pop, shift),
//     stepTimes.*;
//   - a `collab` test (`if (collab`, `if (!collab`, `collab ?`, `collab &&`,
//     `!collab ||`) inside a function whose name says undo, redo or history.
//
//   node tools/undo-ratchet.mjs           check
//   node tools/undo-ratchet.mjs --write   record today's (lower) count
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'docsync/editor/edit.html');
const BASE = join(root, 'tools/undo-ratchet.json');

const INTERNALS = /\bcollab\.(mark|undo|redo|canUndo|canRedo|undoManager|forgetHistory)\b|\b(past|future)\.(length|push|pop|shift)\b|\bstepTimes\.|\bcollabStepBefore\b|\bcollabSteps\b/;
const COLLAB_TEST = /\bif \(!?collab\b|\bcollab \?|\bcollab &&|!collab \|\|/;
const UNDO_FN = /undo|redo|history|withdraw|step/i;

/** [{line, text}] for every reach-in outside the backends. */
export function reachIns(text) {
  const out = [];
  let inBackends = false, fn = '';
  text.split('\n').forEach((l, i) => {
    if (/\/\/ history backends: begin/.test(l)) { inBackends = true; return; }
    if (/\/\/ history backends: end/.test(l)) { inBackends = false; return; }
    const m = l.match(/^(?:async )?function\*? ?([\w$]+)\(/);
    if (m) fn = m[1]; else if (/^}/.test(l)) fn = '';
    if (inBackends) return;
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    const code = l.replace(/\/\/.*$/, '');
    if (INTERNALS.test(code) || (fn && UNDO_FN.test(fn) && COLLAB_TEST.test(code))) out.push({ line: i + 1, text: t });
  });
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = reachIns(readFileSync(SRC, 'utf8'));
  const allowed = JSON.parse(readFileSync(BASE, 'utf8')).reachIns;
  if (process.argv.includes('--write')) {
    if (found.length > allowed) {
      console.error(`undo-ratchet: ${found.length} reach-ins, more than the ${allowed} allowed; --write only lowers the bar.`);
      process.exit(1);
    }
    writeFileSync(BASE, JSON.stringify({ reachIns: found.length }, null, 2) + '\n');
    console.log(`undo-ratchet: bar set to ${found.length} (was ${allowed}).`);
  } else if (found.length > allowed) {
    console.error(`undo-ratchet: ${found.length} lines in docsync/editor/edit.html reach into an undo backend; ${allowed} allowed.`);
    console.error('Undo goes through `history` (open, withdraw, undo, redo, canUndo, canRedo, steps, clear…),');
    console.error('which works the same alone and in a shared session. Lines that reach past it:');
    for (const f of found) console.error(`  ${f.line}: ${f.text.slice(0, 120)}`);
    process.exit(1);
  } else {
    console.log(`undo-ratchet: ${found.length} reach-ins outside the history backends (bar ${allowed})`
      + (found.length < allowed ? '; run with --write to lower the bar.' : '.'));
  }
}
