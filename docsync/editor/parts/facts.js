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
