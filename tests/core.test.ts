import { describe, it, expect, vi, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import {
  allowedMedia,
  chooseSource,
  filename,
  isMusic,
  safeName,
} from "../src/shared";
import {
  downloadOptions,
  loadCollection,
  normalizeTrack,
  sniff,
  xmlDownloadUrl,
} from "../src/provider";
import { encodeWav, tagMp3 } from "../src/audio";
import { defaults } from "../src/types";
import { validSettings } from "../src/state";
afterEach(() => vi.unstubAllGlobals());
describe("download safety and file fidelity", () => {
  it("limits host access to exact Yandex Music domains", () => {
    for (const t of ["ru", "kz", "com", "by", "uz"])
      expect(isMusic(`https://music.yandex.${t}/album/1`)).toBe(true);
    for (const t of [
      "https://music.yandex.ru.evil.test",
      "http://music.yandex.ru",
      "file:///a",
      "https://evil.test/?music.yandex.kz",
    ])
      expect(isMusic(t)).toBe(false);
    expect(allowedMedia("https://evil.test/a.mp3")).toBe(false);
  });
  it("sanitizes traversal, device names and invalid filename characters", () => {
    expect(safeName("../CON?")).not.toContain("/");
    expect(safeName("CON")).toBe("_CON");
    expect(safeName("...")).toBe("Без названия");
    expect(
      filename({ id: "1", title: "A/B", artists: "X:Y" }, 0, "flac", true),
    ).toBe("01 · X Y — A B.flac");
  });
  it("never pretends an unavailable codec exists", () => {
    const list = [
      { codec: "mp3", bitrate: 320, url: "https://s.storage.yandex.net/a" },
      { codec: "mp3", bitrate: 128, url: "https://s.storage.yandex.net/b" },
    ];
    expect(chooseSource(list, "original", "best").bitrate).toBe(320);
    expect(chooseSource(list, "mp3", "128").bitrate).toBe(128);
    expect(() => chooseSource(list, "flac", "best")).toThrow("не предоставил");
    expect(() =>
      chooseSource(
        [{ codec: "mp3", bitrate: 320, url: "https://evil.test/a" }],
        "mp3",
        "best",
      ),
    ).toThrow();
  });
  it("recognizes file contents instead of renaming FLAC to MP3", () => {
    expect(sniff(new TextEncoder().encode("fLaC00000000")).ext).toBe("flac");
    expect(sniff(new TextEncoder().encode("ID3x00000000")).ext).toBe("mp3");
    expect(sniff(new TextEncoder().encode("0000ftypM4A ")).ext).toBe("m4a");
    expect(() => sniff(new TextEncoder().encode("<html>error</html>"))).toThrow(
      "не распознан",
    );
  });
  it("writes valid PCM WAV headers and signed samples", () => {
    const bytes = encodeWav([new Float32Array([-1, 0, 1])], 44100);
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(32767);
  });
  it("adds real ID3 title and artist frames without dropping audio", () => {
    const audio = new Uint8Array([255, 251, 144, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const tagged = tagMp3(
      audio,
      { id: "1", title: "Тест", artists: "Исполнитель", album: "Альбом" },
      0,
    );
    expect(new TextDecoder().decode(tagged.slice(0, 3))).toBe("ID3");
    expect(Array.from(tagged.slice(-audio.length))).toEqual(Array.from(audio));
    expect(new TextDecoder().decode(tagged)).toContain("TIT2");
  });
  it("rejects encrypted/preview entries from API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: [
                {
                  codec: "mp3",
                  preview: true,
                  downloadInfoUrl: "https://s.storage.yandex.net/preview",
                },
                {
                  codec: "mp3",
                  encrypted: true,
                  downloadInfoUrl: "https://s.storage.yandex.net/encrypted",
                },
                { codec: "mp3", downloadInfoUrl: "https://evil.test/file" },
                {
                  codec: "mp3",
                  bitrateInKbps: 192,
                  direct: true,
                  downloadInfoUrl: "https://s.storage.yandex.net/file",
                },
              ],
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    expect(await downloadOptions("1", "")).toHaveLength(1);
  });
  it("validates signed non-encrypted XML host and forbids DTD", () => {
    vi.stubGlobal("DOMParser", new JSDOM().window.DOMParser);
    const xml =
      "<download-info><host>s.storage.yandex.net</host><path>/a/file.mp3</path><ts>123</ts><s>salt</s></download-info>";
    expect(xmlDownloadUrl(xml)).toMatch(
      /^https:\/\/s.storage.yandex.net\/get-mp3\/[a-f0-9]{32}\/123\/a/,
    );
    expect(() =>
      xmlDownloadUrl(xml.replace("s.storage.yandex.net", "evil.test")),
    ).toThrow();
    expect(() => xmlDownloadUrl("<!DOCTYPE a>" + xml)).toThrow();
  });
  it("clamps concurrency and preserves real selectable formats", () => {
    expect(validSettings({ ...defaults, concurrency: 99 }).concurrency).toBe(
      16,
    );
    expect(validSettings({ ...defaults, concurrency: 0 }).concurrency).toBe(12);
    expect(() =>
      validSettings({ ...defaults, format: "fake" as any }),
    ).toThrow();
  });
});
describe("collection adapters", () => {
  it("normalizes unavailable tracks without fake artwork", () => {
    const t = normalizeTrack({
      id: 123,
      title: "Music",
      artists: [{ name: "Artist" }],
      available: false,
      coverUri: "evil.test/x",
    });
    expect(t).toMatchObject({
      id: "123",
      available: false,
      artists: "Artist",
      cover: undefined,
    });
  });
  it("loads albums and UUID playlists with all supplied tracks", async () => {
    const f = vi.fn(
      async (url: any) =>
        new Response(
          JSON.stringify({
            result: {
              title: "Album",
              volumes: [[{ id: 1, title: "One", artists: [{ name: "A" }] }]],
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", f);
    const c = await loadCollection(
      {
        url: "https://music.yandex.kz/album/123",
        title: "",
        tracks: [],
        kind: "album",
      },
      "",
    );
    expect(c.tracks[0].title).toBe("One");
    expect(String(f.mock.calls[0][0])).toContain("/albums/123/with-tracks");
  });
});
