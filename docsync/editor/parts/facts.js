// ------------------------------------------------------------ fact ledger
// The figures Hawaiʻi Appleseed stands behind, one place (docsync/ledger.py).
// A slot or box says {fact:<id>} (optionally @<date> to pin, |<format> to
// write it another way); the engine writes the number in at build, so the
// published page carries plain words. Here the editor only needs to SHOW a
// token as a chip, offer the ledger in Insert fact, and say in Preflight when
// a fact is unknown, unconfirmed, or changed since someone last reviewed it.
//
// The ledger's files are staged with the engine (stage.ledger_files), one per
// issue area; ledgerAdopt() reads them whenever the engine files load.
let LEDGER = { areas: {}, facts: {} };
const LEDGER_URL = 'engine/docsync/ledger/';
const FACT_TOKEN_RE = /\{fact:([a-z0-9][a-z0-9-]{0,63})(?:@(\d{4}(?:-\d{2}(?:-\d{2})?)?))?(?:\|([A-Za-z$%0-9]{1,12}))?\}/g;
// ledger.py's AREAS, in the hub's order (the issue_brief keys).
const LEDGER_AREAS = [['tax-and-budget', 'Taxes & Budget'], ['housing', 'Affordable Housing'],
  ['food-equity', 'Food Equity'], ['labor', 'Wages & Labor'], ['transportation', 'Transportation Equity'],
  ['public-health', 'Public Health'], ['education', 'Education'], ['social-justice', 'Social Justice'],
  ['criminal-justice', 'Criminal Justice'], ['native-hawaiian', 'Native Hawaiian Equity']];

function ledgerAdopt(urls, datas) {
  const facts = {};
  urls.forEach((u, i) => {
    if (!u.startsWith(LEDGER_URL) || !u.endsWith('.json')) return;
    try {
      const raw = typeof datas[i] === 'string' ? datas[i] : new TextDecoder().decode(datas[i]);
      const area = JSON.parse(raw);
      (area.facts || []).forEach(f => { facts[f.id] = { ...f, area: area.area }; });
    } catch (e) { swallowed('ledger file ' + u, e); }
  });
  LEDGER = { areas: Object.fromEntries(LEDGER_AREAS), facts };
}

// ledger.py's FORMATS, for the chip's preview only — the engine writes the
// words that are published.
const fmtG = v => Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 10 }) : String(+v.toPrecision(10));
const fmtMoney = (v, div, digits, word) => {
  let s = (v / div).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (digits && s.endsWith('.' + '0'.repeat(digits))) s = s.slice(0, -(digits + 1));
  return `$${s}${word}`;
};
const FACT_FORMATS = {
  pct: [v => fmtG(v) + '%', 'pct'], percent: [v => fmtG(v) + ' percent', 'pct'],
  n: [v => Math.round(v).toLocaleString('en-US'), 'count'],
  $M: [v => fmtMoney(v, 1e6, 0, 'M'), 'usd'], $M1: [v => fmtMoney(v, 1e6, 1, 'M'), 'usd'],
  $million: [v => fmtMoney(v, 1e6, 1, ' million'), 'usd'], $billion: [v => fmtMoney(v, 1e9, 1, ' billion'), 'usd'],
};
const FACT_DEFAULT_FMT = { pct: 'percent', usd: '$million', count: 'n' };

