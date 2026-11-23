import { afterEach, describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import {
  compactDirectory,
  saveSortedTrack,
  findExistingTrack,
  type LibraryDirectory,
} from "../src/library";
class Directory {
  name = "Треки";
  kind = "directory";
  data = new Map<string, Uint8Array>();
  failWrite = "";
  failRemove = "";
  constructor(input: Record<string, string>) {
    for (const [n, s] of Object.entries(input))
      this.data.set(n, new TextEncoder().encode(s));
  }
  async *values() {
    for (const n of [...this.data.keys()]) yield await this.getFileHandle(n);
  }
  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<any> {
    if (!this.data.has(name)) {
      if (!options?.create) throw new DOMException("Missing", "NotFoundError");
      this.data.set(name, new Uint8Array());
    }
    return {
      name,
      kind: "file",
      getFile: async () =>
        new File([new Uint8Array(this.data.get(name)!)], name, {
          lastModified: 100,
        }),
      createWritable: async () => {
        let pending: Uint8Array | undefined;
        return {
          write: async (b: Blob) => {
            pending = new Uint8Array(await b.arrayBuffer());
          },
          close: async () => {
            if (this.failWrite === name) {
              this.failWrite = "";
              throw new Error("Disk write interrupted");
            }
            this.data.set(name, pending!);
          },
          abort: async () => {},
        };
      },
    };
  }
  async removeEntry(name: string) {
    if (this.failRemove === name) {
      this.failRemove = "";
      throw new Error("Delete interrupted");
    }
    this.data.delete(name);
  }
  text(name: string) {
    return new TextDecoder().decode(this.data.get(name));
  }
  handle() {
    return this as unknown as LibraryDirectory;
  }
}
afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase("volna-library");
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    }),
);
describe("folder-based track order", () => {
  it("detects existing songs before download, permits download after deletion and another format", async () => {
    const d = new Directory({ "07 · Artist — Song.mp3": "existing audio" }),
      track = { id: "42", title: "Song", artists: "Artist" };
    expect(await findExistingTrack(track, "mp3", d.handle())).toEqual({
      name: "07 · Artist — Song.mp3",
    });
    expect(
      await findExistingTrack(track, "original", d.handle()),
    ).not.toBeNull();
    expect(await findExistingTrack(track, "flac", d.handle())).toBeNull();
    d.data.delete("07 · Artist — Song.mp3");
    expect(await findExistingTrack(track, "mp3", d.handle())).toBeNull();
  });
  it("does not create a second copy for a repeated single-song save", async () => {
    const d = new Directory({ "07 · Artist — Song.mp3": "existing audio" });
    const result = await saveSortedTrack(
      new Blob(["another transfer"]),
      "88 · Artist — Song.mp3",
      undefined,
      d.handle(),
      "new-job/0",
    );
    expect(result).toMatchObject({
      duplicate: true,
      name: "01 · Artist — Song.mp3",
    });
    expect([...d.data.keys()]).toEqual(["01 · Artist — Song.mp3"]);
    expect(d.text("01 · Artist — Song.mp3")).toBe("existing audio");
  });
  it("recognizes recorded track identity when the original title differs", async () => {
    const d = new Directory({});
    await saveSortedTrack(
      new Blob(["complete"]),
      "Artist — Other title.mp3",
      undefined,
      d.handle(),
      "job/0",
      { id: "42" },
    );
    expect(
      await findExistingTrack(
        { id: "42", title: "Song", artists: "Artist" },
        "mp3",
        d.handle(),
      ),
    ).toEqual({ name: "01 · Artist — Other title.mp3" });
  });
  it("does not mistake a legacy short preview for a full existing song", async () => {
    const d = new Directory({});
    const bytes = new Uint8Array(417 * 575);
    for (let i = 0; i < 575; i++) bytes.set([255, 251, 144, 0], i * 417);
    d.data.set("01 · Artist — Song.mp3", bytes);
    expect(
      await findExistingTrack(
        { id: "42", title: "Song", artists: "Artist", duration: 180000 },
        "mp3",
        d.handle(),
      ),
    ).toBeNull();
  });
  it("does not append the same queued song twice on retry or recovery", async () => {
    const d = new Directory({ "07 · Old.mp3": "old" });
    const blob = new Blob(["new"]);
    const one = await saveSortedTrack(
      blob,
      "88 · New.mp3",
      undefined,
      d.handle(),
      "job/0",
    );
    const two = await saveSortedTrack(
      blob,
      "88 · New.mp3",
      undefined,
      d.handle(),
      "job/0",
    );
    expect(two?.name).toBe(one?.name);
    expect(d.data.size).toBe(2);
    d.data.delete("01 · Old.mp3");
    const three = await saveSortedTrack(
      blob,
      "88 · New.mp3",
      undefined,
      d.handle(),
      "job/0",
    );
    expect(three?.name).toBe("01 · New.mp3");
    expect(d.data.size).toBe(1);
  });
  it("saves the new song as 02 after a lone 07 and recalculates after external deletion", async () => {
    const d = new Directory({ "07 · Old.mp3": "old" });
    const saved = await saveSortedTrack(
      new Blob(["new"]),
      "88 · New.mp3",
      { blob: new Blob(["lyrics"]), ext: ".lrc" },
      d.handle(),
    );
    expect(saved?.name).toBe("02 · New.mp3");
    expect(d.text("01 · Old.mp3")).toBe("old");
    expect(d.text("02 · New.mp3")).toBe("new");
    expect(d.text("02 · New.lrc")).toBe("lyrics");
    d.data.delete("01 · Old.mp3");
    const next = await saveSortedTrack(
      new Blob(["third"]),
      "99 · Third.mp3",
      undefined,
      d.handle(),
    );
    expect(next?.name).toBe("02 · Third.mp3");
    expect(d.text("01 · New.mp3")).toBe("new");
    expect(d.text("01 · New.lrc")).toBe("lyrics");
    expect(d.text("02 · Third.mp3")).toBe("third");
  });
  it("renumbers one existing 07 song to 01, making the next slot 02", async () => {
    const d = new Directory({ "07 · Song.mp3": "audio" });
    const r = await compactDirectory(d.handle());
    expect(r.count + 1).toBe(2);
    expect([...d.data.keys()]).toEqual(["01 · Song.mp3"]);
    expect(d.text("01 · Song.mp3")).toBe("audio");
  });
  it("keeps seven consecutive songs and selects 08", async () => {
    const input = Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [
        `${String(i + 1).padStart(2, "0")} · Song${i}.mp3`,
        String(i),
      ]),
    );
    const d = new Directory(input),
      r = await compactDirectory(d.handle());
    expect(r.count + 1).toBe(8);
    expect(r.renamed).toEqual([]);
  });
  it("closes gaps and renames lyrics while leaving unrelated files untouched", async () => {
    const d = new Directory({
      "03 · First.mp3": "first",
      "09 · Last.flac": "last",
      "09 · Last.lrc": "lyrics",
      "cover.jpg": "cover",
      "notes.txt": "notes",
    });
    await compactDirectory(d.handle());
    expect(d.text("01 · First.mp3")).toBe("first");
    expect(d.text("02 · Last.flac")).toBe("last");
    expect(d.text("02 · Last.lrc")).toBe("lyrics");
    expect(d.text("cover.jpg")).toBe("cover");
    expect(d.text("notes.txt")).toBe("notes");
  });
  it("handles overlapping names without overwriting audio", async () => {
    const d = new Directory({
      "01 · A.mp3": "one",
      "01 · B.mp3": "b",
      "02 · A.mp3": "two",
      "03 · A.mp3": "three",
    });
    await compactDirectory(d.handle());
    expect(d.text("01 · A.mp3")).toBe("one");
    expect(d.text("02 · B.mp3")).toBe("b");
    expect(d.text("03 · A.mp3")).toBe("two");
    expect(d.text("04 · A.mp3")).toBe("three");
  });
  it("recovers an interrupted final write from verified backup", async () => {
    const d = new Directory({ "07 · Song.mp3": "audio" });
    d.failWrite = "01 · Song.mp3";
    await expect(compactDirectory(d.handle())).rejects.toThrow("interrupted");
    expect(
      [...d.data.values()].some((b) => new TextDecoder().decode(b) === "audio"),
    ).toBe(true);
    await compactDirectory(d.handle());
    expect([...d.data.keys()]).toEqual(["01 · Song.mp3"]);
    expect(d.text("01 · Song.mp3")).toBe("audio");
  });
  it("resumes after partial removal and preserves all original audio", async () => {
    const d = new Directory({ "07 · A.mp3": "a", "09 · B.mp3": "b" });
    d.failRemove = "09 · B.mp3";
    await expect(compactDirectory(d.handle())).rejects.toThrow("interrupted");
    await compactDirectory(d.handle());
    expect(d.text("01 · A.mp3")).toBe("a");
    expect(d.text("02 · B.mp3")).toBe("b");
    expect([...d.data.keys()].some((n) => n.startsWith(".volna-"))).toBe(false);
  });
  it("restores original names if a remaining source was externally edited", async () => {
    const d = new Directory({ "07 · A.mp3": "a", "09 · B.mp3": "b" });
    d.failRemove = "09 · B.mp3";
    await expect(compactDirectory(d.handle())).rejects.toThrow();
    d.data.set("09 · B.mp3", new TextEncoder().encode("external edit"));
    await expect(compactDirectory(d.handle())).rejects.toThrow(
      "Исходные имена восстановлены",
    );
    expect(d.text("07 · A.mp3")).toBe("a");
    expect(d.text("09 · B.mp3")).toBe("external edit");
  });
});
