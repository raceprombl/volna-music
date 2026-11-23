import { afterEach, it, expect } from "vitest";
import "fake-indexeddb/auto";
import {
  fileStore,
  pruneFiles,
  stagingBytes,
  clearFiles,
  clearJobFiles,
} from "../src/blob-store";
afterEach(() => clearFiles());
it("removes terminal and orphaned media while preserving active transfers", async () => {
  await fileStore("put", "active/0", new Blob(["audio"]));
  await fileStore("put", "active/0/lyrics", new Blob(["lyrics"]));
  await fileStore("put", "done/0", new Blob(["finished"]));
  await fileStore("put", "orphan/9", new Blob(["unused"]));
  expect(await pruneFiles(["active"])).toEqual({ removed: 2, bytes: 14 });
  expect(await stagingBytes()).toBe(11);
  expect(await fileStore<Blob>("get", "active/0")).toBeDefined();
  expect(await fileStore("get", "orphan/9")).toBeUndefined();
});
it("clears every staged item and sidecar of one job without matching another id prefix", async () => {
  await fileStore("put", "job/0", new Blob(["audio"]));
  await fileStore("put", "job/0/lyrics", new Blob(["text"]));
  await fileStore("put", "job/999", new Blob(["stale"]));
  await fileStore("put", "job-extra/0", new Blob(["keep"]));
  await clearJobFiles("job");
  expect(await stagingBytes()).toBe(4);
  await pruneFiles([]);
  expect(await stagingBytes()).toBe(0);
});
