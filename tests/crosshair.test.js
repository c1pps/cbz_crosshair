// node --test tests/  — pure crosshair logic (web/crosshair.js) + config.lua presets.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const X = require('../web/crosshair.js');

const ROOT = path.join(__dirname, '..');
const CONFIG = JSON.parse(execFileSync('lua5.4', [path.join(__dirname, 'dump_config.lua'), ROOT], { encoding: 'utf8' }));
const CFG = {
  default: CONFIG.Default, defaultFaint: CONFIG.DefaultFaint, allowFaint: CONFIG.AllowFaint, allowNone: CONFIG.AllowNone,
  defaultHitSound: CONFIG.DefaultHitSound, allowHitSound: CONFIG.AllowHitSound,
  allowEditor: CONFIG.AllowEditor, presets: CONFIG.Presets,
};

// ---------------------------------------------------------------- normalizeStyle
test('normalizeStyle({}) returns the defaults', () => {
  assert.deepEqual(X.normalizeStyle({}), X.DEFAULT_STYLE);
  assert.deepEqual(X.normalizeStyle(null), X.DEFAULT_STYLE);
  assert.notEqual(X.normalizeStyle({}), X.DEFAULT_STYLE, 'must be a copy');
});

test('normalizeStyle clamps, rounds and rejects junk', () => {
  const s = X.normalizeStyle({
    length: 999, thickness: 0, gap: -100, opacity: 'abc', dotSize: 4.6, radius: 2,
    circleThickness: 50, outlineThickness: 9, lines: 'yes', color: 'red', circleColor: '#ABC',
  });
  assert.equal(s.length, 30);
  assert.equal(s.thickness, 1);
  assert.equal(s.gap, -4);
  assert.equal(s.opacity, 100);
  assert.equal(s.dotSize, 5);
  assert.equal(s.radius, 3);
  assert.equal(s.circleThickness, 6);
  assert.equal(s.outlineThickness, 3);
  assert.equal(s.lines, X.DEFAULT_STYLE.lines);
  assert.equal(s.color, '#ffffff');
  assert.equal(s.circleColor, '#aabbcc');
});

test('normalizeStyle never yields an invisible crosshair', () => {
  const s = X.normalizeStyle({ lines: false, dot: false, circle: false });
  assert.equal(s.dot, true);
  const z = X.normalizeStyle({ lines: true, length: 0, dot: false, circle: false });
  assert.equal(z.dot, true);
});

test('colors are lower-cased and circleColor null means "match"', () => {
  assert.equal(X.normalizeStyle({ color: '#A1B2C3' }).color, '#a1b2c3');
  assert.equal(X.normalizeStyle({ circleColor: null }).circleColor, null);
  assert.equal(X.normalizeStyle({ circleColor: 'nope' }).circleColor, null);
});

// ---------------------------------------------------------------- settings
test('defaultSettings follows Config.Default', () => {
  assert.equal(X.defaultSettings({ ...CFG, default: 'native' }).mode, 'native');
  assert.equal(X.defaultSettings({ ...CFG, default: 'none' }).mode, 'none');
  assert.equal(X.defaultSettings({ ...CFG, default: 'none', allowNone: false }).mode, 'native');
  const p = X.defaultSettings({ ...CFG, default: 'cross' });
  assert.equal(p.mode, 'custom');
  assert.equal(p.preset, 'cross');
  assert.equal(p.style.length, 4);
  assert.equal(X.defaultSettings({ ...CFG, default: 'does-not-exist' }).mode, 'native');
});

test('normalizeSettings repairs bad input', () => {
  const d = X.defaultSettings(CFG);
  assert.deepEqual(X.normalizeSettings(null, CFG), d);
  assert.deepEqual(X.normalizeSettings('junk', CFG), d);
  const s = X.normalizeSettings({ mode: 'hacked', faint: true }, CFG);
  assert.equal(s.mode, d.mode);
  assert.equal(s.faint, true);
  assert.equal(X.normalizeSettings({ mode: 'custom', preset: 'custom', faint: 'x' }, CFG).faint, CFG.defaultFaint);
});