/** The ledger entry in force on `date` (ledger.value_on's twin). */
function factEntryOn(f, date) {
  if (!date || !f.since || date >= f.since) return f;
  const hist = [...(f.history || [])].sort((a, b) => (a.since || '').localeCompare(b.since || ''));
  for (let i = hist.length - 1; i >= 0; i--) if ((hist[i].since || '') <= date) return hist[i];
  return hist[0] || f;
}
/** {text, error} for one token's parts. */
function factWords(id, date, fmt) {
  const f = LEDGER.facts[id];
  if (!f) return { error: `no fact "${id}" in the ledger` };
  const e = factEntryOn(f, date);
  if (!fmt && e.shown) return { text: e.shown, f };
  const k = fmt || FACT_DEFAULT_FMT[f.unit];
  const spec = FACT_FORMATS[k];
  if (!spec) return { error: `no format "${fmt}"`, f };
  if (spec[1] !== f.unit) return { error: `${fmt} is for ${spec[1]} figures; this one is ${f.unit}`, f };
  return { text: spec[0](Number(e.value)), f };
}
/** A chip's name is everything inside the braces: fact:<id>[@date][|fmt]. */
function factParts(name) {
  const m = ('{' + name + '}').match(new RegExp(FACT_TOKEN_RE.source));
  return m ? { id: m[1], date: m[2] || null, fmt: m[3] || null } : null;
}
function factChipLabel(name) {
  const p = factParts(name);
  if (!p) return name;
  const w = factWords(p.id, p.date, p.fmt);
  return w.error ? `⚠ ${p.id}` : `ⓕ ${w.text}${p.date ? ' · ' + p.date : ''}`;
}
function factChipTitle(name) {
  const p = factParts(name);
  const f = p && LEDGER.facts[p.id];
  if (!f) return `{${name}} — not in the ledger`;
  return `${f.says}\n${f.source || ''}${f.as_of ? ' · ' + f.as_of : ''}\n`
    + `${f.status === 'confirmed' ? 'Confirmed' : 'Proposed — not yet checked against its source'}`
    + `${p.date ? `\nPinned to ${p.date}: keeps the value it had then` : ''}`;
}

/** Testimony keeps what it said: its facts go in pinned to today. */
const factPinsByDefault = () => /testimony/i.test(M.id || '') || /testimony/i.test(M.name || '');
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Insert fact ▸ — the ledger, issue area by issue area. */
function buildFactRows(d, m, host, range) {
  const ids = Object.keys(LEDGER.facts);
  if (!ids.length) return;
  submenuRow(d, m, 'Insert fact ▸', sub => {
    const pin = factPinsByDefault();
    LEDGER_AREAS.forEach(([area, areaName]) => {
      const mine = ids.filter(id => LEDGER.facts[id].area === area)
        .sort((a, b) => LEDGER.facts[a].says.localeCompare(LEDGER.facts[b].says));
      if (!mine.length) return;
      const h = d.createElement('div');
      h.className = 'ds-menu-head';
      h.textContent = areaName;
      sub.appendChild(h);
      mine.forEach(id => {
        const f = LEDGER.facts[id];
        const b = d.createElement('button');
        b.dataset.fact = id;
        b.textContent = `${f.shown || f.value} — ${f.says.length > 60 ? f.says.slice(0, 59) + '…' : f.says}`
          + (f.status === 'confirmed' ? '' : ' (proposed)');
        b.title = `${f.source || ''}${f.as_of ? ' · ' + f.as_of : ''}`;
        b.addEventListener('click', async () => {
          closeMenu(d);
          const name = `fact:${id}${pin ? '@' + todayIso() : ''}`;
          await insertNodeAt(d, host, range, makeVarChip(d, name));
          factsSeenRecord([id]);
        });
        sub.appendChild(b);
      });
    });
    if (pin) {
      const n = d.createElement('div');
      n.className = 'ds-menu-head';
      n.textContent = 'Testimony: pinned to today';
      sub.appendChild(n);
    }
  });
}

/** The Insert palette's fact row: a text box holding the fact (pinned to
 *  today in testimony), placed as any new text box is. */
const addFactBox = id => addTextBox('plain', `{fact:${id}${factPinsByDefault() ? '@' + todayIso() : ''}}`);

/** Every fact token in the document: {id, date, fmt, where}. */
function factUses() {
  const out = [];
  let key = null;
  String(source || '').split('\n').forEach(line => {
    const k = line.match(/^\[\[([^\]]+)\]\]\s*$/);
    if (k) { key = k[1]; return; }
    for (const m of line.matchAll(FACT_TOKEN_RE)) out.push({ id: m[1], date: m[2] || null, fmt: m[3] || null, where: key });
  });
  const walk = (v, where) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(FACT_TOKEN_RE)) out.push({ id: m[1], date: m[2] || null, fmt: m[3] || null, where });
    } else if (Array.isArray(v)) v.forEach(x => walk(x, where));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, v.id || where || k));
  };
  walk(layout, null);
  return out;
}

