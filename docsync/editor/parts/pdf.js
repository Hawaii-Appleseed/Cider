// ---------------------------------------------- a PDF made in the browser
// Where there is no local server (the staff hub, a static copy) File > Download
// > PDF used to call print() on the report and leave the person in the
// browser's print dialog: nothing was saved, and the dialog froze an automated
// browser for minutes. A web page cannot save a PDF by itself, only that dialog
// can, so the PDF is made here instead. It is the SAME document the local
// server prints (the published render, @media print applied, page size from
// the sheet): every sheet is drawn at 3x by the browser's own layout engine
// into a picture, the pictures are laid in a PDF one to a page, and the page's
// words and links go on top as an invisible layer, so the file can be searched,
// copied from and read aloud. What it is NOT is vector: the words are pictures
// at 288 dpi. A vector PDF needs a real browser print, which the local server
// has and a static page does not.
const PDF_SCALE = 3;                  // picture pixels per CSS pixel (288 dpi)
const PDF_MAX_PIXELS = 30e6;          // the most one sheet's picture may hold
const PDF_MAX_SIDE = 16000;           // a canvas side no browser refuses
let pdfBusy = false;

/** Every url(...) in some CSS that is not already inline -> a data: URI. A
 *  sheet is drawn inside an SVG, and an SVG image may fetch nothing, so a
 *  background picture that stays a path is simply missing. One that will not
 *  fetch is left as it was (and counted in `missed`). */