test('"faint until you aim" is the player\'s choice in every mode', () => {
  assert.equal(CFG.defaultFaint, false, 'shipped default = only while aiming, like GTA');
  assert.equal(X.defaultSettings(CFG).faint, false);
  assert.equal(X.defaultSettings({ ...CFG, defaultFaint: true }).faint, true);
  for (const raw of [{ mode: 'native' }, { mode: 'none' }, { mode: 'custom', preset: 'cross' },
    { mode: 'custom', preset: 'custom', style: {} }, { mode: 'hacked' }]) {
    assert.equal(X.normalizeSettings({ ...raw, faint: true }, CFG).faint, true, JSON.stringify(raw));
    assert.equal(X.normalizeSettings({ ...raw, faint: false }, CFG).faint, false, JSON.stringify(raw));
  }
});

test('Config.AllowFaint = false: the server default applies to everyone', () => {
  const off = { ...CFG, allowFaint: false, defaultFaint: false };
  const on = { ...CFG, allowFaint: false, defaultFaint: true };
  assert.equal(X.normalizeSettings({ mode: 'native', faint: true }, off).faint, false);
  assert.equal(X.normalizeSettings({ mode: 'custom', preset: 'custom', style: {}, faint: true }, off).faint, false);
  assert.equal(X.normalizeSettings({ mode: 'native', faint: false }, on).faint, true);
});

test('hit sound: on by default, the player can turn it off in every mode', () => {
  assert.equal(CFG.defaultHitSound, true);
  assert.equal(X.defaultSettings(CFG).hitSound, true);
  assert.equal(X.defaultSettings({ ...CFG, defaultHitSound: false }).hitSound, false);
  for (const raw of [{ mode: 'native' }, { mode: 'none' }, { mode: 'custom', preset: 'cross' },
    { mode: 'custom', preset: 'custom', style: {} }, { mode: 'hacked' }]) {
    assert.equal(X.normalizeSettings({ ...raw, hitSound: false }, CFG).hitSound, false, JSON.stringify(raw));
    assert.equal(X.normalizeSettings({ ...raw, hitSound: true }, CFG).hitSound, true, JSON.stringify(raw));
  }
  assert.equal(X.normalizeSettings({ mode: 'native', hitSound: 'x' }, CFG).hitSound, true);
});

test('Config.AllowHitSound = false: the server default applies to everyone', () => {
  assert.equal(X.normalizeSettings({ mode: 'native', hitSound: true }, { ...CFG, allowHitSound: false, defaultHitSound: false }).hitSound, false);
  assert.equal(X.normalizeSettings({ mode: 'native', hitSound: false }, { ...CFG, allowHitSound: false, defaultHitSound: true }).hitSound, true);
});

test('hit sounds ship with the resource: realistic variations by default, the tick as an option', () => {
  const fs = require('node:fs');
  const files = CONFIG.HitSoundFiles;
  assert.ok(Array.isArray(files) && files.length >= 3, 'several variations so it never sounds repeated');
  for (const file of [...files, 'sounds/tick.ogg']) {
    assert.match(file, /^sounds\/[A-Za-z0-9_-]+\.ogg$/);
    assert.ok(fs.statSync(path.join(ROOT, 'web', file)).size > 0, file);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'fxmanifest.lua'), 'utf8'), /"web\/sounds\/\*\.ogg"/);
});

test('settings saved by the old While aiming / When armed menu carry over', () => {
  assert.equal(X.normalizeSettings({ mode: 'native', visibility: 'armed' }, CFG).faint, true);
  assert.equal(X.normalizeSettings({ mode: 'native', visibility: 'aim' }, CFG).faint, false);
  const s = X.normalizeSettings({ mode: 'native', visibility: 'armed', dim: true }, CFG);
  assert.ok(!('visibility' in s) && !('dim' in s), 'old keys are dropped');
});

test('normalizeSettings refuses "none" when the server disallows it', () => {
  const s = X.normalizeSettings({ mode: 'none', preset: 'none' }, { ...CFG, allowNone: false });
  assert.equal(s.mode, 'native');
});

