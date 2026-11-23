import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    environmentOptions: { jsdom: { url: "https://music.yandex.kz/album/2" } },
    fileParallelism: false,
    testTimeout: 12000,
  },
});
