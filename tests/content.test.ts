// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { readCollection } from "../src/page-adapter";
afterEach(() => {
  (window as any).__volnaCleanup?.();
  delete (window as any).__volnaCleanup;
  vi.resetModules();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
function fixture() {
  document.body.innerHTML =
    '<main><h1>Любимые песни</h1><div class="HorizontalCardContainer_root__abc"><a href="/album/2/track/123">Трек один</a><a href="/artist/7">Артист</a></div><div class="HorizontalCardContainer_root__abc"><a href="/track/456">Трек два</a><a href="/artist/8">Другой артист</a></div></main>';
}
describe("SPA integration", () => {
  it.each(["complete", "partial"])(
    "does not restart polling after an immediately %s download and explains skipped tracks",
    async (status) => {
      fixture();
      const originalShow = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
      };
      const items = [
        {
          track: { id: "1", title: "Song", artists: "A" },
          status: "complete",
          bytes: 100,
          total: 100,
        },
        {
          track: { id: "2", title: "Other", artists: "A" },
          status: status === "partial" ? "skipped" : "complete",
          bytes: 100,
          total: 100,
          error:
            status === "partial" ? "Ошибка соединения с интернетом" : undefined,
        },
      ];
      vi.stubGlobal("chrome", {
        runtime: {
          id: "test",
          onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
          sendMessage: async (m: any) => {
            if (m.type === "GET_ACTIVE_JOB") return { ok: true, data: null };
            if (m.type === "EXPAND")
              return {
                ok: true,
                data: {
                  title: "Playlist",
                  kind: "playlist",
                  url: location.href,
                  tracks: items.map((i) => i.track),
                },
              };
            if (m.type === "ENQUEUE") return { ok: true, data: "job" };
            if (m.type === "GET_JOB")
              return { ok: true, data: { id: "job", status, items } };
            return { ok: true };
          },
        },
      });
      let polling: ReturnType<typeof vi.spyOn> | undefined;
      try {
        await import("../src/content");
        await new Promise((r) => setTimeout(r, 45));
        polling = vi.spyOn(globalThis, "setInterval");
        const toolbar = [
          ...document.querySelectorAll<HTMLElement>("[data-volna]"),
        ].find((h) => h.shadowRoot?.querySelector(".toolbar"))!;
        toolbar
          .shadowRoot!.querySelector<HTMLButtonElement>(".primary")!
          .click();
        await new Promise((r) => setTimeout(r, 20));
        const dialog = [
          ...document.querySelectorAll<HTMLElement>("[data-volna]"),
        ]
          .find((h) => h.shadowRoot?.querySelector("dialog"))!
          .shadowRoot!.querySelector("dialog")!;
        dialog.querySelector<HTMLButtonElement>(".actions .primary")!.click();
        await new Promise((r) => setTimeout(r, 20));
        expect(
          polling.mock.calls.filter((call: unknown[]) => call[1] === 1000),
        ).toHaveLength(0);
        expect(dialog.textContent).toContain(
          status === "partial" ? "Готово с ошибками" : "Готово",
        );
        if (status === "partial")
          expect(dialog.querySelector(".error")?.textContent).toContain(
            "Other: Ошибка соединения",
          );
      } finally {
        polling?.mockRestore();
        HTMLDialogElement.prototype.showModal = originalShow;
      }
    },
  );
  it("offers five transfer streams in the playlist dialog without the 10 GB caption", async () => {
    fixture();
    const originalShow = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    const enqueue: any[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test",
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: async (m: any) => {
          if (m.type === "GET_ACTIVE_JOB") return { ok: true, data: null };
          if (m.type === "GET_DOWNLOAD_SETTINGS")
            return {
              ok: true,
              data: { format: "mp3", quality: "best", concurrency: 3 },
            };
          if (m.type === "EXPAND")
            return {
              ok: true,
              data: {
                title: "Playlist",
                kind: "playlist",
                url: location.href,
                tracks: [{ id: "123", title: "Song", artists: "A" }],
              },
            };
          if (m.type === "ENQUEUE") {
            enqueue.push(m);
            return { ok: true, data: "job" };
          }
          return { ok: true };
        },
      },
    });
    try {
      await import("../src/content");
      await new Promise((r) => setTimeout(r, 45));
      const toolbar = [
        ...document.querySelectorAll<HTMLElement>("[data-volna]"),
      ].find((host) => host.shadowRoot?.querySelector(".toolbar"))!;
      toolbar.shadowRoot!.querySelector<HTMLButtonElement>(".primary")!.click();
      await new Promise((r) => setTimeout(r, 20));
      const modal = [...document.querySelectorAll<HTMLElement>("[data-volna]")]
        .find((host) => host.shadowRoot?.querySelector("dialog"))!
        .shadowRoot!.querySelector("dialog")!;
      expect(modal.textContent).not.toContain("10 ГБ");
      const streams = modal.querySelector<HTMLSelectElement>(
        '[aria-label="Потоки загрузки"]',
      )!;
      expect(streams.options.length).toBe(16);
      expect(streams.value).toBe("3");
      streams.value = "5";
      modal.querySelector<HTMLButtonElement>(".actions .primary")!.click();
      await new Promise((r) => setTimeout(r, 20));
      expect(enqueue[0].settings.concurrency).toBe(5);
    } finally {
      HTMLDialogElement.prototype.showModal = originalShow;
    }
  });
  it("does not resurrect an old player button when a pending scan finishes after reinjection", async () => {
    fixture();
    const pendingRow = document.querySelector<HTMLElement>(
      '[class*="HorizontalCardContainer"]',
    )!;
    pendingRow.dataset.volnaTrackId = "123";
    const player = document.createElement("section");
    player.className = "PlayerBar_root__test";
    player.innerHTML =
      '<div class="PlayerBarDesktopWithBackgroundProgressBar_meta__test"><div class="ChangeVolume_root__test"></div></div>';
    document.body.append(player);
    let finishOld: ((value: any) => void) | undefined;
    let first = true;
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test",
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: (m: any) => {
          if (m.type === "RENDER_METADATA" && first) {
            first = false;
            return new Promise((resolve) => (finishOld = resolve));
          }
          return Promise.resolve({
            ok: true,
            data: m.type === "GET_ACTIVE_JOB" ? null : undefined,
          });
        },
      },
    });
    vi.resetModules();
    await import("../src/content");
    await new Promise((r) => setTimeout(r, 45));
    expect(finishOld).toBeDefined();
    vi.resetModules();
    await import("../src/content");
    await new Promise((r) => setTimeout(r, 45));
    expect(document.querySelectorAll("[data-volna-player]")).toHaveLength(1);
    finishOld!({ ok: true });
    await new Promise((r) => setTimeout(r, 45));
    expect(document.querySelectorAll("[data-volna-player]")).toHaveLength(1);
    const stray = document.createElement("span");
    stray.dataset.volnaPlayer = "";
    stray.dataset.volna = "";
    player.append(stray);
    document.querySelector<HTMLAnchorElement>("a")!.href = "/track/789";
    await new Promise((r) => setTimeout(r, 45));
    expect(document.querySelectorAll("[data-volna-player]")).toHaveLength(1);
  });
  it("recognizes modern lk favorites addresses", () => {
    fixture();
    expect(
      readCollection(
        document,
        "https://music.yandex.kz/playlists/lk.39d577b5-69c0-4e4e-b697-8f28ea4ce22f",
      ).kind,
    ).toBe("likes");
  });
  it("finds track ids and titles on ru and kz", () => {
    fixture();
    for (const d of ["ru", "kz"]) {
      const c = readCollection(
        document,
        `https://music.yandex.${d}/playlists/12345678-aaaa-bbbb-cccc-123456789abc`,
      );
      expect(c.tracks.map((t) => t.id)).toEqual(["123", "456"]);
      expect(c.kind).toBe("playlist");
    }
  });
  it("does not duplicate buttons after re-injection and handles virtual rows", async () => {
    fixture();
    const listeners = new Set();
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test",
        onMessage: {
          addListener: (fn: any) => listeners.add(fn),
          removeListener: (fn: any) => listeners.delete(fn),
        },
        sendMessage: vi.fn(),
      },
    });
    await import("../src/content");
    await new Promise((r) => setTimeout(r, 45));
    expect(document.querySelectorAll("[data-volna-track]").length).toBe(2);
    expect(listeners.size).toBe(1);
    vi.resetModules();
    await import("../src/content");
    await new Promise((r) => setTimeout(r, 45));
    expect(document.querySelectorAll("[data-volna-track]").length).toBe(2);
    expect(listeners.size).toBe(1);
    const link = document.querySelector<HTMLAnchorElement>("a")!;
    link.href = "/track/789";
    await new Promise((r) => setTimeout(r, 45));
    expect(
      document
        .querySelector("[data-volna-track]")
        ?.getAttribute("data-volna-track"),
    ).toBe("789");
    const row = document.createElement("div");
    row.className = "HorizontalCardContainer_root__new";
    row.innerHTML = '<a href="/track/999">Новый</a>';
    document.querySelector("main")!.append(row);
    await new Promise((r) => setTimeout(r, 45));
    expect(document.querySelectorAll("[data-volna-track]").length).toBe(3);
    (window as any).__volnaCleanup();
    expect(document.querySelectorAll("[data-volna-track]").length).toBe(0);
    expect(listeners.size).toBe(0);
  });
  it("locks page controls on storage updates and unlocks on terminal states", async () => {
    fixture();
    const player = document.createElement("section");
    player.className = "PlayerBar_root__test";
    player.innerHTML =
      '<a href="/track/456">Другая песня</a><div class="PlayerBarDesktopWithBackgroundProgressBar_meta__test"><div class="ChangeVolume_root__test"></div></div>';
    document.body.append(player);
    let storageListener: any;
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test",
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: async (m: any) => ({
          ok: true,
          data: m.type === "GET_ACTIVE_JOB" ? null : undefined,
        }),
      },
      storage: {
        onChanged: {
          addListener: (f: any) => (storageListener = f),
          removeListener: vi.fn(),
        },
      },
    });
    vi.resetModules();
    await import("../src/content");
    await new Promise((r) => setTimeout(r, 45));
    const buttons = () =>
      [...document.querySelectorAll("[data-volna-track]")].map((e) =>
        e.shadowRoot!.querySelector("button")!,
      );
    expect(buttons().every((b) => !b.disabled)).toBe(true);
    const job = {
      status: "running",
      items: [
        { track: { id: "123" }, status: "fetching", bytes: 25, total: 100 },
      ],
    };
    storageListener({ jobs: { newValue: [job] } }, "local");
    expect(buttons().every((b) => b.disabled)).toBe(true);
    expect(
      buttons()[0]
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("25");
    expect(buttons()[1].querySelector('[role="progressbar"]')).toBeNull();
    expect(buttons()[1].getAttribute("aria-busy")).toBe("false");
    const playerButton = player
      .querySelector("[data-volna-player]")!
      .shadowRoot!.querySelector("button")!;
    expect(playerButton.disabled).toBe(true);
    expect(playerButton.querySelector('[role="progressbar"]')).toBeNull();
    const current = player.querySelector<HTMLAnchorElement>("a")!;
    current.href = "/track/123";
    await new Promise((r) => setTimeout(r, 45));
    expect(playerButton.querySelector('[role="progressbar"]')).not.toBeNull();
    current.href = "/track/456";
    await new Promise((r) => setTimeout(r, 45));
    expect(playerButton.querySelector('[role="progressbar"]')).toBeNull();
    for (const status of ["queued", "packing"]) {
      job.status = status;
      storageListener({ jobs: { newValue: [job] } }, "local");
      expect(buttons().every((b) => b.disabled)).toBe(true);
    }
    for (const status of ["complete", "cancelled", "failed", "partial"]) {
      job.status = status;
      storageListener({ jobs: { newValue: [job] } }, "local");
      expect(buttons().every((b) => !b.disabled)).toBe(true);
      expect(buttons()[0].querySelector('[role="progressbar"]')).toBeNull();
    }
  });
  it("downloads a single song immediately from a row or player without opening a modal", async () => {
    for (const target of ["row", "player"]) {
      (window as any).__volnaCleanup?.();
      fixture();
      const player = document.createElement("section");
      player.className = "PlayerBar_root__test";
      player.innerHTML =
        '<a href="/track/7">Текущий трек</a><div class="PlayerBarDesktopWithBackgroundProgressBar_meta__test"><div class="ChangeVolume_root__test"></div></div>';
      document.body.append(player);
      let active: any = null;
      const enqueue: any[] = [];
      vi.stubGlobal("chrome", {
        runtime: {
          id: "test",
          onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
          sendMessage: async (m: any) => {
            if (m.type === "ENQUEUE") {
              enqueue.push(m);
              active = {
                status: "queued",
                items: [{ status: "queued", bytes: 0, total: 0 }],
              };
              return { ok: true, data: "job" };
            }
            return {
              ok: true,
              data: m.type === "GET_ACTIVE_JOB" ? active : undefined,
            };
          },
        },
      });
      vi.resetModules();
      await import("../src/content");
      await new Promise((r) => setTimeout(r, 45));
      const host = document.querySelector(
        target === "player" ? "[data-volna-player]" : "[data-volna-track]",
      )!;
      const button = host.shadowRoot!.querySelector("button")!;
      button.click();
      button.click();
      await new Promise((r) => setTimeout(r, 45));
      expect(enqueue).toHaveLength(1);
      expect(enqueue[0].tracks[0].id).toBe(target === "player" ? "7" : "123");
      expect(enqueue[0].settings).toEqual({ zip: false });
      expect(
        document
          .querySelector("#volna-overlay")
          ?.shadowRoot?.querySelector("dialog"),
      ).toBeNull();
      expect(button.disabled).toBe(true);
    }
  });
  it("places the 44px player download button inside the action group, outside volume", async () => {
    fixture();
    const player = document.createElement("section");
    player.className = "PlayerBar_root__test";
    player.innerHTML =
      '<div class="PlayerBarDesktopWithBackgroundProgressBar_playerBar__test"><div class="PlayerBarDesktopWithBackgroundProgressBar_meta__test"><button aria-label="Queue">Queue</button><div class="ChangeVolume_root__test"><button aria-label="Volume">Volume</button></div></div></div>';
    document.body.append(player);
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test",
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: async (m: any) => ({
          ok: true,
          data: m.type === "GET_ACTIVE_JOB" ? null : undefined,
        }),
      },
    });
    vi.resetModules();
    await import("../src/content");
    await new Promise((r) => setTimeout(r, 45));
    const host = player.querySelector<HTMLElement>("[data-volna-player]")!;
    expect(host.parentElement?.className).toContain("_meta__");
    expect(host.parentElement?.firstElementChild).toBe(host);
    expect(
      player.querySelector('[class*="ChangeVolume_root"]')?.contains(host),
    ).toBe(false);
    expect(host.style.flex).toBe("0 0 44px");
    expect(host.shadowRoot?.querySelector("button")?.style.background).toBe(
      "rgb(255, 220, 94)",
    );
    expect(
      host.shadowRoot?.querySelector("button")?.getAttribute("aria-label"),
    ).toBe("Скачать текущий трек");
  });
});
