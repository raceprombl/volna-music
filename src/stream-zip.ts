// ZIP64 STORE records, per PKWARE APPNOTE 6.3.10. Audio is already compressed.
// Only the central directory and a 1 MiB transfer chunk stay in memory.
export const MAX_ARCHIVE_BYTES = 10 * 1024 ** 3;
const FOOTER_BYTES = 98;
export interface ZipSink {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
const T0 = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
const [T1, T2, T3] = (() => {
  const tables = [T0];
  for (let t = 1; t < 4; t++) {
    const prev = tables[t - 1];
    const cur = new Uint32Array(256);
    for (let i = 0; i < 256; i++)
      cur[i] = T0[prev[i] & 255] ^ (prev[i] >>> 8);
    tables.push(cur);
  }
  return tables.slice(1);
})();
function crc32(bytes: Uint8Array, crc: number) {
  let i = 0;
  const end = bytes.length - 3;
  while (i < end) {
    crc ^=
      bytes[i] |
      (bytes[i + 1] << 8) |
      (bytes[i + 2] << 16) |
      (bytes[i + 3] << 24);
    crc =
      T3[crc & 255] ^
      T2[(crc >>> 8) & 255] ^
      T1[(crc >>> 16) & 255] ^
      T0[crc >>> 24];
    i += 4;
  }
  while (i < bytes.length) crc = T0[(crc ^ bytes[i++]) & 255] ^ (crc >>> 8);
  return crc;
}
function record(size: number) {
  const bytes = new Uint8Array(size),
    view = new DataView(bytes.buffer);
  return { bytes, view };
}
export class StreamZip {
  private offset = 0;
  private central: Uint8Array[] = [];
  private centralBytes = 0;
  private names = new Set<string>();
  private ended = false;
  private busy = false;
  private time: number;
  private date: number;
  constructor(
    private sink: ZipSink,
    date = new Date(),
    private limit = MAX_ARCHIVE_BYTES,
  ) {
    this.time =
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1);
    this.date =
      ((Math.max(1980, Math.min(2107, date.getFullYear())) - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate();
  }
  get bytes() {
    return this.offset;
  }
  get count() {
    return this.central.length;
  }
  private async write(data: Uint8Array) {
    await this.sink.write(data);
    this.offset += data.length;
  }
  async add(name: string, input: Blob | Uint8Array, signal: AbortSignal) {
    if (this.ended || this.busy) throw new Error("ZIP недоступен для записи.");
    if (
      !name ||
      /[\\\u0000]/.test(name) ||
      name.startsWith("/") ||
      name.split("/").some((p) => p === ".." || p === ".")
    )
      throw new Error("Недопустимое имя файла в ZIP.");
    let unique = name,
      suffix = 1;
    while (this.names.has(unique))
      unique = name.replace(/(\.[^/.]+)?$/, ` (${++suffix})$1`);
    const text = new TextEncoder().encode(unique);
    const isBytes = input instanceof Uint8Array;
    const totalSize = isBytes ? input.byteLength : input.size;
    if (
      text.length > 65535 ||
      !Number.isSafeInteger(totalSize) ||
      totalSize < 0
    )
      throw new Error("Недопустимый размер записи ZIP.");
    const centralSize = 46 + text.length + 28;
    // Includes every header, descriptor, central record and the ZIP64 footer.
    if (
      this.offset +
        30 +
        text.length +
        20 +
        totalSize +
        24 +
        this.centralBytes +
        centralSize +
        FOOTER_BYTES >
      this.limit
    )
      throw new Error(
        "ZIP превысит 10 ГБ. Выберите меньше треков для одного архива.",
      );
    signal.throwIfAborted();
    this.busy = true;
    try {
      const start = this.offset;
      const local = record(30 + text.length + 20),
        v = local.view;
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 45, true);
      v.setUint16(6, 0x808, true);
      v.setUint16(10, this.time, true);
      v.setUint16(12, this.date, true);
      v.setUint32(18, 0xffffffff, true);
      v.setUint32(22, 0xffffffff, true);
      v.setUint16(26, text.length, true);
      v.setUint16(28, 20, true);
      local.bytes.set(text, 30);
      const x = 30 + text.length;
      v.setUint16(x, 1, true);
      v.setUint16(x + 2, 16, true);
      v.setBigUint64(x + 4, BigInt(totalSize), true);
      v.setBigUint64(x + 12, BigInt(totalSize), true);
      await this.write(local.bytes);
      let crc = 0xffffffff;
      for (let pos = 0; pos < totalSize; pos += 1024 ** 2) {
        signal.throwIfAborted();
        const bytes = isBytes
          ? input.subarray(pos, Math.min(pos + 1024 ** 2, totalSize))
          : new Uint8Array(
              await input.slice(pos, pos + 1024 ** 2).arrayBuffer(),
            );
        crc = crc32(bytes, crc);
        await this.write(bytes); // Backpressure: no unbounded chunk queue.
      }
      signal.throwIfAborted();
      crc = (crc ^ 0xffffffff) >>> 0;
      const dd = record(24);
      dd.view.setUint32(0, 0x08074b50, true);
      dd.view.setUint32(4, crc, true);
      dd.view.setBigUint64(8, BigInt(totalSize), true);
      dd.view.setBigUint64(16, BigInt(totalSize), true);
      await this.write(dd.bytes);
      const cd = record(centralSize),
        c = cd.view;
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 45, true);
      c.setUint16(6, 45, true);
      c.setUint16(8, 0x808, true);
      c.setUint16(12, this.time, true);
      c.setUint16(14, this.date, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, 0xffffffff, true);
      c.setUint32(24, 0xffffffff, true);
      c.setUint16(28, text.length, true);
      c.setUint16(30, 28, true);
      c.setUint32(42, 0xffffffff, true);
      cd.bytes.set(text, 46);
      const y = 46 + text.length;
      c.setUint16(y, 1, true);
      c.setUint16(y + 2, 24, true);
      c.setBigUint64(y + 4, BigInt(totalSize), true);
      c.setBigUint64(y + 12, BigInt(totalSize), true);
      c.setBigUint64(y + 20, BigInt(start), true);
      this.central.push(cd.bytes);
      this.centralBytes += centralSize;
      this.names.add(unique);
      return unique;
    } catch (e) {
      await this.abort(e);
      throw e;
    } finally {
      this.busy = false;
    }
  }
  async close(signal: AbortSignal) {
    if (this.ended || this.busy)
      throw new Error("ZIP недоступен для завершения.");
    signal.throwIfAborted();
    try {
      const start = this.offset,
        count = BigInt(this.central.length);
      for (const entry of this.central) {
        signal.throwIfAborted();
        await this.write(entry);
      }
      const zip64Start = this.offset,
        end = record(FOOTER_BYTES),
        v = end.view;
      v.setUint32(0, 0x06064b50, true);
      v.setBigUint64(4, 44n, true);
      v.setUint16(12, 45, true);
      v.setUint16(14, 45, true);
      v.setBigUint64(24, count, true);
      v.setBigUint64(32, count, true);
      v.setBigUint64(40, BigInt(this.centralBytes), true);
      v.setBigUint64(48, BigInt(start), true);
      v.setUint32(56, 0x07064b50, true);
      v.setBigUint64(64, BigInt(zip64Start), true);
      v.setUint32(72, 1, true);
      v.setUint32(76, 0x06054b50, true);
      v.setUint16(84, 0xffff, true);
      v.setUint16(86, 0xffff, true);
      v.setUint32(88, 0xffffffff, true);
      v.setUint32(92, 0xffffffff, true);
      await this.write(end.bytes);
      signal.throwIfAborted();
      await this.sink.close();
      this.ended = true;
    } catch (e) {
      await this.abort(e);
      throw e;
    }
  }
  async abort(reason?: unknown) {
    if (this.ended) return;
    this.ended = true;
    this.central = [];
    this.names.clear();
    await this.sink.abort(reason).catch(() => {});
  }
}
