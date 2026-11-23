import { describe, it, expect } from "vitest";
import { friendly } from "../src/shared";
describe("actionable download errors", () => {
  it.each([
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Сохранение прервано: NETWORK_DISCONNECTED",
  ])("explains a lost connection: %s", (message) =>
    expect(friendly(new Error(message))).toContain("Проверьте сеть"),
  );
  it("explains timeout, disk space, folder permission and Chrome cancellation separately", () => {
    expect(friendly(new DOMException("timeout", "TimeoutError"))).toContain(
      "Сервер долго не отвечает",
    );
    expect(friendly(new DOMException("quota", "QuotaExceededError"))).toContain(
      "Недостаточно места",
    );
    expect(friendly(new Error("Сохранение прервано: FILE_NO_SPACE"))).toContain(
      "Недостаточно места",
    );
    expect(friendly(new DOMException("denied", "NotAllowedError"))).toContain(
      "Нет доступа к папке",
    );
    expect(friendly(new Error("USER_CANCELED"))).toContain("отменено в Chrome");
  });
  it("distinguishes login, access rights, rate limits and server failure", () => {
    expect(friendly(new Error("HTTP 401"))).toContain(
      "Вход в Яндекс Музыку истёк",
    );
    expect(friendly(new Error("HTTP 403"))).toContain("права аккаунта");
    expect(friendly(new Error("HTTP 429"))).toContain("ограничил запросы");
    expect(friendly(new Error("HTTP 503"))).toContain("временно недоступен");
  });
  it("does not interpret a track ID as an HTTP error and preserves the full-track validation message", () => {
    expect(friendly(new Error("Трек 140123 недоступен"))).toBe(
      "Трек 140123 недоступен",
    );
    const preview = "Сервис вернул короткое превью вместо полного трека.";
    expect(friendly(new Error(preview))).toBe(preview);
  });
  it("explains an extension reload without blaming the internet", () =>
    expect(friendly(new Error("Extension context invalidated."))).toContain(
      "Обновите страницу Яндекс Музыки",
    ));
});
