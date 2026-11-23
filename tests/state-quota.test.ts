import { afterEach, it, expect, vi } from "vitest";
import { defaults, type AppState } from "../src/types";
import { mutate, newJob } from "../src/state";
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const old = newJob("Old", [{ id: "1", title: "A", artists: "B" }], defaults);
  old.created = 1;
  old.status = "complete";
  const active = newJob(
    "Active",
    [{ id: "2", title: "C", artists: "D" }],
    defaults,
  );
  active.created = 2;
  const model: AppState = {
    settings: { ...defaults },
    jobs: [active, old],
    tokenPresent: false,
    nextTrackNumber: 2,
  };
  return { model, active, old };
}
it("reclaims only completed history on quota failure without repeating the mutation", async () => {
  const { model, active } = fixture();
  const write = vi.fn(async (data: any) => {
    if (data.jobs.length > 1)
      throw new DOMException("quota", "QuotaExceededError");
    Object.assign(model, structuredClone(data));
  });
  vi.stubGlobal("chrome", {
    storage: {
      local: { get: async () => structuredClone(model), set: write },
      session: { get: async () => ({}) },
    },
  });
  const action = vi.fn((state: AppState) => {
    state.settings.quality = "128";
    return 42;
  });
  expect(await mutate(action)).toBe(42);
  expect(action).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledTimes(2);
  expect(model.jobs.map((job) => job.id)).toEqual([active.id]);
  expect(model.settings.quality).toBe("128");
  expect(model.nextTrackNumber).toBe(2);
});
it("never discards active jobs on a non-quota storage error", async () => {
  const { model } = fixture(),
    write = vi.fn(async () => {
      throw Error("Disk I/O error");
    });
  vi.stubGlobal("chrome", {
    storage: {
      local: { get: async () => structuredClone(model), set: write },
      session: { get: async () => ({}) },
    },
  });
  await expect(mutate(() => {})).rejects.toThrow("Disk I/O error");
  expect(model.jobs).toHaveLength(2);
  expect(write).toHaveBeenCalledOnce();
});
