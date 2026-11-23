// ISO BMFF to native FLAC remux. No decoding, decryption or quality changes.
type Box = { type: string; start: number; data: number; end: number };
const ascii = (b: Uint8Array, a: number, z: number) =>
  new TextDecoder("ascii").decode(b.subarray(a, z));
export function demuxFlacMp4(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (n: number) => {
    if (n < 0 || n + 4 > bytes.length)
      throw new Error("Повреждённая таблица MP4.");
    return view.getUint32(n);
  };
  const u64 = (n: number) => {
    const x = u32(n) * 2 ** 32 + u32(n + 4);
    if (!Number.isSafeInteger(x))
      throw new Error("Слишком большой offset MP4.");
    return x;
  };
  function boxes(start: number, end: number): Box[] {
    const result: Box[] = [];
    for (let n = start; n + 8 <= end;) {
      let size = u32(n),
        header = 8;
      if (size === 1) {
        size = u64(n + 8);
        header = 16;
      }
      if (size === 0) size = end - n;
      if (size < header || n + size > end)
        throw new Error("Повреждённый контейнер MP4.");
      result.push({
        type: ascii(bytes, n + 4, n + 8),
        start: n,
        data: n + header,
        end: n + size,
      });
      n += size;
    }
    return result;
  }
  const top = boxes(0, bytes.length);
  const moov = top.find((b) => b.type === "moov");
  if (!moov) throw new Error("MP4 не содержит moov.");
  function child(box: Box, type: string) {
    return boxes(box.data, box.end).find((b) => b.type === type);
  }
  for (const trak of boxes(moov.data, moov.end).filter(
    (b) => b.type === "trak",
  )) {
    const mdia = child(trak, "mdia"),
      minf = mdia && child(mdia, "minf"),
      stbl = minf && child(minf, "stbl");
    if (!stbl) continue;
    const table = boxes(stbl.data, stbl.end),
      stsd = table.find((b) => b.type === "stsd");
    if (!stsd) continue;
    const entries = boxes(stsd.data + 8, stsd.end);
    if (entries.some((e) => e.type === "enca"))
      throw new Error("Зашифрованный MP4 не поддерживается.");
    const entry = entries.find((e) => e.type === "fLaC");
    if (!entry) continue;
    // AudioSampleEntry has 28 fixed bytes before its child boxes.
    const dfla = boxes(entry.data + 28, entry.end).find(
      (b) => b.type === "dfLa",
    );
    if (!dfla) throw new Error("Нет FLAC-конфигурации dfLa.");
    const metadata = bytes.slice(dfla.data + 4, dfla.end);
    let p = 0,
      last = -1;
    while (p < metadata.length) {
      if (p + 4 > metadata.length) throw new Error("Обрезаны метаданные FLAC.");
      const size =
        metadata[p + 1] * 65536 + metadata[p + 2] * 256 + metadata[p + 3];
      if (p + 4 + size > metadata.length) throw new Error("Обрезан блок FLAC.");
      if (p === 0 && ((metadata[p] & 127) !== 0 || size !== 34))
        throw new Error("Нет STREAMINFO.");
      last = p;
      metadata[p] &= 127;
      p += 4 + size;
    }
    if (last < 0) throw new Error("Пустые метаданные FLAC.");
    metadata[last] |= 128;
    const stsz = table.find((b) => b.type === "stsz"),
      stsc = table.find((b) => b.type === "stsc"),
      offsetsBox =
        table.find((b) => b.type === "co64") ??
        table.find((b) => b.type === "stco");
    if (!stsz || !stsc || !offsetsBox)
      throw new Error(
        "Нет полных таблиц аудиосэмплов. Файл не будет повреждённой копией.",
      );
    const constant = u32(stsz.data + 4),
      count = u32(stsz.data + 8);
    if (count > 2e6 || (!constant && stsz.data + 12 + count * 4 > stsz.end))
      throw new Error("Некорректная таблица размеров.");
    const sizes = Array.from(
      { length: count },
      (_, i) => constant || u32(stsz.data + 12 + i * 4),
    );
    const rulesCount = u32(stsc.data + 4),
      chunkCount = u32(offsetsBox.data + 4),
      wide = offsetsBox.type === "co64";
    if (
      !rulesCount ||
      rulesCount > count ||
      stsc.data + 8 + rulesCount * 12 > stsc.end ||
      offsetsBox.data + 8 + chunkCount * (wide ? 8 : 4) > offsetsBox.end
    )
      throw new Error("Некорректная таблица чанков.");
    const rules = Array.from({ length: rulesCount }, (_, i) => ({
      first: u32(stsc.data + 8 + i * 12),
      samples: u32(stsc.data + 12 + i * 12),
    }));
    const total = sizes.reduce((n, s) => n + s, 0);
    if (!total || total > bytes.length)
      throw new Error("Некорректный размер FLAC-сэмплов.");
    const result = new Uint8Array(4 + metadata.length + total);
    result.set(new TextEncoder().encode("fLaC"));
    result.set(metadata, 4);
    let sample = 0,
      write = 4 + metadata.length,
      rule = 0;
    for (let c = 0; c < chunkCount && sample < count; c++) {
      while (rule + 1 < rules.length && rules[rule + 1].first <= c + 1) rule++;
      let offset = wide
        ? u64(offsetsBox.data + 8 + c * 8)
        : u32(offsetsBox.data + 8 + c * 4);
      for (
        let s = 0;
        s < rules[rule].samples && sample < count;
        s++, sample++
      ) {
        const size = sizes[sample];
        if (
          !top.some(
            (b) =>
              b.type === "mdat" && offset >= b.data && offset + size <= b.end,
          )
        )
          throw new Error("FLAC-сэмпл выходит за mdat.");
        result.set(bytes.subarray(offset, offset + size), write);
        offset += size;
        write += size;
      }
    }
    if (sample !== count || write !== result.length)
      throw new Error("FLAC извлечён не полностью.");
    return result;
  }
  throw new Error("MP4 не содержит незашифрованную FLAC-дорожку.");
}
