// The slot marker, read the same way on both sides (docsync/editor/edit.html's
// slotRe / writeSlot, against content.py's _KEY_RE).
//
// content.py accepts `[[key]]` followed by any trailing whitespace, CRLF
// included. The editor's slotRe demanded `]]` then a bare \n — so one stray
// space after the brackets (a Doc import, a hand edit) and it matched nothing,
// writeSlot took its "this slot does not exist yet" branch, and a SECOND
// `[[key]]` block was appended to the file. parse_content then refused the
// whole document for a duplicate key: the draft stopped building on the first
// edit to that slot, and the cause was a space nobody could see.
//
// The other half: a line that is nothing but `[[something]]` is a marker
// wherever it sits, so pasting one into a paragraph split the slot in two.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const DOC = tail => `[[a.b]]${tail}Words.\n\n[[sources]]\n[x]: A. — https://a.gov\n`;

test.describe('slot markers', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  for (const [name, tail] of [['a bare newline', '\n'],
                              ['a trailing space', ' \n'],
                              ['a trailing tab', '\t\n'],
                              ['a CRLF ending', '\r\n']]) {
    test(`a marker ending in ${name} is edited in place, not duplicated`,
      async ({ page }) => {
        const out = await page.evaluate(doc => {
          source = doc;
          writeSlot('a.b', 'Rewritten.');
          return source;
        }, DOC(tail));

        // One marker, still — the whole point. A second one is a duplicate
        // key, which refuses the entire document at the next build.
        expect(out.match(/\[\[a\.b\]\]/g)).toHaveLength(1);
        expect(out).toContain('Rewritten.');
        expect(out).not.toContain('Words.');
        // and the sources block is untouched where it always was
        expect(out).toContain('[x]: A. — https://a.gov');
      });
  }

  test('reading a slot works through the same tolerance', async ({ page }) => {
    const read = await page.evaluate(doc => {
      source = doc;
      return readSlot('a.b');
    }, DOC(' \n'));
    expect(read).toBe('Words.');
  });

  test('a line that is only [[key]] is refused, not written into the slot',
    async ({ page }) => {
      const res = await page.evaluate(doc => {
        source = doc;
        writeSlot('a.b', 'Before.\n\n[[sources]]\n\nAfter.');
        return { source, stat: document.getElementById('stat').textContent };
      }, DOC('\n'));

      // Nothing saved: written through, that pasted line would have become a
      // SECOND [[sources]] marker and refused the whole file.
      expect(res.source).toBe(DOC('\n'));
      expect(res.stat).toContain('slot marker');
    });

  test('the same brackets INSIDE a line are ordinary words', async ({ page }) => {
    const out = await page.evaluate(doc => {
      source = doc;
      writeSlot('a.b', 'The marker [[cover.title]] names the cover.');
      return source;
    }, DOC('\n'));
    expect(out).toContain('The marker [[cover.title]] names the cover.');
  });

  test('an editorial note in a block is hidden from the editor and kept in the file',
    async ({ page }) => {
      // content.py strips every HTML comment before it looks for slots, so a
      // note inside a block never reaches the page. It used to reach the
      // editor as text: the author opened a heading and found somebody's
      // editorial note in it, and committing wrote the note back as words.
      const WITH_NOTE = '[[a.b]]\nWords.\n\n<!--\n  A note to whoever edits this.\n-->'
        + '\n\n[[sources]]\n[x]: A. — https://a.gov\n';

      const read = await page.evaluate(doc => {
        source = doc;
        return readSlot('a.b');
      }, WITH_NOTE);
      expect(read).toBe('Words.');

      const out = await page.evaluate(doc => {
        source = doc;
        writeSlot('a.b', 'Rewritten.');
        return source;
      }, WITH_NOTE);
      expect(out).toContain('Rewritten.');
      expect(out).toContain('A note to whoever edits this.');   // kept
      expect(out).not.toContain('Words.');
      // ...and still one note, not two: read strips them, write puts back the
      // ones the file already had, so a read-modify-write cannot double them.
      expect(out.match(/<!--/g)).toHaveLength(1);
    });
});