test('a preset selection always reflects the current config', () => {
  const s = X.normalizeSettings({ mode: 'custom', preset: 'cross', style: { length: 1 } }, CFG);
  assert.equal(s.style.length, 4);
  const gone = X.normalizeSettings({ mode: 'custom', preset: 'removed-preset', style: { length: 1 } }, CFG);
  assert.equal(gone.mode, X.defaultSettings(CFG).mode);
});

test('edited styles survive while the editor is allowed, not when it is disabled', () => {
  const raw = { mode: 'custom', preset: 'custom', style: { length: 13 } };
  assert.equal(X.normalizeSettings(raw, CFG).style.length, 13);
  const locked = X.normalizeSettings(raw, { ...CFG, allowEditor: false });
  assert.equal(locked.preset, X.defaultSettings(CFG).preset);
});

test('the player\'s own style ("mine") is kept while trying presets', () => {
  const s = X.normalizeSettings({ mode: 'custom', preset: 'cross', mine: { length: 17 } }, CFG);
  assert.equal(s.style.length, 4);
  assert.equal(s.mine.length, 17);
  const back = X.normalizeSettings({ mode: 'custom', preset: 'custom', mine: { length: 17 }, style: { length: 2 } }, CFG);
  assert.equal(back.style.length, 17);
  assert.deepEqual(back.style, back.mine);
  const legacy = X.normalizeSettings({ mode: 'custom', preset: 'custom', style: { length: 2 } }, CFG);
  assert.equal(legacy.mine.length, 2, 'falls back to style when mine is missing');
  assert.equal(X.normalizeSettings({ mode: 'native', mine: { length: 9 } }, CFG).mine.length, 9);
  assert.equal(X.normalizeSettings({ mode: 'native', mine: { length: 9 } }, { ...CFG, allowEditor: false }).mine, null);
  assert.equal(X.normalizeSettings({ mode: 'native', mine: 'junk' }, CFG).mine, null);
});

test('image presets come from config only and are path-checked', () => {
  const cfg = { ...CFG, presets: [...CFG.presets,
    { id: 'png', label: 'PNG', image: 'custom/mine.png', size: 500 },
    { id: 'evil', label: 'Evil', image: '../../evil.png' },
    { id: 'evil2', label: 'Evil2', image: 'javascript:alert(1)' }] };
  const s = X.normalizeSettings({ mode: 'custom', preset: 'png', image: { src: 'http://x/y.png' } }, cfg);
  assert.deepEqual(s.image, { src: 'custom/mine.png', size: 128 });
  assert.equal(X.normalizeSettings({ mode: 'custom', preset: 'evil' }, cfg).mode, X.defaultSettings(cfg).mode);
  assert.equal(X.normalizeSettings({ mode: 'custom', preset: 'evil2' }, cfg).mode, X.defaultSettings(cfg).mode);
  assert.equal(X.normalizeSettings({ mode: 'custom', preset: 'cross' }, cfg).image, null);
});

// ---------------------------------------------------------------- geometry
const rects = (shapes) => shapes.filter((s) => s.kind === 'rect');

test('classic cross at 1080p: four arms placed from the gap', () => {
  const g = X.geometry({ lines: true, length: 6, thickness: 2, gap: 3, outline: false }, 1);
  const arms = rects(g.layers.fill);
  assert.equal(arms.length, 4);
  assert.deepEqual(arms[0], { kind: 'rect', x: 3, y: -1, w: 6, h: 2, color: '#ffffff' });
  assert.deepEqual(arms[1], { kind: 'rect', x: -9, y: -1, w: 6, h: 2, color: '#ffffff' });
  assert.deepEqual(arms[2], { kind: 'rect', x: -1, y: 3, w: 2, h: 6, color: '#ffffff' });
  assert.deepEqual(arms[3], { kind: 'rect', x: -1, y: -9, w: 2, h: 6, color: '#ffffff' });
  assert.equal(g.shift, 0);
  assert.equal(g.layers.outline.length, 0);
});

