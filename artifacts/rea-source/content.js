function e() {
  let e = (typeof location < `u` ? location.host : ``).match(
    /music\.ya(?:ndex|ndex)\.([a-z]+)/i,
  );
  return e?.[1] ? `api.music.yandex.${e[1]}` : `api.music.yandex.ru`;
}
function t() {
  return `https://${typeof location < `u` ? location.host : `music.yandex.ru`}`;
}
var n = /[?:"<>/\\|*]/g,
  r = {
    "?": `？`,
    ":": `：`,
    '"': `＂`,
    "<": `＜`,
    ">": `＞`,
    "/": `⧸`,
    "\\": `⧹`,
    "|": `｜`,
    "*": `＊`,
  };
function i(e, t) {
  return e.replace(n, (e) => (t?.unicodeLookalikes ? r[e] : `_`));
}
function a(e, t) {
  return i(e, t)
    .replace(/^\s+/, ``)
    .replace(/[\u200B-\u200D\uFEFF]/g, `_`);
}
function o(e, t) {
  let n = e.trim() || `Unknown Track`,
    r = String(t || ``).trim();
  return !r || n.toLowerCase().includes(r.toLowerCase()) ? n : `${n} (${r})`;
}
function s(e) {
  let t = (e || ``).toLowerCase();
  return t.includes(`flac`)
    ? `flac`
    : t.includes(`mp4`) || t === `m4a`
      ? `m4a`
      : `mp3`;
}
function c(e, t) {
  return (
    i(e, t)
      .replace(/[\x00-\x1f\x7f]|[\u200B-\u200D\uFEFF]/g, `_`)
      .trim()
      .replace(/[.\s]+$/g, ``)
      .trim() || `_`
  );
}
function l(e, t, n) {
  let r = e
    .split(/[/\\]+/)
    .map((e) => c(e))
    .filter(Boolean)
    .join(`/`);
  if (!t) return `${r}/tracks/`;
  let i = c(t.title, n);
  if (t.type === `artistPopularTracks`)
    return `${r}/popular-tracks/${c(t.artistName || t.title, n)}/`;
  if (t.type === `playlist`) return `${r}/playlists/${i}/`;
  if (t.type === `album`) {
    let e = String(t.year || ``).trim();
    return `${r}/albums/${c(e && !i.includes(`(${e})`) ? `${i} (${e})` : i, n)}/`;
  }
  return `${r}/tracks/`;
}
var u = { off: 0, error: 1, warn: 2, info: 3, debug: 4 },
  d = `off`;
function f(e) {
  return typeof e == `string` && e in u ? e : `off`;
}
function p(e) {
  return u[d] >= u[e];
}
function m(e) {
  d = f(e);
}
async function h() {
  try {
    m((await chrome.storage.local.get(`logLevel`)).logLevel);
  } catch {
    m(`off`);
  }
}
function g() {
  return d;
}
var _ = {
    error(...e) {
      p(`error`) && console.error(`[YMD]`, ...e);
    },
    warn(...e) {
      p(`warn`) && console.warn(`[YMD]`, ...e);
    },
    info(...e) {
      p(`info`) && console.info(`[YMD]`, ...e);
    },
    debug(...e) {
      p(`debug`) && console.debug(`[YMD]`, ...e);
    },
  },
  v = {
    "x-yandex-music-client": `YandexMusicWebNext/1.0.0`,
    "x-yandex-music-without-invocation-info": `1`,
    "X-Requested-With": `XMLHttpRequest`,
  };
async function y(e, t) {
  return fetch(e, { credentials: `include`, ...t })
    .then((e) => e.json())
    .catch(() => null);
}
async function b(e, t) {
  return y(e, {
    method: `POST`,
    headers: { "Content-Type": `application/x-www-form-urlencoded`, ...v },
    body: t,
  });
}
var x = `7tvSmFbyf5hJnIHhCimDDD`,
  ee = async (e, t) => b(e, t);
async function S(e) {
  let t = new TextEncoder(),
    n = await crypto.subtle.importKey(
      `raw`,
      t.encode(x),
      { name: `HMAC`, hash: { name: `SHA-256` } },
      !1,
      [`sign`],
    ),
    r = await crypto.subtle.sign(`HMAC`, n, t.encode(e));
  return btoa(String.fromCharCode(...new Uint8Array(r)));
}
async function C(e) {
  return (await S(e)).replace(/=+$/, ``);
}
async function te(t, n) {
  let r = !!n?.hasAvailableSyncLyrics,
    i = !!n?.hasAvailableTextLyrics;
  if (!r && !i) return null;
  let a = String(t).split(`:`)[0].trim();
  if (!a) return null;
  let o = [];
  (r && o.push(`LRC`), i && o.push(`TEXT`));
  let s = e();
  for (let e of o)
    try {
      let t = Math.floor(Date.now() / 1e3),
        n = await S(`${a}${t}`),
        r = `https://${s}/tracks/${a}/lyrics?${new URLSearchParams({ sign: n, timeStamp: String(t), format: e }).toString()}`;
      _.debug(`Requesting track lyrics`, { trackId: a, format: e });
      let i = await y(r, { headers: v }),
        o = i?.downloadUrl || i?.result?.downloadUrl;
      if (!o) continue;
      let c = await fetch(o)
        .then((e) => (e.ok ? e.text() : null))
        .catch(() => null);
      if (!c) continue;
      let l = c
        .replace(
          /\r\n?/g,
          `
`,
        )
        .trim();
      if (l) return { text: l, format: e };
    } catch (t) {
      _.warn(`Failed to fetch track lyrics`, { trackId: a, format: e, err: t });
    }
  return null;
}
function w(e) {
  let t = typeof e == `string` ? e.trim() : ``;
  return t && t !== `-` ? t : ``;
}
async function ne(t) {
  let n = String(t).split(`:`)[0].trim();
  if (!n) return null;
  let r = `https://${e()}/tracks/${n}/credits`;
  try {
    let e = await y(r, { headers: { ...v, "Accept-Language": `ru` } }),
      t = Array.isArray(e?.credits)
        ? e.credits
        : Array.isArray(e?.result?.credits)
          ? e.result.credits
          : [];
    if (t.length === 0) return null;
    let n = {};
    for (let e of t) {
      let t = String(e?.title || ``)
          .trim()
          .toLowerCase(),
        r = w(e?.value);
      t &&
        r &&
        (t === `автор музыки` ||
        t === `композитор` ||
        t === `music by` ||
        t === `composer`
          ? (n.composer = r)
          : t === `автор текста` ||
              t === `автор слов` ||
              t === `слова` ||
              t === `lyrics by` ||
              t === `lyricist` ||
              t === `writer`
            ? (n.lyricist = r)
            : t === `лейбл` || t === `label`
              ? (n.label = r)
              : (t === `источник фонограммы` || t === `backing track source`) &&
                (n.phonogramSource = r));
    }
    return n;
  } catch (e) {
    return (
      _.warn(`Failed to fetch track credits`, { trackId: n, err: e }),
      null
    );
  }
}
var T = { flac: `flac-mp4`, m4a: `aac-mp4`, mp3: `mp3` };
function E(e) {
  return e.filter((t, n) => e.indexOf(t) === n);
}
function D(e, t) {
  let n = T[e] || T.mp3;
  return e === `flac` ? E([n, T[t] || T.mp3]) : [n];
}
function O(e, t, n) {
  let r = D(e, n);
  return {
    quality: e === `flac` ? `lossless` : t,
    codecs: r,
    fallbackCodec: r[0],
    transport: `raw`,
  };
}
async function k(n, r) {
  let i = Math.floor(Date.now() / 1e3),
    a = e(),
    o = t(),
    s = r.codecs.join(`,`),
    c = await C(`${i}${n}${r.quality}${r.codecs.join(``)}${r.transport}`),
    l = `https://${a}/get-file-info?ts=${i}&trackId=${n}&quality=${r.quality}&codecs=${s}&transports=${r.transport}&sign=${encodeURIComponent(c)}`;
  _.debug(`Requesting stream info`, {
    trackId: n,
    quality: r.quality,
    codecs: r.codecs,
  });
  let u = await chrome.runtime.sendMessage({
    message: `downloadInfo`,
    url: l,
    headers: { ...v, Referer: `${o}/` },
  });
  return u?.downloadInfo?.url
    ? {
        url: decodeURIComponent(u.downloadInfo.url),
        codec: u.downloadInfo.codec || r.fallbackCodec,
        transport: u.downloadInfo.transport || r.transport,
      }
    : null;
}
var re = async (e, t, n = `hq`, r = `mp3`) =>
  (await k(e, O(t, n, r))) ||
  (t === `flac`
    ? (_.info(`FLAC stream unavailable, falling back`, {
        trackId: e,
        fallbackFormat: r,
      }),
      k(e, O(r, n, `mp3`)))
    : null);
function A(e, t) {
  return (e[t] << 24) | (e[t + 1] << 16) | (e[t + 2] << 8) | e[t + 3];
}
function j(e, t) {
  let n = A(e, t),
    r = A(e, t + 4);
  return n * 4294967296 + r;
}
function* M(e, t, n) {
  let r = t;
  for (; r + 8 <= n;) {
    let t = A(e, r),
      i = String.fromCharCode(...e.slice(r + 4, r + 8)),
      a = r + 8;
    if (t === 1) {
      if (r + 16 > n) break;
      ((t = Number(j(e, r + 8))), (a = r + 16));
    } else t === 0 && (t = n - r);
    if (t < 8 || r + t > n) break;
    (yield { type: i, start: r, size: t, dataStart: a }, (r += t));
  }
}
function N(e, t, n, r) {
  for (let i of M(e, t, n)) {
    if (i.type === r) return i;
    let t = i.dataStart + (ie(i.type) ? 4 : 0);
    if (t < i.start + i.size) {
      let n = N(e, t, i.start + i.size, r);
      if (n) return n;
    }
  }
  return null;
}
function ie(e) {
  return [
    `mvhd`,
    `tkhd`,
    `mdhd`,
    `hdlr`,
    `vmhd`,
    `smhd`,
    `dref`,
    `stsd`,
    `stts`,
    `stsc`,
    `stsz`,
    `stco`,
    `co64`,
    `esds`,
    `dfLa`,
  ].includes(e);
}
function ae(e, t, n, r) {
  let i = [];
  for (let a of M(e, t, n)) {
    a.type === r && i.push(a);
    let t = a.dataStart + (ie(a.type) ? 4 : 0);
    t < a.start + a.size && i.push(...ae(e, t, a.start + a.size, r));
  }
  return i;
}
function P(e, t, n) {
  let r = new Uint8Array(4);
  return (
    (r[0] = (n ? 128 : 0) | (e & 127)),
    (r[1] = (t >> 16) & 255),
    (r[2] = (t >> 8) & 255),
    (r[3] = t & 255),
    r
  );
}
function oe(e, t) {
  let n = `${e}=${t}`,
    r = new TextEncoder().encode(n),
    i = new Uint8Array(4);
  ((i[0] = r.length & 255),
    (i[1] = (r.length >> 8) & 255),
    (i[2] = (r.length >> 16) & 255),
    (i[3] = (r.length >> 24) & 255));
  let a = new Uint8Array(4 + r.length);
  return (a.set(i, 0), a.set(r, 4), a);
}
function se(e) {
  let t = new TextEncoder().encode(`YandexMusicDownloader`),
    n = new Uint8Array(4),
    r = t.length;
  ((n[0] = r & 255),
    (n[1] = (r >> 8) & 255),
    (n[2] = (r >> 16) & 255),
    (n[3] = (r >> 24) & 255));
  let i = Object.entries(e).filter(([, e]) => e),
    a = new Uint8Array(4);
  ((a[0] = i.length & 255),
    (a[1] = (i.length >> 8) & 255),
    (a[2] = (i.length >> 16) & 255),
    (a[3] = (i.length >> 24) & 255));
  let o = i.map(([e, t]) => oe(e, t)),
    s = o.reduce((e, t) => e + t.length, 0),
    c = new Uint8Array(4 + t.length + 4 + s),
    l = 0;
  (c.set(n, l), (l += 4), c.set(t, l), (l += t.length), c.set(a, l), (l += 4));
  for (let e of o) (c.set(e, l), (l += e.length));
  let u = P(4, c.length, !1),
    d = new Uint8Array(u.length + c.length);
  return (d.set(u, 0), d.set(c, u.length), d);
}
function ce(e, t) {
  let n = new TextEncoder().encode(e),
    r = new TextEncoder().encode(``),
    i = new Uint8Array(t),
    a = 8 + n.length + 4 + r.length + 4 + 4 + 4 + 4 + 4 + i.length,
    o = new Uint8Array(a),
    s = new DataView(o.buffer),
    c = 0;
  (s.setUint32(c, 3, !1),
    (c += 4),
    s.setUint32(c, n.length, !1),
    (c += 4),
    o.set(n, c),
    (c += n.length),
    s.setUint32(c, r.length, !1),
    (c += 4),
    o.set(r, c),
    (c += r.length),
    s.setUint32(c, 0, !1),
    (c += 4),
    s.setUint32(c, 0, !1),
    (c += 4),
    s.setUint32(c, 0, !1),
    (c += 4),
    s.setUint32(c, 0, !1),
    (c += 4),
    s.setUint32(c, i.length, !1),
    (c += 4),
    o.set(i, c),
    (c += i.length));
  let l = P(6, o.length, !1),
    u = new Uint8Array(l.length + o.length);
  return (u.set(l, 0), u.set(o, l.length), u);
}
function le(e, t) {
  let n = [100, 102, 76, 97],
    r = t.dataStart,
    i = t.start + t.size;
  for (let t = r; t <= i - 8; t++)
    if (
      e[t + 4] === n[0] &&
      e[t + 5] === n[1] &&
      e[t + 6] === n[2] &&
      e[t + 7] === n[3]
    ) {
      let n = A(e, t);
      if (n >= 8 && t + n <= i)
        return { type: `dfLa`, start: t, size: n, dataStart: t + 8 };
    }
  return null;
}
function ue(e, t) {
  let n = t.slice(e.dataStart + 4, e.start + e.size);
  if (n.length < 8) return null;
  let r = A(n, 0),
    i = A(n, 4);
  if (i === 0) return [];
  if (r !== 0) return Array.from({ length: i }, () => r);
  let a = [],
    o = 8;
  for (let e = 0; e < i && !(o + 4 > n.length); e++)
    (a.push(A(n, o)), (o += 4));
  return a;
}
function de(e, t) {
  let n = t.slice(e.dataStart + 4, e.start + e.size);
  if (n.length < 4) return [];
  let r = A(n, 0),
    i = [],
    a = 4;
  for (let e = 0; e < r && !(a + 12 > n.length); e++) {
    let e = A(n, a),
      t = A(n, a + 4);
    ((a += 12), i.push({ firstChunk: e, samplesPerChunk: t }));
  }
  return i;
}
function fe(e, t) {
  let n = t.slice(e.dataStart + 4, e.start + e.size);
  if (n.length < 4) return [];
  let r = A(n, 0),
    i = [],
    a = 4;
  for (let e = 0; e < r && !(a + 8 > n.length); e++)
    (i.push(j(n, a)), (a += 8));
  return i;
}
function pe(e, t) {
  let n = t.slice(e.dataStart + 4, e.start + e.size);
  if (n.length < 4) return [];
  let r = A(n, 0),
    i = [],
    a = 4;
  for (let e = 0; e < r && !(a + 4 > n.length); e++)
    (i.push(A(n, a)), (a += 4));
  return i;
}
function me(e, t) {
  for (let n = t.length - 1; n >= 0; n--)
    if (e >= t[n].firstChunk) return t[n].samplesPerChunk;
  return t[0]?.samplesPerChunk ?? 0;
}
function he(e, t) {
  let n = N(e, 0, e.length, `stsz`),
    r = N(e, 0, e.length, `stsc`),
    i = N(e, 0, e.length, `co64`),
    a = N(e, 0, e.length, `stco`);
  if (!n || !r || (!i && !a))
    return (
      _.warn(`FLAC sample tables missing, falling back to raw mdat`),
      e.slice(t.dataStart, t.start + t.size)
    );
  let o = ue(n, e),
    s = de(r, e),
    c = i ? fe(i, e) : pe(a, e);
  if (!o || o.length === 0 || c.length === 0 || s.length === 0)
    return (
      _.warn(`Incomplete FLAC sample tables, falling back to raw mdat`),
      e.slice(t.dataStart, t.start + t.size)
    );
  let l = 0;
  for (let e of o) l += e;
  if (l === 0)
    return (
      _.warn(`Total FLAC sample size is zero, falling back to raw mdat`),
      e.slice(t.dataStart, t.start + t.size)
    );
  let u = new Uint8Array(l),
    d = 0,
    f = 0;
  for (let t = 0; t < c.length && f < o.length; t++) {
    let n = c[t],
      r = t + 1,
      i = me(r, s);
    if (n + (i > 0 ? o[f] : 0) > e.length) {
      _.warn(`FLAC chunk ${r} offset out of bounds`);
      break;
    }
    let a = n;
    for (let t = 0; t < i && f < o.length; t++, f++) {
      let t = o[f];
      if (a + t > e.length) {
        _.warn(`FLAC sample ${f} exceeds buffer, truncating`);
        break;
      }
      (u.set(e.slice(a, a + t), d), (a += t), (d += t));
    }
  }
  return (
    d !== l && _.warn(`FLAC extracted ${d} bytes, expected ${l}`),
    u.slice(0, d)
  );
}
function ge(e) {
  let t = new DataView(e.buffer, e.byteOffset, e.byteLength),
    n = t.getUint16(0, !1),
    r = t.getUint16(2, !1),
    i = (t.getUint32(4, !1) >> 8) & 16777215,
    a = (t.getUint32(7, !1) >> 8) & 16777215,
    o = j(e, 10);
  return {
    minBlockSize: n,
    maxBlockSize: r,
    minFrameSize: i,
    maxFrameSize: a,
    sampleRate: Number(o >> 44) & 2097151,
    channels: Number((o >> 41) & 7) + 1,
    bitsPerSample: Number((o >> 36) & 31) + 1,
    totalSamples: Number(o & 68719476735),
    md5: e.slice(18, 34),
  };
}
function _e(e, t, n, r) {
  let i = [],
    a = Math.max(2, Math.floor(r / (t * 10))),
    o = Math.floor(r / a),
    s = 0,
    c = 0;
  for (
    i.push({ sampleNumber: 0, offset: 0, samplesInFrame: n });
    s < e.length;
  ) {
    let t = s;
    if (((e[s] << 6) | (e[s + 1] >> 2)) != 16382) break;
    let n = (e[s + 2] >> 4) & 15;
    e[s + 2] & 15;
    let l;
    if (n === 1) l = 192;
    else if (n >= 2 && n <= 5) l = 576 * 2 ** (n - 2);
    else if (n === 6) l = e[s + 5] + 1;
    else if (n === 7) l = (e[s + 5] << 8) + e[s + 6] + 1;
    else break;
    let u = 5;
    n === 6 ? (u = 6) : n === 7 && (u = 7);
    let d = t + u + l + 2;
    for (; d + 2 <= e.length && ((e[d] << 6) | (e[d + 1] >> 2)) != 16382;) d++;
    if (
      (d > e.length && (d = e.length),
      c > 0 &&
        c % o < l &&
        i.length < a &&
        i.push({ sampleNumber: c, offset: t, samplesInFrame: l }),
      (s = d),
      (c += l),
      c >= r)
    )
      break;
  }
  i.push({ sampleNumber: 18446744073709551615n, offset: 0, samplesInFrame: 0 });
  let l = new Uint8Array(i.length * 18),
    u = new DataView(l.buffer);
  for (let e = 0; e < i.length; e++) {
    let t = i[e];
    (u.setBigUint64(e * 18, BigInt.asUintN(64, BigInt(t.sampleNumber)), !1),
      u.setBigUint64(e * 18 + 8, BigInt.asUintN(64, BigInt(t.offset)), !1),
      u.setUint16(e * 18 + 16, t.samplesInFrame, !1));
  }
  let d = P(3, l.length, !1),
    f = new Uint8Array(d.length + l.length);
  return (f.set(d, 0), f.set(l, d.length), f);
}
function ve(e) {
  let t = new Uint8Array(e),
    n = t.length,
    r = ae(t, 0, n, `mdat`);
  if (r.length === 0) throw Error(`MP4 demux: mdat box not found`);
  let i = r[0],
    a = N(t, 0, n, `stsd`);
  if (!a) throw Error(`MP4 demux: stsd box not found`);
  let o = a.dataStart + 4;
  if (A(t, o) === 0) throw Error(`MP4 demux: no sample entries`);
  let s = null;
  for (let e of M(t, o + 4, a.start + a.size))
    if (e.type === `fLaC`) {
      s = e;
      break;
    }
  if (!s) throw Error(`MP4 demux: fLaC sample entry not found`);
  let c = le(t, s);
  if (!c) throw Error(`MP4 demux: dfLa box not found`);
  let l = c.dataStart + 4,
    u = t.slice(l, c.start + c.size),
    d = [],
    f = 0;
  for (; f < u.length && !(f + 4 > u.length);) {
    let e = !!(u[f] & 128),
      t = (u[f + 1] << 16) | (u[f + 2] << 8) | u[f + 3];
    if (f + 4 + t > u.length) break;
    let n = u.slice(f, f + 4 + t);
    if ((d.push(n), (f += 4 + t), e)) break;
  }
  if (d.length === 0) throw Error(`MP4 demux: no FLAC metadata blocks`);
  let p = d[0],
    m = ge(p.slice(4)),
    h = he(t, i),
    g = _e(h, m.sampleRate, m.minBlockSize, m.totalSamples),
    _ = [new TextEncoder().encode(`fLaC`)],
    v = new Uint8Array(p);
  ((v[0] &= 127), _.push(v), _.push(g), (_[_.length - 1][0] |= 128), _.push(h));
  let y = _.reduce((e, t) => e + t.length, 0),
    b = new Uint8Array(y),
    x = 0;
  for (let e of _) (b.set(e, x), (x += e.length));
  return b.buffer;
}
function ye(e, t, n) {
  let r = new Uint8Array(e),
    i = 4,
    a = [],
    o = 4;
  for (; i < r.length && !(i + 4 > r.length);) {
    let e = (r[i + 1] << 16) | (r[i + 2] << 8) | r[i + 3];
    if (i + 4 + e > r.length) break;
    if ((a.push(r.slice(i, i + 4 + e)), (i += 4 + e), r[i - e - 4] & 128)) {
      o = i;
      break;
    }
  }
  for (let e of a) e[0] &= 127;
  let s = new Uint8Array(t.length);
  (s.set(t), (s[0] &= 127));
  let c = n ? new Uint8Array(n.length) : null;
  c && n && (c.set(n), (c[0] &= 127));
  let l = r.slice(o),
    u = [r.slice(0, 4), ...a];
  (s.length && u.push(s), c && u.push(c), u.push(l));
  let d = u.reduce((e, t) => e + t.length, 0),
    f = new Uint8Array(d),
    p = 0;
  for (let e of u) (f.set(e, p), (p += e.length));
  let m = c || s;
  if (m.length) {
    let e = p - l.length - m.length;
    f[e] |= 128;
  } else if (a.length) {
    let e = p - l.length - a[a.length - 1].length;
    f[e] |= 128;
  }
  return f.buffer;
}
function be(e) {
  let t = [],
    n = 0;
  for (let r of e.split(/\r?\n/)) {
    let e = r.trim();
    if (!e) continue;
    let i = e.match(/^\[offset:\s*([+-]?\d+)\s*\]$/i);
    if (i) {
      n = parseInt(i[1], 10) || 0;
      continue;
    }
    let a = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g,
      o = [],
      s = 0,
      c;
    for (
      ;
      (c = a.exec(e)) !== null &&
      (c.index === s || e.slice(s, c.index).trim() === ``);
    ) {
      let e = parseInt(c[1], 10),
        t = parseInt(c[2], 10),
        r = c[3] || ``,
        i = r ? parseInt(r, 10) / 10 ** r.length : 0,
        l = Math.round((e * 60 + t + i) * 1e3) + n;
      (o.push(Math.max(0, l)), (s = a.lastIndex));
    }
    if (o.length > 0) {
      let n = e.slice(s).trim();
      for (let e of o) t.push({ text: n, timeMs: e });
    }
  }
  return (t.sort((e, t) => e.timeMs - t.timeMs), t);
}
function xe(e) {
  let t = new Uint8Array(2 + e.length * 2);
  ((t[0] = 255), (t[1] = 254));
  for (let n = 0; n < e.length; n++) {
    let r = e.charCodeAt(n);
    ((t[2 + n * 2] = r & 255), (t[2 + n * 2 + 1] = (r >>> 8) & 255));
  }
  return t;
}
function Se(e, t = `eng`, n = ``) {
  let r = xe(n),
    i = e.map((e) => ({ textBytes: xe(e.text), timeMs: e.timeMs >>> 0 })),
    a = i.reduce((e, t) => e + t.textBytes.length + 2 + 4, 0),
    o = 6 + r.length + 2 + a,
    s = new Uint8Array(10 + o),
    c = new DataView(s.buffer);
  ((s[0] = 83),
    (s[1] = 89),
    (s[2] = 76),
    (s[3] = 84),
    c.setUint32(4, o, !1),
    (s[8] = 0),
    (s[9] = 0));
  let l = 10;
  s[l++] = 1;
  let u = (t || `eng`).slice(0, 3).padEnd(3, ` `);
  ((s[l++] = u.charCodeAt(0) & 255),
    (s[l++] = u.charCodeAt(1) & 255),
    (s[l++] = u.charCodeAt(2) & 255),
    (s[l++] = 2),
    (s[l++] = 1),
    s.set(r, l),
    (l += r.length),
    (s[l++] = 0),
    (s[l++] = 0));
  for (let e of i)
    (s.set(e.textBytes, l),
      (l += e.textBytes.length),
      (s[l++] = 0),
      (s[l++] = 0),
      c.setUint32(l, e.timeMs, !1),
      (l += 4));
  return s;
}
function Ce(e) {
  let t = e.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!t) return null;
  let n = `${t[3]}${t[2]}`,
    r = new Uint8Array(15),
    i = new DataView(r.buffer);
  ((r[0] = 84),
    (r[1] = 68),
    (r[2] = 65),
    (r[3] = 84),
    i.setUint32(4, 5, !1),
    (r[8] = 0),
    (r[9] = 0),
    (r[10] = 0));
  for (let e = 0; e < 4; e++) r[11 + e] = n.charCodeAt(e) & 255;
  return r;
}
function we(e, t, n = 4096) {
  let r = new Uint8Array(e);
  if (r.byteLength < 10 || r[0] !== 73 || r[1] !== 68 || r[2] !== 51) return e;
  let i =
      ((r[6] & 127) << 21) |
      ((r[7] & 127) << 14) |
      ((r[8] & 127) << 7) |
      (r[9] & 127),
    a = Math.max(10, 10 + i - n),
    o = i + t.byteLength,
    s = new Uint8Array(r.byteLength + t.byteLength);
  return (
    s.set(r.subarray(0, a), 0),
    s.set(t, a),
    s.set(r.subarray(a), a + t.byteLength),
    (s[6] = (o >>> 21) & 127),
    (s[7] = (o >>> 14) & 127),
    (s[8] = (o >>> 7) & 127),
    (s[9] = o & 127),
    s.buffer
  );
}
function Te(e, t, n) {
  let r = new browserId3Writer(e);
  if (
    (r
      .setFrame(`TIT2`, t.title)
      .setFrame(`TPE1`, [t.artist])
      .setFrame(`TPE2`, t.albumArtist || t.artist)
      .setFrame(`TALB`, t.album),
    t.year)
  )
    try {
      r.setFrame(`TYER`, t.year);
    } catch {}
  if (t.genre)
    try {
      r.setFrame(`TCON`, [t.genre]);
    } catch {}
  if (t.trackNumber)
    try {
      let e =
        t.trackTotal && !t.trackNumber.includes(`/`)
          ? `${t.trackNumber}/${t.trackTotal}`
          : t.trackNumber;
      r.setFrame(`TRCK`, e);
    } catch {}
  if (t.discNumber)
    try {
      r.setFrame(`TPOS`, t.discNumber);
    } catch {}
  if (t.composer)
    try {
      r.setFrame(`TCOM`, [t.composer]);
    } catch {}
  if (t.lyricist)
    try {
      r.setFrame(`TEXT`, t.lyricist);
    } catch {}
  if (t.publisher)
    try {
      r.setFrame(`TPUB`, t.publisher);
    } catch {}
  let i = null;
  if (t.lyrics?.text) {
    if (t.lyrics.format === `LRC`) {
      let e = be(t.lyrics.text);
      if (e.length > 0) i = Se(e);
      else
        try {
          r.setFrame(`USLT`, { description: ``, lyrics: t.lyrics.text });
        } catch {}
    } else
      try {
        r.setFrame(`USLT`, { description: ``, lyrics: t.lyrics.text });
      } catch {}
  }
  if (t.coverBuffer)
    try {
      r.setFrame(`APIC`, { type: 3, data: t.coverBuffer, description: `` });
    } catch {}
  let a = t.releaseDate ? Ce(t.releaseDate) : null;
  if (n) {
    r.addTag();
    let e = [];
    (a && e.push(a), i && e.push(i));
    for (let t of e) r.arrayBuffer = we(r.arrayBuffer, t, r.padding ?? 4096);
  }
  return r.getURL();
}
function F(e) {
  let t = new Uint8Array(e);
  return t[0] === 255 && t[1] === 216
    ? `image/jpeg`
    : t[0] === 137 && t[1] === 80 && t[2] === 78 && t[3] === 71
      ? `image/png`
      : t[0] === 71 && t[1] === 73 && t[2] === 70
        ? `image/gif`
        : t[8] === 87 && t[9] === 69 && t[10] === 66 && t[11] === 80
          ? `image/webp`
          : `image/jpeg`;
}
function Ee(e) {
  return e === `image/png`
    ? `.png`
    : e === `image/webp`
      ? `.webp`
      : e === `image/gif`
        ? `.gif`
        : `.jpg`;
}
var De = 0.95;
async function Oe(e) {
  let t = F(e);
  if (t === `image/jpeg`)
    return (
      _.debug(`Cover is already JPEG, keeping as-is`, {
        sizeBytes: e.byteLength,
      }),
      e
    );
  _.debug(`Re-encoding cover to JPEG`, {
    fromMime: t,
    originalBytes: e.byteLength,
  });
  try {
    let n = await createImageBitmap(new Blob([e], { type: t }));
    try {
      let r = document.createElement(`canvas`);
      ((r.width = n.width), (r.height = n.height));
      let i = r.getContext(`2d`);
      if (!i)
        return (
          _.warn(`Canvas 2D context unavailable, keeping original cover`, {
            mime: t,
          }),
          e
        );
      ((i.fillStyle = `#fff`),
        i.fillRect(0, 0, r.width, r.height),
        i.drawImage(n, 0, 0));
      let a = await new Promise((e) => r.toBlob(e, `image/jpeg`, De));
      return a
        ? t === `image/png` && a.size >= e.byteLength
          ? (_.info(
              `Re-encoded JPEG is not smaller than PNG, keeping original PNG`,
              {
                pngBytes: e.byteLength,
                jpegBytes: a.size,
                dimensions: `${n.width}x${n.height}`,
              },
            ),
            e)
          : (_.info(`Cover re-encoded to JPEG`, {
              fromMime: t,
              originalBytes: e.byteLength,
              jpegBytes: a.size,
              dimensions: `${n.width}x${n.height}`,
            }),
            await a.arrayBuffer())
        : (_.warn(`canvas.toBlob returned null, keeping original cover`, {
            mime: t,
          }),
          e);
    } finally {
      n.close();
    }
  } catch (n) {
    return (
      _.warn(`Failed to re-encode cover to JPEG, keeping original`, {
        mime: t,
        err: n,
      }),
      e
    );
  }
}
var I = 1836019574,
  ke = 1969517665,
  Ae = 1835365473,
  je = 1768715124,
  Me = 1835295092,
  Ne = 1751411826,
  Pe = 1937007471,
  Fe = 1668232756,
  Ie = 1953653099,
  Le = 1835297121,
  Re = 1835626086,
  ze = 1937007212;
