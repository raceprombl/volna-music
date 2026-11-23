import { describe, it, expect, vi } from "vitest";
import { unzipSync } from "fflate";
import { writeFile } from "node:fs/promises";
import { StreamZip, MAX_ARCHIVE_BYTES, type ZipSink } from "../src/stream-zip";
import { createArchive, pruneArchives } from "../src/archive-store";
import { memoryOpfs } from "./opfs-fixture";

const signal = () => new AbortController().signal;
function capture() {
  const chunks: Uint8Array[] = [];
  const sink: ZipSink = {
    write: async (bytes) => {
      chunks.push(bytes.slice());
    },
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
  return {
    sink,
    bytes: async () =>
      new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer()),
  };
}
describe("disk-streamed ZIP64", () => {
  it("round-trips Unicode, duplicate names, artwork and metadata through an independent ZIP reader", async () => {
    const output = capture(),
      zip = new StreamZip(output.sink);
    await zip.add(
      "01 · Исполнитель — Песня.mp3",
      new Blob(["audio fixture"]),
      signal(),
    );
    expect(
      await zip.add(
        "01 · Исполнитель — Песня.mp3",
        new Blob(["different"]),
        signal(),
      ),
    ).toContain(" (2).mp3");
    await zip.add("metadata.json", new Blob(['{"tracks":2}']), signal());
    await zip.close(signal());
    const bytes = await output.bytes(),
      entries = unzipSync(bytes);
    expect(
      new TextDecoder().decode(entries["01 · Исполнитель — Песня.mp3"]),
    ).toBe("audio fixture");
    expect(
      new TextDecoder().decode(entries["01 · Исполнитель — Песня (2).mp3"]),
    ).toBe("different");
    expect(output.sink.close).toHaveBeenCalledOnce();
    // Also used by Python's independent zipfile reader in validation.
    await writeFile("artifacts/zip64-fixture.zip", bytes);
  });
  it("includes central records and footer in the size limit and accepts the exact boundary", async () => {
    const output = capture(),
      zip = new StreamZip(output.sink);
    await zip.add("x", new Blob(["123"]), signal());
    await zip.close(signal());
    const exact = (await output.bytes()).length;
    const ok = capture(),
      bounded = new StreamZip(ok.sink, new Date(), exact);
    await bounded.add("x", new Blob(["123"]), signal());
    await expect(bounded.close(signal())).resolves.toBeUndefined();
    const tooSmall = capture(),
      rejected = new StreamZip(tooSmall.sink, new Date(), exact - 1);
    await expect(
      rejected.add("x", new Blob(["123"]), signal()),
    ).rejects.toThrow("10 ГБ");
    expect((await tooSmall.bytes()).length).toBe(0);
  });
  it("aborts on cancellation with backpressure and never commits", async () => {
    const controller = new AbortController();
    let writes = 0,
      inflight = 0,
      peak = 0;
    const sink: ZipSink = {
      write: async (bytes) => {
        peak = Math.max(peak, ++inflight);
        expect(bytes.length).toBeLessThanOrEqual(1024 ** 2);
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (++writes === 3)
          controller.abort(new DOMException("Cancel", "AbortError"));
        inflight--;
      },
      close: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    };
    const zip = new StreamZip(sink);
    await expect(
      zip.add(
        "large.flac",
        new Blob([new Uint8Array(4 * 1024 ** 2)]),
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(peak).toBe(1);
    expect(sink.close).not.toHaveBeenCalled();
    expect(sink.abort).toHaveBeenCalledOnce();
  });
  it("rejects traversal paths and does not swallow disk errors", async () => {
    const output = capture(),
      zip = new StreamZip(output.sink);
    await expect(zip.add("../song.mp3", new Blob(), signal())).rejects.toThrow(
      "имя",
    );
    const sink = {
      ...output.sink,
      write: async () => {
        throw Error("disk full");
      },
    };
    await expect(
      new StreamZip(sink).add("song.mp3", new Blob(["x"]), signal()),
    ).rejects.toThrow("disk full");
    expect(sink.abort).toHaveBeenCalledOnce();
  });
  it("removes abandoned private archives while preserving the active job and unrelated files", async () => {
    const opfs = memoryOpfs();
    vi.stubGlobal("navigator", {
      storage: { getDirectory: async () => opfs.directory },
    });
    try {
      opfs.files.set("active.zip", new Blob(["active"]));
      opfs.files.set("orphan.zip", new Blob(["orphan"]));
      opfs.files.set("unrelated.txt", new Blob(["keep"]));
      await pruneArchives(["active"]);
      expect([...opfs.files.keys()]).toEqual(["active.zip", "unrelated.txt"]);
      const archive = await createArchive("test-job");
      await archive.zip.add("song.mp3", new Blob(["audio"]), signal());
      await archive.zip.close(signal());
      expect((await archive.file()).size).toBeGreaterThan(5);
      await archive.cleanup();
      expect(opfs.files.has("test-job.zip")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("streams nearly 10 GiB with ZIP64 offsets beyond 4 GiB and at most 1 MiB per write", async () => {
    // Reuse a chunk to exercise the actual CRC and write loop over 10 GiB.
    // No multi-gigabyte allocation or disk artifact is created by this test.
    const chunk = new Uint8Array(1024 ** 2).fill(0x5a);
    let written = 0,
      maxWrite = 0;
    const records: Uint8Array[] = [];
    const sink: ZipSink = {
      write: async (bytes) => {
        written += bytes.length;
        maxWrite = Math.max(maxWrite, bytes.length);
        if (bytes.length < 1024) records.push(bytes.slice());
      },
      close: async () => {},
      abort: async () => {},
    };
    const source = (size: number) =>
      ({
        size,
        slice: (start: number, end: number) => ({
          arrayBuffer: async () =>
            end - start === chunk.length && end <= size
              ? chunk.buffer
              : chunk.buffer.slice(0, Math.min(end, size) - start),
        }),
      }) as Blob;
    const zip = new StreamZip(sink);
    await zip.add("first.flac", source(5 * 1024 ** 3), signal());
    await zip.add("second.flac", source(5 * 1024 ** 3 - 65536), signal());
    await expect(
      zip.add("overflow.flac", source(65536), signal()),
    ).rejects.toThrow("10 ГБ");
    await zip.close(signal());
    expect(written).toBeGreaterThan(10 * 1024 ** 3 - 65536);
    expect(written).toBeLessThanOrEqual(MAX_ARCHIVE_BYTES);
    expect(maxWrite).toBe(1024 ** 2);
    const central = records.filter(
      (bytes) => new DataView(bytes.buffer).getUint32(0, true) === 0x02014b50,
    );
    const second = new DataView(central[1].buffer),
      nameLength = second.getUint16(28, true);
    expect(second.getBigUint64(46 + nameLength + 20, true)).toBeGreaterThan(
      0xffffffffn,
    );
    const footer = new DataView(records.at(-1)!.buffer);
    expect(footer.getUint32(0, true)).toBe(0x06064b50);
    expect(footer.getBigUint64(48, true)).toBeGreaterThan(0xffffffffn);
    expect(footer.getBigUint64(24, true)).toBe(2n);
  }, 180000);
  it("streams raw Uint8Array entries larger than 1 MiB without exceeding the 1 MiB write limit", async () => {
    const payload = new Uint8Array(2 * 1024 ** 2 + 12345);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 7) & 0xff;
    let maxWrite = 0;
    const chunks: Uint8Array[] = [];
    const sink: ZipSink = {
      write: async (bytes) => {
        maxWrite = Math.max(maxWrite, bytes.length);
        chunks.push(bytes.slice());
      },
      close: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    };
    const zip = new StreamZip(sink);
    await zip.add("track.m4a", payload, signal());
    await zip.close(signal());
    expect(maxWrite).toBeLessThanOrEqual(1024 ** 2);
    const raw = new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer());
    const entries = unzipSync(raw);
    expect(entries["track.m4a"]).toEqual(payload);
  });
});