test('T-shape drops the top arm', () => {
  const arms = rects(X.geometry({ lines: true, tshape: true, outline: false }, 1).layers.fill);
  assert.equal(arms.length, 3);
  assert.ok(arms.every((a) => !(a.w < a.h && a.y < 0)), 'no vertical arm above the centre');
});

test('odd thickness shifts by half a pixel for crisp lines', () => {
  assert.equal(X.geometry({ thickness: 1 }, 1).shift, 0.5);
  assert.equal(X.geometry({ thickness: 2 }, 1).shift, 0);
});

test('outline layer is drawn first, black, grown by the outline thickness', () => {
  const g = X.geometry({ lines: true, length: 6, thickness: 2, gap: 3, outline: true, outlineThickness: 1 }, 1);
  assert.equal(g.layers.outline.length, g.layers.fill.length);
  assert.deepEqual(g.layers.outline[0], { kind: 'rect', x: 2, y: -2, w: 8, h: 4, color: '#000000' });
  const ring = X.geometry({ lines: false, circle: true, radius: 9, circleThickness: 1, outline: true }, 1);
  assert.equal(ring.layers.outline[0].sw, 3);
});

test('scale factor resizes everything to whole pixels (min 1px)', () => {
  const g = X.geometry({ length: 6, thickness: 1, gap: 3, outline: false }, 2);
  assert.deepEqual(rects(g.layers.fill)[0], { kind: 'rect', x: 6, y: -1, w: 12, h: 2, color: '#ffffff' });
  const small = X.geometry({ thickness: 1 }, 0.5);
  assert.equal(rects(small.layers.fill)[0].h, 1);
});

test('canvas size is even and contains every shape', () => {
  for (const p of CFG.presets.filter((p) => p.style)) {
    for (const k of [1, 4 / 3, 2]) {
      const g = X.geometry(p.style, k);
      assert.equal(g.size % 2, 0, p.id);
      const half = g.size / 2;
      for (const sh of [...g.layers.outline, ...g.layers.fill]) {
        const ext = sh.kind === 'rect'
          ? Math.max(Math.abs(sh.x), Math.abs(sh.x + sh.w), Math.abs(sh.y), Math.abs(sh.y + sh.h))
          : sh.kind === 'ring' ? sh.r + sh.sw / 2 : sh.r;
        assert.ok(ext + g.shift <= half, `${p.id} @${k} fits`);
      }
    }
  }
});

test('ring draws in its own colour, or the main colour when matching', () => {
  const own = X.geometry({ lines: false, circle: true, circleColor: '#000000', color: '#ffffff' }, 1);
  assert.equal(own.layers.fill.find((s) => s.kind === 'ring').color, '#000000');
  const match = X.geometry({ lines: false, circle: true, circleColor: null, color: '#3ce8ff' }, 1);
  assert.equal(match.layers.fill.find((s) => s.kind === 'ring').color, '#3ce8ff');
});

test('renderSVG is well-formed markup with no NaN/undefined', () => {
  for (const p of CFG.presets.filter((p) => p.style)) {
    const svg = X.renderSVG(p.style, 1);
    assert.match(svg, /^<svg [^>]*width="\d+" height="\d+"[^>]*>.*<\/svg>$/s, p.id);
    assert.doesNotMatch(svg, /NaN|undefined|null/, p.id);
  }
});

// ---------------------------------------------------------------- share codes
test('share codes round-trip every preset', () => {
  for (const p of CFG.presets.filter((p) => p.style)) {
    const style = X.normalizeStyle(p.style);
    const code = X.encode(style);
    assert.match(code, /^CBZ1-[A-Za-z0-9_-]{22}$/, p.id);
    assert.deepEqual(X.decode(code), style, p.id);
  }
});

