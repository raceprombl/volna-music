import { build } from "vite";
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
await build({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: "popup.html",
        offscreen: "offscreen.html",
        background: "src/background.ts",
      },
      output: {
        entryFileNames: (c) =>
          c.name === "background" ? "background.js" : "assets/[name]-[hash].js",
      },
    },
  },
});
await build({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/content.ts",
      name: "VolnaContent",
      formats: ["iife"],
      fileName: () => "content.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const domains = ["ru", "kz", "com", "by", "uz"].map(
  (t) => `https://music.yandex.${t}/*`,
);
const manifest = {
  manifest_version: 3,
  name: "VOLNA — музыка с собой",
  version: "1.0.0",
  description:
    "Очередь загрузок, плейлисты и ZIP для доступных файлов Яндекс Музыки. Без обхода DRM.",
  minimum_chrome_version: "120",
  permissions: ["storage", "downloads", "offscreen", "alarms", "scripting"],
  host_permissions: [
    ...domains,
    "https://api.music.yandex.ru/*",
    "https://*.storage.yandex.net/*",
    "https://storage.mds.yandex.net/*",
    "https://*.strm.yandex.net/*",
    "https://*.music.yandex.net/*",
    "https://avatars.yandex.net/*",
    "https://avatars.mds.yandex.net/*",
  ],
  background: { service_worker: "background.js", type: "module" },
  action: {
    default_popup: "popup.html",
    default_title: "VOLNA — музыка с собой",
    default_icon: { 16: "icons/16.png", 32: "icons/32.png" },
  },
  icons: {
    16: "icons/16.png",
    32: "icons/32.png",
    48: "icons/48.png",
    128: "icons/128.png",
  },
  content_scripts: [
    { matches: domains, js: ["content.js"], run_at: "document_idle" },
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'",
  },
};
await writeFile("dist/manifest.json", JSON.stringify(manifest, null, 2));
await mkdir("dist/icons", { recursive: true });
for (const size of [16, 32, 48, 128])
  await copyFile(`public/icons/${size}.png`, `dist/icons/${size}.png`);
await copyFile("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
console.log("VOLNA extension built → dist");