/** What the report last agreed each fact said: layout.factsSeen[id]. Written
 *  when a fact goes in and when someone marks a change reviewed. */
function factsSeenRecord(ids) {
  const seen = { ...(layout.factsSeen || {}) };
  let moved = false;
  ids.forEach(id => {
    const f = LEDGER.facts[id];
    if (f && seen[id] !== Number(f.value)) { seen[id] = Number(f.value); moved = true; }
  });
  if (!moved) return;
  return changeDoc(() => { layout.factsSeen = seen; }, { render: false });
}

/** The baseline for every fact the document points at and has none for: the
 *  ledger's value now. Run inside every change the document takes
 *  (changeDoc, beginChange's commit), so a token that went in any other way
 *  than Insert fact (typed, pasted, a pilot setSlot from the hub connector,
 *  the headless editor) is recorded in the same step and saved with it, and
 *  fact-changed can fire for it later. A token already in the document with
 *  no baseline gets one with the next edit of any kind; nothing is written
 *  just because a report was opened. Not run by undo, redo or a collaborator's
 *  change arriving: those are not new edits, and a write there would cost the
 *  redo stack. Pinned tokens need none (they never follow the ledger), and an
 *  id the ledger lacks has nothing to record. Mutates `layout`; true when it
 *  added anything. */
function factsSeenFill() {
  if (!Object.keys(LEDGER.facts).length) return false;
  if (!String(source || '').includes('{fact:') && !JSON.stringify(layout || {}).includes('{fact:')) return false;
  const seen = layout.factsSeen || {};
  const add = {};
  factUses().forEach(u => {
    const f = LEDGER.facts[u.id];
    if (!u.date && f && seen[u.id] == null && add[u.id] == null) add[u.id] = Number(f.value);
  });
  if (!Object.keys(add).length) return false;
  layout.factsSeen = { ...seen, ...add };
  return true;
}

/** Preflight's fact rows: unknown (error), proposed, and changed since the
 *  report last reviewed it — the draft already says the new number. */
function factIssues() {
  const issues = [];
  const seen = layout.factsSeen || {};
  const by = new Map();
  factUses().forEach(u => {
    const k = u.id + '|' + (u.date || '') + '|' + (u.fmt || '');
    if (!by.has(k)) by.set(k, { ...u, wheres: new Set() });
    if (u.where) by.get(k).wheres.add(u.where);
  });
  const said = new Set();
  by.forEach(u => {
    const ids = [...u.wheres];
    const w = factWords(u.id, u.date, u.fmt);
    if (w.error) { issues.push({ kind: 'fact-unknown', ids, note: `{fact:${u.id}…}: ${w.error}` }); return; }
    if (said.has(u.id)) return;
    said.add(u.id);
    const f = w.f;
    if (f.status !== 'confirmed') issues.push({ kind: 'fact-proposed', ids, fact: u.id,
      note: `${f.shown || f.value} (${f.says}) is not yet checked against its source` });
    if (!u.date && seen[u.id] != null && Number(seen[u.id]) !== Number(f.value)) {
      const was = (f.history || []).find(h => Number(h.value) === Number(seen[u.id]));
      issues.push({ kind: 'fact-changed', ids, fact: u.id,
        note: `the ledger changed: ${was && was.shown ? was.shown : seen[u.id]} → ${f.shown || f.value}. `
          + 'This draft now says the new number; republish to update the published copy' });
    }
  });
  return issues;
}

