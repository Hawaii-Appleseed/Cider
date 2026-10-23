/**
 * The Phase 0 gate.
 *
 *   node --test collab/
 *
 * Fails the collaboration plan if the file<->document bridge is not lossless
 * on real project data. Pure Node, no Playwright, no Pyodide — runs in under a
 * second, so it can gate every later phase cheaply.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  parseContent, serializeContent, parseLayout, serializeLayout,
  filesToDoc, docToFiles, slotKeys, readSlot, setSlotText, assertWellFormed,
} from './serialize.mjs';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/** Every project in this repo that has a content.md, plus the report2027 fixture. */
function projects() {
  const out = [];
  const pdir = join(REPO, 'projects');
  if (existsSync(pdir)) {
    for (const d of readdirSync(pdir).sort()) {
      if (existsSync(join(pdir, d, 'content.md'))) out.push({ id: d, dir: join(pdir, d) });
    }
  }
  if (existsSync(join(REPO, 'report2027', 'content.md'))) {
    out.push({ id: 'report2027', dir: join(REPO, 'report2027') });
  }
  return out;
}

const ALL = projects();

test('the repo has projects to test against', () => {
  assert.ok(ALL.length >= 5, `expected several projects, found ${ALL.length}`);
});

describe('content.md round-trips byte-identically', () => {
  for (const p of ALL) {
    test(p.id, () => {
      const raw = readFileSync(join(p.dir, 'content.md'), 'utf8');
      const out = serializeContent(parseContent(raw));
      if (out !== raw) {
        let i = 0;
        while (i < Math.min(out.length, raw.length) && out[i] === raw[i]) i++;
        assert.fail(
          `byte mismatch at offset ${i} (${raw.length}B in, ${out.length}B out)\n` +
          `  file: ${JSON.stringify(raw.slice(Math.max(0, i - 60), i + 60))}\n` +
          `  ours: ${JSON.stringify(out.slice(Math.max(0, i - 60), i + 60))}`);
      }
    });
  }
});

describe('layout.json round-trips without data loss', () => {
  for (const p of ALL) {
    const lp = join(p.dir, 'layout.json');
    if (!existsSync(lp)) continue;
    test(p.id, () => {
      const raw = readFileSync(lp, 'utf8');
      const obj = parseLayout(raw);
      // Semantic identity is the hard requirement.
      assert.deepEqual(parseLayout(serializeLayout(obj)), obj);
      // Byte identity holds only for files the editor itself last wrote;
      // Python's json.dump formats floats and short arrays differently.
      // Record which state each file is in rather than asserting one.
      const byteExact = serializeLayout(obj) === raw;
      if (!byteExact) {
        console.log(`      note: ${p.id}/layout.json was last written by Python ` +
                    `(reformats on first editor Save) — semantics preserved`);
      }
    });
  }
});

describe('filesToDoc / docToFiles', () => {
  for (const p of ALL) {
    const lp = join(p.dir, 'layout.json');
    if (!existsSync(lp)) continue;
    test(p.id, () => {
      const files = {
        content: readFileSync(join(p.dir, 'content.md'), 'utf8'),
        layout: readFileSync(lp, 'utf8'),
      };
      const back = docToFiles(filesToDoc(files));
      assert.equal(back.content, files.content, 'content.md must be byte-identical');
      assert.deepEqual(parseLayout(back.layout), parseLayout(files.layout));
    });
  }
});

describe('our slot keys match the renderer\'s parser (docsync/content.py)', () => {
  // content.py is the authority on what the build sees. If our block list and
  // its key list ever diverge, a collaborative edit could write a file the
  // renderer reads differently. Cross-check against the real thing.
  const py = `
import json, re, sys
sys.path.insert(0, ${JSON.stringify(REPO)})
from docsync.content import _strip_comments, _KEY_RE
text = _strip_comments(open(sys.argv[1]).read())
print(json.dumps([m.group(1) for m in _KEY_RE.finditer(text)]))
`;
  let havePython = true;
  try { execFileSync('python3', ['-c', 'import sys'], { stdio: 'ignore' }); }
  catch { havePython = false; }

  for (const p of ALL) {
    test(p.id, { skip: havePython ? false : 'python3 not available' }, () => {
      const theirs = JSON.parse(
        execFileSync('python3', ['-c', py, join(p.dir, 'content.md')], { encoding: 'utf8' }));
      const ours = slotKeys(parseContent(readFileSync(join(p.dir, 'content.md'), 'utf8')));
      assert.deepEqual(ours, theirs);
    });
  }
});

