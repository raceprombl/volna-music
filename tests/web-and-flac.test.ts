import { it, expect, afterEach, vi } from "vitest";
import { webSource } from "../src/web-provider";
import { demuxFlacMp4 } from "../src/mp4-flac";
import { tagFlac } from "../src/audio";
import { safeName, coverUrl } from "../src/shared";
afterEach(() => vi.unstubAllGlobals());
it("prefers AAC for original format and retains the complete mirror array", async () => {
  const http = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          result: {
            downloadInfo: {
              urls: [
                "https://a.storage.yandex.net/file",
                "https://b.storage.yandex.net/file",
              ],
              codec: "aac-mp4",
              bitrate: 256000,
              transport: "raw",
            },
          },
        }),
      ),
  );
  vi.stubGlobal("fetch", http);
  const source = await webSource(
    "123",
    "original",
    "best",
    new AbortController().signal,
  );
  expect(source.urls).toHaveLength(2);
  expect(source.codec).toBe("aac-mp4");
  expect(source.bitrate).toBe(256);
  const call = http.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URL(call[0]).searchParams.get("codecs")).toBe(
    "aac-mp4,he-aac-mp4,mp3",
  );
  expect(call[1].referrer).toBe("");
});
it("resolves a raw MP3 through web API without sending OAuth or cookies", async () => {
  const mock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          downloadInfo: {
            url: "https://sample.strm.yandex.net/file.mp3",
            codec: "mp3",
            transport: "raw",
          },
        }),
      ),
  );
  vi.stubGlobal("fetch", mock);
  const source = await webSource(
    "123",
    "mp3",
    "best",
    new AbortController().signal,
  );
  expect(source.codec).toBe("mp3");
  const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("get-file-info?");
  expect(url).toContain("transports=raw");
  expect(init.credentials).toBe("omit");
  expect(JSON.stringify(init.headers)).not.toContain("Authorization");
});
it("never accepts encrypted transport or third-party file URLs", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            downloadInfo: {
              url: "https://sample.strm.yandex.net/file",
              codec: "mp3",
              transport: "encraw",
              key: "secret",
            },
          }),
        ),
    ),
  );
  await expect(
    webSource("123", "mp3", "best", new AbortController().signal),
  ).rejects.toThrow("незашифрованный");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            downloadInfo: {
              url: "https://evil.test/file",
              codec: "mp3",
              transport: "raw",
            },
          }),
        ),
    ),
  );
  await expect(
    webSource("123", "mp3", "best", new AbortController().signal),
  ).rejects.toThrow("адрес");
});
function join(...parts: Uint8Array[]) {
  const b = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) {
    b.set(part, p);
    p += part.length;
  }
  return b;
}
function ints(...numbers: number[]) {
  const b = new Uint8Array(numbers.length * 4),
    v = new DataView(b.buffer);
  numbers.forEach((n, i) => v.setUint32(i * 4, n));
  return b;
}
function box(type: string, data: Uint8Array) {
  return join(ints(8 + data.length), new TextEncoder().encode(type), data);
}
it("remuxes an unencrypted FLAC MP4 using sample tables without altering frames", () => {
  const frames = new Uint8Array([255, 248, 16, 1, 2, 3, 4, 5]);
  const metadata = join(new Uint8Array([128, 0, 0, 34]), new Uint8Array(34));
  const stsd = box(
    "stsd",
    join(
      ints(0, 1),
      box(
        "fLaC",
        join(new Uint8Array(28), box("dfLa", join(ints(0), metadata))),
      ),
    ),
  );
  const moov = (offset: number) =>
    box(
      "moov",
      box(
        "trak",
        box(
          "mdia",
          box(
            "minf",
            box(
              "stbl",
              join(
                stsd,
                box("stsz", ints(0, frames.length, 1)),
                box("stsc", ints(0, 1, 1, 1, 1)),
                box("stco", ints(0, 1, offset)),
              ),
            ),
          ),
        ),
      ),
    );
  const ftyp = box("ftyp", new TextEncoder().encode("isom0000"));
  const offset = ftyp.length + moov(0).length + 8;
  const file = join(ftyp, moov(offset), box("mdat", frames));
  const flac = demuxFlacMp4(file);
  expect(new TextDecoder().decode(flac.slice(0, 4))).toBe("fLaC");
  expect(flac.slice(-frames.length)).toEqual(frames);
  const tagged = tagFlac(
    flac,
    { id: "123", title: "Тест", artists: "Автор", genre: "Rock" },
    0,
    "Тестовая строка",
  );
  expect(tagged.slice(-frames.length)).toEqual(frames);
  expect(new TextDecoder().decode(tagged)).toContain(
    "UNSYNCEDLYRICS=Тестовая строка",
  );
  const corrupt = file.slice(0, -1);
  expect(() => demuxFlacMp4(corrupt)).toThrow();
});
it("supports requested artwork sizes and safe Unicode filenames", () => {
  expect(coverUrl("avatars.yandex.net/a/400x400", 1000)).toBe(
    "https://avatars.yandex.net/a/1000x1000",
  );
  expect(safeName("A/B: C?", undefined, true)).toBe("A／B： C？");
});