async function inlineCssUrls(css, missed) {
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  const urls = new Set();
  // %23 is a # written inside a data: URI (an SVG filter="url(%23n)"): a
  // reference to a part of that same picture, not a file.
  for (const m of css.matchAll(re)) if (!/^(data:|#|%23|about:)/i.test(m[2])) urls.add(m[2]);
  if (!urls.size) return css;
  const got = new Map();
  await Promise.all([...urls].map(async u => {
    try {
      const r = await fetch(/^https?:/i.test(u) ? u : withBase(u), { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob();
      got.set(u, await new Promise((ok, no) => {
        const fr = new FileReader();
        fr.onload = () => ok(fr.result); fr.onerror = no;
        fr.readAsDataURL(blob);
      }));
    } catch (e) { if (missed) missed.push(u); }
  }));
  return css.replace(re, (m, q, u) => got.has(u) ? `url("${got.get(u)}")` : m);
}

/** The words of a sheet as boxes in the sheet's own CSS pixels, one per word:
 *  what the invisible layer is made of. `sr` is the sheet's rectangle. */
function sheetWords(d, sheet, sr) {
  const out = [], view = d.defaultView, range = d.createRange(), shown = new Map();
  const visible = el => {
    if (!shown.has(el)) shown.set(el, view.getComputedStyle(el).visibility !== 'hidden');
    return shown.get(el);
  };
  const walker = d.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const host = n.parentElement;
    if (!host || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|TITLE)$/i.test(host.tagName) || !visible(host)) continue;
    for (const m of n.nodeValue.matchAll(/\S+/g)) {
      range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const x = r.left - sr.left, y = r.top - sr.top;
      if (x + r.width < 0 || y + r.height < 0 || x > sr.width || y > sr.height) continue;   // clipped away
      out.push({ x, y, w: r.width, h: r.height, t: m[0] });
    }
  }
  return out;
}

/** The links of a sheet: web, mail and phone ones, as boxes like the words. */
function sheetLinks(sheet, sr) {
  const out = [];
  for (const a of sheet.querySelectorAll('a[href], a[*|href]')) {
    const raw = a.getAttribute('href') || a.getAttribute('xlink:href') || '';
    if (!/^(https?:|mailto:|tel:)/i.test(raw)) continue;
    for (const r of a.getClientRects()) {
      if (r.width < 2 || r.height < 2) continue;
      out.push({ x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height, url: raw });
    }
  }
  return out;
}

/** A cheap fingerprint of a canvas: every 7th pixel, folded. */
function canvasSignature(cv) {
  const px = new Uint32Array(cv.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, cv.width, cv.height).data.buffer);
  let h = 2166136261;
  for (let i = 0; i < px.length; i += 7) h = Math.imul(h ^ px[i], 16777619);
  return h >>> 0;
}

/** An SVG that holds a sheet, drawn onto a canvas of cw x ch pixels.
 *
 *  An SVG image fetches its fonts and pictures when it is first PAINTED, not
 *  when it loads, so a first drawing comes out in the fallback font (or, in
 *  Safari, empty), and wraps its lines differently. The same image painted a
 *  moment later is right. So it is painted again, after `settle` ms and then
 *  every 40, until two paints in a row are the same pixels. */
async function drawSvg(svg, cw, ch, settle = 80) {
  // As a blob: the picture is megabytes (the report's fonts ride in it), and a
  // data: address made of it had to be percent-encoded, three bytes for one,
  // for every page. Some browsers also refuse an address that long, which is
  // one way a page "could not be drawn". A browser that will not read a
  // canvas painted from a blob gets the data: address, as before.
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    try { return await paintSvg(blobUrl, cw, ch, settle); }
    catch (e) {
      return await paintSvg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), cw, ch, settle);
    }
  } finally { URL.revokeObjectURL(blobUrl); }
}
async function paintSvg(src, cw, ch, settle) {
  const img = new Image();
  const loaded = new Promise((ok, no) => {
    img.onload = ok;
    img.onerror = () => no(new Error('the browser could not draw this page'));
  });
  img.src = src;
  await loaded;
  // Whether two paints agree is asked of a SMALL painting (a quarter of the
  // sheet's width at most): reading back the full 288 dpi canvas, some thirty
  // megabytes, up to eight times a page was most of the time a page took.
  const k = Math.min(1, 640 / cw);
  const probe = document.createElement('canvas');
  probe.width = Math.max(1, Math.round(cw * k)); probe.height = Math.max(1, Math.round(ch * k));
  const pg = probe.getContext('2d', { willReadFrequently: true });
  let last = null;
  for (let i = 0; i < 20; i++) {
    pg.fillStyle = '#fff'; pg.fillRect(0, 0, probe.width, probe.height);
    pg.drawImage(img, 0, 0, probe.width, probe.height);
    const sig = canvasSignature(probe);            // throws if the canvas may not be read
    if (sig === last) break;
    last = sig;
    await new Promise(r => setTimeout(r, i ? 40 : settle));
  }
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch);      // a JPEG has no transparency
  g.drawImage(img, 0, 0, cw, ch);
  return cv;
}

/** True when a canvas is all one colour, sampled on a grid: a sheet with
 *  words on it that came out empty (a browser that cannot draw the SVG). */
function looksBlank(cv) {
  const g = cv.getContext('2d', { willReadFrequently: true });
  const px = g.getImageData(0, 0, cv.width, cv.height).data, row = cv.width * 4;
  const r = px[0], gr = px[1], b = px[2];
  for (let y = 0; y < cv.height; y += 7) {
    for (let x = 0; x < cv.width; x += 7) {
      const i = y * row + x * 4;
      if (Math.abs(px[i] - r) + Math.abs(px[i + 1] - gr) + Math.abs(px[i + 2] - b) > 12) return false;
    }
  }
  return true;
}

