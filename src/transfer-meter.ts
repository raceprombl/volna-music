import type { Job, QueueItem } from "./types";

/** Measures aggregate network traffic, independently of ID3/WAV output sizes. */
export class TransferMeter {
  private files: {
    bytes: number;
    total: number;
    duration: number;
    done: boolean;
    ignored: boolean;
  }[];
  private received = 0;
  private samples: { at: number; bytes: number }[] = [];
  constructor(
    private items: QueueItem[],
    private clock = Date.now,
  ) {
    this.files = items.map((item) => ({
      bytes: 0,
      total: 0,
      duration: item.track.duration || 0,
      done: ["ready", "complete"].includes(item.status),
      ignored: ["failed", "skipped", "cancelled"].includes(item.status),
    }));
  }
  record(index: number, bytes: number, total: number) {
    const file = this.files[index];
    if (!file || !Number.isFinite(bytes) || bytes < 0) return;
    if (!this.samples.length && bytes > 0)
      this.samples.push({ at: this.clock(), bytes: this.received });
    this.received += bytes >= file.bytes ? bytes - file.bytes : bytes;
    file.bytes = bytes;
    if (Number.isFinite(total) && total > 0) file.total = total;
  }
  finish(index: number) {
    if (this.files[index]) this.files[index].done = true;
  }
  skip(index: number) {
    if (this.files[index]) this.files[index].ignored = true;
  }
  snapshot(): NonNullable<Job["transfer"]> {
    const now = this.clock();
    this.files.forEach((file, index) => {
      const duration = this.items[index].track.duration;
      if (duration && Number.isFinite(duration) && duration > 0)
        file.duration = duration;
    });
    let bytesPerSecond: number | undefined;
    if (this.samples.length) {
      this.samples.push({ at: now, bytes: this.received });
      while (this.samples.length > 2 && this.samples[1].at <= now - 8000)
        this.samples.shift();
      const first = this.samples[0];
      if (now - first.at >= 500)
        bytesPerSecond = Math.max(
          0,
          ((this.received - first.bytes) * 1000) / (now - first.at),
        );
    }
    const known = this.files.filter((file) => !file.ignored && file.total > 0);
    const withDuration = known.filter((file) => file.duration > 0);
    const bytesPerDuration =
      withDuration.reduce((n, f) => n + f.total, 0) /
      withDuration.reduce((n, f) => n + f.duration, 0);
    const average = known.reduce((n, f) => n + f.total, 0) / known.length;
    let remaining = 0,
      estimated = false,
      unknown = false,
      pendingTracks = 0;
    for (const file of this.files) {
      if (file.done || file.ignored) continue;
      pendingTracks++;
      let total = file.total;
      if (!total) {
        estimated = true;
        total =
          file.duration > 0 && Number.isFinite(bytesPerDuration)
            ? file.duration * bytesPerDuration
            : average;
      }
      if (!Number.isFinite(total) || total <= 0) unknown = true;
      else remaining += Math.max(0, total - file.bytes);
    }
    return {
      receivedBytes: this.received,
      totalBytes: unknown ? undefined : Math.ceil(this.received + remaining),
      estimated,
      bytesPerSecond,
      remainingSeconds:
        !unknown && pendingTracks > 0 && bytesPerSecond && bytesPerSecond > 0
          ? Math.ceil(remaining / bytesPerSecond)
          : undefined,
      pendingTracks,
      updatedAt: now,
    };
  }
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  const index = Math.min(3, Math.floor(Math.log2(Math.max(1, bytes)) / 10));
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: index ? 1 : 0 }).format(bytes / 1024 ** index)} ${units[index]}`;
}
function formatWait(seconds: number) {
  const value = Math.max(1, Math.ceil(seconds));
  if (value < 60) return `${value} с`;
  if (value < 3600)
    return `${Math.floor(value / 60)} мин${value % 60 ? ` ${value % 60} с` : ""}`;
  if (value < 86400)
    return `${Math.floor(value / 3600)} ч ${Math.floor((value % 3600) / 60)} мин`;
  return `${Math.floor(value / 86400)} дн. ${Math.floor((value % 86400) / 3600)} ч`;
}
export function transferInfo(job: Job, now = Date.now()) {
  const data = job.transfer;
  const volume = data
    ? `Получено ${formatBytes(data.receivedBytes)}${data.totalBytes !== undefined ? ` из ${data.estimated ? "≈ " : ""}${formatBytes(data.totalBytes)}` : ""}`
    : "";
  if (!["queued", "running", "packing"].includes(job.status))
    return { speed: "", remaining: "", volume };
  if (job.status === "packing")
    return {
      speed: "Сохраняем ZIP",
      remaining: "Время зависит от диска",
      volume,
    };
  if (data?.pendingTracks === 0)
    return { speed: "Обрабатываем файлы", remaining: "", volume };
  const fresh = data && now - data.updatedAt < 3000;
  return {
    speed:
      !data || data.bytesPerSecond === undefined
        ? "Измеряем скорость…"
        : !fresh
          ? "Обновляем скорость…"
          : `${formatBytes(data.bytesPerSecond)}/с`,
    remaining:
      fresh && data.remainingSeconds !== undefined
        ? `Осталось ≈ ${formatWait(data.remainingSeconds)}`
        : fresh && data.bytesPerSecond === 0
          ? "Ждём данные от сервера"
          : "Оцениваем время…",
    volume,
  };
}
