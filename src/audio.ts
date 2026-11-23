import { ID3Writer } from "browser-id3-writer";
import type { Track } from "./types";
export function tagMp3(
  data: Uint8Array,
  track: Track,
  index: number,
  cover?: Uint8Array,
  lyrics?: string,
) {
  const writer = new ID3Writer(
    data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer,
  );
  writer
    .setFrame("TIT2", track.title)
    .setFrame("TPE1", [track.artists])
    .setFrame("TRCK", String(index + 1));
  if (track.album) writer.setFrame("TALB", track.album);
  if (track.year) writer.setFrame("TYER", track.year);
  if (track.genre) writer.setFrame("TCON", [track.genre]);
  if (lyrics)
    writer.setFrame("USLT", { description: "", lyrics, language: "rus" });
  if (cover)
    writer.setFrame("APIC", {
      type: 3,
      data: cover.buffer.slice(
        cover.byteOffset,
        cover.byteOffset + cover.byteLength,
      ) as ArrayBuffer,
      description: "Cover",
    });
  return new Uint8Array(writer.addTag());
}
export function tagFlac(
  data: Uint8Array,
  track: Track,
  index: number,
  lyrics?: string,
) {
  if (new TextDecoder().decode(data.subarray(0, 4)) !== "fLaC")
    throw new Error("Некорректный FLAC.");
  const blocks: Uint8Array[] = [];
  let offset = 4,
    last = false;
  while (!last) {
    if (offset + 4 > data.length)
      throw new Error("Повреждены метаданные FLAC.");
    const type = data[offset] & 127;
    last = !!(data[offset] & 128);
    const length =
      data[offset + 1] * 65536 + data[offset + 2] * 256 + data[offset + 3];
    if (offset + 4 + length > data.length) throw new Error("Обрезан FLAC.");
    if (type !== 4) {
      const block = data.slice(offset, offset + 4 + length);
      block[0] &= 127;
      blocks.push(block);
    }
    offset += 4 + length;
  }
  const encoder = new TextEncoder();
  const values: Record<string, string> = {
    TITLE: track.title,
    ARTIST: track.artists,
    TRACKNUMBER: String(index + 1),
  };
  if (track.album) values.ALBUM = track.album;
  if (track.year) values.DATE = String(track.year);
  if (track.genre) values.GENRE = track.genre;
  if (lyrics) values.UNSYNCEDLYRICS = lyrics;
  const vendor = encoder.encode("VOLNA"),
    comments = Object.entries(values).map(([k, v]) =>
      encoder.encode(k + "=" + v),
    );
  const contentSize =
    4 + vendor.length + 4 + comments.reduce((n, c) => n + 4 + c.length, 0);
  if (contentSize > 0xffffff) throw new Error("Слишком большой FLAC-тег.");
  const block = new Uint8Array(4 + contentSize),
    v = new DataView(block.buffer);
  block[0] = 132;
  block[1] = contentSize >>> 16;
  block[2] = contentSize >>> 8;
  block[3] = contentSize;
  let p = 4;
  v.setUint32(p, vendor.length, true);
  p += 4;
  block.set(vendor, p);
  p += vendor.length;
  v.setUint32(p, comments.length, true);
  p += 4;
  for (const c of comments) {
    v.setUint32(p, c.length, true);
    p += 4;
    block.set(c, p);
    p += c.length;
  }
  blocks.push(block);
  const result = new Uint8Array(
    4 + blocks.reduce((n, b) => n + b.length, 0) + data.length - offset,
  );
  result.set(data.subarray(0, 4));
  let write = 4;
  for (const b of blocks) {
    result.set(b, write);
    write += b.length;
  }
  result.set(data.subarray(offset), write);
  return result;
}
export function encodeWav(channels: Float32Array[], sampleRate: number) {
  const length = channels[0].length,
    count = channels.length;
  const buffer = new ArrayBuffer(44 + length * count * 2),
    v = new DataView(buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, count, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * count * 2, true);
  v.setUint16(32, count * 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, buffer.byteLength - 44, true);
  let offset = 44;
  for (let i = 0; i < length; i++)
    for (const channel of channels) {
      const n = Math.max(-1, Math.min(1, channel[i]));
      v.setInt16(offset, n < 0 ? n * 32768 : n * 32767, true);
      offset += 2;
    }
  return new Uint8Array(buffer);
}
export async function toWav(data: Uint8Array) {
  if (data.byteLength > 40 * 1024 * 1024)
    throw new Error(
      "Для WAV исходный файл должен быть меньше 40 МБ. Выберите оригинал.",
    );
  const ctx = new OfflineAudioContext(2, 1, 44100);
  const decoded = await ctx.decodeAudioData(
    data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer,
  );
  if (decoded.length * decoded.numberOfChannels * 2 > 200 * 1024 * 1024)
    throw new Error("WAV превысит 200 МБ. Выберите оригинал.");
  return encodeWav(
    Array.from({ length: decoded.numberOfChannels }, (_, i) =>
      decoded.getChannelData(i),
    ),
    decoded.sampleRate,
  );
}
