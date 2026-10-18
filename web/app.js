/* cbz_crosshair — NUI controller: the in-game crosshair overlay and the /crosshair drawer.
   Developed by wthejulio · CBz Network */
(function () {
  'use strict';

  const X = window.CbzCrosshair;
  const RES = typeof window.GetParentResourceName === 'function' ? window.GetParentResourceName() : 'cbz_crosshair';
  // Tile/preview stand-in for the stock GTA reticle (Config.Native.preview = 'gta').
  const GTA_STYLE = { color: '#ffffff', opacity: 90, lines: false, dot: true, dotSize: 3, dotRound: true, outline: true, outlineThickness: 1 };
  const HEX = /^#?([0-9a-f]{6})$/i;
  const SOUND_SRC = /^sounds\/[A-Za-z0-9_-]+\.ogg$/;

  const $ = (id) => document.getElementById(id);
  let cfg = null;
  let L = {};
  let settings = null;
  const overlay = { show: false, full: true, target: false, blocked: false }; // from the client, every change
  const ui = { open: false, tab: 'presets', bg: 'sky', sheet: null };
  const controls = []; // editor controls: { sync(style) }
  const hitAudio = []; // one <audio> per variation
  let lastHit = -1;

  const t = (key) => (typeof L[key] === 'string' ? L[key] : key);
  const scale = () => window.innerHeight / 1080;
  const even = (n) => (n % 2 ? n + 1 : n);

  function post(name, body) {
    return fetch(`https://${RES}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(body || {}),
    }).then((r) => r.json()).catch(() => null);
  }

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c) node.appendChild(c);
    return node;
  }

  // ---------------------------------------------------------------- settings

  let saveTimer = null;
  function save(now) {
    clearTimeout(saveTimer);
    const send = () => {
      saveTimer = null;
      const { v, mode, preset, faint, hitSound, style, mine } = settings;
      post('save', { settings: { v, mode, preset, faint, hitSound, style, mine } });
    };
    if (now) send(); else saveTimer = setTimeout(send, 150);
  }
  function flushSave() { if (saveTimer) save(true); }

  function setSettings(raw, immediate) {
    settings = X.normalizeSettings(raw, cfg);
    save(immediate);
    render();
  }

  // The style the editor shows (and edits).
  function editable() {
    if (settings.mode === 'custom' && !settings.image) return settings.style;
    return settings.mine || settings.style;
  }

  function edit(patch) {
    if (!cfg.allowEditor) return;
    const style = X.normalizeStyle({ ...editable(), ...patch });
    setSettings({ ...settings, mode: 'custom', preset: 'custom', style, mine: style }, false);
  }

  // ---------------------------------------------------------------- art

  function nativeEntry() {
    const pv = cfg.native && cfg.native.preview;
    if (pv && typeof pv === 'object' && !Array.isArray(pv)) return { style: X.normalizeStyle(pv), image: null };
    const p = typeof pv === 'string' && pv !== 'gta' ? X.findPreset(cfg, pv) : null;
    return p || { style: X.normalizeStyle(GTA_STYLE), image: null };
  }

  /** Fills `host` with the crosshair, scaled to fit `box` px (never above maxK). */
  function drawArt(host, entry, box, maxK) {
    host.textContent = '';
    if (entry.image) {
      const k = Math.min(maxK, box / entry.image.size);
      const size = Math.max(1, Math.round(entry.image.size * k));
      host.appendChild(h('img', { src: entry.image.src, width: size, height: size, alt: '' }));
      return;
    }
    const k = Math.min(maxK, box / X.geometry(entry.style, 1).size);
    host.innerHTML = X.renderSVG(entry.style, k);
  }

  function noneIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'none-icon');
    svg.innerHTML = '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>';
    return svg;
  }

  // ---------------------------------------------------------------- overlay

  // Like GTA: red while aiming at a living ped (the client decides; image presets keep their colours).
  function overlayStyle() {
    const target = overlay.target && !overlay.blocked && typeof cfg.targetColor === 'string' && HEX.test(cfg.targetColor);
    if (!target) return settings.style;
    const red = '#' + HEX.exec(cfg.targetColor)[1].toLowerCase();
    return { ...settings.style, color: red };
  }

  function renderOverlay() {
    const host = $('xh-reticle');
    const custom = settings && settings.mode === 'custom';
    if (!custom) {
      host.textContent = '';
    } else if (settings.image) {
      const size = even(Math.max(2, Math.round(settings.image.size * scale())));
      host.textContent = '';
      host.appendChild(h('img', { src: settings.image.src, width: size, height: size, alt: '' }));
      host.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
    } else {
      const k = scale();
      const style = overlayStyle();
      host.innerHTML = X.renderSVG(style, k);
      const size = X.geometry(style, k).size;
      host.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
    }
    // "Faint until you aim": faint while the weapon is out, full opacity as soon as you aim.
    // Gun behind a wall (look bug): always faint.
    const faint = custom && (overlay.blocked || (settings.faint && !overlay.full));
    host.style.opacity = faint ? String((cfg.faintOpacity || 35) / 100) : '1';
    $('xh-overlay').classList.toggle('hidden', !(overlay.show && custom));
  }

  // ---------------------------------------------------------------- drawer

  function applyTexts() {
    document.querySelectorAll('[data-t]').forEach((n) => { n.textContent = t(n.dataset.t); });
    document.querySelectorAll('[data-tt]').forEach((n) => {
      n.title = t(n.dataset.tt);
      n.setAttribute('aria-label', t(n.dataset.tt));
    });
  }

  function renderPreview() {
    const box = $('xh-preview');
    box.dataset.bg = ui.bg;
    box.querySelectorAll('.bg-dot').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.bg === ui.bg)));
    box.querySelectorAll('.preview-note').forEach((n) => n.remove());
    const art = $('xh-preview-art');
    if (settings.mode === 'none') {
      art.textContent = '';
      box.appendChild(h('span', { class: 'preview-note', text: t('off') }));
    } else if (settings.mode === 'native') {
      drawArt(art, nativeEntry(), 104, 2);
      box.appendChild(h('span', { class: 'preview-note', text: t('game_reticle') }));
    } else {
      drawArt(art, settings.image ? { image: settings.image } : { style: settings.style }, 104, 2);
    }
  }

  function renderOptions() {
    $('xh-faint-row').classList.toggle('hidden', cfg.allowFaint === false);
    $('xh-faint').setAttribute('aria-checked', String(!!settings.faint));
    $('xh-hit-row').classList.toggle('hidden', cfg.allowHitSound === false);
    $('xh-hit').setAttribute('aria-checked', String(!!settings.hitSound));
  }

  // ---------------------------------------------------------------- hit sound

  function setupHitSound() {
    const hs = cfg.hitSound || {};
    const volume = Number.isFinite(hs.volume) ? Math.min(100, Math.max(0, hs.volume)) / 100 : 0.5;
    const files = (Array.isArray(hs.files) ? hs.files : [hs.files]).filter((f) => typeof f === 'string' && SOUND_SRC.test(f));
    for (const src of files.length ? files : ['sounds/hit_1.ogg']) {
      const a = new Audio(src);
      a.preload = 'auto';
      a.volume = volume;
      hitAudio.push(a);
    }
  }

  // A different variation each time (the same sample over and over sounds fake).
  function playHit() {
    if (!hitAudio.length) return;
    let i = Math.floor(Math.random() * hitAudio.length);
    if (hitAudio.length > 1 && i === lastHit) i = (i + 1 + Math.floor(Math.random() * (hitAudio.length - 1))) % hitAudio.length;
    lastHit = i;
    const a = hitAudio[i];
    try { a.currentTime = 0; } catch (e) { /* not loaded yet */ }
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  function renderTabs() {
    const tabs = document.querySelector('.tabs');
    tabs.classList.toggle('hidden', !cfg.allowEditor);
    if (!cfg.allowEditor) ui.tab = 'presets';
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== ui.tab));
  }

  function tile(key, name, sub, pressed, onPick, fill) {
    const art = h('div', { class: 'tile-art' });
    fill(art);
    // A div, not a <button>: FiveM's older Chromium does not stretch the flex children of a <button>.
    return h('div', { class: 'tile', role: 'button', tabindex: '0', 'aria-pressed': String(pressed), 'data-key': key, onclick: onPick,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } } },
      art,
      h('div', { class: 'tile-meta' },
        h('span', { class: 'tile-name', text: name }),
        sub ? h('span', { class: 'tile-sub', text: sub }) : null));
  }

  function renderGrid() {
    const grid = $('xh-grid');
    grid.textContent = '';
    const pick = (raw) => () => { setSettings({ ...settings, ...raw }, true); };

    grid.appendChild(tile('native', cfg.native.label, t('game_reticle'), settings.mode === 'native',
      pick({ mode: 'native', preset: 'native' }), (a) => drawArt(a, nativeEntry(), 48, 1.5)));
    if (cfg.allowNone) {
      grid.appendChild(tile('none', t('none'), t('off'), settings.mode === 'none',
        pick({ mode: 'none', preset: 'none' }), (a) => a.appendChild(noneIcon())));
    }
    if (cfg.allowEditor && settings.mine) {
      const mine = settings.mine;
      grid.appendChild(tile('custom', t('edited'), t('tab_editor'), settings.mode === 'custom' && settings.preset === 'custom',
        pick({ mode: 'custom', preset: 'custom' }), (a) => drawArt(a, { style: mine }, 48, 1.5)));
    }
    for (const raw of cfg.presets || []) {
      const p = raw && X.findPreset(cfg, raw.id);
      if (!p) continue;
      grid.appendChild(tile(p.id, String(raw.label || p.id), p.image ? t('image') : null,
        settings.mode === 'custom' && settings.preset === p.id,
        pick({ mode: 'custom', preset: p.id }), (a) => drawArt(a, p, 48, 1.5)));
    }
  }

  // ------------------------------------------------ editor (built once, synced on change)

  function slider(key, label, unit) {
    const [min, max] = X.LIMITS[key];
    const value = h('span', { class: 'slider-value' });
    const input = h('input', { type: 'range', min, max, step: 1, 'data-key': key, 'aria-label': t(label) });
    input.addEventListener('input', () => edit({ [key]: Number(input.value) }));
    controls.push({
      sync(s) {
        if (document.activeElement !== input || Number(input.value) !== s[key]) input.value = s[key];
        input.style.setProperty('--p', `${((s[key] - min) / (max - min)) * 100}%`);
        value.textContent = `${s[key]}${unit}`;
      },
    });
    return h('div', { class: 'slider' }, h('div', { class: 'slider-top' }, h('span', { class: 'field-label', text: t(label) }), value), input);
  }

  function switchBtn(key, label) {
    const btn = h('button', { type: 'button', class: 'switch', role: 'switch', 'data-key': key, 'aria-label': t(label) });
    btn.addEventListener('click', () => edit({ [key]: btn.getAttribute('aria-checked') !== 'true' }));
    controls.push({ sync(s) { btn.setAttribute('aria-checked', String(!!s[key])); } });
    return btn;
  }

  function switchRow(key, label) {
    return h('div', { class: 'field-row' }, h('span', { class: 'field-label', text: t(label) }), switchBtn(key, label));
  }

  function segmentedRow(key, label, options) {
    const seg = h('div', { class: 'segmented', 'data-key': key });
    for (const [val, text] of options) {
      seg.appendChild(h('button', { type: 'button', text: t(text), onclick: () => edit({ [key]: val }) }));
    }
    controls.push({
      sync(s) { [...seg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === s[key]))); },
    });
    return h('div', { class: 'field-row' }, h('span', { class: 'field-label', text: t(label) }), seg);
  }

  function colorField(key, allowMatch) {
    const wrap = h('div', { class: 'swatches', 'data-key': key });
    const buttons = [];
    if (allowMatch) {
      const m = h('button', { type: 'button', class: 'swatch match', text: t('match'), onclick: () => edit({ [key]: null }) });
      buttons.push([null, m]);
      wrap.appendChild(m);
    }
    for (const c of cfg.swatches || []) {
      if (typeof c !== 'string' || !HEX.test(c)) continue;
      const color = c.toLowerCase();
      const b = h('button', { type: 'button', class: 'swatch', title: color, 'aria-label': color, onclick: () => edit({ [key]: color }) });
      b.style.background = color;
      buttons.push([color, b]);
      wrap.appendChild(b);
    }
    const chip = h('span', { class: 'hex-chip' });
    const input = h('input', { class: 'input mono', maxlength: 7, spellcheck: 'false', 'aria-label': t('hex') });
    input.addEventListener('input', () => {
      const m = HEX.exec(input.value.trim());
      input.classList.toggle('invalid', !m && input.value.trim().length >= 6);
      if (m) edit({ [key]: '#' + m[1].toLowerCase() });
    });
    input.addEventListener('blur', () => { input.classList.remove('invalid'); syncEditor(); });
    wrap.appendChild(h('div', { class: 'hex' }, chip, input));
    controls.push({
      sync(s) {
        const shown = s[key] || s.color;
        for (const [c, b] of buttons) b.setAttribute('aria-pressed', String(c === s[key]));
        chip.style.background = shown;
        if (document.activeElement !== input) input.value = shown;
      },
    });
    return wrap;
  }

  function section(key, title, ...fields) {
    const body = h('div', { class: 'section-body' }, ...fields);
    const head = h('div', { class: 'section-head' }, h('h3', { text: t(title) }), key ? switchBtn(key, title) : null);
    if (key) controls.push({ sync(s) { body.classList.toggle('hidden', !s[key]); } });
    return h('div', { class: 'section', 'data-section': key || 'color' }, head, body);
  }

  function buildEditor() {
    const host = $('xh-editor');
    host.textContent = '';
    controls.length = 0;
    if (!cfg.allowEditor) {
      host.appendChild(h('p', { class: 'note', text: t('editor_disabled') }));
      return;
    }
    const note = h('p', { class: 'note', id: 'xh-editor-note' });
    host.appendChild(note);
    controls.push({
      sync() {
        const text = settings.image ? t('editor_image') : settings.preset !== 'custom' ? t('editor_hint') : '';
        note.textContent = text;
        note.classList.toggle('hidden', !text);
      },
    });
    host.append(
      section(null, 'sec_color', colorField('color', false), slider('opacity', 'opacity', '%')),
      section('lines', 'sec_lines', slider('length', 'length', ' px'), slider('thickness', 'thickness', ' px'),
        slider('gap', 'gap', ' px'), switchRow('tshape', 'tshape')),
      section('dot', 'sec_dot', slider('dotSize', 'size', ' px'), segmentedRow('dotRound', 'shape', [[false, 'square'], [true, 'round']])),
      section('circle', 'sec_circle', slider('radius', 'radius', ' px'), slider('circleThickness', 'thickness', ' px'),
        h('div', { class: 'field-label', text: t('ring_color') }), colorField('circleColor', true)),
      section('outline', 'sec_outline', slider('outlineThickness', 'thickness', ' px')),
    );
  }

  function syncEditor() {
    const s = editable();
    for (const c of controls) c.sync(s);
  }

  function renderFooter() {
    const copy = $('xh-copy');
    copy.classList.toggle('hidden', !cfg.allowShare);
    copy.disabled = settings.mode !== 'custom';
    copy.title = settings.image ? t('image_no_share') : '';
    $('xh-import').classList.toggle('hidden', !(cfg.allowShare && cfg.allowEditor));
  }

  function render() {
    if (!settings) return;
    renderOverlay();
    if (!ui.open) return;
    renderPreview();
    renderOptions();
    renderTabs();
    renderGrid();
    syncEditor();
    renderFooter();
  }

  // ---------------------------------------------------------------- sheet, toast

  let toastTimer = null;
  function toast(text) {
    const el = $('xh-toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  function openSheet(kind, code) {
    ui.sheet = kind;
    const input = $('xh-code');
    $('xh-sheet').classList.remove('hidden');
    $('xh-sheet-error').classList.add('hidden');
    input.classList.remove('invalid');
    input.readOnly = kind === 'copy';
    input.classList.toggle('hidden', kind === 'reset');
    input.placeholder = kind === 'import' ? t('paste_hint') : '';
    input.value = code || '';
    $('xh-sheet-text').textContent = kind === 'reset' ? t('reset_confirm') : kind === 'copy' ? t('copy_manual') : t('import_title');
    $('xh-sheet-ok').textContent = kind === 'reset' ? t('confirm') : kind === 'copy' ? t('close') : t('apply');
    $('xh-sheet-cancel').classList.toggle('hidden', kind === 'copy');
    if (kind !== 'reset') { input.focus(); input.select(); }
  }

  function closeSheet() {
    ui.sheet = null;
    $('xh-sheet').classList.add('hidden');
  }

  function sheetOk() {
    if (ui.sheet === 'import') {
      const style = X.decode($('xh-code').value);
      if (!style) {
        $('xh-code').classList.add('invalid');
        const err = $('xh-sheet-error');
        err.textContent = t('invalid_code');
        err.classList.remove('hidden');
        return;
      }
      closeSheet();
      setSettings({ ...settings, mode: 'custom', preset: 'custom', style, mine: style }, true);
      toast(t('imported'));
      return;
    }
    if (ui.sheet === 'reset') {
      const d = X.defaultSettings(cfg);
      closeSheet();
      setSettings({ ...d, mine: settings.mine }, true);
      return;
    }
    closeSheet();
  }

  function copyCode() {
    if (settings.mode !== 'custom') return;
    if (settings.image) { toast(t('image_no_share')); return; }
    const code = X.encode(settings.style);
    const ta = h('textarea', { readonly: true });
    ta.value = code;
    ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (ok) toast(t('copied')); else openSheet('copy', code);
  }

  // ---------------------------------------------------------------- open / close

  function openMenu() {
    if (!settings) return;
    ui.open = true;
    closeSheet();
    $('xh-panel').classList.remove('hidden');
    render();
  }

  function closeMenu(fromClient) {
    if (!ui.open) return;
    ui.open = false;
    closeSheet();
    $('xh-panel').classList.add('hidden');
    flushSave();
    if (!fromClient) post('close');
  }

  // ---------------------------------------------------------------- wiring

  function wire() {
    $('xh-close').addEventListener('click', () => closeMenu(false));
    $('xh-faint').addEventListener('click', () => setSettings({ ...settings, faint: !settings.faint }, true));
    $('xh-hit').addEventListener('click', () => {
      setSettings({ ...settings, hitSound: !settings.hitSound }, true);
      if (settings.hitSound) playHit(); // let the player hear it
    });
    document.querySelector('.tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      ui.tab = b.dataset.tab;
      render();
      $('xh-body').scrollTop = 0;
    });
    $('xh-preview').addEventListener('click', (e) => {
      const b = e.target.closest('.bg-dot');
      if (!b) return;
      ui.bg = b.dataset.bg;
      try { localStorage.setItem('cbz_crosshair:bg', ui.bg); } catch (err) { /* storage unavailable */ }
      renderPreview();
    });
    $('xh-copy').addEventListener('click', copyCode);
    $('xh-import').addEventListener('click', () => openSheet('import'));
    $('xh-reset').addEventListener('click', () => openSheet('reset'));
    $('xh-sheet-ok').addEventListener('click', sheetOk);
    $('xh-sheet-cancel').addEventListener('click', closeSheet);
    $('xh-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') sheetOk(); });

    document.addEventListener('keydown', (e) => {
      if (!ui.open || e.key !== 'Escape') return;
      if (ui.sheet) closeSheet(); else closeMenu(false);
    });
    window.addEventListener('resize', renderOverlay);
    window.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.action === 'overlay') {
        overlay.show = !!d.show;
        overlay.full = d.full !== false;
        overlay.target = !!d.target;
        overlay.blocked = !!d.blocked;
        if (settings) renderOverlay();
      }
      else if (d.action === 'hit') { if (settings && settings.hitSound) playHit(); }
      else if (d.action === 'open') openMenu();
      else if (d.action === 'close') closeMenu(true);
      else if (d.action === 'reset' && cfg) setSettings(null, true);
    });
  }

  async function boot(attempt) {
    const res = await post('ready');
    if (!res || !res.config) {
      if (attempt < 60) setTimeout(() => boot(attempt + 1), 500);
      return;
    }
    cfg = res.config;
    cfg.native = cfg.native || { label: 'Default', preview: 'gta' };
    L = res.locale || {};
    try { const bg = localStorage.getItem('cbz_crosshair:bg'); if (['dark', 'sky', 'light'].includes(bg)) ui.bg = bg; } catch (err) { /* ignore */ }
    applyTexts();
    setupHitSound();
    buildEditor();
    setSettings(res.settings || null, true); // normalised copy goes back to the client (KVP)
  }

  wire();
  boot(0);
})();