/** A PDF string for text that may hold any character: UTF-16BE in hex. */
function pdfTextString(s) {
  let h = 'FEFF';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${h}>`;
}
const pdfLiteral = s => '(' + String(s).replace(/[^\x20-\x7e]/g, c => encodeURIComponent(c))
  .replace(/[\\()]/g, '\\$&') + ')';

/** The file: one picture per page, the words over it in invisible text (render
 *  mode 3) and links as annotations. `pages` is
 *  [{ w, h (CSS px), jpeg (bytes), iw, ih (picture pixels), words, links }].
 *  The invisible text sits in standard Helvetica with every glyph 500 wide and
 *  a horizontal scale per word that makes it span its box, so a selection
 *  follows the words on the picture. A ToUnicode table gives each character
 *  its real code point, so the kahako, the okina and curly quotes copy and
 *  search as what they are (Helvetica's own encoding has no way to say them). */
function buildPdf(pages, title) {
  const enc = new TextEncoder(), parts = [], offs = [];
  let size = 0;
  const put = x => { const u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); size += u.length; };
  const obj = (n, body) => { offs[n] = size; put(`${n} 0 obj\n${body}\nendobj\n`); };
  const stream = (n, dict, bytes) => {
    offs[n] = size;
    put(`${n} 0 obj\n<< ${dict} /Length ${bytes.length} >>\nstream\n`); put(bytes); put('\nendstream\nendobj\n');
  };
  const f2 = v => (+v).toFixed(2);

  // Characters -> (font, code), a font holding up to 250 of them.
  const fonts = [], codes = new Map();
  const codeOf = ch => {
    let c = codes.get(ch);
    if (!c) {
      let f = fonts[fonts.length - 1];
      if (!f || f.list.length >= 250) { f = { list: [] }; fonts.push(f); }
      f.list.push(ch);
      c = [fonts.length - 1, f.list.length];
      codes.set(ch, c);
    }
    return c;
  };
  const hex2 = n => n.toString(16).padStart(2, '0');
  const ops = pages.map(p => {
    const wPt = p.w * 0.75, hPt = p.h * 0.75;
    let s = `q ${f2(wPt)} 0 0 ${f2(hPt)} 0 0 cm /Im0 Do Q\nBT 3 Tr\n`;
    for (const w of p.words) {
      const chars = [...w.t + ' '];                    // the space keeps copied words apart
      const runs = [];
      for (const ch of chars) {
        const [fi, c] = codeOf(ch);
        if (runs.length && runs[runs.length - 1][0] === fi) runs[runs.length - 1][1] += hex2(c);
        else runs.push([fi, hex2(c)]);
      }
      const fs = Math.max(2, w.h * 0.75 / 1.2);        // the box is the font's content area
      const tz = Math.max(1, (w.w * 0.75) / ((chars.length - 1) * 0.5 * fs) * 100);
      s += `${f2(tz)} Tz 1 0 0 1 ${f2(w.x * 0.75)} ${f2(hPt - (w.y + w.h * 0.76) * 0.75)} Tm`;
      for (const [fi, hx] of runs) s += ` /F${fi + 1} ${f2(fs)} Tf <${hx}> Tj`;
      s += '\n';
    }
    return s + 'ET\n';
  });

  // Object numbers: 1 catalog, 2 page tree, 3 info, then 2 per font, then each
  // page's page, contents, picture and link annotations.
  let next = 4 + 2 * fonts.length;
  const ids = pages.map(p => {
    const o = { page: next++, content: next++, image: next++, annots: [] };
    for (let i = 0; i < p.links.length; i++) o.annots.push(next++);
    return o;
  });
  const total = next;

  put('%PDF-1.5\n%âãÏÓ\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${ids.map(o => o.page + ' 0 R').join(' ')}] /Count ${pages.length} >>`);
  const d = new Date(), z = n => String(n).padStart(2, '0');
  obj(3, `<< /Title ${pdfTextString(title)} /Producer ${pdfTextString('Cider')} `
    + `/CreationDate (D:${d.getUTCFullYear()}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}${z(d.getUTCHours())}${z(d.getUTCMinutes())}${z(d.getUTCSeconds())}Z) >>`);
  fonts.forEach((f, i) => {
    const fid = 4 + 2 * i, tid = fid + 1, n = f.list.length;
    obj(fid, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 1 /LastChar ${n} `
      + `/Widths [${new Array(n).fill(500).join(' ')}] /ToUnicode ${tid} 0 R >>`);
    let cm = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n'
      + '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
      + '/CMapName /Adobe-Identity-UCS def /CMapType 2 def\n1 begincodespacerange <01> <FF> endcodespacerange\n';
    for (let k = 0; k < n; k += 100) {
      const chunk = f.list.slice(k, k + 100);
      cm += `${chunk.length} beginbfchar\n`;
      chunk.forEach((ch, j) => {
        let u = '';
        for (let q = 0; q < ch.length; q++) u += ch.charCodeAt(q).toString(16).padStart(4, '0');
        cm += `<${hex2(k + j + 1)}> <${u}>\n`;
      });
      cm += 'endbfchar\n';
    }
    cm += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
    const bytes = enc.encode(cm);
    stream(tid, '', bytes);
  });
  const fontRes = fonts.map((f, i) => `/F${i + 1} ${4 + 2 * i} 0 R`).join(' ');
  pages.forEach((p, i) => {
    const o = ids[i], wPt = p.w * 0.75, hPt = p.h * 0.75;
    obj(o.page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f2(wPt)} ${f2(hPt)}] `
      + `/Resources << /Font << ${fontRes} >> /XObject << /Im0 ${o.image} 0 R >> >> /Contents ${o.content} 0 R`
      + (o.annots.length ? ` /Annots [${o.annots.map(a => a + ' 0 R').join(' ')}]` : '') + ' >>');
    stream(o.content, '', enc.encode(ops[i]));
    stream(o.image, `/Type /XObject /Subtype /Image /Width ${p.iw} /Height ${p.ih} `
      + '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', p.jpeg);
    p.links.forEach((l, j) => {
      const x1 = l.x * 0.75, y1 = hPt - (l.y + l.h) * 0.75;
      obj(o.annots[j], `<< /Type /Annot /Subtype /Link /Rect [${f2(x1)} ${f2(y1)} ${f2(x1 + l.w * 0.75)} ${f2(y1 + l.h * 0.75)}] `
        + `/Border [0 0 0] /A << /S /URI /URI ${pdfLiteral(l.url)} >> >>`);
    });
  });
  const xref = size;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) x += String(offs[n]).padStart(10, '0') + ' 00000 n \n';
  put(x + `trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

/** The published report, loaded in a hidden frame and ready to be drawn sheet
 *  by sheet: what a print would see (the page's own width as the viewport,
 *  @media print on), every font and picture inside the document. The PDF and
 *  Copy as picture both draw from it. The caller removes `frame`. */
async function openPrintFrame() {
  const doc = new DOMParser().parseFromString(await renderClean(), 'text/html');
  const inl = await inlineEverything(doc, { fonts: true, scripts: true });
  await inlineHubFonts(doc);
  // What a print would see: the page's own width as the viewport, @media
  // print on and @media screen off. Resolved here, once, so the SVG a sheet
  // is drawn in (whose viewport is whatever it is) cannot answer them again.
  const pw = Math.round(PAGE_W_IN * 96), missed = [];
  for (const st of doc.querySelectorAll('style')) {
    st.textContent = await inlineCssUrls(freezeViewportUnits(flattenMedia(st.textContent, pw, 'print'), pw), missed);
  }
  for (const el of doc.querySelectorAll('[style]')) {
    const s = el.getAttribute('style') || '';
    if (/vw\b|url\(/i.test(s)) el.setAttribute('style', await inlineCssUrls(freezeViewportUnits(s, pw), missed));
  }
  // The printed sheet has no screen margin, no shadow and no background
  // beside it, and its picture starts at the sheet's own corner. And text
  // is measured the same way in the page and in the picture: without
  // geometricPrecision, Chrome sets text in an SVG image with different
  // glyph widths from the same text in a page (measured on a Retina Mac: a
  // line that fits in the page wraps in the picture, and the words laid over
  // it no longer sit on their words).
  const base = doc.createElement('style');
  base.textContent = 'html,body{margin:0!important;padding:0!important}html{overflow:hidden}'
    + 'section.page{margin:0!important;box-shadow:none!important}'
    + '*{text-rendering:geometricPrecision!important}';
  doc.head.appendChild(base);

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-99999px;top:0;border:0;visibility:hidden;width:${pw}px;height:2000px`;
  document.body.appendChild(frame);
  await new Promise(res => {
    frame.addEventListener('load', res, { once: true });
    frame.srcdoc = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  });
  const d = frame.contentDocument;
  void d.body.offsetHeight;                          // lay out, so the fonts start loading
  // …and wait for them, but not for ever: a face that never arrives left
  // this promise pending and the export with it.
  try { await Promise.race([d.fonts.ready, new Promise(r => setTimeout(r, 8000))]); }
  catch (e) { /* an engine without it: draw anyway */ }
  await Promise.all([...d.images].map(im => im.complete ? 0
    : new Promise(r => { im.onload = im.onerror = r; setTimeout(r, 8000); })));
  await new Promise(r => setTimeout(r, 150));        // a script's first paint

  const sheets = [...d.querySelectorAll('section.page')];
  if (!sheets.length) { frame.remove(); throw new Error('this report has no pages to print'); }
  const rootPx = parseFloat(d.defaultView.getComputedStyle(d.documentElement).fontSize) || 16;
  // The head (every style, and the fonts inside them) is the same for every
  // sheet: written out once, where it was cloned and written per page.
  const ser = new XMLSerializer();
  const headCopy = d.head.cloneNode(true);
  headCopy.querySelectorAll('script').forEach(s => s.remove());
  const headXml = ser.serializeToString(headCopy);
  const htmlOpen = ser.serializeToString(d.documentElement.cloneNode(false)).replace(/(\s*\/>|><\/html>)$/, '>');
  return { frame, d, sheets, pw, rootPx, inl, missed, ser, headXml, htmlOpen };
}
/** Sheet `n` (from 1) of a print frame as a canvas, with its words and links:
 *  { cv, w, h (CSS px), cw, ch (picture pixels), words, links }, or null for a
 *  sheet that is not drawn. `first` waits longer: its fonts are the ones nobody
 *  has loaded yet. */