describe('a fully rewritten document still reads back through content.py', () => {
  // Identity round-trips only prove we can open and close a file. This proves
  // the WRITE path: rewrite every slot, serialize, and check the renderer's own
  // parser sees exactly the values we wrote. If this holds, a collaborative
  // edit cannot produce a file the build reads differently.
  const py = `
import json, sys, tempfile, pathlib
sys.path.insert(0, ${JSON.stringify(REPO)})
from docsync.content import parse_content
print(json.dumps(parse_content(pathlib.Path(sys.argv[1]))))
`;
  let havePython = true;
  try { execFileSync('python3', ['-c', 'import sys'], { stdio: 'ignore' }); }
  catch { havePython = false; }

  for (const p of ALL) {
    test(p.id, { skip: havePython ? false : 'python3 not available' }, () => {
      const raw = readFileSync(join(p.dir, 'content.md'), 'utf8');
      const doc = parseContent(raw);

      const want = new Map();
      let n = 0;
      for (const b of doc.blocks) {
        if (b.kind !== 'slot') continue;
        // [[sources]] has its own grammar (content.py parse_sources) and the
        // editor refuses a malformed line at the write; leave it alone.
        if (b.key === 'sources') { want.set(b.key, b.text); continue; }
        const v = `rewritten value ${n++} for ${b.key}`;
        assert.ok(setSlotText(doc, b.key, v), `no such slot [[${b.key}]]`);
        want.set(b.key, v);
      }
      assertWellFormed(doc);

      const tmp = join(REPO, `.collab-mutation-${p.id.replace(/\W/g, '_')}.md`);
      try {
        writeFileSync(tmp, serializeContent(doc));
        const got = JSON.parse(execFileSync('python3', ['-c', py, tmp], { encoding: 'utf8' }));
        // content.py strips comments and trims, so compare against the same.
        for (const [k, v] of want) {
          const expect = v.replace(/<!--[\s\S]*?-->/g, '').trim();
          assert.equal(got[k], expect, `slot [[${k}]] read back wrong`);
        }
        assert.deepEqual(Object.keys(got).sort(), [...want.keys()].sort());
      } finally {
        rmSync(tmp, { force: true });
      }
    });
  }
});

describe('editing a slot', () => {
  const sample = [
    '<!-- preamble -->\n',
    '\n',
    '[[a.one]]\n',
    'First value.\n',
    '\n',
    '[[a.two]]\n',
    'Second value, which is followed by a note.\n',
    '\n',
    '<!-- a note that documents the slots above -->\n',
    '\n',
    '[[sources]]\n',
    '[x]: A source — https://example.com\n',
  ].join('');

  test('parses into slots and a note', () => {
    const doc = parseContent(sample);
    assert.deepEqual(slotKeys(doc), ['a.one', 'a.two', 'sources']);
    assert.equal(doc.blocks.filter(b => b.kind === 'note').length, 1);
    assert.equal(readSlot(doc, 'a.one'), 'First value.');
    assert.equal(doc.preamble, '<!-- preamble -->\n\n');
  });

  test('round-trips', () => {
    assert.equal(serializeContent(parseContent(sample)), sample);
  });

  test('does NOT destroy a following comment (edit.html writeSlot does)', () => {
    const doc = parseContent(sample);
    const b = doc.blocks.find(x => x.kind === 'slot' && x.key === 'a.two');
    b.text = 'Rewritten by a collaborator.';
    const out = serializeContent(doc);
    assert.match(out, /<!-- a note that documents the slots above -->/);
    assert.match(out, /Rewritten by a collaborator\./);
    assert.doesNotMatch(out, /Second value/);
    // and the file is still parseable back to the same structure
    assert.deepEqual(slotKeys(parseContent(out)), ['a.one', 'a.two', 'sources']);
  });

  test('preserves each block\'s own separator width', () => {
    // tax-testimony has blocks separated by 1, 2 and 3 newlines. writeSlot()
    // normalizes all of them to 2; we must not.
    const odd = '[[a]]\nx\n[[b]]\ny\n\n\n[[c]]\nz\n';
    assert.equal(serializeContent(parseContent(odd)), odd);
  });
});