function Be(e, t) {
  return ((e[t] << 24) | (e[t + 1] << 16) | (e[t + 2] << 8) | e[t + 3]) >>> 0;
}
function Ve(e, t) {
  return Be(e, t + 4);
}
function He(e, t, n = 0, r = e.length) {
  let i = n,
    a = r;
  for (let n of t) {
    let t = L(e, n, i + 8, a);
    if (!t) return null;
    ((i = t.offset), (a = t.offset + t.size));
  }
  return { offset: i, size: a - i };
}
function Ue(e, t) {
  let n = L(e, I, 0, e.length);
  if (!n) return;
  let r = n.offset + 8,
    i = n.offset + n.size;
  for (;;) {
    let n = L(e, Ie, r, i);
    if (!n) break;
    let a = He(e, [Le, Re, ze, Pe], n.offset, n.offset + n.size);
    if (a) {
      let n = new DataView(e.buffer, e.byteOffset, e.byteLength),
        r = n.getUint32(a.offset + 12, !1);
      for (let e = 0; e < r; e++) {
        let r = a.offset + 16 + e * 4,
          i = n.getUint32(r, !1);
        n.setUint32(r, i + t, !1);
      }
    }
    let o = He(e, [Le, Re, ze, Fe], n.offset, n.offset + n.size);
    if (o) {
      let n = new DataView(e.buffer, e.byteOffset, e.byteLength),
        r = n.getUint32(o.offset + 12, !1);
      for (let e = 0; e < r; e++) {
        let r = o.offset + 16 + e * 8,
          i = Number(n.getBigUint64(r, !1));
        n.setBigUint64(r, BigInt(i + t), !1);
      }
    }
    r = n.offset + n.size;
  }
}
function L(e, t, n = 0, r = e.length) {
  let i = n;
  for (; i + 8 <= r;) {
    let n = Be(e, i),
      a = Ve(e, i);
    if (n < 8 || i + n > r) return null;
    if (a === t) return { offset: i, size: n };
    i += n;
  }
  return null;
}
function R(e) {
  let t = e.reduce((e, t) => e + t.length, 0),
    n = new Uint8Array(t),
    r = 0;
  for (let t of e) (n.set(t, r), (r += t.length));
  return n;
}
function z(e) {
  return new TextEncoder().encode(e);
}
function B(e, t, n, r) {
  let i = 12 + r.length,
    a = new Uint8Array(i),
    o = new DataView(a.buffer);
  return (
    o.setUint32(0, i, !1),
    o.setUint32(4, e, !1),
    (a[8] = t),
    (a[9] = (n >>> 16) & 255),
    (a[10] = (n >>> 8) & 255),
    (a[11] = n & 255),
    a.set(r, 12),
    a
  );
}
function V(e, t) {
  let n = z(t),
    r = 16 + n.length,
    i = new Uint8Array(r),
    a = new DataView(i.buffer);
  (a.setUint32(0, r, !1),
    a.setUint32(4, 1684108385, !1),
    a.setUint32(8, 1, !1),
    a.setUint32(12, 0, !1),
    i.set(n, 16));
  let o = 8 + i.length,
    s = new Uint8Array(o),
    c = new DataView(s.buffer);
  return (c.setUint32(0, o, !1), c.setUint32(4, e, !1), s.set(i, 8), s);
}
function We(e, t) {
  let n = String(e).match(/^(\d+)(?:\/(\d+))?$/),
    r = n ? parseInt(n[1], 10) : 0,
    i = n && n[2] ? parseInt(n[2], 10) : (t && parseInt(t, 10)) || 0,
    a = new Uint8Array(24),
    o = new DataView(a.buffer);
  (o.setUint32(0, 24, !1),
    o.setUint32(4, 1684108385, !1),
    o.setUint32(8, 0, !1),
    o.setUint32(12, 0, !1),
    o.setUint16(16, 0, !1),
    o.setUint16(18, r, !1),
    o.setUint16(20, i, !1),
    o.setUint16(22, 0, !1));
  let s = 8 + a.length,
    c = new Uint8Array(s),
    l = new DataView(c.buffer);
  return (
    l.setUint32(0, s, !1),
    l.setUint32(4, 1953655662, !1),
    c.set(a, 8),
    c
  );
}
function Ge(e) {
  let t = String(e).match(/^(\d+)(?:\/(\d+))?$/),
    n = t ? parseInt(t[1], 10) : 0,
    r = t && t[2] ? parseInt(t[2], 10) : 0,
    i = new Uint8Array(22),
    a = new DataView(i.buffer);
  (a.setUint32(0, 22, !1),
    a.setUint32(4, 1684108385, !1),
    a.setUint32(8, 0, !1),
    a.setUint32(12, 0, !1),
    a.setUint16(16, 0, !1),
    a.setUint16(18, n, !1),
    a.setUint16(20, r, !1));
  let o = 8 + i.length,
    s = new Uint8Array(o),
    c = new DataView(s.buffer);
  return (
    c.setUint32(0, o, !1),
    c.setUint32(4, 1684632427, !1),
    s.set(i, 8),
    s
  );
}
function Ke(e, t, n = `com.apple.iTunes`) {
  let r = B(1835360622, 0, 0, z(n)),
    i = B(1851878757, 0, 0, z(e)),
    a = z(t),
    o = 16 + a.length,
    s = new Uint8Array(o),
    c = new DataView(s.buffer);
  (c.setUint32(0, o, !1),
    c.setUint32(4, 1684108385, !1),
    c.setUint32(8, 1, !1),
    c.setUint32(12, 0, !1),
    s.set(a, 16));
  let l = R([r, i, s]),
    u = 8 + l.length,
    d = new Uint8Array(u),
    f = new DataView(d.buffer);
  return (f.setUint32(0, u, !1), f.setUint32(4, 757935405, !1), d.set(l, 8), d);
}
function qe(e, t) {
  let n = new Uint8Array(e),
    r = t === `image/png` ? 14 : 13,
    i = 16 + n.length,
    a = new Uint8Array(i),
    o = new DataView(a.buffer);
  (o.setUint32(0, i, !1),
    o.setUint32(4, 1684108385, !1),
    o.setUint32(8, r, !1),
    o.setUint32(12, 0, !1),
    a.set(n, 16));
  let s = 8 + a.length,
    c = new Uint8Array(s),
    l = new DataView(c.buffer);
  return (
    l.setUint32(0, s, !1),
    l.setUint32(4, 1668249202, !1),
    c.set(a, 8),
    c
  );
}
function Je(e) {
  let t = new Uint8Array(21);
  return (
    (t[4] = 109),
    (t[5] = 100),
    (t[6] = 105),
    (t[7] = 114),
    (t[8] = 97),
    (t[9] = 112),
    (t[10] = 112),
    (t[11] = 108),
    B(Ae, 0, 0, R([B(Ne, 0, 0, t), ...e]))
  );
}
function Ye(e) {
  let t = [];
  (e.title && t.push(V(2842583405, e.title)),
    e.artist && t.push(V(2839630420, e.artist)),
    e.albumArtist && t.push(V(1631670868, e.albumArtist)),
    e.album && t.push(V(2841734242, e.album)));
  let n = e.releaseDate || e.year;
  (n && t.push(V(2841928057, n)),
    e.genre && t.push(V(2842125678, e.genre)),
    e.composer && t.push(V(2843177588, e.composer)),
    e.lyricist && t.push(Ke(`LYRICIST`, e.lyricist)),
    e.publisher && t.push(V(2842719586, e.publisher)),
    e.lyrics?.text && t.push(V(2842458482, e.lyrics.text)),
    e.trackNumber && t.push(We(e.trackNumber, e.trackTotal)),
    e.discNumber && t.push(Ge(e.discNumber)),
    e.coverBuffer && t.push(qe(e.coverBuffer, F(e.coverBuffer))));
  let r = R(t),
    i = 8 + r.length,
    a = new Uint8Array(i),
    o = new DataView(a.buffer);
  return (o.setUint32(0, i, !1), o.setUint32(4, je, !1), a.set(r, 8), a);
}
function Xe(e, t, n) {
  let r = new Uint8Array(e);
  if (!n) return e;
  let i = L(r, I, 0, r.length),
    a = L(r, Me, 0, r.length);
  if (!i || !a)
    return (_.warn(`M4A moov or mdat not found, returning untagged buffer`), e);
  let o = Je([Ye(t)]),
    s = (() => {
      let e = 8 + o.length,
        t = new Uint8Array(e),
        n = new DataView(t.buffer);
      return (n.setUint32(0, e, !1), n.setUint32(4, ke, !1), t.set(o, 8), t);
    })(),
    c = i.offset + 8,
    l = i.offset + i.size,
    u = L(r, ke, c, l),
    d;
  d = R(
    u
      ? [r.slice(c, u.offset), s, r.slice(u.offset + u.size, l)]
      : [r.slice(c, l), s],
  );
  let f = (() => {
      let e = 8 + d.length,
        t = new Uint8Array(e),
        n = new DataView(t.buffer);
      return (n.setUint32(0, e, !1), n.setUint32(4, I, !1), t.set(d, 8), t);
    })(),
    p = f.length - i.size;
  p !== 0 && Ue(f, p);
  let m = [];
  (i.offset > 0 && m.push(r.slice(0, i.offset)),
    m.push(f),
    m.push(r.slice(a.offset, a.offset + a.size)));
  let h = a.offset + a.size;
  return (h < r.length && m.push(r.slice(h, r.length)), R(m).buffer);
}
var Ze = 3e4;
function Qe(e) {
  setTimeout(() => URL.revokeObjectURL(e), Ze);
}
function $e(e, t) {
  let n = document.createElement(`a`);
  ((n.href = e),
    (n.download = t),
    (n.style.display = `none`),
    document.body.appendChild(n),
    n.click(),
    document.body.removeChild(n),
    Qe(e));
}
async function et(e, t) {
  try {
    return (
      (
        await new Promise((n) => {
          chrome.runtime.sendMessage(
            { message: `saveBlob`, url: e, filename: t },
            (e) => {
              (chrome.runtime.lastError, n(e));
            },
          );
        })
      )?.ok === !0
    );
  } catch {
    return !1;
  }
}
async function H(e, t) {
  (await et(e, t))
    ? Qe(e)
    : (await new Promise((n) => {
        chrome.runtime.sendMessage(
          { message: `registerFilename`, url: e, filename: t },
          () => n(),
        );
      }),
      $e(e, t));
}
async function tt(e, t, n) {
  let r = new Blob([e], { type: n });
  await H(URL.createObjectURL(r), t);
}
var U = new Set(),
  W = new Map(),
  G = 3,
  nt = 500,
  K = `application/octet-stream`;
