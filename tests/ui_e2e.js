// Behavioural test of the real NUI page in headless Chromium (dev only, not shipped).
//   PLAYWRIGHT=/path/to/node_modules/playwright [SHOTS=dir] [BG=backdrop.jpg] [PAGE=web/index.html] node tests/ui_e2e.js
// The client is mocked: fetch('https://cbz_crosshair/<cb>') is answered in-page and recorded.
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.resolve(ROOT, process.env.PAGE || 'web/index.html');
const SHOTS = process.env.SHOTS || null;
const BG = process.env.BG ? 'file://' + path.resolve(process.env.BG) : null;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) CitizenFX/1.0.0.0 Chrome/103 Safari/537.36';

const dump = (...a) => JSON.parse(execFileSync('lua5.4', [path.join(__dirname, 'dump_config.lua'), ROOT, ...a], { encoding: 'utf8' }));
const C = dump();
const LOCALES = { en: dump('locale', 'en'), fr: dump('locale', 'fr') };
const baseConfig = (over = {}) => ({
  default: C.Default, defaultFaint: C.DefaultFaint, allowFaint: C.AllowFaint, allowNone: C.AllowNone, allowEditor: C.AllowEditor,
  defaultHitSound: C.DefaultHitSound, allowHitSound: C.AllowHitSound, hitSound: { files: C.HitSoundFiles, volume: C.HitSoundVolume },
  allowShare: C.AllowShareCodes, native: C.Native, swatches: C.Swatches,
  faintOpacity: C.FaintOpacity, targetColor: C.TargetColor,
  presets: [...C.Presets, { id: 'example', label: 'Example PNG', image: 'custom/example.png', size: 24 }],
  ...over,
});

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) passed++; else { failed++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}

async function newPage(browser, { config = baseConfig(), locale = 'en', stored = null } = {}) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, userAgent: UA });
  page.on('pageerror', (e) => { failed++; console.log('PAGE ERROR ' + e.message); });
  await page.addInitScript(({ config, locale, stored }) => {
    window.GetParentResourceName = () => 'cbz_crosshair';
    window.__posts = [];
    window.__plays = [];
    HTMLMediaElement.prototype.play = function () { window.__plays.push({ src: this.getAttribute('src'), volume: this.volume }); return Promise.resolve(); };
    const real = window.fetch;
    window.fetch = async (url, opts) => {
      const m = /^https:\/\/cbz_crosshair\/(\w+)/.exec(String(url));
      if (!m) return real(url, opts);
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      window.__posts.push({ name: m[1], body });
      const res = m[1] === 'ready' ? { settings: stored || false, config, locale } : { ok: true };
      return new Response(JSON.stringify(res), { headers: { 'Content-Type': 'application/json' } });
    };
  }, { config, locale: LOCALES[locale], stored });
  await page.goto(PAGE);
  if (BG) await page.addStyleTag({ content: `body{background:url("${BG}") center/cover no-repeat !important}` });
  await page.waitForFunction(() => window.__posts.some((p) => p.name === 'save'));
  return page;
}

const send = (page, msg) => page.evaluate((m) => window.postMessage(m, '*'), msg);
const lastSave = (page) => page.evaluate(() => {
  const s = window.__posts.filter((p) => p.name === 'save').pop();
  return s && s.body.settings;
});
const settle = (page) => page.waitForTimeout(220); // > save debounce
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const tiles = (page) => page.$$eval('#xh-grid .tile', (ts) => ts.map((t) => ({ key: t.dataset.key, on: t.getAttribute('aria-pressed') === 'true', name: t.querySelector('.tile-name').textContent })));

