/* cbz_crosshair — pure crosshair model: normalise settings, build the SVG, share codes.
   No DOM access here: the same file runs in the NUI page and in the node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CbzCrosshair = factory();
})(this, function () {
  'use strict';

  // Sizes are pixels on a 1080p screen; the page scales them by innerHeight / 1080.
  const DEFAULT_STYLE = Object.freeze({
    color: '#ffffff', opacity: 100,
    lines: true, tshape: false, length: 4, thickness: 2, gap: 2,
    dot: false, dotSize: 3, dotRound: false,
    circle: false, radius: 4, circleThickness: 1, circleColor: null,
    outline: false, outlineThickness: 1,
  });

  const LIMITS = Object.freeze({
    opacity: [10, 100], length: [0, 30], thickness: [1, 8], gap: [-4, 20], dotSize: [1, 10],
    radius: [3, 40], circleThickness: [1, 6], outlineThickness: [1, 3],
  });

  const BOOLS = ['lines', 'tshape', 'dot', 'dotRound', 'circle', 'outline'];
  const MODES = ['native', 'custom', 'none'];
  const RESERVED = ['native', 'none', 'custom'];
  const IMAGE_SRC = /^custom\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.(png|webp|jpg|jpeg|svg)$/;

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

  function hexColor(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return null;
  }

  function normalizeStyle(raw) {
    const src = isObj(raw) ? raw : {};
    const s = { ...DEFAULT_STYLE };
    for (const key of Object.keys(LIMITS)) {
      const n = typeof src[key] === 'number' ? src[key] : typeof src[key] === 'string' && src[key].trim() !== '' ? Number(src[key]) : NaN;
      if (Number.isFinite(n)) s[key] = clamp(Math.round(n), LIMITS[key]);
    }
    for (const key of BOOLS) if (typeof src[key] === 'boolean') s[key] = src[key];
    s.color = hexColor(src.color) || DEFAULT_STYLE.color;
    s.circleColor = hexColor(src.circleColor);
    // A custom crosshair is never invisible (that is what the "None" option is for).
    if (!(s.lines && s.length > 0) && !s.dot && !s.circle) s.dot = true;
    return s;
  }

  function normalizeImage(preset) {
    if (!isObj(preset) || typeof preset.image !== 'string' || !IMAGE_SRC.test(preset.image)) return null;
    const size = Number.isFinite(preset.size) ? clamp(Math.round(preset.size), [8, 128]) : 32;
    return { src: preset.image, size };
  }

  function findPreset(cfg, id) {
    const list = cfg && Array.isArray(cfg.presets) ? cfg.presets : [];
    if (typeof id !== 'string' || RESERVED.includes(id)) return null;
    const p = list.find((x) => isObj(x) && x.id === id);
    if (!p) return null;
    if (p.style) return { id: p.id, style: normalizeStyle(p.style), image: null };
    const image = normalizeImage(p);
    return image ? { id: p.id, style: null, image } : null;
  }

  function defaultSettings(cfg) {
    const c = cfg || {};
    const s = {
      v: 1, mode: 'native', preset: 'native',
      faint: c.defaultFaint === true, // "Faint until you aim": shown faint while the weapon is out
      hitSound: c.defaultHitSound !== false, // tick when you hit a player or NPC
      style: normalizeStyle(null), mine: null, image: null,
    };
    if (c.default === 'none' && c.allowNone !== false) {
      s.mode = 'none'; s.preset = 'none';
    } else {
      const p = findPreset(c, c.default);
      if (p) {
        s.mode = 'custom'; s.preset = p.id;
        if (p.style) s.style = p.style; else s.image = p.image;
      }
    }
    return s;
  }

  function normalizeSettings(raw, cfg) {
    const c = cfg || {};
    const d = defaultSettings(c);
    if (!isObj(raw)) return d;
    // The server can hide the option (Config.AllowFaint): everyone then gets Config.DefaultFaint.
    // `visibility: 'armed'` = what the old While aiming / When armed menu saved.
    const faint = c.allowFaint === false ? d.faint
      : typeof raw.faint === 'boolean' ? raw.faint
        : raw.visibility === 'armed' ? true : raw.visibility === 'aim' ? false : d.faint;
    const hitSound = c.allowHitSound === false || typeof raw.hitSound !== 'boolean' ? d.hitSound : raw.hitSound;
    const style = normalizeStyle(raw.style);
    // `mine` = the player's own edited style, kept while they try presets.
    const mine = c.allowEditor === false ? null : isObj(raw.mine) ? normalizeStyle(raw.mine) : null;
    const keep = (s) => ({ ...s, faint, hitSound, mine });

    if (!MODES.includes(raw.mode)) return keep(d);
    if (raw.mode === 'native') return keep({ ...d, mode: 'native', preset: 'native', style, image: null });
    if (raw.mode === 'none') {
      return c.allowNone === false ? keep(d) : keep({ ...d, mode: 'none', preset: 'none', style, image: null });
    }
    // custom: either a preset (always taken fresh from config) or the player's own style.
    const p = findPreset(c, raw.preset);
    if (p) return keep({ ...d, mode: 'custom', preset: p.id, style: p.style || style, image: p.image });
    if (raw.preset === 'custom' && c.allowEditor !== false) {
      const own = mine || style;
      return { ...d, mode: 'custom', preset: 'custom', style: own, mine: own, image: null, faint, hitSound };
    }
    return keep(d);
  }

  // ------------------------------------------------------------------ geometry
  function grow(sh, o) {
    if (sh.kind === 'rect') return { kind: 'rect', x: sh.x - o, y: sh.y - o, w: sh.w + 2 * o, h: sh.h + 2 * o, color: '#000000' };
    if (sh.kind === 'ring') return { kind: 'ring', r: sh.r, sw: sh.sw + 2 * o, color: '#000000' };
    return { kind: 'disc', r: sh.r + o, color: '#000000' };
  }

  function extent(sh) {
    if (sh.kind === 'rect') return Math.max(Math.abs(sh.x), Math.abs(sh.x + sh.w), Math.abs(sh.y), Math.abs(sh.y + sh.h));
    if (sh.kind === 'ring') return sh.r + sh.sw / 2;
    return sh.r;
  }

  function geometry(style, k) {
    const s = normalizeStyle(style);
    const scale = Number.isFinite(k) && k > 0 ? k : 1;
    const px = (v) => Math.round(v * scale);
    const t = Math.max(1, px(s.thickness));
    const L = Math.max(0, px(s.length));
    const g = px(s.gap);
    const d = Math.max(1, px(s.dotSize));
    const R = Math.max(1, px(s.radius));
    const ct = Math.max(1, px(s.circleThickness));
    const o = s.outline ? Math.max(1, px(s.outlineThickness)) : 0;
    const color = s.color;
    const drawLines = s.lines && L > 0;

    const fill = [];
    if (s.circle) fill.push({ kind: 'ring', r: R, sw: ct, color: s.circleColor || color });
    if (drawLines) {
      const h = t / 2;
      fill.push({ kind: 'rect', x: g, y: -h, w: L, h: t, color });
      fill.push({ kind: 'rect', x: -g - L, y: -h, w: L, h: t, color });
      fill.push({ kind: 'rect', x: -h, y: g, w: t, h: L, color });
      if (!s.tshape) fill.push({ kind: 'rect', x: -h, y: -g - L, w: t, h: L, color });
    }
    if (s.dot) {
      fill.push(s.dotRound ? { kind: 'disc', r: d / 2, color } : { kind: 'rect', x: -d / 2, y: -d / 2, w: d, h: d, color });
    }
    const outline = o ? fill.map((sh) => grow(sh, o)) : [];

    // Odd widths are centred on a pixel instead of a pixel edge, so they render crisp.
    const basis = drawLines ? t : s.dot ? d : ct;
    const shift = basis % 2 === 1 ? 0.5 : 0;
    let ext = 0;
    for (const sh of outline.concat(fill)) ext = Math.max(ext, extent(sh));
    const size = 2 * Math.ceil(ext + shift + 1);

    return { size, shift, opacity: s.opacity / 100, layers: { outline, fill } };
  }

  function n(v) { return String(Math.round(v * 1000) / 1000); }

  function shapeMarkup(sh) {
    if (sh.kind === 'rect') return `<rect x="${n(sh.x)}" y="${n(sh.y)}" width="${n(sh.w)}" height="${n(sh.h)}" fill="${sh.color}"/>`;
    if (sh.kind === 'ring') return `<circle r="${n(sh.r)}" fill="none" stroke="${sh.color}" stroke-width="${n(sh.sw)}" shape-rendering="geometricPrecision"/>`;
    return `<circle r="${n(sh.r)}" fill="${sh.color}" shape-rendering="geometricPrecision"/>`;
  }

  function renderSVG(style, k) {
    const g = geometry(style, k);
    const S = g.size;
    const h = S / 2;
    let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="${-h} ${-h} ${S} ${S}" shape-rendering="crispEdges">`;
    out += `<g opacity="${n(g.opacity)}" transform="translate(${g.shift} ${g.shift})">`;
    for (const sh of g.layers.outline) out += shapeMarkup(sh);
    for (const sh of g.layers.fill) out += shapeMarkup(sh);
    return out + '</g></svg>';
  }

  // ------------------------------------------------------------------ share codes
  // CBZ1- + base64url(16 bytes): flags, rgb, opacity, length, thickness, gap+64, dotSize,
  // radius, circleThickness, circle rgb, outlineThickness, checksum.
  const PREFIX = 'CBZ1-';
  const FLAG = { lines: 1, tshape: 2, dot: 4, dotRound: 8, circle: 16, outline: 32, circleMatch: 64 };

  function rgb(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); }
  function toHex(r, g, b) { return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''); }
  function checksum(bytes) {
    let c = 0x5a;
    for (let i = 0; i < 15; i++) c = (c * 31 + bytes[i]) & 0xff;
    return c;
  }

  function codeBytes(style) {
    const s = normalizeStyle(style);
    let flags = 0;
    for (const key of BOOLS) if (s[key]) flags |= FLAG[key];
    if (!s.circleColor) flags |= FLAG.circleMatch;
    const bytes = [flags, ...rgb(s.color), s.opacity, s.length, s.thickness, s.gap + 64, s.dotSize,
      s.radius, s.circleThickness, ...(s.circleColor ? rgb(s.circleColor) : [0, 0, 0]), s.outlineThickness, 0];
    bytes[15] = checksum(bytes);
    return bytes;
  }

  function bytesToCode(bytes) {
    const copy = bytes.slice(0, 16);
    copy[15] = checksum(copy);
    let bin = '';
    for (const b of copy) bin += String.fromCharCode(b & 0xff);
    return PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function encode(style) { return bytesToCode(codeBytes(style)); }

  function decode(code) {
    if (typeof code !== 'string') return null;
    const str = code.trim();
    if (str.slice(0, PREFIX.length).toUpperCase() !== PREFIX) return null;
    const body = str.slice(PREFIX.length);
    if (!/^[A-Za-z0-9_-]{22}$/.test(body)) return null;
    let bin;
    try { bin = atob(body.replace(/-/g, '+').replace(/_/g, '/') + '=='); } catch (e) { return null; }
    if (bin.length !== 16) return null;
    const b = Array.from(bin, (ch) => ch.charCodeAt(0));
    if (b[15] !== checksum(b) || b[0] & 0x80) return null;
    const style = {
      color: toHex(b[1], b[2], b[3]), opacity: b[4], length: b[5], thickness: b[6], gap: b[7] - 64,
      dotSize: b[8], radius: b[9], circleThickness: b[10],
      circleColor: b[0] & FLAG.circleMatch ? null : toHex(b[11], b[12], b[13]), outlineThickness: b[14],
    };
    for (const key of BOOLS) style[key] = !!(b[0] & FLAG[key]);
    return normalizeStyle(style);
  }

  return {
    DEFAULT_STYLE, LIMITS,
    normalizeStyle, normalizeSettings, defaultSettings, findPreset,
    geometry, renderSVG, encode, decode,
    _codeBytes: codeBytes, _bytesToCode: bytesToCode,
  };
});