async function drawSheet(pf, n, first) {
  const { d, sheets, pw, rootPx, ser, headXml, htmlOpen } = pf;
  const sheet = sheets[n - 1];
  // Show only this sheet, so it sits at the top and is measured there.
  const was = sheets.map(s => s.getAttribute('style'));
  sheets.forEach(s => { if (s !== sheet) s.style.setProperty('display', 'none', 'important'); });
  const sr = sheet.getBoundingClientRect();
  const words = sheetWords(d, sheet, sr), links = sheetLinks(sheet, sr);
  const copy = d.body.cloneNode(true);
  sheets.forEach((s, j) => { was[j] === null ? s.removeAttribute('style') : s.setAttribute('style', was[j]); });
  if (sr.width < 1 || sr.height < 1) return null;  // a sheet that is not drawn is not printed
  copy.querySelectorAll('script').forEach(s => s.remove());
  copy.querySelectorAll('section.page').forEach((s, j) => { if (j !== n - 1) s.textContent = ''; });
  const w = sr.width, h = sr.height;
  const k = Math.min(PDF_SCALE, Math.sqrt(PDF_MAX_PIXELS / (w * h)), PDF_MAX_SIDE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" `
    + `viewBox="${sr.left} ${sr.top} ${w} ${h}" style="font-size:${rootPx}px">`
    + `<foreignObject x="0" y="0" width="${Math.max(pw, Math.ceil(sr.left + w))}" height="${Math.ceil(sr.top + h)}">`
    + htmlOpen + headXml + ser.serializeToString(copy) + '</html></foreignObject></svg>';
  // The first sheet waits longest: its fonts are the ones nobody has loaded.
  // A sheet that would not draw is tried once more before the export fails.
  let cv;
  try { cv = await drawSvg(svg, cw, ch, first ? 250 : 80); }
  catch (e) { await new Promise(r => setTimeout(r, 300)); cv = await drawSvg(svg, cw, ch, 250); }
  return { cv, w, h, cw, ch, words, links };
}

/** Copy as picture: what is selected (or a whole page) onto the clipboard as
 *  a PNG, to paste into Slack, an email or a slide. Drawn from the published
 *  page, as the PDF is, so nothing of the editor (handles, guides, the frame
 *  edges) is in it; a selection is the part of its page inside its bounds,
 *  with whatever lies behind it. The clipboard is handed a promise at once, in
 *  the click, which is the only moment Safari lets a page write to it. */
function pagePicture(d, page, boxIn) {
  return (async () => {
    const n = [...d.querySelectorAll('section.page')].indexOf(page) + 1;
    const pf = await openPrintFrame();
    try {
      if (n < 1 || n > pf.sheets.length) throw new Error('that page is not in the published report');
      const got = await drawSheet(pf, n, true);
      if (!got) throw new Error('that page is not drawn');
      let cv = got.cv;
      if (boxIn) {
        const k = got.cw / PAGE_W_IN, pad = 0.04;
        const x = Math.max(0, Math.round((boxIn.x - pad) * k)), y = Math.max(0, Math.round((boxIn.y - pad) * k));
        const w = Math.min(got.cw - x, Math.round((boxIn.w + 2 * pad) * k)), h = Math.min(got.ch - y, Math.round((boxIn.h + 2 * pad) * k));
        if (w < 2 || h < 2) throw new Error('the selection is off the page');
        const cut = document.createElement('canvas');
        cut.width = w; cut.height = h;
        cut.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, w, h);
        cv = cut;
      }
      return await new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error('the picture could not be made')), 'image/png'));
    } finally { pf.frame.remove(); }
  })();
}
let pictureBusy = false;
async function copyAsPicture(d, page, boxIn, what) {
  if (pictureBusy) return { ok: false, error: 'still copying the last picture' };
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    tell('this browser cannot copy a picture: use File > Download instead');
    return { ok: false, error: 'no clipboard' };
  }
  pictureBusy = true;
  tell(`copying ${what} as a picture…`);
  try {
    const blob = pagePicture(d, page, boxIn);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    const b = await blob;
    tell(`${what} copied as a picture: paste it anywhere`);
    return { ok: true, bytes: b.size };
  } catch (e) {
    tell('could not copy the picture: ' + (e.message || e));
    return { ok: false, error: String(e.message || e) };
  } finally { pictureBusy = false; }
}
/** The selection's bounds on its page, in inches, or null with nothing selected. */
function selBounds(d) {
  const els = selEls(d);
  if (!els.length) return null;
  const page = els[0].closest('section.page') || d.querySelector('section.page');
  const mine = els.filter(el => el.closest('section.page') === page);
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  mine.forEach(el => {
    const b = shapeBox(el, page);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  });
  return { page, box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, n: mine.length };
}
function copySelAsPicture(d) {
  const sb = selBounds(d);
  if (!sb) { tell('select something to copy as a picture'); return; }
  return copyAsPicture(d, sb.page, sb.box, sb.n === 1 ? 'the selection' : `${sb.n} objects`);
}