(async () => {
  const browser = await chromium.launch();

  // ------------------------------------------------------------ boot + defaults
  {
    const page = await newPage(browser);
    const s = await lastSave(page);
    check('boot saves normalised defaults', s && s.mode === 'native' && s.preset === 'native' && s.faint === false && !('visibility' in s), s);
    check('panel hidden at boot', await page.$eval('#xh-panel', (e) => e.classList.contains('hidden')));
    check('overlay hidden at boot', await page.$eval('#xh-overlay', (e) => e.classList.contains('hidden')));

    await send(page, { action: 'open' });
    await page.waitForTimeout(260); // open animation
    check('panel opens', !(await page.$eval('#xh-panel', (e) => e.classList.contains('hidden'))));
    check('texts applied', (await page.textContent('#xh-title')) === 'Crosshair');
    const list = await tiles(page);
    check('tiles: native + none + 4 presets + image', list.length === 7 && list.map((t) => t.key).join() === 'native,none,dot,square,cross,circle,example', list.map((t) => t.key));
    check('native tile first, selected, labelled from config', list[0].key === 'native' && list[0].on && list[0].name === 'Server default');
    // CEF (old Chromium) does not stretch flex children of <button>: every tile's art must span the tile.
    const widths = await page.$$eval('#xh-grid .tile', (ts) => ts.map((t) => ({ tile: t.clientWidth, art: t.querySelector('.tile-art').getBoundingClientRect().width })));
    check('tile art spans the whole tile', widths.every((w) => Math.abs(w.tile - w.art) <= 1), widths);
    check('no "Your crosshair" tile yet', !list.some((t) => t.key === 'custom'));
    check('native tile previews the Ring', (await page.$eval('#xh-grid .tile[data-key="native"] svg', (e) => e.querySelectorAll('circle').length)) >= 1);
    check('preview note says game reticle', (await page.textContent('#xh-preview')).includes('Game reticle'));
    check('copy disabled on native', await page.$eval('#xh-copy', (e) => e.disabled));
    await shot(page, '01-presets-native');

    // -------------------------------------------------------- pick a preset
    await page.click('#xh-grid .tile[data-key="cross"]');
    let saved = await lastSave(page);
    check('cross saved', saved.mode === 'custom' && saved.preset === 'cross' && saved.style.length === 4, saved);
    await send(page, { action: 'overlay', show: true });
    check('overlay visible in custom mode', !(await page.$eval('#xh-overlay', (e) => e.classList.contains('hidden'))));
    const box = await page.$eval('#xh-reticle svg', (e) => { const r = e.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width }; });
    check('overlay centred on the screen', Math.abs(box.cx - 960) <= 0.5 && Math.abs(box.cy - 540) <= 0.5, box);
    check('overlay even size', box.w % 2 === 0, box);
    check('copy enabled on a vector preset', !(await page.$eval('#xh-copy', (e) => e.disabled)));
    await shot(page, '02-cross-selected');

    // -------------------------------------------------------- target colour (like GTA)
    await send(page, { action: 'overlay', show: true, full: true, target: true });
    let fills = await page.$$eval('#xh-reticle svg rect', (rs) => rs.map((r) => r.getAttribute('fill')));
    check('aiming at a ped turns the crosshair red', fills.length > 0 && fills.every((f) => f === '#e03232'), fills);
    await shot(page, '02a-target-red');
    await send(page, { action: 'overlay', show: true, full: true, target: false });
    fills = await page.$$eval('#xh-reticle svg rect', (rs) => rs.map((r) => r.getAttribute('fill')));
    check('back to white off target', fills.every((f) => f === '#ffffff'), fills);

    // -------------------------------------------------------- faint until you aim
    const opacity = () => page.$eval('#xh-reticle', (e) => getComputedStyle(e).opacity);
    check('no While aiming / When armed choice any more', (await page.$('#xh-visibility')) === null);
    check('faint switch shown, off by default', !(await page.$eval('#xh-faint-row', (e) => e.classList.contains('hidden')))
      && await page.$eval('#xh-faint', (e) => e.getAttribute('aria-checked') === 'false'));
    await send(page, { action: 'overlay', show: true, full: false, target: false });
    await page.waitForTimeout(250);
    check('faint off: never drawn faint', (await opacity()) === '1', await opacity());
    await page.click('#xh-faint');
    saved = await lastSave(page);
    check('faint switch saved on', saved.faint === true, saved);
    check('faint switch state', await page.$eval('#xh-faint', (e) => e.getAttribute('aria-checked') === 'true'));
    await send(page, { action: 'overlay', show: true, full: false, target: false });
    await page.waitForTimeout(250);
    check('faint on, weapon out: 35% opacity', (await opacity()) === '0.35', await opacity());
    await shot(page, '02b-faint');
    await send(page, { action: 'overlay', show: true, full: true, target: false });
    await page.waitForTimeout(250);
    check('faint on, aiming: full opacity', (await opacity()) === '1', await opacity());
    // gun behind a wall (look bug): faint even with the switch off, and never red
    await page.click('#xh-faint');
    check('faint switch saved off', (await lastSave(page)).faint === false);
    await send(page, { action: 'overlay', show: true, full: false, blocked: true, target: true });
    await page.waitForTimeout(250);
    const blockedFills = await page.$$eval('#xh-reticle svg rect', (rs) => rs.map((r) => r.getAttribute('fill')));
    check('blocked by a wall: faint even with the switch off', (await opacity()) === '0.35', await opacity());
    check('blocked by a wall: not red', blockedFills.every((f) => f === '#ffffff'), blockedFills);
    await send(page, { action: 'overlay', show: true, full: true, blocked: false, target: false });
    await page.waitForTimeout(250);
    check('line of fire clear again: full opacity', (await opacity()) === '1', await opacity());

    // -------------------------------------------------------- hit sound
    const plays = () => page.evaluate(() => window.__plays.length);
    check('hit sound switch shown, on by default', !(await page.$eval('#xh-hit-row', (e) => e.classList.contains('hidden')))
      && await page.$eval('#xh-hit', (e) => e.getAttribute('aria-checked') === 'true'));
    check('boot saved hitSound = true', (await lastSave(page)).hitSound === true);
    let p0 = await plays();
    await send(page, { action: 'hit' });
    const played = await page.evaluate(() => window.__plays[window.__plays.length - 1]);
    check('hit plays one of the realistic sounds', (await plays()) === p0 + 1 && played && /^sounds\/visceral_[123]\.ogg$/.test(played.src) && Math.abs(played.volume - 0.5) < 1e-6, played);
    for (let i = 0; i < 30; i++) await send(page, { action: 'hit' });
    const seq = await page.evaluate((n) => window.__plays.slice(-n).map((p) => p.src), 31);
    check('variations: never the same sound twice in a row', seq.every((s, i) => i === 0 || s !== seq[i - 1]), seq);
    check('variations: all of them get used', new Set(seq).size === 3, [...new Set(seq)]);
    p0 = await plays();
    await page.click('#xh-hit');
    check('hit sound switch saved off', (await lastSave(page)).hitSound === false);
    p0 = await plays();
    await send(page, { action: 'hit' });
    check('off: no sound', (await plays()) === p0);
    await page.click('#xh-hit');
    check('turning it on plays a preview', (await plays()) === p0 + 1 && (await lastSave(page)).hitSound === true);

    // -------------------------------------------------------- editor
    await page.click('.tabs button[data-tab="editor"]');
    check('editor tab visible', !(await page.$eval('[data-pane="editor"]', (e) => e.classList.contains('hidden'))));
    check('editor starts from the selected preset', (await page.$eval('input[data-key="length"]', (e) => e.value)) === '4');
    check('editor hint shown before editing', !(await page.$eval('#xh-editor-note', (e) => e.classList.contains('hidden'))));
    await page.$eval('input[data-key="length"]', (e) => { e.value = '12'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await settle(page);
    saved = await lastSave(page);
    check('slider edit switches to custom', saved.mode === 'custom' && saved.preset === 'custom' && saved.style.length === 12 && saved.mine.length === 12, saved);
    check('slider value label', (await page.textContent('.slider:has(input[data-key="length"]) .slider-value')) === '12 px');
    check('editor hint hidden once custom', await page.$eval('#xh-editor-note', (e) => e.classList.contains('hidden')));
    check('circle section collapsed while off', await page.$eval('[data-section="circle"] .section-body', (e) => e.classList.contains('hidden')));
    await page.click('[data-section="circle"] .section-head .switch');
    await settle(page);
    check('circle section expands', !(await page.$eval('[data-section="circle"] .section-body', (e) => e.classList.contains('hidden'))));
    check('circle drawn in overlay', (await page.$$eval('#xh-reticle svg circle', (c) => c.length)) >= 1);
    await page.fill('[data-key="color"] .hex input', '#FF3366');
    await settle(page);
    saved = await lastSave(page);
    check('hex color applied', saved.style.color === '#ff3366', saved.style);
    await page.click('[data-key="circleColor"] .swatch.match');
    await settle(page);
    check('circle color match = null', (await lastSave(page)).style.circleColor == null);
    await page.click('[data-section="dot"] .section-head .switch');
    await page.click('[data-key="dotRound"] button:nth-child(2)');
    await settle(page);
    saved = await lastSave(page);
    check('dot round', saved.style.dot === true && saved.style.dotRound === true, saved.style);
    await page.click('[data-section="lines"] .section-head .switch');
    await settle(page);
    check('lines off keeps dot', (await lastSave(page)).style.lines === false);
    await page.click('[data-section="lines"] .section-head .switch');
    await page.$eval('input[data-key="gap"]', (e) => { e.value = '-4'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await settle(page);
    check('negative gap allowed', (await lastSave(page)).style.gap === -4);
    await page.$eval('input[data-key="gap"]', (e) => { e.value = '5'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await settle(page);
    await shot(page, '03-editor');
    await page.$eval('#xh-body', (e) => { e.scrollTop = e.scrollHeight; });
    await shot(page, '04-editor-bottom');

    // -------------------------------------------------------- "Your crosshair" survives presets
    await page.click('.tabs button[data-tab="presets"]');
    let list2 = await tiles(page);
    check('"Your crosshair" tile appears, selected', list2.some((t) => t.key === 'custom' && t.on), list2);
    await page.click('#xh-grid .tile[data-key="dot"]');
    saved = await lastSave(page);
    check('preset keeps mine', saved.preset === 'dot' && saved.mine && saved.mine.length === 12, saved);
    await page.click('#xh-grid .tile[data-key="custom"]');
    saved = await lastSave(page);
    check('back to mine', saved.preset === 'custom' && saved.style.length === 12 && saved.style.color === '#ff3366', saved);

    // -------------------------------------------------------- share codes
    const myCode = await page.evaluate(() => window.CbzCrosshair.encode(window.CbzCrosshair.normalizeStyle({ length: 20, color: '#00ff00' })));
    await page.click('#xh-copy');
    const copyState = await page.evaluate(() => ({
      toast: !document.getElementById('xh-toast').classList.contains('hidden') && document.getElementById('xh-toast').textContent,
      sheet: !document.getElementById('xh-sheet').classList.contains('hidden') && document.getElementById('xh-code').value,
    }));
    check('copy gives a toast or a selectable code', copyState.toast === 'Code copied to clipboard' || /^CBZ1-/.test(copyState.sheet || ''), copyState);
    if (copyState.sheet) await page.click('#xh-sheet-ok');

    await page.click('#xh-import');
    check('import sheet opens', !(await page.$eval('#xh-sheet', (e) => e.classList.contains('hidden'))));
    await page.fill('#xh-code', 'CBZ1-nope');
    await page.click('#xh-sheet-ok');
    check('invalid code rejected', !(await page.$eval('#xh-sheet-error', (e) => e.classList.contains('hidden'))));
    await shot(page, '05-import-invalid');
    await page.fill('#xh-code', myCode);
    await page.press('#xh-code', 'Enter');
    saved = await lastSave(page);
    check('import applied', saved.preset === 'custom' && saved.style.length === 20 && saved.style.color === '#00ff00', saved);
    check('import toast', (await page.textContent('#xh-toast')) === 'Crosshair imported');
    check('sheet closed after import', await page.$eval('#xh-sheet', (e) => e.classList.contains('hidden')));

    // -------------------------------------------------------- image preset
    await page.click('#xh-grid .tile[data-key="example"]');
    saved = await lastSave(page);
    check('image preset saved by id', saved.preset === 'example', saved);
    const img = await page.$eval('#xh-reticle img', (e) => { const r = e.getBoundingClientRect(); return { src: e.getAttribute('src'), w: r.width, cx: r.left + r.width / 2, cy: r.top + r.height / 2, ok: e.complete && e.naturalWidth > 0 }; });
    check('image overlay centred and loaded', img.src === 'custom/example.png' && img.w === 24 && img.ok && Math.abs(img.cx - 960) <= 0.5 && Math.abs(img.cy - 540) <= 0.5, img);
    await page.click('#xh-copy');
    check('image presets cannot be shared', (await page.textContent('#xh-toast')) === 'Image presets cannot be shared as a code.');
    await page.click('.tabs button[data-tab="editor"]');
    check('editor explains image presets', (await page.textContent('#xh-editor-note')).startsWith('This preset is an image'));
    check('editor shows mine for image preset', (await page.$eval('input[data-key="length"]', (e) => e.value)) === '20');
    await page.click('.tabs button[data-tab="presets"]');

    // -------------------------------------------------------- none
    await page.click('#xh-grid .tile[data-key="none"]');
    check('none saved', (await lastSave(page)).mode === 'none');
    check('overlay hidden in none mode even if client says show', await page.$eval('#xh-overlay', (e) => e.classList.contains('hidden')));

    // -------------------------------------------------------- reset
    await page.click('#xh-reset');
    check('reset asks first', (await page.textContent('#xh-sheet-text')) === 'Back to the server default?');
    await page.click('#xh-sheet-ok');
    saved = await lastSave(page);
    check('reset to default keeps mine', saved.mode === 'native' && saved.mine && saved.mine.length === 20, saved);

    // -------------------------------------------------------- escape + background
    check('sky background by default', (await page.$eval('#xh-preview', (e) => e.dataset.bg)) === 'sky');
    await page.click('#xh-preview .bg-dot[data-bg="light"]');
    check('background switch', (await page.$eval('#xh-preview', (e) => e.dataset.bg)) === 'light');
    await page.click('#xh-import');
    await page.keyboard.press('Escape');
    check('Esc closes the sheet first', await page.$eval('#xh-sheet', (e) => e.classList.contains('hidden')) && !(await page.$eval('#xh-panel', (e) => e.classList.contains('hidden'))));
    await page.keyboard.press('Escape');
    check('Esc closes the menu', await page.$eval('#xh-panel', (e) => e.classList.contains('hidden')));
    check('close posted to client', await page.evaluate(() => window.__posts.some((p) => p.name === 'close')));
    await send(page, { action: 'close' });
    check('client close is idempotent', await page.evaluate(() => window.__posts.filter((p) => p.name === 'close').length === 1));

    // -------------------------------------------------------- /crosshair reset from the client
    await send(page, { action: 'reset' });
    await settle(page);
    saved = await lastSave(page);
    check('client reset wipes everything', saved.mode === 'native' && saved.mine == null, saved);
    await page.close();
  }

  // ------------------------------------------------------------ stored settings + locked-down server
  {
    const stored = { v: 1, mode: 'custom', preset: 'custom', faint: true, style: { length: 9, color: '#3ce8ff' }, mine: { length: 9, color: '#3ce8ff' } };
    const page = await newPage(browser, { stored, config: baseConfig({ allowNone: false, allowEditor: false, allowShare: false, allowFaint: false, allowHitSound: false, defaultHitSound: false }) });
    const s = await lastSave(page);
    check('editor disabled: custom style replaced by the default', s.mode === 'native' && s.mine == null, s);
    check('AllowFaint = false: server default applies', s.faint === false, s);
    await send(page, { action: 'open' });
    const list = await tiles(page);
    check('no none tile when disallowed', !list.some((t) => t.key === 'none'));
    check('no custom tile when editor disabled', !list.some((t) => t.key === 'custom'));
    check('tabs hidden when editor disabled', await page.$eval('.tabs', (e) => e.classList.contains('hidden')));
    check('faint switch hidden when the server disallows it', await page.$eval('#xh-faint-row', (e) => e.classList.contains('hidden')));
    check('hit sound switch hidden when the server disallows it', await page.$eval('#xh-hit-row', (e) => e.classList.contains('hidden')));
    await send(page, { action: 'hit' });
    check('server default off: no sound', (await page.evaluate(() => window.__plays.length)) === 0);
    check('share buttons hidden', await page.$eval('#xh-copy', (e) => e.classList.contains('hidden')) && await page.$eval('#xh-import', (e) => e.classList.contains('hidden')));
    await page.close();
  }

  // ------------------------------------------------------------ stored custom settings restore + French
  {
    const stored = { v: 1, mode: 'custom', preset: 'circle', visibility: 'armed', style: {}, mine: { length: 9 } }; // old menu
    const page = await newPage(browser, { stored, locale: 'fr' });
    await send(page, { action: 'open' });
    await send(page, { action: 'overlay', show: true });
    await page.waitForTimeout(260);
    check('stored preset restored', (await tiles(page)).some((t) => t.key === 'circle' && t.on));
    check('French texts', (await page.textContent('#xh-title')) === 'Viseur');
    check('old "When armed" setting became faint = on', await page.$eval('#xh-faint', (e) => e.getAttribute('aria-checked') === 'true'));
    const foot = await page.$$eval('.foot .btn', (bs) => bs.map((b) => ({ h: b.offsetHeight, r: b.getBoundingClientRect().right })));
    const panelRight = await page.$eval('#xh-panel', (e) => e.getBoundingClientRect().right);
    check('French footer buttons on one line, inside the panel', foot.every((b) => b.h <= 30 && b.r <= panelRight - 18), foot);
    await shot(page, '06-fr-circle');
    await page.click('.tabs button[data-tab="editor"]');
    await shot(page, '07-fr-editor');
    const overflow = await page.evaluate(() => [...document.querySelectorAll('#xh-panel *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'visible' && e.clientWidth > 0).map((e) => e.className || e.tagName));
    check('no horizontal overflow in French', overflow.length === 0, overflow);
    await page.close();
  }

  // ------------------------------------------------------------ 1440p scaling
  {
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, userAgent: UA });
    await page.addInitScript(({ config, locale }) => {
      window.__posts = [];
      window.fetch = async (url, opts) => {
        const name = /cbz_crosshair\/(\w+)/.exec(String(url))[1];
        window.__posts.push({ name, body: opts && opts.body ? JSON.parse(opts.body) : {} });
        return new Response(JSON.stringify(name === 'ready' ? { settings: { mode: 'custom', preset: 'cross' }, config, locale } : { ok: true }));
      };
    }, { config: baseConfig(), locale: LOCALES.en });
    await page.goto(PAGE);
    await page.waitForFunction(() => window.__posts.some((p) => p.name === 'save'));
    await send(page, { action: 'overlay', show: true });
    const r = await page.$eval('#xh-reticle svg rect:last-child', (e) => ({ w: +e.getAttribute('width'), h: +e.getAttribute('height') }));
    check('1440p: cross arm scaled (4×2 px → 5×3 px)', r.w === 3 && r.h === 5, r);
    const b = await page.$eval('#xh-reticle svg', (e) => { const q = e.getBoundingClientRect(); return { cx: q.left + q.width / 2, cy: q.top + q.height / 2 }; });
    check('1440p: centred', Math.abs(b.cx - 1280) <= 0.5 && Math.abs(b.cy - 720) <= 0.5, b);
    await page.close();
  }

  await browser.close();
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