describe('refusals and edge cases', () => {
  test('duplicate keys are refused, as content.py does', () => {
    assert.throws(() => parseContent('[[a]]\n1\n\n[[a]]\n2\n'), /duplicate key/);
  });

  test('a file with no markers is all preamble and round-trips', () => {
    const t = 'no markers here\njust prose\n';
    const doc = parseContent(t);
    assert.deepEqual(doc.blocks, []);
    assert.equal(serializeContent(doc), t);
  });

  test('an empty slot round-trips', () => {
    const t = '[[a]]\n\n[[b]]\nvalue\n';
    const doc = parseContent(t);
    assert.equal(readSlot(doc, 'a'), '');
    assert.equal(serializeContent(doc), t);
  });

  test('writing into an empty slot does not swallow the next marker', () => {
    // The bug this suite caught on real data: rxkids, tax-testimony and
    // tfc-2027-priorities all carry `[[key]]\n\n\n[[next]]` empty slots. The
    // whitespace belongs to the separator, not to the slot's leading space.
    const t = '[[a]]\n\n\n[[b]]\nvalue\n';
    const doc = parseContent(t);
    assert.equal(serializeContent(doc), t, 'identity round-trip');
    setSlotText(doc, 'a', 'now it has text');
    assertWellFormed(doc);
    const out = serializeContent(doc);
    assert.deepEqual(slotKeys(parseContent(out)), ['a', 'b']);
    assert.equal(readSlot(parseContent(out), 'a'), 'now it has text');
    assert.equal(readSlot(parseContent(out), 'b'), 'value');
  });

  test('setSlotText on the last block adds no gratuitous separator', () => {
    const doc = parseContent('[[a]]\nx\n\n[[b]]\n');
    setSlotText(doc, 'b', 'tail');
    assert.equal(serializeContent(doc), '[[a]]\nx\n\n[[b]]\ntail');
    assertWellFormed(doc);
  });

  test('assertWellFormed catches a document assembled without separators', () => {
    // Not reachable from parseContent — every parsed non-final block carries
    // its newline in `gap`. This is the guard for a doc rebuilt from Y types
    // in Phase 2, where a lost `gap` field would silently merge two slots.
    const doc = { preamble: '', blocks: [
      { kind: 'slot', key: 'a', pad: '', lead: '', text: 'x', gap: '' },
      { kind: 'slot', key: 'b', pad: '', lead: '', text: 'y', gap: '\n' },
    ] };
    assert.equal(serializeContent(doc), '[[a]]\nx[[b]]\ny\n');
    assert.deepEqual(slotKeys(parseContent(serializeContent(doc))), ['a']);
    assert.throws(() => assertWellFormed(doc), /does not round-trip/);
  });

  test('setSlotText reports an unknown key instead of inventing one', () => {
    const doc = parseContent('[[a]]\nx\n');
    assert.equal(setSlotText(doc, 'nope', 'v'), false);
    assert.equal(serializeContent(doc), '[[a]]\nx\n');
  });

  test('a file with no trailing newline round-trips', () => {
    const t = '[[a]]\nvalue';
    assert.equal(serializeContent(parseContent(t)), t);
  });

  test('a marker with trailing spaces round-trips', () => {
    // content.py's _KEY_RE allows `\s*$` after the brackets.
    const t = '[[a]]  \nvalue\n';
    assert.equal(serializeContent(parseContent(t)), t);
  });

  test('[[key]] inside a slot body is not a marker', () => {
    const t = '[[a]]\nSee the [[b]] slot for more.\n\n[[b]]\nx\n';
    // A marker must start its own line; the reference above is mid-line.
    assert.deepEqual(slotKeys(parseContent(t)), ['a', 'b']);
    assert.equal(serializeContent(parseContent(t)), t);
  });

  test('layout: a non-object top level is refused', () => {
    assert.throws(() => parseLayout('[]'), /expected a JSON object/);
    assert.throws(() => parseLayout('null'), /expected a JSON object/);
  });

  test('layout: the writer matches edit.html byte for byte', () => {
    const o = { positions: {}, shapes: [], boxes: [], tables: {} };
    assert.equal(serializeLayout(o), JSON.stringify(o, null, 2) + '\n');
    assert.ok(serializeLayout(o).endsWith('}\n'));
  });
});

describe('mergeRestore: a restore as a per-slot diff', async () => {
  const { mergeRestore } = await import('./ydoc.mjs');
  const doc = (a, b) => `[[a]]\n${a}\n\n[[b]]\n${b}\n`;
  const lay = p => JSON.stringify({ positions: p, shapes: [], sections: {} });
  test('a slot the restore leaves alone keeps current words; a changed one takes the restored', () => {
    const m = mergeRestore(
      { content: doc('A0', 'B0'), layout: lay({ x: 1, y: 1 }) },
      { content: doc('A1', 'B0'), layout: lay({ x: 1, y: 1 }) },
      { content: doc('A0', 'B-typed'), layout: lay({ x: 1, y: 1 }) });
    assert.equal(m.content, doc('A1', 'B-typed'));
    assert.deepEqual(m.kept, ['b']); assert.deepEqual(m.taken, []);
  });
  test('unsaved words in a slot the restore changes are replaced and reported', () => {
    const m = mergeRestore(
      { content: doc('A0', 'B0'), layout: lay({}) }, { content: doc('A1', 'B0'), layout: lay({}) },
      { content: doc('A-typed', 'B0'), layout: lay({}) });
    assert.equal(m.content, doc('A1', 'B0')); assert.deepEqual(m.taken, ['a']);
  });
  test('a slot a colleague added since the saved version is reported as dropped', () => {
    const m = mergeRestore(
      { content: doc('A', 'B'), layout: lay({}) }, { content: doc('A', 'B'), layout: lay({}) },
      { content: doc('A', 'B') + '\n[[c]]\nnew\n', layout: lay({}) });
    assert.equal(m.content, doc('A', 'B')); assert.deepEqual(m.dropped, ['c']);
  });
  test('layout is merged key by key', () => {
    const m = mergeRestore(
      { content: doc('A', 'B'), layout: lay({ p: { x: 1 }, q: { x: 1 } }) },
      { content: doc('A', 'B'), layout: lay({ p: { x: 9 }, q: { x: 1 } }) },
      { content: doc('A', 'B'), layout: lay({ p: { x: 1 }, q: { x: 5 } }) });
    assert.deepEqual(m.layout.positions, { p: { x: 9 }, q: { x: 5 } });
  });
});