/** Several things made the width, the height or both of one of them: three
 *  photographs or three stat cards in a row, sized by eye until now. The one
 *  right-clicked is the one the others follow (the first selected, from the
 *  strip); a locked thing is left alone. One undo step. */
async function matchSizeSel(d, what, refId) {
  const { page, els } = pageMembers(d);
  if (els.length < 2) return { ok: false, error: 'select two or more things' };
  const ref = els.find(el => idOf(el) === refId) || els[0];
  const rb = shapeBox(ref, page);
  const others = els.filter(el => el !== ref);
  await changeDoc(() => {
    others.forEach(el => commitSize(d, el, { w: what === 'h' ? undefined : rb.w, h: what === 'w' ? undefined : rb.h }));
  });
  tell(`${others.length + 1} things made the same ${what === 'w' ? 'width' : what === 'h' ? 'height' : 'size'}`);
  return { ok: true, changed: others.length };
}

/** File > Download > PDF without a server. `pages` is the sorted list of
 *  sheet numbers (null: all), `spec` what the person typed for them. */
async function exportPdfInBrowser(pages, spec) {
  if (pdfBusy) { tell('still making the PDF… it will download when it is ready'); return; }
  pdfBusy = true;
  const stat = t => { tell(t); };
  const tick = () => new Promise(r => setTimeout(r, 0));
  const name = `${exportBasename()}${spec ? '-p' + spec.replace(/,/g, '_') : ''}.pdf`;
  let pf = null;
  try {
    stat('making the PDF… (a full report takes a moment)');
    await tick();
    pf = await openPrintFrame();
    const { sheets, inl, missed } = pf;
    const want = pages || sheets.map((s, i) => i + 1);
    if (want.some(n => n > sheets.length)) throw new Error(`the report has ${sheets.length} page${sheets.length === 1 ? '' : 's'}`);
    const out = [];
    let blank = 0;
    for (const [i, n] of want.entries()) {
      stat(`making the PDF… page ${i + 1} of ${want.length}`);
      await tick();
      const got = await drawSheet(pf, n, !out.length);
      if (!got) continue;
      const { cv, w, h, cw, ch, words, links } = got;
      if (words.length && looksBlank(cv)) blank++;
      const jpeg = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
      out.push({ w, h, iw: cw, ih: ch, words, links, jpeg: new Uint8Array(await jpeg.arrayBuffer()) });
      cv.width = cv.height = 0;
    }
    if (!out.length) throw new Error('none of those pages is drawn');
    const title = document.title.replace(/\s+[—–-]\s+Cider$/, '').trim() || M.id || 'Report';
    const blob = buildPdf(out, title);
    saveBlob(blob, name);
    const notes = [];
    if (inl.fontsLinked.length) notes.push('fonts could not be embedded, so a fallback font is used');
    if (missed.length) notes.push(`${missed.length} background picture${missed.length === 1 ? '' : 's'} could not be fetched`);
    if (blank) notes.push(`${blank} page${blank === 1 ? '' : 's'} may have come out empty — try Chrome`);
    tell($('stat').textContent + ` — ${out.length} page${out.length === 1 ? '' : 's'}, ${(blob.size / 1048576).toFixed(1)} MB`
      + (notes.length ? '; ' + notes.join('; ') : ''));
  } catch (e) {
    tell('PDF failed: ' + (e.message || e) + '. Try again, or download one page at a time (PDF pages)',
      { title: String(e && e.stack || e) });
  } finally {
    if (pf) pf.frame.remove();
    pdfBusy = false;
  }
}

