var e = { off: 0, error: 1, warn: 2, info: 3, debug: 4 },
  t = `https://forms.gle/z6Q2CjuH7bcHmSuR9`;
function n(t) {
  return typeof t == `string` && t in e ? t : `off`;
}
function r(t, ...r) {
  chrome.storage.local.get(`logLevel`, (i) => {
    e[n(i.logLevel)] < e[t] ||
      console[t === `debug` ? `debug` : t](`[YMD]`, ...r);
  });
}
var i =
    (e) =>
    (...t) =>
      new Promise((n, r) => {
        try {
          e(...t, (e) => {
            chrome.runtime.lastError ? r(chrome.runtime.lastError) : n(e);
          });
        } catch (e) {
          r(e);
        }
      }),
  a = {
    get: i(chrome.storage.local.get.bind(chrome.storage.local)),
    set: i(chrome.storage.local.set.bind(chrome.storage.local)),
    remove: i(chrome.storage.local.remove.bind(chrome.storage.local)),
    async isEmpty(e) {
      let t = await this.get(e);
      return !t || (typeof t == `object` && Object.keys(t).length === 0);
    },
  },
  o = { create: i(chrome.tabs.create.bind(chrome.tabs)) };
function s() {
  chrome.runtime.setUninstallURL &&
    chrome.runtime.setUninstallURL(t, () => {
      chrome.runtime.lastError &&
        r(
          `warn`,
          `Failed to set uninstall survey URL`,
          chrome.runtime.lastError,
        );
    });
}
var c = async () => {
  for (let [e, t] of Object.entries({
    quality: `hq`,
    format: `mp3`,
    fallbackFormat: `mp3`,
    tags: !0,
    lyrics: !1,
    saveLyricsFile: !1,
    folder: !1,
    path: `YMD`,
    position: !1,
    cover: `400x400`,
    saveCoverFile: !1,
    coverFileSize: `1000x1000`,
    logLevel: `off`,
    multithread: !0,
    unicodeFilenames: !1,
  }))
    (await a.isEmpty(e)) && (await a.set({ [e]: t }));
};
chrome.action.onClicked.addListener(() => {
  o.create({ url: chrome.runtime.getURL(`src/options/options.html`) });
});
var l = new Map(),
  u = (e, t) => {
    let n = l.get(e.url);
    (n
      ? (l.delete(e.url), t({ filename: n, conflictAction: `overwrite` }))
      : e.byExtensionId === chrome.runtime.id
        ? t({ filename: e.filename, conflictAction: `overwrite` })
        : t({ filename: e.filename }),
      l.size === 0 &&
        chrome.downloads?.onDeterminingFilename &&
        chrome.downloads.onDeterminingFilename.removeListener(u));
  };
function d() {
  chrome.downloads?.onDeterminingFilename &&
    (chrome.downloads.onDeterminingFilename.hasListener(u) ||
      chrome.downloads.onDeterminingFilename.addListener(u));
}
function f(e, t) {
  (l.set(e, t),
    d(),
    setTimeout(() => {
      l.has(e) &&
        (l.delete(e),
        l.size === 0 &&
          chrome.downloads?.onDeterminingFilename &&
          chrome.downloads.onDeterminingFilename.removeListener(u));
    }, 5e3));
}
function p(e) {
  (l.delete(e),
    l.size === 0 &&
      chrome.downloads?.onDeterminingFilename &&
      chrome.downloads.onDeterminingFilename.removeListener(u));
}
(s(),
  chrome.runtime.onInstalled.addListener(async (e) => {
    (s(),
      e.reason === `install` &&
        o.create({ url: chrome.runtime.getURL(`src/welcome/welcome.html`) }),
      await c());
  }),
  chrome.runtime.onStartup.addListener(async () => {
    (s(), await c());
  }),
  chrome.runtime.onMessage.addListener((e, t, n) => {
    if (e.message === `trackMetadata`) {
      let t = `trackIds=${e.trackId}&removeDuplicates=false&withProgress=true`;
      return (
        fetch(`https://api.music.yandex.ru/tracks`, {
          method: `POST`,
          headers: {
            "Content-Type": `application/x-www-form-urlencoded`,
            "x-yandex-music-client": `YandexMusicWebNext/1.0.0`,
            "x-yandex-music-without-invocation-info": `1`,
            "X-Requested-With": `XMLHttpRequest`,
            Referer: `https://music.yandex.ru/`,
          },
          body: t,
        })
          .then(async (e) => {
            if (!e.ok) n(!1);
            else
              try {
                n(await e.json());
              } catch {
                n(!1);
              }
          })
          .catch((e) => {
            (r(`error`, `Metadata proxy fetch failed`, e), n(!1));
          }),
        !0
      );
    }
    if (e.message === `downloadInfo`)
      return (
        fetch(e.url, { headers: e.headers })
          .then(async (e) => {
            if (!e.ok) n(!1);
            else
              try {
                n(await e.json());
              } catch {
                n({ error: `Invalid JSON response from Yandex API` });
              }
          })
          .catch((e) => {
            (r(`error`, `API proxy fetch failed`, e), n(!1));
          }),
        !0
      );
    if (e.message === `registerFilename`)
      return (f(e.url, e.filename), n({ status: `ok` }), !0);
    if (e.message === `saveBlob`) {
      f(e.url, e.filename);
      try {
        chrome.downloads.download(
          {
            url: e.url,
            filename: e.filename,
            conflictAction: `overwrite`,
            saveAs: !1,
          },
          (t) => {
            let i = chrome.runtime.lastError;
            i || !t
              ? (p(e.url),
                r(`warn`, `Downloads API save failed`, i?.message),
                n({ ok: !1, error: i?.message ?? `downloads.download failed` }))
              : n({ ok: !0, downloadId: t });
          },
        );
      } catch (t) {
        p(e.url);
        let i = t instanceof Error ? t.message : String(t);
        (r(`warn`, `Downloads API save failed`, i), n({ ok: !1, error: i }));
      }
      return !0;
    }
    if (e.message === `check`) return (n({ status: !1 }), !0);
  }));
