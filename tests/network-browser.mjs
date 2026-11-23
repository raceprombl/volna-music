import http from "node:http";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

// Controlled loopback bytes only. This is not a Yandex CDN speed benchmark.
const data = Buffer.alloc(8 * 1024 * 1024);
for (let i = 0; i < data.length; i++) data[i] = i % 251;
const expected = createHash("sha256").update(data).digest("hex");
let dropped = false,
  active = 0,
  peak = 0;
const requests = [];
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range, If-Range");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Range, Content-Length, ETag",
  );
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  active++;
  peak = Math.max(peak, active);
  let closed = false;
  res.on("close", () => {
    if (!closed) {
      closed = true;
      active--;
    }
  });
  requests.push({
    path: req.url,
    range: req.headers.range,
    ifRange: req.headers["if-range"],
  });
  const send = () => {
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0,
      end =
        range && range[2]
          ? Math.min(data.length - 1, Number(range[2]))
          : data.length - 1;
    if (start > end || start >= data.length) {
      res.writeHead(416, { "Content-Range": `bytes */${data.length}` });
      res.end();
      return;
    }
    res.setHeader("ETag", '"fixture-v1"');
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", end - start + 1);
    if (range) {
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${data.length}`);
    }
    if (req.url === "/drop" && !range && !dropped) {
      dropped = true;
      res.write(data.subarray(0, 512 * 1024));
      const timer = setTimeout(() => res.destroy(), 30);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    let position = start;
    const pump = () => {
      while (position <= end) {
        const next = Math.min(position + 256 * 1024, end + 1);
        const ok = res.write(data.subarray(position, next));
        position = next;
        if (!ok) {
          res.once("drain", pump);
          return;
        }
      }
      res.end();
    };
    pump();
  };
  if (req.url === "/slow") {
    const timer = setTimeout(send, 1000);
    res.on("close", () => clearTimeout(timer));
  } else send();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/popup.html");
  const results = await page.evaluate(
    async ({ base, expected }) => {
      const { MediaClient } = await import("/src/media-client.ts");
      const client = new MediaClient(undefined, undefined, (url) =>
        url.startsWith(base + "/"),
      );
      const signal = new AbortController().signal;
      const digest = async (bytes) =>
        Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
      const recovered = await client.download([base + "/drop"], signal);
      if ((await digest(recovered)) !== expected)
        throw Error("Native resume corrupted bytes");
      const started = performance.now();
      const mirrored = await client.download(
        [base + "/slow", base + "/fast"],
        signal,
      );
      const mirrorMs = Math.round(performance.now() - started);
      if ((await digest(mirrored)) !== expected)
        throw Error("Native mirror corrupted bytes");
      const multipart = await client.download(
        [base + "/multipart"],
        signal,
        undefined,
        20 * 1024 * 1024,
        { multipart: 4, priority: 0 },
      );
      if ((await digest(multipart)) !== expected)
        throw Error("Native multipart corrupted bytes");
      const began = performance.now();
      const batch = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          client.download([base + "/batch?" + index], signal),
        ),
      );
      const elapsedMs = performance.now() - began;
      for (const bytes of batch)
        if ((await digest(bytes)) !== expected)
          throw Error("Native batch corrupted bytes");
      return {
        resume: true,
        mirrors: true,
        multipart: true,
        batchFiles: batch.length,
        allChecksums: true,
        mirrorMs,
        loopbackMiB:
          batch.reduce((n, bytes) => n + bytes.length, 0) / 1024 ** 2,
        loopbackMbps: Math.round(
          (batch.reduce((n, bytes) => n + bytes.length, 0) * 8) /
            elapsedMs /
            1000,
        ),
        disclaimer:
          "Controlled loopback fixture; not a Yandex CDN benchmark or playback TTFA measurement",
      };
    },
    { base, expected },
  );
  const resumed = requests.find(
    (item) =>
      item.path === "/drop" && item.range && item.ifRange === '"fixture-v1"',
  );
  if (!resumed)
    throw Error("No native Range / If-Range recovery request observed");
  if (!requests.some((item) => item.path === "/fast"))
    throw Error("No native mirror switch observed");
  if (peak > 24) throw Error("Native connection budget exceeded");
  const report = {
    ...results,
    resumeRange: resumed.range,
    peakNativeRequests: peak,
    requests: requests.length,
  };
  await writeFile(
    "artifacts/network-browser-validation.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
