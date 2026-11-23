(function () {
  if (window.__ymd_page_script_installed__) return;
  window.__ymd_page_script_installed__ = !0;
  let e = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" width="20" height="20"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.8333 12.7791C10.9784 12.5958 11.1318 12.409 11.2927 12.22C12.5317 10.7655 14.2728 9.12663 16.2619 8.02154L17.0714 9.47847C15.3105 10.4567 13.7183 11.9428 12.5614 13.3008C11.9853 13.9771 11.5301 14.6065 11.2243 15.1042C11.0708 15.3541 10.9624 15.5587 10.8953 15.711C10.8712 15.7658 10.8559 15.806 10.8464 15.8333H18.3333V17.5H9.99997H1.66666V15.8333H9.15355C9.14404 15.806 9.12879 15.7658 9.10466 15.711C9.03759 15.5587 8.92917 15.3541 8.77565 15.1042C8.46983 14.6065 8.01465 13.9771 7.43853 13.3008C6.2817 11.9428 4.68945 10.4567 2.92861 9.47847L3.73802 8.02154C5.72719 9.12663 7.46827 10.7655 8.70727 12.22C8.8682 12.409 9.02154 12.5958 9.16664 12.7791V2.5H10.8333V12.7791Z" fill="currentColor"/></svg>`,
    t = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" stroke-width="4" opacity="0.3"/><circle class="ymd-progress" cx="18" cy="18" r="16" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="0, 100"/></svg>`,
    n = { off: 0, error: 1, warn: 2, info: 3, debug: 4 },
    r = `off`;
  function i(e) {
    r = Object.prototype.hasOwnProperty.call(n, e) ? e : `off`;
  }
  function a(e, ...t) {
    n[r] < n[e] || console[e === `debug` ? `debug` : e](`[YMD page]`, ...t);
  }
  function o(e) {
    if (!e) return null;
    let t = Object.keys(e).find((e) => e.startsWith(`__reactProps$`));
    if (!t) return null;
    let n = e[t],
      r =
        n?.children?.[1]?.props?.track?.id ||
        n?.children?.[2]?.props?.track?.id ||
        n?.children?.[3]?.props?.track?.id;
    if (r)
      return { trackId: String(r), source: `HorizontalCardContainer_root` };
    let i =
      n?.children?.[0]?.props?.children?.props?.objectId ||
      n?.children?.[1]?.props?.children?.props?.trackId ||
      n?.children?.[0]?.props?.mainObjectId;
    if (i) return { trackId: String(i), source: `VibePage_playerBlock` };
    let a =
      n?.children?.props?.track?.id ||
      n?.children?.props?.afterTitle?.props?.children?.props?.track?.id;
    if (a) return { trackId: String(a), source: `player` };
    let o = n?.children?.props?.track?.id;
    return o ? { trackId: String(o), source: `PageHeaderBase_controls` } : null;
  }
  function s(e) {
    alert(
      `YMD не смог определить ID трека из React props (${e}). Попробуйте обновить страницу Яндекс.Музыки.`,
    );
  }
  function c(e, t) {
    window.dispatchEvent(
      new CustomEvent(`ymd:request-download`, {
        detail: { trackId: e, position: t },
      }),
    );
  }
  function l() {
    let e = window.location.host.match(/music\.ya(?:ndex|ndex)\.([a-z]+)/i);
    return e?.[1] ? `api.music.yandex.${e[1]}` : `api.music.yandex.ru`;
  }
  function u(e) {
    let t = typeof e == `string` ? e : e instanceof URL ? e.href : e?.url;
    if (!t) return null;
    try {
      return new URL(t, window.location.origin);
    } catch {
      return null;
    }
  }
  function d(e) {
    window.dispatchEvent(
      new CustomEvent(`ymd:playlist-filter-state`, { detail: e }),
    );
  }
  function f(e, t) {
    if (!t.ok || e.hostname !== l()) return;
    if (e.pathname === `/filters/tracks`) {
      t.clone()
        .json()
        .then((e) => {
          let t = Array.isArray(e?.filters)
            ? e.filters
            : Array.isArray(e?.result?.filters)
              ? e.result.filters
              : [];
          t.length !== 0 &&
            (d({
              filters: t.map((e) => ({
                id: e.id,
                name: e.name,
                tracks: Array.isArray(e.tracks) ? e.tracks : [],
              })),
            }),
            a(`debug`, `cached playlist filters`, t.length));
        })
        .catch((e) => a(`debug`, `failed to read filters/tracks response`, e));
      return;
    }
    let n = e.pathname.match(/^\/filters\/(.+)$/);
    n &&
      n[1] !== `tracks` &&
      t
        .clone()
        .json()
        .then((e) => {
          let t = e?.result || e;
          t?.id &&
            (d({
              currentFilterId: String(t.id),
              currentFilterName: String(t.name || t.id),
            }),
            a(`debug`, `selected playlist filter`, t.id, t.name));
        })
        .catch((e) => a(`debug`, `failed to read filter response`, e));
  }
  function p() {
    if (window.__ymd_filter_fetch_interceptor_installed__) return;
    window.__ymd_filter_fetch_interceptor_installed__ = !0;
    let e = window.fetch.bind(window);
    window.fetch = async (...t) => {
      let n = await e(...t),
        r = u(t[0]);
      return (r && f(r, n), n);
    };
  }
  function m(e) {
    e.innerHTML = t;
  }
  function h(e) {
    e.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  }
  function g(e, t) {
    ((e.innerHTML = t), (e.disabled = !1));
  }
  let _ = ``;
  function v(e) {
    ((_ = e.donateIconUrl || ``), i(e.logLevel));
  }
  (window.addEventListener(`ymd:page-config`, (e) => {
    v(e.detail || {});
  }),
    window.addEventListener(`ymd:log-level`, (e) => {
      i(e.detail?.level);
    }));
  function y() {
    let e = document.createElement(`a`);
    ((e.href = `https://pay.cloudtips.ru/p/2b4c933e`),
      (e.target = `_blank`),
      (e.rel = `noopener noreferrer`),
      e.classList.add(`__ymd_donate`),
      (e.title = `Поддержать YMD`),
      (e.draggable = !1));
    let t = document.createElement(`img`);
    return (
      (t.src = _ || `src/donate.png`),
      (t.alt = `Donate`),
      (t.draggable = !1),
      e.appendChild(t),
      e
    );
  }
  function b(e, t) {
    if (e.querySelector(`.__ymd_donate`)) return;
    let n = y();
    t.insertAdjacentElement(`afterend`, n);
  }
  function x(t) {
    let n = document.createElement(`button`);
    return (
      (n.type = `button`),
      n.classList.add(`__ymd_download`),
      (n.title = `Скачать`),
      (n.innerHTML = e),
      t && n.setAttribute(`data-ymd-track-id`, t),
      n
    );
  }
  function S(t, n) {
    let r = e;
    t.addEventListener(`click`, (e) => {
      if ((e.stopPropagation(), e.preventDefault(), t.disabled)) return;
      t.disabled = !0;
      let i = null;
      try {
        i = t.getAttribute(`data-ymd-track-id`) || n();
      } catch (e) {
        a(`error`, `trackId props extraction failed`, e);
      }
      if (!i) {
        (a(`debug`, `trackId not found`),
          s(t.dataset.ymdSource || `unknown`),
          (t.disabled = !1));
        return;
      }
      (a(`info`, `download trackId`, i), m(t), c(i, 0));
      let o = (e) => {
          if (e.detail?.trackId !== i) return;
          let n = t.querySelector(`.ymd-progress`);
          n && n.setAttribute(`stroke-dasharray`, `${e.detail.percent}, 100`);
        },
        l = (e) => {
          let { trackId: n, success: a } = e.detail;
          n === i &&
            (window.removeEventListener(`ymd:download-done`, l),
            window.removeEventListener(`ymd:download-progress`, o),
            a ? (h(t), setTimeout(() => g(t, r), 2e3)) : g(t, r));
        };
      (window.addEventListener(`ymd:download-progress`, o),
        window.addEventListener(`ymd:download-done`, l));
    });
  }
  function C(e) {
    let t = e.querySelector(`[class*='CommonControlsBar_root']`);
    if (!t || t.querySelector(`.__ymd_download`)) return;
    let n = t.querySelectorAll(`button`);
    if (n.length < 2 || n[1].disabled) return;
    let r = x(o(e)?.trackId || null);
    ((r.dataset.ymdSource = `track-card`), S(r, () => o(e)?.trackId || null));
    let i = t.querySelector(`[class*='CommonControlsBar_removeButton']`);
    i ? i.insertAdjacentElement(`afterend`, r) : t.insertBefore(r, n[0]);
  }
  function w() {
    document
      .querySelectorAll(
        `[class*='PlayerBarDesktopWithBackgroundProgressBar_meta'], [class*='PlayerBarMobile_infoButtons']`,
      )
      .forEach((e) => {
        if (e.querySelector(`.__ymd_download_player`)) return;
        let t = x(null);
        (t.classList.add(`__ymd_download_player`),
          (t.title = `Скачать текущий трек`),
          (t.dataset.ymdSource = `player`),
          S(t, () => {
            let e = document.querySelector(
                `[class*='PlayerBarDesktopWithBackgroundProgressBar_description']`,
              ),
              t = document.querySelector(
                `[class*='PlayerBarMobile_description']`,
              );
            return (o(e) || o(t))?.trackId || null;
          }),
          e.prepend(t),
          b(e, t));
      });
  }
  function T() {
    let e = document.querySelector(`[class*='VibePlayerBar_root']`);
    if (!e) return;
    let t = e.querySelector(`[class*='VibePlayerBar_progress']`);
    if (!t || t.querySelector(`.__ymd_download_vibe`)) return;
    let n = x(null);
    (n.classList.add(`__ymd_download`, `__ymd_download_vibe`),
      (n.title = `Скачать текущий трек`),
      (n.dataset.ymdSource = `vibe-player`),
      S(
        n,
        () =>
          o(document.querySelector(`[class*='VibePage_playerBlock']`))
            ?.trackId || null,
      ),
      t.appendChild(n));
  }
  function E() {
    let e = document.querySelector(
      `[class*="TrackModalControls_controlsContainer"]:not(._ym_track_modal_ready)`,
    );
    if (
      !e ||
      (e.classList.add(`_ym_track_modal_ready`),
      e.querySelector(`.__ymd_download_modal`))
    )
      return;
    let t = e.closest(`[class*="PageHeaderBase_controls"]`),
      n = x(o(t)?.trackId || null);
    (n.classList.add(`__ymd_download_modal`),
      (n.dataset.ymdSource = `track-modal`),
      S(n, () => o(t)?.trackId || null),
      e.prepend(n));
  }
  function D() {
    return (
      window.location.pathname.match(/\/artist\/(\d+)\/tracks/i)?.[1] || null
    );
  }
  function O() {
    let t = document.createElement(`button`);
    return (
      (t.type = `button`),
      t.classList.add(`__ymd_download`, `__ymd_artist_download_all`),
      (t.title = `Скачать всё`),
      (t.innerHTML = e),
      t
    );
  }
  function k(e, n) {
    e.dataset.ymdArtistId = n;
    let r = e.innerHTML,
      i = !1,
      o = !1,
      s = !1,
      c = 0,
      l = 0,
      u = (t, n, r) => {
        ((c = t), (l = n));
        let i = e.querySelector(`.ymd-progress`),
          a = e.querySelector(`.ymd-count`);
        (i && i.setAttribute(`stroke-dasharray`, `${r}, 100`),
          a && !s && (a.textContent = `${t}/${n}`));
      },
      d = () => {
        ((e.innerHTML = r),
          e.classList.remove(`_downloading`),
          (e.style.backgroundColor = ``),
          (e.style.color = ``),
          (i = !1),
          (o = !1));
      };
    (e.addEventListener(`mouseenter`, () => {
      if (((s = !0), i && !o)) {
        ((e.style.backgroundColor = `#ff4444`),
          (e.style.color = `#ffffff`),
          (e.title = `Нажмите, чтобы остановить загрузку`));
        let t = e.querySelector(`.ymd-count`);
        t && (t.textContent = `Прервать?`);
      }
    }),
      e.addEventListener(`mouseleave`, () => {
        if (((s = !1), i)) {
          ((e.style.backgroundColor = ``), (e.style.color = ``));
          let t = e.querySelector(`.ymd-count`);
          (t && !o && (t.textContent = `${c}/${l}`),
            o &&
              (t && (t.textContent = `Остановка...`),
              (e.title = `Загрузка останавливается...`)));
        }
      }),
      e.addEventListener(`click`, (r) => {
        (r.stopPropagation(), r.preventDefault());
        let s = e.dataset.ymdArtistId || n;
        if (!s) {
          a(`error`, `no artistId for download all button`);
          return;
        }
        if (i) {
          confirm(`Вы действительно хотите остановить загрузку?`) &&
            ((o = !0),
            (e.innerHTML = `<span>Остановка...</span>`),
            (e.style.backgroundColor = ``),
            (e.style.color = ``),
            (e.title = `Загрузка останавливается...`),
            window.dispatchEvent(
              new CustomEvent(`ymd:cancel-artist-download`, {
                detail: { artistId: s },
              }),
            ));
          return;
        }
        ((i = !0),
          e.classList.add(`_downloading`),
          (e.innerHTML = t + `<span class="ymd-count">0/0</span>`),
          a(`info`, `dispatch download-artist-tracks`, s),
          window.dispatchEvent(
            new CustomEvent(`ymd:download-artist-tracks`, {
              detail: { artistId: s },
            }),
          ));
        let c = (e) => {
            let { current: t, total: n, percent: r } = e.detail;
            u(t, n, r);
          },
          l = (t) => {
            (window.removeEventListener(`ymd:artist-download-progress`, c),
              window.removeEventListener(`ymd:artist-download-done`, l));
            let { success: n, cancelled: r } = t.detail;
            r
              ? ((e.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><span>Прервано</span>`),
                (e.title = `Загрузка была остановлена пользователем`),
                setTimeout(d, 2e3))
              : n
                ? ((e.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span>Готово!</span>`),
                  setTimeout(d, 3e3))
                : d();
          };
        (window.addEventListener(`ymd:artist-download-progress`, c),
          window.addEventListener(`ymd:artist-download-done`, l));
      }));
  }
  function A() {
    let e = D();
    if (!e) return;
    let t = document.querySelector(
      `[class*="TextHeader_staticItem"]:not(._ym_artist_ready_static)`,
    );
    if (
      !t ||
      (t.classList.add(`_ym_artist_ready_static`),
      t.querySelector(`.__ymd_download`))
    )
      return;
    let n = t.querySelector(`h1`),
      r = O();
    (k(r, e),
      n && n.parentNode ? n.parentNode.insertBefore(r, n) : t.prepend(r));
  }
  function j() {
    (document
      .querySelectorAll(
        `[class*="HorizontalCardContainer_root"]:not(._ym_ready)`,
      )
      .forEach((e) => {
        (e.classList.add(`_ym_ready`), C(e));
      }),
      w(),
      T(),
      E(),
      A());
  }
  function M() {
    (p(), j());
    let e = new MutationObserver(() => j());
    document.body
      ? e.observe(document.body, { childList: !0, subtree: !0 })
      : document.addEventListener(`DOMContentLoaded`, () => {
          e.observe(document.body, { childList: !0, subtree: !0 });
        });
  }
  document.readyState === `loading`
    ? document.addEventListener(`DOMContentLoaded`, M)
    : M();
})();
