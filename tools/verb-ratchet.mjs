#!/usr/bin/env node
// One code path per action: when the editor's own UI (a menu row, a panel
// button, a dialog) makes an edit a pilot verb already makes, it calls the
// verb through uiVerb() in docsync/editor/edit.html, not the verb's core
// function inside its own changeDoc(). The verb validates first, refuses
// with words instead of leaving an empty undo step, and puts the document
// back when the engine will not build the result; the UI's own copy did
// none of that (docs/ui-pilot-verbs.md has the inventory).
//
// This counts the calls to a verb's core that are left outside the pilot
// section (between `// pilot verbs: begin` and `// pilot verbs: end`) and
// outside the cores themselves, and fails when there are MORE than
// tools/verb-ratchet.json allows. When a batch of sites moves over, run it
// with --write to lower the bar.
//
//   node tools/verb-ratchet.mjs           check
//   node tools/verb-ratchet.mjs --list    every call left, by core
//   node tools/verb-ratchet.mjs --write   record today's (lower) count
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'docsync/editor/edit.html');
const BASE = join(root, 'tools/verb-ratchet.json');

/** The verb each core belongs to. A core is the function a verb's apply
 *  calls to make the edit, which a UI site could call directly instead. Only
 *  cores whose verb does the SAME edit as the UI are listed: a verb with
 *  more or different steps (setStyle over the type toolbar, place over a
 *  drag) is in docs/ui-pilot-verbs.md under what is left alone. */
export const CORES = {
  replaceColour: 'replaceColour',
  nameAllColours: 'nameAllColours',
  deleteUnusedStyles: 'dropUnusedStyles',
  duplicateStyle: 'duplicateStyle',
  setSlotNotes: 'setNotes',
  setPageSection: 'setPageSection',
  setReadingOrder: 'setReadingOrder',
  setDefaultStyle: 'setDefaultStyle',
  clearOverrides: 'clearOverrides',
  stepRepeatIds: 'stepRepeat',
  relinkSource: 'relink',
  changeLink: 'changeLink',
  linkBareUrls: 'linkBareUrls',
  replaceFont: 'replaceFont',
  _defineLayer: 'defineLayer',
  _toLayer: 'toLayer',
  _dropLayer: 'dropLayer',
  _mergeLayers: 'mergeLayers',
  _dropUnusedLayers: 'dropUnusedLayers',
  masterOverride: 'masterOverride',
  textToTable: 'textToTable',
  tableToText: 'tableToText',
  clearTransforms: 'clearTransforms',
  _pathfinderApply: 'pathfinder',
  _releaseApply: 'release',
  _pasteIntoApply: 'pasteInto',
  _shapeImageApply: 'shapeImage',
  _unthreadApply: 'unthread',
  _threadApply: 'thread',
  tableMerge: 'mergeCells',
  tableUnmerge: 'unmergeCells',
  tableSplit: 'splitCell',
  applyCellStyle: 'cellStyle',
  defineCellStyle: 'defineCellStyle',
  tableInsertRow: 'tableRow',
  tableDeleteRow: 'tableRow',
  tableMoveRow: 'tableRow',
  tableDistributeRows: 'tableRow',
  tableInsertCol: 'tableCol',
  tableDeleteCol: 'tableCol',
  tableMoveCol: 'tableCol',
  tableFitColumns: 'tableCol',
};

const esc = s => s.replace(/[$]/g, '\\$');

/** Lines that call a core outside the pilot section and outside any core's
 *  own body (a core may build on another: tableSplit unmerges first). */
export function bypasses(text) {
  const lines = text.split('\n');
  const names = Object.keys(CORES);
  const call = new RegExp(`(?<![\\w$.])(${names.map(esc).join('|')})\\s*\\(`, 'g');
  const def = new RegExp(`^(?:async\\s+)?function\\s+(${names.map(esc).join('|')})\\s*\\(`);
  const out = [];
  let inPilot = false, inCore = false;
  lines.forEach((l, i) => {
    if (/^\s*\/\/ pilot verbs: begin\b/.test(l)) { inPilot = true; return; }
    if (/^\s*\/\/ pilot verbs: end\b/.test(l)) { inPilot = false; return; }
    if (def.test(l)) { inCore = true; return; }
    if (inCore) { if (/^}/.test(l)) inCore = false; return; }
    if (inPilot) return;
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    for (const m of l.replace(/\/\/.*$/, '').matchAll(call)) out.push({ line: i + 1, core: m[1], verb: CORES[m[1]] });
  });
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = readFileSync(SRC, 'utf8');
  if (!/\/\/ pilot verbs: begin\b/.test(text) || !/\/\/ pilot verbs: end\b/.test(text)) {
    console.error('verb-ratchet: the `// pilot verbs: begin` / `// pilot verbs: end` markers are missing from docsync/editor/edit.html.');
    process.exit(1);
  }
  const left = bypasses(text);
  const allowed = JSON.parse(readFileSync(BASE, 'utf8')).bypasses;
  if (process.argv.includes('--list')) {
    for (const b of left) console.log(`${b.line}\t${b.core}\t(verb ${b.verb})`);
  }
  if (process.argv.includes('--write')) {
    if (left.length > allowed) {
      console.error(`verb-ratchet: ${left.length} UI calls to a verb's core, more than the ${allowed} allowed; --write only lowers the bar.`);
      process.exit(1);
    }
    writeFileSync(BASE, JSON.stringify({ bypasses: left.length }, null, 2) + '\n');
    console.log(`verb-ratchet: bar set to ${left.length} (was ${allowed}).`);
  } else if (left.length > allowed) {
    console.error(`verb-ratchet: ${left.length} UI calls to a pilot verb's core in docsync/editor/edit.html; ${allowed} allowed.`);
    console.error('An edit a pilot verb already makes goes through uiVerb(verb, ...args), which validates,');
    console.error('refuses with words, and rolls back what the engine will not build. Calls left:');
    for (const b of left) console.error(`  ${b.line}: ${b.core}() — uiVerb('${b.verb}', …)`);
    process.exit(1);
  } else {
    console.log(`verb-ratchet: ${left.length} UI calls to a verb's core (bar ${allowed})`
      + (left.length < allowed ? '; run with --write to lower the bar.' : '.'));
  }
}
