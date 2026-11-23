/** Count actual MPEG Layer III frames, ignoring declared Xing/ID3 durations. */
export function mp3Duration(data: Uint8Array): number | undefined {
  let offset = 0,
    seconds = 0,
    frames = 0;
  if (
    String.fromCharCode(...data.subarray(0, 3)) === "ID3" &&
    data.length >= 10
  )
    offset =
      10 +
      ((data[6] & 127) * 2097152 +
        (data[7] & 127) * 16384 +
        (data[8] & 127) * 128 +
        (data[9] & 127));
  const high = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
  ];
  const low = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  while (offset + 4 <= data.length) {
    const a = data[offset],
      b = data[offset + 1],
      c = data[offset + 2];
    const version = (b >> 3) & 3,
      rate = (c >> 2) & 3,
      bit = c >> 4;
    if (
      a !== 255 ||
      (b & 224) !== 224 ||
      version === 1 ||
      ((b >> 1) & 3) !== 1 ||
      rate === 3 ||
      !bit ||
      bit === 15
    ) {
      if (frames) break;
      offset++;
      continue;
    }
    const sampleRate =
      [44100, 48000, 32000][rate] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const kbps = (version === 3 ? high : low)[bit];
    const length =
      Math.floor(((version === 3 ? 144 : 72) * kbps * 1000) / sampleRate) +
      ((c >> 1) & 1);
    if (offset + length > data.length) break;
    seconds += (version === 3 ? 1152 : 576) / sampleRate;
    offset += length;
    frames++;
  }
  return frames >= 3 ? seconds : undefined;
}

/** Parse FLAC STREAMINFO duration directly from bytes without spawning a media element. */
export function flacDuration(data: Uint8Array): number | undefined {
  if (
    data.length < 42 ||
    data[0] !== 0x66 ||
    data[1] !== 0x4c ||
    data[2] !== 0x61 ||
    data[3] !== 0x43 ||
    (data[4] & 127) !== 0
  )
    return undefined;
  const blockLen = (data[5] << 16) | (data[6] << 8) | data[7];
  if (blockLen !== 34) return undefined;
  const sampleRate = (data[18] << 12) | (data[19] << 4) | (data[20] >>> 4);
  const totalSamples =
    (data[21] & 0x0f) * 4294967296 +
    (((data[22] << 24) | (data[23] << 16) | (data[24] << 8) | data[25]) >>> 0);
  return sampleRate > 0 && totalSamples > 0
    ? totalSamples / sampleRate
    : undefined;
}

/** Parse ISO BMFF (M4A/MP4) mvhd duration directly from bytes without spawning a media element. */
export function mp4Duration(data: Uint8Array): number | undefined {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const readBox = (pos: number, end: number) => {
    if (pos + 8 > end) return undefined;
    let size = view.getUint32(pos);
    let header = 8;
    const type = view.getUint32(pos + 4);
    if (size === 1) {
      if (pos + 16 > end) return undefined;
      size = view.getUint32(pos + 8) * 4294967296 + view.getUint32(pos + 12);
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (!Number.isSafeInteger(size) || size < header || pos + size > end)
      return undefined;
    return { type, data: pos + header, end: pos + size };
  };
  for (let pos = 0; pos + 8 <= data.length; ) {
    const box = readBox(pos, data.length);
    if (!box) break;
    if (box.type === 0x6d6f6f76 /* moov */) {
      for (let childPos = box.data; childPos + 8 <= box.end; ) {
        const child = readBox(childPos, box.end);
        if (!child) break;
        if (child.type === 0x6d766864 /* mvhd */) {
          const version = data[child.data];
          if (version === 0 && child.data + 20 <= child.end) {
            const timescale = view.getUint32(child.data + 12);
            const duration = view.getUint32(child.data + 16);
            return timescale > 0 && duration > 0
              ? duration / timescale
              : undefined;
          }
          if (version === 1 && child.data + 32 <= child.end) {
            const timescale = view.getUint32(child.data + 20);
            const duration =
              view.getUint32(child.data + 24) * 4294967296 +
              view.getUint32(child.data + 28);
            return timescale > 0 &&
              duration > 0 &&
              Number.isSafeInteger(duration)
              ? duration / timescale
              : undefined;
          }
          return undefined;
        }
        childPos = child.end;
      }
      return undefined;
    }
    pos = box.end;
  }
  return undefined;
}

export function assertDuration(actual: number, expectedMs: number) {
  const expected = expectedMs / 1000;
  if (
    !Number.isFinite(actual) ||
    actual <= 0 ||
    (expected - actual > 4 && actual < expected * 0.92)
  )
    throw new Error(
      `Яндекс выдал короткий фрагмент (${Math.round(actual || 0)} с вместо ${Math.round(expected)} с). Превью не сохранено. Проверьте вход и доступ к полному треку в Яндекс Музыке.`,
    );
}

export async function verifyFullAudio(
  bytes: Uint8Array,
  mime: string,
  expectedMs: number | undefined,
  signal: AbortSignal,
) {
  if (!expectedMs || !Number.isFinite(expectedMs) || expectedMs <= 0)
    throw new Error(
      "Не удалось получить полную длительность композиции. Файл не сохранён, чтобы не скачать превью. Повторите загрузку при доступном соединении с Яндекс Музыкой.",
    );
  signal.throwIfAborted();
  const parsedDuration =
    mime === "audio/mpeg"
      ? mp3Duration(bytes)
      : mime === "audio/flac"
        ? flacDuration(bytes)
        : mime === "audio/mp4"
          ? mp4Duration(bytes)
          : undefined;
  if (parsedDuration !== undefined)
    return assertDuration(parsedDuration, expectedMs);
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const audio = new Audio();
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              "Не удалось проверить длительность файла. Загрузка не сохранена.",
            ),
          ),
        8000,
      );
      const abort = () => finish(signal.reason ?? new Error("Отменено"));
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        audio.onloadedmetadata = audio.onerror = null;
        error ? reject(error) : resolve(audio.duration);
      };
      audio.onloadedmetadata = () => finish();
      audio.onerror = () =>
        finish(
          new Error("Не удалось проверить аудиофайл. Загрузка не сохранена."),
        );
      signal.addEventListener("abort", abort, { once: true });
      audio.preload = "metadata";
      audio.src = url;
    });
    assertDuration(duration, expectedMs);
  } finally {
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  }
}
