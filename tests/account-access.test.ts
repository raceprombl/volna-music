// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { existingMusicAccessToken } from "../src/account-access";
afterEach(() => localStorage.clear());
it("reads only a valid known Music access entry without copying other site data", () => {
  localStorage.setItem("other-secret", "unrelated");
  expect(existingMusicAccessToken()).toBeNull();
  localStorage.setItem(
    "aYa_token",
    JSON.stringify({ access_token: "fixture_music_token_1234567890" }),
  );
  expect(existingMusicAccessToken()).toBe("fixture_music_token_1234567890");
  expect(localStorage.getItem("other-secret")).toBe("unrelated");
  localStorage.setItem(
    "aYa_token",
    JSON.stringify({ access_token: "bad value" }),
  );
  expect(existingMusicAccessToken()).toBeNull();
});