function rt() {
  (U.clear(), W.clear());
}
function it(e, t) {
  if (!t || e <= 0) return ``;
  let n = Math.max(2, String(t.totalTracks || 0).length);
  return `${String(e).padStart(n, `0`)}. `;
}
async function at(t) {
  let n = await ee(
    `https://${e()}/tracks`,
    `trackIds=${t}&removeDuplicates=false&withProgress=true`,
  );
  if (!n || !n[0]) throw Error(`API Metadata extraction failed for track ${t}`);
  return (_.debug(`Fetched track metadata`, t), n[0]);
}
async function ot(e, t) {
  let n = await fetch(e);
  if (!n.ok) {
    let e = Error(`HTTP ${n.status} while fetching stream`);
    throw ((e.status = n.status), e);
  }
  let r = parseInt(n.headers.get(`Content-Length`) || `0`, 10);
  if (!r || !n.body) return n.arrayBuffer();
  let i = n.body.getReader(),
    a = [],
    o = 0;
  for (;;) {
    let { done: e, value: n } = await i.read();
    if (e) break;
    (a.push(n), (o += n.length), t?.(Math.round((o / r) * 100)));
  }
  let s = new Uint8Array(o),
    c = 0;
  for (let e of a) (s.set(e, c), (c += e.length));
  return s.buffer;
}
async function st(e) {
  for (let t = 1; t <= G; t++)
    try {
      let t = await fetch(e, {
        cache: `no-store`,
        headers: { Accept: `image/jpeg,image/*;q=0.8` },
      });
      if (!t.ok) throw Error(`HTTP ${t.status}`);
      return await Oe(await t.arrayBuffer());
    } catch (n) {
      t < G
        ? (_.warn(`Cover fetch attempt ${t}/${G} failed, retrying...`, {
            coverUrl: e,
            err: n,
          }),
          await new Promise((e) => setTimeout(e, nt * t)))
        : _.error(`Cover fetch failed after ${G} attempts`, {
            coverUrl: e,
            err: n,
          });
    }
  return null;
}
async function ct(e, t, n = !1) {
  if (!e) return null;
  let r = (e.startsWith(`http`) ? e : `https://${e}`).replace(`%%`, t);
  if (!n) return st(r);
  let i = W.get(r);
  if (i) return (_.debug(`Reusing cached cover`, { coverUrl: r }), i);
  let a = st(r).then((e) => (e || W.delete(r), e));
  return (W.set(r, a), a);
}
async function lt(e, t, n) {
  let r = await ct(e, t, !0);
  if (!r) return;
  let i = F(r),
    a = `${n}cover${Ee(i)}`;
  (await tt(r, a, i), _.info(`Saved album cover`, a));
}
function ut(e, t, n, r) {
  let i = o(e.title || `Unknown Track`, e.version),
    a = e.artists?.map((e) => e.name).join(`, `) || `Unknown Artist`,
    s = e.albums?.[0] || null,
    c =
      s?.artists
        ?.filter((e) => e?.name && !e?.various)
        .map((e) => e.name)
        .join(`, `) || a,
    l = s?.title || ``,
    u = String(s?.releaseDate || ``).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || ``,
    d = s?.year ? `${s.year}` : u.slice(0, 4),
    f = s?.genre || ``,
    p =
      s?.labels?.map((e) => e.name).join(`, `) ||
      r?.label ||
      r?.phonogramSource ||
      ``,
    m = n?.type === `album`,
    h = s?.trackPosition,
    g = h?.index || 0,
    _ = (m && g) || t,
    v = h?.index ? `${h.index}` : ``,
    y = s?.trackCount ? `${s.trackCount}` : ``,
    b = h?.volume ? `${h.volume}` : ``,
    x =
      e.artists
        ?.filter((e) => e?.composer && e?.name)
        .map((e) => e.name)
        .join(`, `) || ``;
  return {
    title: i,
    artist: a,
    albumArtist: c,
    album: l,
    year: d,
    releaseDate: u,
    position: _,
    genre: f,
    publisher: p,
    trackNumber: v,
    trackTotal: y,
    discNumber: b,
    composer: r?.composer || x,
    lyricist: r?.lyricist || ``,
    coverRawUri: e.coverUri || s?.coverUri || e.ogImage,
    lyricsInfo: e.lyricsInfo
      ? {
          hasAvailableSyncLyrics: !!e.lyricsInfo.hasAvailableSyncLyrics,
          hasAvailableTextLyrics: !!e.lyricsInfo.hasAvailableTextLyrics,
        }
      : void 0,
  };
}
async function dt(e, t, n = null, r = null, i) {
  let o = await chrome.storage.local.get([
      `quality`,
      `format`,
      `fallbackFormat`,
      `tags`,
      `lyrics`,
      `saveLyricsFile`,
      `folder`,
      `path`,
      `position`,
      `cover`,
      `saveCoverFile`,
      `coverFileSize`,
      `unicodeFilenames`,
    ]),
    c = { unicodeLookalikes: o.unicodeFilenames === !0 },
    u = o.format || `mp3`,
    d = o.fallbackFormat || `mp3`,
    f = o.cover || `400x400`;
  _.info(`Starting track download`, {
    trackId: e,
    format: u,
    fallbackFormat: d,
    quality: o.quality || `hq`,
  });
  let p = n || (await at(e)),
    m = String(p.id || e),
    [h, g] = await Promise.all([
      re(e, u, o.quality || `hq`, d),
      o.tags === !1 ? Promise.resolve(null) : ne(m),
    ]);
  if (!h) throw Error(`Could not retrieve Yandex stream URL`);
  let v = ut(p, t, r, g);
  _.debug(`Resolved stream info`, {
    trackId: e,
    codec: h.codec,
    transport: h.transport,
  });
  let y = await ot(h.url, i),
    b = o.tags === !1 ? null : await ct(v.coverRawUri, f, r !== null),
    x = s(h.codec),
    ee = `.${x}`,
    S = o.tags !== !1 && o.lyrics === !0,
    C = o.saveLyricsFile === !0,
    w =
      (S || C) &&
      (v.lyricsInfo?.hasAvailableTextLyrics ||
        v.lyricsInfo?.hasAvailableSyncLyrics)
        ? await te(String(p.id || e), v.lyricsInfo)
        : null,
    T = S ? w : null,
    E,
    D;
  if (x === `flac`) {
    if (((D = ve(y)), o.tags !== !1 || b)) {
      let e = {
        TITLE: v.title,
        ARTIST: v.artist,
        ALBUMARTIST: v.albumArtist,
        ALBUM: v.album,
        DATE: v.releaseDate || v.year,
        YEAR: v.year,
        GENRE: v.genre,
        TRACKNUMBER: v.trackNumber,
        TRACKTOTAL: v.trackTotal,
        DISCNUMBER: v.discNumber,
        COMPOSER: v.composer,
        LYRICIST: v.lyricist,
        ORGANIZATION: v.publisher,
      };
      T?.text && (e[T.format === `LRC` ? `LYRICS` : `UNSYNCEDLYRICS`] = T.text);
      let t = o.tags === !1 ? new Uint8Array() : se(e),
        n = b ? ce(F(b), b) : null;
      (t.length || n) && (D = ye(D, t, n));
    }
    let e = new Blob([D], { type: K });
    E = URL.createObjectURL(e);
  } else if (x === `m4a`) {
    D = Xe(
      y,
      {
        title: v.title,
        artist: v.artist,
        albumArtist: v.albumArtist,
        album: v.album,
        year: v.year,
        releaseDate: v.releaseDate,
        genre: v.genre,
        trackNumber: v.trackNumber,
        trackTotal: v.trackTotal,
        discNumber: v.discNumber,
        publisher: v.publisher,
        composer: v.composer,
        lyricist: v.lyricist,
        lyrics: T,
        coverBuffer: b,
      },
      o.tags !== !1,
    );
    let e = new Blob([D], { type: K });
    E = URL.createObjectURL(e);
  } else
    E = Te(
      y,
      {
        title: v.title,
        artist: v.artist,
        albumArtist: v.albumArtist,
        album: v.album,
        year: v.year,
        releaseDate: v.releaseDate,
        genre: v.genre,
        trackNumber: v.trackNumber,
        trackTotal: v.trackTotal,
        discNumber: v.discNumber,
        publisher: v.publisher,
        composer: v.composer,
        lyricist: v.lyricist,
        lyrics: T,
        coverBuffer: b,
      },
      o.tags !== !1,
    );
  let O = `${a(v.artist, c)} - ${a(v.title, c)}`,
    k = `${O}${ee}`,
    A = o.position === !0 && r && v.position > 0 ? it(v.position, r) : ``,
    j = ``;
  if (
    (o.folder === !0 && o.path && (j = l(o.path, r, c)),
    o.folder === !0 &&
      o.saveCoverFile === !0 &&
      r?.type === `album` &&
      v.coverRawUri)
  ) {
    let e = o.coverFileSize || `1000x1000`,
      t = `${j}_${v.coverRawUri}_${e}`;
    if (!U.has(t)) {
      U.add(t);
      try {
        await lt(v.coverRawUri, e, j);
      } catch (e) {
        _.error(`Failed to save album cover file:`, e);
      }
    }
  }
  let M = `${j}${A}${k}`;
  if (
    (await H(E, M),
    _.info(`Track download dispatched`, {
      trackId: e,
      filename: M,
      actualFormat: x,
    }),
    C && w?.text)
  )
    try {
      let e = w.format === `LRC` ? `.lrc` : `.txt`,
        t = `${j}${A}${O}${e}`,
        n = new Blob([w.text], { type: K });
      (await H(URL.createObjectURL(n), t), _.info(`Saved lyrics file`, t));
    } catch (e) {
      _.error(`Failed to save lyrics file:`, e);
    }
}
var q = [],
  J = 0,
  ft = 7;