// ------------------------------------------------- a ledgered figure, typed
// docsync/facts.py's check, cut to the question Preflight asks of each slot
// and text box: does a sentence state a ledgered fact (its `match`, not its
// `unless`) with a typed number of the same kind, and not through a token?
// The hub connector asks the same of a slot (the hub's assets/factledger.js
// typedFacts); this is its twin. When the number is the ledger's, Preflight
// offers Link: the token in its place, so it follows the ledger from then on.
// When it is not, it says so and leaves the choice to a person.
//
// Words that are not ours to change are left out: anything in quotation
// marks, a blockquote, and a line that ends by attributing itself to someone
// (`— [Name, …](link)`), as testimony summaries do. Their numbers are what
// that person said, whatever the ledger says now.
const FT_SCALE = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, K: 1e3, M: 1e6, B: 1e9 };
const FT_NUM = /(?<![\w.#§/-])(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(%|percent\b|per\s?cent\b)|\s(thousand|million|billion|trillion)\b|([KMB])\b)?/g;
const FT_SENT = /(?<=[.!?;])\s+(?=[*_]*[A-Z"“(])|\n{2,}|\n(?=\s*[-*•]\s)/;
const FT_ATTRIBUTED = /[—–-]\s*\[[^\]]+\]\([^)]+\)\s*$/;

function typedNumbers(sentence) {
  const plain = sentence.replace(/\[\^[^\]\s]+\]/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>|]+/g, ' ');
  const quoted = [...plain.matchAll(/“[^”]*”|"[^"]*"/g)].map(m => [m.index, m.index + m[0].length]);
  const out = [];
  for (const m of plain.matchAll(FT_NUM)) {
    if (quoted.some(([a, b]) => m.index > a && m.index < b)) continue;
    const [whole, dollar, digits, frac, pct, word, letter] = m;
    const before = plain.slice(Math.max(0, m.index - 16), m.index);
    if (/\b(?:HB|SB|Act|Section|Table|Figure|page|No\.?|FY|TY|tax year)\s*$/i.test(before)) continue;
    const sc = FT_SCALE[word ? word.toLowerCase() : letter || ''] || 1;
    const v = Number(digits.replace(/,/g, '') + (frac || '')) * sc;
    const unit = pct ? 'pct' : dollar ? 'usd' : 'count';
    if (unit === 'count' && (v < 100 || (v >= 1900 && v <= 2100 && !digits.includes(',')))) continue;
    out.push({ shown: whole.trim(), value: v, unit, step: (frac ? 10 ** -frac.length : 1) * sc });
  }
  return out;
}
const ftAgrees = (n, v) => Math.abs(n.value - v) <= n.step / 2 + 1e-9;

/** [{fact, typed, ledger, agrees, earlier, sentence}] for one piece of text. */
function typedFacts(text) {
  const out = [];
  const md = String(text || '');
  if (!md.trim() || !Object.keys(LEDGER.facts).length) return out;
  for (const sentence of md.split(FT_SENT)) {
    const line = sentence.trim();
    if (!line || /^>/.test(line) || FT_ATTRIBUTED.test(line)) continue;
    const linked = new Set([...line.matchAll(FACT_TOKEN_RE)].map(m => m[1]));
    const bare = line.replace(FACT_TOKEN_RE, ' ');
    const nums = typedNumbers(bare);
    if (!nums.length) continue;
    for (const f of Object.values(LEDGER.facts)) {
      if (!f.match || linked.has(f.id)) continue;
      let rx, nx;
      try { rx = new RegExp(f.match, 'i'); nx = f.unless ? new RegExp(f.unless, 'i') : null; } catch (e) { continue; }
      if (!rx.test(bare) || (nx && nx.test(bare))) continue;
      const mine = nums.filter(n => n.unit === f.unit);
      if (!mine.length) continue;
      const hit = mine.find(n => ftAgrees(n, Number(f.value)));
      // A disagreement is only worth a row when the typed figure could be a
      // version of this one: an earlier ledger value, or within a factor of
      // two of it (facts.py's `near`). "2.6 percent of income" in a sentence
      // that matches the capital-gains share is another figure, not a stale one.
      const ratio = n => Math.abs(Math.log(Math.abs(n.value || 1e-9) / Math.abs(Number(f.value) || 1e-9)));
      const wasOne = n => (f.history || []).find(h => ftAgrees(n, Number(h.value)));
      const n = hit || mine.filter(x => wasOne(x) || ratio(x) <= Math.log(2)).sort((a, b) => ratio(a) - ratio(b))[0];
      if (!n) continue;
      const old = !hit && wasOne(n);
      out.push({ fact: f.id, typed: n.shown, ledger: f.shown || factWords(f.id, null, null).text, agrees: !!hit,
                 earlier: old ? (old.as_of || old.since || 'an earlier value') : null, sentence: line });
    }
  }
  return out;
}

/** Every text the document holds, with a way to rewrite it: content.md's
 *  slots ({slot}) and the layout's words (a text box's md, a table cell…,
 *  {el, path}). */
function factTexts() {
  const out = [];
  const lines = String(source || '').split('\n');
  let key = null, start = 0;
  const close = end => { if (key && key !== 'sources') out.push({ where: key, slot: key, text: lines.slice(start, end).join('\n') }); };
  lines.forEach((l, i) => {
    const k = l.match(/^\[\[([^\]]+)\]\]\s*$/);
    if (!k) return;
    close(i);
    key = k[1]; start = i + 1;
  });
  close(lines.length);
  const walk = (v, path, where) => {
    if (typeof v === 'string') { if (/\d/.test(v) && v.length > 12) out.push({ where, path, text: v }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path.concat(i), where)); return; }
    if (v && typeof v === 'object') {
      Object.entries(v).forEach(([k, x]) => {
        if (k === 'factsSeen' || k === 'style' || k === 'src' || k === 'url') return;
        walk(x, path.concat(k), where || (v.id != null ? (path[0] === 'boxes' ? 'text.' + v.id : String(v.id)) : null));
      });
    }
  };
  walk(layout, [], null);
  return out;
}

