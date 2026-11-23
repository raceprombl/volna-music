import { createHmac } from "node:crypto";
const checks = [];
for (const [format, quality, codecs] of [
  ["MP3", "hq", ["mp3"]],
  ["M4A", "hq", ["aac-mp4", "aac"]],
  ["FLAC", "lossless", ["flac", "flac-mp4"]],
]) {
  const ts = String(Math.floor(Date.now() / 1000)),
    id = "44025551";
  const sign = createHmac("sha256", "7tvSmFbyf5hJnIHhCimDDD")
    .update(ts + id + quality + codecs.join("") + "raw")
    .digest("base64")
    .replace(/=+$/, "");
  const query = new URLSearchParams({
    ts,
    trackId: id,
    quality,
    codecs: codecs.join(","),
    transports: "raw",
    sign,
  });
  const r = await fetch("https://api.music.yandex.ru/get-file-info?" + query, {
    headers: {
      "x-yandex-music-client": "YandexMusicWebNext/1.0.0",
      "x-yandex-music-without-invocation-info": "1",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  const json = await r.json(),
    d = json.downloadInfo ?? json.result?.downloadInfo;
  const record = {
    format,
    status: r.status,
    hasFile: !!d?.url,
    codec: d?.codec,
    transport: d?.transport,
    oauthUsed: false,
  };
  if (format === "MP3" && d?.transport === "raw" && d.url) {
    const media = await fetch(decodeURIComponent(d.url), {
      headers: { Range: "bytes=0-31" },
    });
    const reader = media.body.getReader();
    const first = await reader.read();
    await reader.cancel();
    const b = first.value;
    record.mediaStatus = media.status;
    record.mp3HeaderVerified =
      !!b &&
      (String.fromCharCode(...b.slice(0, 3)) === "ID3" ||
        (b[0] === 255 && (b[1] & 224) === 224));
  }
  checks.push(record);
}
console.log(
  JSON.stringify(
    { checks, note: "Only MP3 prefix read; no complete song saved." },
    null,
    2,
  ),
);