async function pt() {
  if (J >= ft || q.length === 0) return;
  J++;
  let {
    trackId: e,
    position: t,
    resolve: n,
    reject: r,
    onProgress: i,
  } = q.shift();
  try {
    (await dt(e, t, null, null, i), n());
  } catch (e) {
    r(e);
  } finally {
    (J--, pt());
  }
}
function mt(e, t, n) {
  return new Promise((r, i) => {
    (q.push({ trackId: e, position: t, resolve: r, reject: i, onProgress: n }),
      pt());
  });
}
var ht = 5,
  gt = 4,
  _t = new Set([429, 500, 502, 503, 504]),
  vt = 1e3;
function yt(e) {
  return new Promise((t) => setTimeout(t, e));
}
function bt(e) {
  let t = e?.status;
  return typeof t == `number` && _t.has(t);
}
async function xt(e, t, n) {
  for (let r = 0; ; r++)
    try {
      await dt(e.trackId, e.position, e.trackData, e.bulkContext, n);
      return;
    } catch (n) {
      if (!bt(n) || r >= gt || t?.()) throw n;
      let i = Math.min(8e3, 500 * 2 ** r) + Math.round(Math.random() * 300);
      (_.warn(`Retrying track download after error`, {
        trackId: e.trackId,
        attempt: r + 1,
        delay: i,
      }),
        await yt(i));
    }
}
async function St(e, t, n, r) {
  for (let i = 0; i < e.length; i++) {
    if (n && n()) {
      _.info(`Bulk download cancelled by user`);
      break;
    }
    let a = e[i];
    t && t(i + 1, e.length, a.trackData?.title || `Unknown`);
    try {
      await xt(a, n, r || void 0);
    } catch (e) {
      _.error(`Bulk track download failed`, e);
    }
    if (i < e.length - 1)
      for (let e = 0; e < vt && !(n && n()); e += 100) await yt(100);
  }
}
async function Ct(e, t, n, r) {
  let i = 0,
    a = 0,
    o = Array.from({ length: e.length }, () => 0),
    s = () => {
      if (!r) return;
      let t = o.reduce((e, t) => e + t, 0) / e.length;
      r(Math.round(t));
    },
    c = async () => {
      for (;;) {
        if (n && n()) return;
        let c = i++;
        if (c >= e.length) return;
        let l = e[c],
          u = r
            ? (e) => {
                ((o[c] = e), s());
              }
            : void 0;
        try {
          await xt(l, n, u);
        } catch (e) {
          _.error(`Bulk track download failed`, e);
        } finally {
          (a++,
            (o[c] = 100),
            t && t(a, e.length, l.trackData?.title || `Unknown`),
            s());
        }
      }
    },
    l = Array.from({ length: Math.min(ht, e.length) }, () => c());
  await Promise.all(l);
}
async function wt(e, t, n, r) {
  (rt(),
    (await chrome.storage.local.get([`multithread`])).multithread === !1
      ? (_.info(`Bulk download started (sequential)`, { total: e.length }),
        await St(e, t, n, r))
      : (_.info(`Bulk download started (multithreaded)`, {
          total: e.length,
          MAX_CONCURRENT: ht,
        }),
        await Ct(e, t, n, r)));
}
function Y(e, t, n) {
  ((Z = e),
    window.dispatchEvent(
      new CustomEvent(`ymd:artist-download-progress`, {
        detail: { current: e, total: t, percent: n },
      }),
    ));
}
function X(e, t) {
  window.dispatchEvent(
    new CustomEvent(`ymd:artist-download-done`, {
      detail: { success: e, cancelled: t },
    }),
  );
}
var Z = 0;
function Tt(e) {
  Z = e;
}
async function Et(t) {
  let n = await y(`https://${e()}/artists/${t}/track-ids`);
  return (Array.isArray(n?.result) ? n.result : Array.isArray(n) ? n : []).map(
    (e) => String(e),
  );
}
async function Dt(t) {
  let n = await y(`https://${e()}/artists/${t}`),
    r = n?.result?.artist?.name || n?.result?.name || n?.artist?.name;
  return (
    r || _.warn(`Artist name not found in artist response`, t, n),
    r || `Unknown Artist`
  );
}
async function Ot(t) {
  let n = await b(
    `https://${e()}/tracks`,
    `trackIds=${t.join(`,`)}&removeDuplicates=false&withProgress=true`,
  );
  return (
    Array.isArray(n?.result) ? n.result : Array.isArray(n) ? n : []
  ).filter((e) => e && e.id);
}
async function kt(e, t) {
  try {
    let n = await Et(e);
    if (n.length === 0) {
      (_.info(`No track ids for artist`, e), X(!1, !1));
      return;
    }
    let r = await Dt(e),
      i = await Ot(n);
    if (i.length === 0) {
      (_.info(`No track metadata for artist`, e), X(!1, !1));
      return;
    }
    let a = {
        type: `artistPopularTracks`,
        title: `${r} — Popular tracks`,
        artistName: r,
        totalTracks: i.length,
      },
      o = i.map((e, t) => ({
        trackId: String(e.id),
        position: t + 1,
        trackData: e,
        bulkContext: a,
      }));
    (Y(0, o.length, 0),
      await wt(
        o,
        (e, t, n) => {
          (Tt(e),
            Y(e, t, Math.round((e / t) * 100)),
            _.info(`Artist download ${e}/${t}: ${n}`));
        },
        t || null,
        (e) => {
          Y(Z, o.length, e);
        },
      ));
    let s = t ? t() : !1;
    (Y(s ? Z : o.length, o.length, 100), X(!0, s));
  } catch (e) {
    (_.error(`Artist download failed`, e), X(!1, !1));
  }
}
var Q = {
  currentFilterId: `all`,
  currentFilterName: `Всё`,
  filters: new Map(),
};
function $(e) {
  return typeof e == `string`
    ? e.trim()
    : typeof e == `number`
      ? String(e).trim()
      : ``;
}
function At(e) {
  let t = $(e.trackId || e.trackData?.id),
    n = $(e.trackData?.albums?.[0]?.id),
    r = new Set();
  return (t && r.add(t), t && n && r.add(`${t}:${n}`), Array.from(r));
}
function jt(e, t) {
  for (let n of At(e)) {
    let e = t.get(n);
    if (e !== void 0) return e;
  }
  return 2 ** 53 - 1;
}
function Mt(e) {
  return Array.isArray(e?.filters)
    ? e.filters
    : Array.isArray(e?.result?.filters)
      ? e.result.filters
      : [];
}
function Nt(e) {
  let t = new Set();
  return (
    e.forEach((e) => {
      let n = At(e);
      t.add(n.find((e) => e.includes(`:`)) || n[0]);
    }),
    Array.from(t).filter(Boolean)
  );
}
async function Pt(t) {
  let n = Q.filters.get(Q.currentFilterId);
  if (n) return n;
  let r = Nt(t);
  if (r.length === 0) return null;
  let i = Mt(
    await y(`https://${e()}/filters/tracks`, {
      method: `POST`,
      headers: { "Content-Type": `application/json`, ...v },
      body: JSON.stringify({ trackIds: r }),
    }),
  );
  return i.length === 0
    ? null
    : (Ft({ filters: i }), Q.filters.get(Q.currentFilterId) || null);
}
function Ft(e) {
  (typeof e.currentFilterId == `string` &&
    e.currentFilterId &&
    (Q.currentFilterId = e.currentFilterId),
    typeof e.currentFilterName == `string` &&
      e.currentFilterName &&
      (Q.currentFilterName = e.currentFilterName),
    Array.isArray(e.filters) &&
      e.filters.forEach((e) => {
        e?.id &&
          Array.isArray(e.tracks) &&
          Q.filters.set(
            e.id,
            e.tracks.map((e) => String(e)),
          );
      }),
    _.debug(`Playlist filter state updated`, {
      currentFilterId: Q.currentFilterId,
      currentFilterName: Q.currentFilterName,
      filtersCount: Q.filters.size,
    }));
}
async function It(e, t) {
  if (
    t.type !== `playlist` ||
    !Q.currentFilterId ||
    Q.currentFilterId === `all`
  )
    return e;
  let n = await Pt(e);
  if (!n || n.length === 0)
    return (
      _.warn(`Selected playlist filter has no cached tracks`, {
        filterId: Q.currentFilterId,
        filterName: Q.currentFilterName,
      }),
      e
    );
  let r = new Map();
  n.forEach((e, t) => {
    let n = $(e);
    if (!n) return;
    r.set(n, t);
    let i = n.split(`:`)[0];
    i && !r.has(i) && r.set(i, t);
  });
  let i = e
    .filter((e) => At(e).some((e) => r.has(e)))
    .sort((e, t) => jt(e, r) - jt(t, r))
    .map((e, n) => ({ ...e, position: n + 1, bulkContext: t }));
  return i.length === 0
    ? (_.warn(`Selected playlist filter did not match fetched tracks`, {
        filterId: Q.currentFilterId,
        filterName: Q.currentFilterName,
        filterTracks: n.length,
        fetchedTracks: e.length,
      }),
      e)
    : ((t.filterId = Q.currentFilterId),
      (t.filterName = Q.currentFilterName),
      (t.filtered = !0),
      (t.totalTracks = i.length),
      _.info(`Applied playlist filter`, {
        filterId: Q.currentFilterId,
        filterName: Q.currentFilterName,
        tracks: i.length,
      }),
      i);
}
function Lt(e) {
  return String(e?.login || ``)
    .toLowerCase()
    .startsWith(`yamusic`);
}
function Rt(e) {
  let t = e?.title || `Unknown Playlist`,
    n = e?.owner,
    r = n?.name || n?.login;
  return t.trim().toLowerCase() === `мне нравится` && r && !Lt(n)
    ? `${t} - ${r}`
    : t;
}
function zt(e) {
  return (
    String(e?.year || ``).trim() ||
    String(e?.releaseDate || ``).match(/^\d{4}/)?.[0] ||
    ``
  );
}
function Bt(e) {
  let t = o(e?.title || `Unknown Title`, e?.version);
  return {
    artist: e?.artists?.map((e) => e.name).join(`, `) || `Unknown Artist`,
    title: t,
  };
}
function Vt(e) {
  return (
    e.map((e) => `${e.artist} — ${e.title}`).join(`
`) +
    `
`
  );
}
async function Ht(e, t) {
  let n = [],
    r = { type: `playlist`, title: t },
    i = 0,
    a = 1;
  do {
    let t = await y(`${e}${e.includes(`?`) ? `&` : `?`}page=${i}`);
    if (!t?.result?.tracks) return null;
    let o = t.result;
    o.tracks.forEach((e) => {
      n.push({
        trackId: e.track?.id || e.id,
        position: (e.originalIndex ?? n.length) + 1,
        trackData: e.track || e,
        bulkContext: r,
      });
    });
    let s = o.pager;
    (s && s.total && s.perPage && (a = Math.ceil(s.total / s.perPage)), i++);
  } while (i < a);
  return ((r.totalTracks = n.length), { items: await It(n, r), context: r });
}
async function Ut(t) {
  let n = await y(
    `https://${e()}/albums/${t}/with-tracks?resumeStream=false&richTracks=true&withListeningFinished=true`,
  );
  if (!n?.result) return null;
  let r = n.result,
    i = r.title || `Unknown Album`,
    a = zt(r),
    o = [],
    s = { type: `album`, title: i, year: a };
  return (
    Array.isArray(r.volumes) &&
      r.volumes.forEach((e) => {
        Array.isArray(e) &&
          e.forEach((e) => {
            o.push({
              trackId: e.id,
              position: o.length + 1,
              trackData: e,
              bulkContext: s,
            });
          });
      }),
    o.length === 0 &&
      Array.isArray(r.tracks) &&
      r.tracks.forEach((e) => {
        o.push({
          trackId: e.id,
          position: o.length + 1,
          trackData: e,
          bulkContext: s,
        });
      }),
    o.length === 0
      ? null
      : ((s.totalTracks = o.length), { items: o, context: s })
  );
}
async function Wt() {
  let t = window.location.pathname,
    n = e(),
    r = t.match(/\/users\/([^/]+)\/playlists\/(\d+)/i);
  if (r) {
    let e = `https://${n}/users/${r[1]}/playlists/${r[2]}?resumeStream=false&richTracks=true`;
    return Ht(e, Rt((await y(e))?.result));
  }
  let i = t.match(/\/playlists\/([^/]+)/i);
  if (i) {
    let e = `https://${n}/playlist/${i[1]}?resumeStream=false&richTracks=true`;
    return Ht(e, Rt((await y(e))?.result));
  }
  let a = t.match(/\/album\/(\d+)/i);
  return a ? Ut(a[1]) : null;
}
async function Gt() {
  let e = await Wt();
  if (!e || e.items.length === 0) {
    alert(
      `Не удалось получить список треков. Пожалуйста, убедитесь, что вы на странице плейлиста или альбома.`,
    );
    return;
  }
  let t = Vt(e.items.map((e) => Bt(e.trackData))),
    { unicodeFilenames: n } =
      await chrome.storage.local.get(`unicodeFilenames`),
    r = `${a(e.context.title, { unicodeLookalikes: n === !0 })}.txt`,
    i = new Blob([t], { type: `text/plain;charset=utf-8` }),
    o = URL.createObjectURL(i);
  ($e(o, r), setTimeout(() => URL.revokeObjectURL(o), 3e4));
}
async function Kt() {
  return (await Wt())?.items || null;
}
function qt(e, t) {
  if (e.querySelector(`.__ymd_telegram`)) return;
  let n = document.createElement(`a`);
  ((n.href = `tg://resolve?domain=ymdownloader`),
    (n.target = `_blank`),
    (n.rel = `noopener noreferrer`),
    n.classList.add(`__ymd_telegram`),
    (n.title = `YMD в Telegram`),
    (n.draggable = !1));
  let r = chrome.runtime.getURL(`src/ymd.png`),
    i = document.createElement(`img`);
  ((i.src = r),
    (i.alt = `YMD`),
    (i.draggable = !1),
    n.appendChild(i),
    t.insertAdjacentElement(`afterend`, n));
}
function Jt(e, t) {
  if (e.querySelector(`.__ymd_export`)) return;
  let n = document.createElement(`button`);
  ((n.type = `button`),
    n.classList.add(`__ymd_export`),
    (n.title = `Экспортировать список треков в TXT`));
  let r = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`;
  ((n.innerHTML = r),
    n.addEventListener(`click`, async (e) => {
      if (
        (e.stopPropagation(),
        e.preventDefault(),
        !n.classList.contains(`_loading`))
      ) {
        (n.classList.add(`_loading`),
          (n.innerHTML = `<svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`));
        try {
          (await Gt(),
            (n.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`));
        } catch (e) {
          (_.error(`Export failed`, e),
            alert(
              `Ошибка экспорта: ${e instanceof Error ? e.message : String(e)}`,
            ),
            (n.innerHTML = r),
            n.classList.remove(`_loading`));
          return;
        }
        setTimeout(() => {
          ((n.innerHTML = r), n.classList.remove(`_loading`));
        }, 2e3);
      }
    }),
    t.insertAdjacentElement(`afterend`, n));
}
function Yt(e) {
  if (e.querySelector(`.__ymd_download`)) return;
  let t = document.createElement(`button`);
  ((t.type = `button`),
    t.classList.add(`__ymd_download`),
    (t.title = `Скачать всё`),
    (t.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" width="20" height="20"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.8333 12.7791C10.9784 12.5958 11.1318 12.409 11.2927 12.22C12.5317 10.7655 14.2728 9.12663 16.2619 8.02154L17.0714 9.47847C15.3105 10.4567 13.7183 11.9428 12.5614 13.3008C11.9853 13.9771 11.5301 14.6065 11.2243 15.1042C11.0708 15.3541 10.9624 15.5587 10.8953 15.711C10.8712 15.7658 10.8559 15.806 10.8464 15.8333H18.3333V17.5H9.99997H1.66666V15.8333H9.15355C9.14404 15.806 9.12879 15.7658 9.10466 15.711C9.03759 15.5587 8.92917 15.3541 8.77565 15.1042C8.46983 14.6065 8.01465 13.9771 7.43853 13.3008C6.2817 11.9428 4.68945 10.4567 2.92861 9.47847L3.73802 8.02154C5.72719 9.12663 7.46827 10.7655 8.70727 12.22C8.8682 12.409 9.02154 12.5958 9.16664 12.7791V2.5H10.8333V12.7791Z" fill="currentColor"/></svg>`));
  let n = !1,
    r = !1,
    i = !1,
    a = !1,
    o = 0,
    s = 0,
    c = t.innerHTML,
    l = t.title,
    u = (e, a = !0) => {
      a
        ? (t.classList.add(`_downloading`), (n = !0))
        : ((t.innerHTML = c),
          (t.title = l),
          t.classList.remove(`_downloading`),
          (n = !1),
          (i = !1),
          (r = !1),
          (t.style.backgroundColor = ``),
          (t.style.color = ``));
    };
  (t.addEventListener(`mouseenter`, () => {
    if (((a = !0), n && !i && !r)) {
      ((t.style.backgroundColor = `#ff4444`),
        (t.style.color = `#ffffff`),
        (t.title = `Нажмите, чтобы остановить загрузку`));
      let e = t.querySelector(`.ymd-count`);
      e && (e.textContent = `Прервать?`);
    }
  }),
    t.addEventListener(`mouseleave`, () => {
      if (((a = !1), n)) {
        ((t.style.backgroundColor = ``), (t.style.color = ``));
        let e = t.querySelector(`.ymd-count`);
        (e && !i && (e.textContent = `${o}/${s}`),
          i &&
            (e && (e.textContent = `Остановка...`),
            (t.title = `Загрузка останавливается...`)));
      }
    }),
    t.addEventListener(`click`, async (e) => {
      if ((e.stopPropagation(), e.preventDefault(), n)) {
        if (r) return;
        confirm(
          `Вы действительно хотите остановить загрузку плейлиста/альбома?`,
        ) &&
          ((i = !0),
          (t.innerHTML = `<span>Остановка...</span>`),
          (t.style.backgroundColor = ``),
          (t.style.color = ``),
          (t.title = `Загрузка останавливается...`));
      } else
        try {
          ((r = !0), t.classList.add(`_downloading`), (n = !0));
          let e = await Kt();
          if (((r = !1), !e || e.length === 0)) {
            (alert(
              `Не удалось загрузить треки по API. Пожалуйста, убедитесь, что вы авторизованы.`,
            ),
              u(``, !1));
            return;
          }
          t.innerHTML =
            `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" stroke-width="4" opacity="0.3"/><circle class="ymd-progress" cx="18" cy="18" r="16" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="0, 100"/></svg><span class="ymd-count">0/` +
            e.length +
            `</span>`;
          let c = t.querySelector(`.ymd-progress`),
            l = t.querySelector(`.ymd-count`);
          ((s = e.length), (o = 0));
          let d = (e, t, n) => {
            ((o = e),
              c && c.setAttribute(`stroke-dasharray`, `${n}, 100`),
              l && !a && (l.textContent = `${e}/${t}`));
          };
          (d(0, e.length, 0),
            await wt(
              e,
              (e, n, r) => {
                (d(e, n, 0), (t.title = `Скачивание: ${r} (${e} из ${n})`));
              },
              () => i,
              (t) => {
                d(o, e.length, t);
              },
            ),
            (t.style.backgroundColor = ``),
            (t.style.color = ``),
            (n = !1),
            i
              ? (t.classList.add(`_downloading`),
                (t.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><span>Прервано</span>`),
                (t.title = `Загрузка была остановлена пользователем`),
                setTimeout(() => u(``, !1), 2e3))
              : (t.classList.add(`_downloading`),
                (t.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span>Готово!</span>`),
                setTimeout(() => u(``, !1), 3e3)));
        } catch (e) {
          ((t.style.backgroundColor = ``),
            (t.style.color = ``),
            _.error(`Bulk download failed`, e),
            alert(
              `Ошибка скачивания: ${typeof e == `object` && e && `message` in e ? e.message : String(e)}`,
            ),
            u(``, !1));
        }
    }),
    e.prepend(t),
    qt(e, t),
    Jt(e, t));
}
function Xt() {
  let e = document.querySelector(
    `[class*="CommonPageHeader_controls__"], [class*="PageHeaderPlaylist_mainControls"]`,
  );
  e &&
    !e.classList.contains(`_ym_ready_hdr`) &&
    (e.classList.add(`_ym_ready_hdr`), Yt(e));
}
var Zt = (e, t) =>
  document.getElementById(e)
    ? Promise.resolve()
    : new Promise((n) => {
        let r = document.createElement(`script`);
        ((r.id = e),
          (r.src = chrome.runtime.getURL(t)),
          (r.onload = () => {
            (r.remove(), n());
          }),
          (r.onerror = () => {
            (r.remove(), n());
          }),
          document.documentElement.appendChild(r));
      });