async function doExport(fmt) {
  // A PDF of some pages (INDESIGN_PARITY 83). Checked before anything runs.
  const pages = fmt === 'pdf' ? exportPages() : null;
  if (typeof pages === 'string') { tell(pages); return; }
  const spec = pages ? $('dl-pages').value.replace(/\s+/g, '') : '';
  $('downloadpop').hidden = true;
  if (!local) {                        // the hub, a static copy: no server to print for us
    if (fmt !== 'pdf') return;
    // Not print(): that opens the browser's print dialog and saves nothing.
    // The pages left out stay in the document, so page numbers count as in the
    // whole report (the same rule the server's export follows).
    return exportPdfInBrowser(pages, spec);
  }
  const marks = $('dl-marks').checked;
  const slug = exportBasename();
  const name = fmt === 'pdf' ? `${slug}${spec ? '-p' + spec.replace(/,/g, '_') : ''}.pdf` : `${slug}-pages.zip`;
  tell(`rendering the ${fmt.toUpperCase()}… (a full report takes a moment)`);
  try {
    const r = await fetch('/__export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fmt, marks, project: M.id, ...(spec ? { pages: spec } : {}),
        content: source, layout: JSON.stringify(layout, null, 2) + '\n' }),
    });
    const blob = await exportAnswer(r, fmt === 'pdf' ? ['application/pdf'] : ['application/zip', 'application/octet-stream']);
    saveBlob(blob, name);
  } catch (e) {
    tell('export failed: ' + e.message, { title: e.message });
  }
}