test('share codes round-trip random styles', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const hex = () => '#' + [0, 0, 0].map(() => rnd(256).toString(16).padStart(2, '0')).join('');
  for (let i = 0; i < 300; i++) {
    const style = X.normalizeStyle({
      color: hex(), opacity: 10 + rnd(91), lines: !!rnd(2), tshape: !!rnd(2), length: rnd(31), thickness: 1 + rnd(8),
      gap: -4 + rnd(25), dot: !!rnd(2), dotSize: 1 + rnd(10), dotRound: !!rnd(2), circle: !!rnd(2), radius: 3 + rnd(38),
      circleThickness: 1 + rnd(6), circleColor: rnd(2) ? hex() : null, outline: !!rnd(2), outlineThickness: 1 + rnd(3),
    });
    assert.deepEqual(X.decode(X.encode(style)), style);
  }
});

test('decode accepts surrounding spaces and a lower-case prefix', () => {
  const code = X.encode(X.normalizeStyle({}));
  assert.deepEqual(X.decode('  ' + code.replace('CBZ1', 'cbz1') + '\n'), X.normalizeStyle({}));
});

test('decode rejects anything that is not an intact code', () => {
  const code = X.encode(X.normalizeStyle({}));
  const flip = code.slice(0, 8) + (code[8] === 'A' ? 'B' : 'A') + code.slice(9);
  for (const bad of ['', 'hello', 'CBZ2-' + code.slice(5), code.slice(0, -1), code + 'A', flip, 'CBZ1-!!!!!!!!!!!!!!!!!!!!!!', null, 42]) {
    assert.equal(X.decode(bad), null, String(bad));
  }
});

test('decode clamps out-of-range values inside a valid code', () => {
  const bytes = X._codeBytes(X.normalizeStyle({}));
  bytes[5] = 200; // length
  bytes[6] = 0;   // thickness
  const code = X._bytesToCode(bytes);
  const s = X.decode(code);
  assert.equal(s.length, 30);
  assert.equal(s.thickness, 1);
});

// ---------------------------------------------------------------- config
test('config presets are unique and every one of them is valid', () => {
  const ids = CFG.presets.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes('native') && !ids.includes('none') && !ids.includes('custom'), 'reserved ids');
  for (const p of CFG.presets) assert.ok(p.style || p.image, p.id);
  const pv = CONFIG.Native.preview;
  assert.ok(pv === 'gta' || ids.includes(pv) || (pv && typeof pv === 'object'), 'Native.preview');
});

test('shipped presets stay roleplay-sober: plain white, small, no outline', () => {
  for (const p of CFG.presets.filter((p) => p.style)) {
    const s = X.normalizeStyle(p.style);
    assert.equal(s.color, '#ffffff', p.id);
    assert.equal(s.circleColor, null, p.id);
    assert.equal(s.outline, false, p.id);
    assert.ok(X.geometry(s, 1).size <= 16, `${p.id} fits in 16px at 1080p`);
  }
});

test('the editor starts from the small white cross', () => {
  const s = X.normalizeStyle({});
  assert.equal(s.color, '#ffffff');
  assert.equal(s.outline, false);
  assert.ok(X.geometry(s, 1).size <= 16);
});

test('weapon group names in config hash to the real GTA group hashes', () => {
  const KNOWN = {
    GROUP_PISTOL: 416676503, GROUP_SMG: 3337201093, GROUP_RIFLE: 970310034, GROUP_MG: 1159398588,
    GROUP_SHOTGUN: 860033945, GROUP_SNIPER: 3082541095, GROUP_HEAVY: 2725924767, GROUP_THROWN: 1548507267,
    GROUP_STUNGUN: 690389602,
  };
  const joaat = (str) => {
    let h = 0;
    for (const ch of str.toLowerCase()) {
      h = (h + ch.charCodeAt(0)) >>> 0; h = (h + (h << 10)) >>> 0; h = (h ^ (h >>> 6)) >>> 0;
    }
    h = (h + (h << 3)) >>> 0; h = (h ^ (h >>> 11)) >>> 0; h = (h + (h << 15)) >>> 0;
    return h;
  };
  for (const name of CONFIG.WeaponGroups) {
    assert.ok(name in KNOWN, name);
    assert.equal(joaat(name), KNOWN[name], name);
  }
});
