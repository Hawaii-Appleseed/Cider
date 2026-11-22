// --- modal dialogs ----------------------------------------------------------
// Native <dialog> (Baseline since 2022): focus-trapped, Esc-closable, a
// backdrop for free — and, unlike prompt()/confirm(), one dialog can gather
// several fields at once and never silently drops typed input to an accidental
// dismissal. Everything below returns a Promise so call sites just `await`.
// modalOpen guards the in-iframe edit: opening a dialog steals focus and would
// otherwise blur the paragraph being edited and commit it out from under the
// dialog (see edit()'s blur handler).
let modalOpen = false;

function dsModal(build) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dsdlg';
    let settled = false;
    const done = v => {
      if (settled) return; settled = true;
      modalOpen = false;
      try { dlg.close(); } catch (e) {}
      dlg.remove();
      resolve(v);
    };
    build(dlg, done);
    dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });   // Esc
    dlg.addEventListener('click', e => { if (e.target === dlg) done(null); });  // backdrop
    document.body.appendChild(dlg);
    modalOpen = true;
    dlg.showModal();
  });
}

/** A form dialog. fields: [{name, label, type:'text'|'textarea'|'select',
 *  value, placeholder, options:[{value,label}], required, readOnly}]. Resolves
 *  an object of the entered values, or null if cancelled. opts.validate(values)
 *  may return an error string to show and keep the dialog open. */
function dsForm(title, fields, opts = {}) {
  return dsModal((dlg, done) => {
    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'dsdlg-form';
    if (title) {
      const h = document.createElement('p'); h.className = 'dsdlg-title';
      h.textContent = title; form.appendChild(h);
    }
    const inputs = {};
    // Fields marked `more` fold under one "More details" line, so a form that
    // needs one answer most of the time does not ask seven.
    let more = null;
    fields.forEach(f => {
      if (f.more && !more) {
        more = document.createElement('details');
        more.className = 'dsdlg-more';
        const sum = document.createElement('summary');
        sum.textContent = opts.moreLabel || 'More details';
        more.appendChild(sum);
      }
      const label = document.createElement('label'); label.className = 'dsdlg-field';
      if (f.label) { const s = document.createElement('span'); s.textContent = f.label; label.appendChild(s); }
      let input;
      if (f.type === 'select') {
        input = document.createElement('select');
        (f.options || []).forEach(o => {
          const opt = document.createElement('option');
          opt.value = o.value; opt.textContent = o.label;
          input.appendChild(opt);
        });
        if (f.value != null) input.value = f.value;
      } else if (f.type === 'textarea') {
        input = document.createElement('textarea');
        input.value = f.value || '';
        if (f.placeholder) input.placeholder = f.placeholder;
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.value = f.value || '';
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.readOnly) input.readOnly = true;
      }
      input.name = f.name;
      if (f.required) input.required = true;
      label.appendChild(input);
      inputs[f.name] = input;
      (f.more ? more : form).appendChild(label);
    });
    if (more) form.appendChild(more);
    const err = document.createElement('p'); err.className = 'dsdlg-err'; form.appendChild(err);
    const btns = document.createElement('div'); btns.className = 'dsdlg-btns';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'dsdlg-cancel';
    cancel.textContent = opts.cancelLabel || 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'submit'; ok.className = 'dsdlg-ok' + (opts.danger ? ' danger' : '');
    ok.textContent = opts.okLabel || 'OK';
    btns.append(cancel, ok); form.appendChild(btns);
    cancel.onclick = () => done(null);
    form.onsubmit = e => {
      e.preventDefault();
      const values = {};
      for (const k in inputs) values[k] = inputs[k].value;
      if (opts.validate) { const msg = opts.validate(values); if (msg) { err.textContent = msg; return; } }
      done(values);
    };
    dlg.appendChild(form);
    const first = fields[0] && inputs[fields[0].name];
    if (first) setTimeout(() => { first.focus(); first.select && first.select(); }, 0);
  });
}

