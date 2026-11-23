import { describe, it, expect } from "vitest";
import {
  assertDuration,
  flacDuration,
  mp3Duration,
  mp4Duration,
  verifyFullAudio,
} from "../src/audio-duration";
function mp3(seconds: number) {
  const count = Math.ceil((seconds * 44100) / 1152),
    frameLength = 417;
  const bytes = new Uint8Array(count * frameLength);
  for (let i = 0; i < count; i++)
    bytes.set([255, 251, 144, 0], i * frameLength);
  return bytes;
}
function flac(seconds: number, sampleRate = 44100) {
  const bytes = new Uint8Array(42);
  bytes.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0x00, 0x00, 0x22], 0);
  const totalSamples = BigInt(Math.round(seconds * sampleRate));
  bytes[18] = (sampleRate >> 12) & 0xff;
  bytes[19] = (sampleRate >> 4) & 0xff;
  bytes[20] = ((sampleRate & 0xf) << 4) | 0x02;
  bytes[21] = 0xf0 | Number((totalSamples >> 32n) & 0xfn);
  new DataView(bytes.buffer).setUint32(
    22,
    Number(totalSamples & 0xffffffffn),
    false,
  );
  return bytes;
}
function mp4(seconds: number, version: 0 | 1 = 0, timescale = 1000) {
  const mvhdSize = version === 1 ? 44 : 32;
  const moovSize = 8 + mvhdSize;
  const ftypSize = 16;
  const bytes = new Uint8Array(ftypSize + moovSize);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  view.setUint32(0, ftypSize, false);
  ascii(4, "ftyp");
  ascii(8, "isom");
  view.setUint32(ftypSize, moovSize, false);
  ascii(ftypSize + 4, "moov");
  const mvhd = ftypSize + 8;
  view.setUint32(mvhd, mvhdSize, false);
  ascii(mvhd + 4, "mvhd");
  bytes[mvhd + 8] = version;
  if (version === 0) {
    view.setUint32(mvhd + 20, timescale, false);
    view.setUint32(mvhd + 24, Math.round(seconds * timescale), false);
  } else {
    view.setUint32(mvhd + 28, timescale, false);
    view.setBigUint64(
      mvhd + 32,
      BigInt(Math.round(seconds * timescale)),
      false,
    );
  }
  return bytes;
}
describe("full audio verification", () => {
  it("rejects unmarked 15/30 second MP3 previews using actual frame duration", async () => {
    for (const seconds of [15, 30]) {
      const bytes = mp3(seconds);
      expect(mp3Duration(bytes)).toBeCloseTo(seconds, 0);
      await expect(
        verifyFullAudio(
          bytes,
          "audio/mpeg",
          180000,
          new AbortController().signal,
        ),
      ).rejects.toThrow("Превью не сохранено");
    }
  });
  it("accepts complete tracks and legitimately short songs", async () => {
    for (const seconds of [15, 90])
      await expect(
        verifyFullAudio(
          mp3(seconds),
          "audio/mpeg",
          seconds * 1000,
          new AbortController().signal,
        ),
      ).resolves.toBeUndefined();
    expect(() => assertDuration(Infinity, 90000)).toThrow();
  });
  it("verifies FLAC and MP4 (v0/v1 mvhd) durations purely from bytes without DOM Audio", async () => {
    const flacFull = flac(210, 48000);
    expect(flacDuration(flacFull)).toBeCloseTo(210, 2);
    expect(flacDuration(flacFull.subarray(0, 20))).toBeUndefined();
    await expect(
      verifyFullAudio(
        flacFull,
        "audio/flac",
        210000,
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    await expect(
      verifyFullAudio(
        flac(30),
        "audio/flac",
        210000,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Превью не сохранено");

    for (const version of [0, 1] as const) {
      const mp4Full = mp4(185, version, 44100);
      expect(mp4Duration(mp4Full)).toBeCloseTo(185, 2);
      await expect(
        verifyFullAudio(
          mp4Full,
          "audio/mp4",
          185000,
          new AbortController().signal,
        ),
      ).resolves.toBeUndefined();
      await expect(
        verifyFullAudio(
          mp4(30, version),
          "audio/mp4",
          185000,
          new AbortController().signal,
        ),
      ).rejects.toThrow("Превью не сохранено");
    }
  });
  it("refuses to export files when catalog duration cannot be verified", async () => {
    await expect(
      verifyFullAudio(
        mp3(15),
        "audio/mpeg",
        undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Файл не сохранён");
  });
});