/** Preflight's fact-typed rows. */
function factTypedIssues() {
  const issues = [];
  factTexts().forEach(t => {
    typedFacts(t.text).forEach(x => {
      const f = LEDGER.facts[x.fact];
      issues.push({ kind: 'fact-typed', ids: t.where ? [t.where] : [], fact: x.fact, agrees: x.agrees,
        typed: x.typed, sentence: x.sentence, slot: t.slot || null, path: t.path || null,
        note: x.agrees
          ? `“${x.typed}” is ${f.says.charAt(0).toLowerCase() + f.says.slice(1)}, typed as words. Link it and it follows the ledger`
          : `says ${x.typed}; the ledger says ${x.ledger}${x.earlier ? ` (${x.typed} was its value for ${x.earlier})` : ''}. Check which is right` });
    });
  });
  return issues;
}

/** Link: the typed figure in that sentence becomes the fact's token (pinned
 *  to today in testimony, as Insert fact does), as one undo step. Refused,
 *  changing nothing, when the words moved since Preflight read them. */
async function factLink(issue) {
  const token = `{fact:${issue.fact}${factPinsByDefault() ? '@' + todayIso() : ''}}`;
  const swap = text => {
    const at = text.indexOf(issue.sentence);
    if (at < 0) return null;
    const i = text.indexOf(issue.typed, at);
    if (i < 0 || i >= at + issue.sentence.length) return null;
    return text.slice(0, i) + token + text.slice(i + issue.typed.length);
  };
  let done = false;
  await changeDoc(() => {
    if (issue.slot) {
      const lines = String(source || '').split('\n');
      const h = lines.findIndex(l => l.trim() === `[[${issue.slot}]]`);
      if (h < 0) return false;
      let e = h + 1;
      while (e < lines.length && !/^\[\[[^\]]+\]\]\s*$/.test(lines[e])) e++;
      const next = swap(lines.slice(h + 1, e).join('\n'));
      if (next == null) return false;
      source = [...lines.slice(0, h + 1), next, ...lines.slice(e)].join('\n');
    } else if (issue.path) {
      let o = layout;
      for (const k of issue.path.slice(0, -1)) { o = o && o[k]; }
      const last = issue.path[issue.path.length - 1];
      if (!o || typeof o[last] !== 'string') return false;
      const next = swap(o[last]);
      if (next == null) return false;
      o[last] = next;
    } else return false;
    done = true;
    return true;
  });
  if (!done) tell('those words changed since Preflight read them — check again', { kind: 'error' });
  else tell(`linked to the ledger: ${issue.typed} is now ${token}`);
  return done;
}
