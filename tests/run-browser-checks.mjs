import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

// Own HTTP fixture pages only; no access to the user's Chrome profile.
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 440, height: 760 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const results = {};
try {
  // Keep functional UI checks, skip their old screenshots: the design pass has
  // one final rendering, rather than generating an image of every state.
  let source = await readFile("tests/ui-cli.js", "utf8");
  source = source.replace(
    /await (?:page|dialog)\.screenshot\(\{[\s\S]*?\}\);/g,
    "",
  );
  results.ui = await eval(`(${source})`)(page);
  await page.setViewportSize({ width: 440, height: 620 });
  await page.locator("nav").getByRole("button", { name: "Настройки" }).click();
  await page.getByRole("button", { name: "Тёмная", exact: true }).click();
  await page.locator("nav").getByRole("button", { name: "Главная" }).click();
  await page.evaluate(() => document.fonts.ready);
  if (process.env.UI_SCREENSHOT === "1")
    await page.screenshot({
      path: "artifacts/unslop-after.png",
      fullPage: true,
    });

  const downloadEvent = page.waitForEvent("download");
  results.opfs = await page.evaluate(async () => {
    const { createArchive } = await import("/src/archive-store.ts");
    const archive = await createArchive("browser-check");
    const signal = new AbortController().signal;
    for (let i = 0; i < 4; i++) {
      await archive.zip.add(
        `Трек ${i + 1}.flac`,
        new Blob([new Uint8Array(2 * 1024 ** 2).fill(i + 1)]),
        signal,
      );
    }
    await archive.zip.close(signal);
    const file = await archive.file();
    const url = URL.createObjectURL(file);
    window.__zipCheck = { archive, url };
    const link = document.createElement("a");
    link.href = url;
    link.download = "volna-streaming-fixture.zip";
    link.click();
    return {
      diskFile: file instanceof File,
      bytes: file.size,
      entries: archive.zip.count,
    };
  });
  const download = await downloadEvent;
  await download.saveAs("artifacts/streamed-browser-fixture.zip");
  results.opfs.cleaned = await page.evaluate(async () => {
    const { archive, url } = window.__zipCheck;
    URL.revokeObjectURL(url);
    await archive.cleanup();
    delete window.__zipCheck;
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("volna-archives");
    return (await Array.fromAsync(dir.keys())).length === 0;
  });
  if (
    !results.opfs.diskFile ||
    !results.opfs.cleaned ||
    results.opfs.bytes < 8 * 1024 ** 2
  )
    throw Error("Disk ZIP integration failed");

  // Use a separate context so the two fixture initialization scripts cannot mix.
  const libraryContext = await browser.newContext();
  const libraryPage = await libraryContext.newPage();
  const librarySource = (
    await readFile("tests/library-ui-cli.js", "utf8")
  ).replace(/await (?:page|dialog)\.screenshot\(\{[\s\S]*?\}\);/g, "");
  results.library = await eval(`(${librarySource})`)(libraryPage);
  await libraryContext.close();
  if (errors.length) throw Error(errors.join("\n"));
  results.pageErrors = errors;
  await writeFile(
    "artifacts/browser-validation.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