/** A yes/no dialog. Resolves true only on the confirm button. */
function dsConfirm(message, opts = {}) {
  return dsModal((dlg, done) => {
    const form = document.createElement('form');
    form.method = 'dialog'; form.className = 'dsdlg-form';
    const msg = document.createElement('p'); msg.className = 'dsdlg-msg';
    msg.textContent = message; form.appendChild(msg);
    const btns = document.createElement('div'); btns.className = 'dsdlg-btns';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'dsdlg-cancel';
    cancel.textContent = opts.cancelLabel || 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'submit'; ok.className = 'dsdlg-ok' + (opts.danger ? ' danger' : '');
    ok.textContent = opts.okLabel || 'OK';
    btns.append(cancel, ok); form.appendChild(btns);
    cancel.onclick = () => done(false);
    form.onsubmit = e => { e.preventDefault(); done(true); };
    dlg.appendChild(form);
    setTimeout(() => ok.focus(), 0);
  }).then(v => v === true);
}

/** A single-field prompt. Resolves the string, or null if cancelled. */
async function dsPrompt(message, value = '', opts = {}) {
  const r = await dsForm(opts.title || '', [{
    name: 'value', label: message, type: opts.multiline ? 'textarea' : 'text',
    value, placeholder: opts.placeholder, readOnly: opts.readOnly, required: opts.required,
  }], opts);
  return r ? r.value : null;
}

/** An acknowledge-only dialog. */
function dsAlert(message) {
  return dsModal((dlg, done) => {
    const form = document.createElement('form');
    form.method = 'dialog'; form.className = 'dsdlg-form';
    const msg = document.createElement('p'); msg.className = 'dsdlg-msg';
    msg.textContent = message; form.appendChild(msg);
    const btns = document.createElement('div'); btns.className = 'dsdlg-btns';
    const ok = document.createElement('button');
    ok.type = 'submit'; ok.className = 'dsdlg-ok'; ok.textContent = 'OK';
    btns.appendChild(ok); form.appendChild(btns);
    form.onsubmit = e => { e.preventDefault(); done(); };
    dlg.appendChild(form);
    setTimeout(() => ok.focus(), 0);
  });
}

let py = null, source = '', original = '', dirty = false, editing = false;
let lastFit = [];
let layout = null, layoutOrig = '', scrollTopWas = 0;

// A fetch that cannot hang FOREVER. fetch() has no default timeout, so a
// request that opens and then stalls — a wedged socket, a proxy, a CDN
// throttling under load — leaves its promise pending for the life of the
// page. boot() awaits all of its downloads together, so ONE stalled request
// meant the editor sat at the last thing it had said, with nothing rendered,
// nothing logged, nothing thrown and nothing to retry: the silent hang.
// A bounded wait turns that into an error a caller can name and the boot
// handler can explain. Generous on purpose — the engine files are local and
// arrive in milliseconds, but this same helper pulls a report from GitHub
// Pages on whatever connection the reader has.
const FETCH_TIMEOUT = 45000;
// How long boot stays silent before it starts naming what it is waiting on.
// Comfortably past a normal cold start (a warm Pyodide boots in well under a
// second; a cold ~30MB one takes seconds), so a healthy load never says a
// word — this is for the case that would otherwise say nothing at all.
const BOOT_STALL_S = 20;
function boundedFetch(u) {
  let signal;
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    signal = AbortSignal.timeout(FETCH_TIMEOUT);
  } else {                                   // older engines: same idea by hand
    const c = new AbortController();
    setTimeout(() => c.abort(), FETCH_TIMEOUT);
    signal = c.signal;
  }
  return fetch(bust(u), { cache: 'no-store', signal }).catch(e => {
    // An abort surfaces as an anonymous DOMException naming neither the URL
    // nor the reason, which is no better than the hang it replaced.
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error(`no answer after ${FETCH_TIMEOUT / 1000}s — ${u}`);
    }
    throw e;
  });
}

async function get(u) {
  // no-store: a query string alone does not reliably defeat the raw CDN,
  // and a stale renderer silently produces a wrong page.
  const r = await boundedFetch(u);
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${u}`);
  return r.text();
}

// A manifest file that isn't text (an image an editor.engine list names, e.g.
// a logo a renderer inlines as a data URI). r.text() UTF-8-decodes the
// response — on real binary bytes that silently replaces every invalid
// sequence with U+FFFD, corrupting the file from the first non-ASCII byte
// on. Every manifest file used to be source code/markdown/JSON, so this
// never came up until a project first staged a raster image.
const BINARY_RE = /\.(png|jpe?g|gif|webp|ico|bmp|woff2?|ttf|otf)$/i;
async function getBytes(u) {
  const r = await boundedFetch(u);
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${u}`);
  return new Uint8Array(await r.arrayBuffer());
}