function Qt(e, t) {
  window.dispatchEvent(
    new CustomEvent(`ymd:download-done`, {
      detail: { trackId: e, success: t },
    }),
  );
}
var $t = new Map();
function en(e, t) {
  $t.set(e, t);
}
function tn(e) {
  return $t.get(e) || !1;
}
function nn(e) {
  return () => tn(e);
}
(async () => {
  (await h(), await Zt(`ymd-page-script`, `src/page-script.js`));
  let e = () => {
    (window.dispatchEvent(
      new CustomEvent(`ymd:page-config`, {
        detail: {
          donateIconUrl: chrome.runtime.getURL(`src/donate.png`),
          ymdIconUrl: chrome.runtime.getURL(`src/ymd.png`),
          logLevel: g(),
        },
      }),
    ),
      window.dispatchEvent(
        new CustomEvent(`ymd:log-level`, { detail: { level: g() } }),
      ));
  };
  (chrome.storage.onChanged.addListener((t, n) => {
    n === `local` && t.logLevel && (m(t.logLevel.newValue), e());
  }),
    e(),
    window.addEventListener(`ymd:request-download`, (e) => {
      let { trackId: t, position: n } = e.detail;
      (_.info(`Download requested`, { trackId: t, position: n }),
        mt(t, n || 0, (e) => {
          window.dispatchEvent(
            new CustomEvent(`ymd:download-progress`, {
              detail: { trackId: t, percent: e },
            }),
          );
        })
          .then(() => Qt(t, !0))
          .catch((e) => {
            (_.error(`Download failed`, e), Qt(t, !1));
          }));
    }),
    window.addEventListener(`ymd:download-artist-tracks`, (e) => {
      let t =
        e.detail?.artistId ||
        window.location.pathname.match(/\/artist\/(\d+)\/tracks/i)?.[1];
      t
        ? (_.info(`Download artist tracks requested`, t),
          en(t, !1),
          kt(t, nn(t)))
        : _.error(`Download artist tracks requested without artistId`);
    }),
    window.addEventListener(`ymd:cancel-artist-download`, (e) => {
      let { artistId: t } = e.detail;
      (_.info(`Cancel artist download`, t), en(t, !0));
    }),
    window.addEventListener(`ymd:playlist-filter-state`, (e) => {
      Ft(e.detail || {});
    }));
  let t = () => {
    (Xt(),
      new MutationObserver(Xt).observe(document.body, {
        childList: !0,
        subtree: !0,
      }));
  };
  document.readyState === `loading`
    ? document.addEventListener(`DOMContentLoaded`, t)
    : t();
})();
