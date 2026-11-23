import React, { useState } from "react";
import { AudioLines, Music2 } from "lucide-react";
import { transferInfo } from "../transfer-meter";
import type { Format, Job, Track } from "../types";

export type Tab = "home" | "downloads" | "history" | "settings";

export const fmt = (n: number) => new Intl.NumberFormat("ru").format(n);

export const formats: { value: Format; label: string; note: string }[] = [
  { value: "original", label: "Оригинал", note: "Без конвертации" },
  { value: "mp3", label: "MP3", note: "Универсальный" },
  { value: "flac", label: "FLAC", note: "Если доступен" },
  { value: "aac", label: "M4A / AAC", note: "Если доступен" },
  { value: "ogg", label: "OGG", note: "Если доступен" },
  { value: "wav", label: "WAV", note: "PCM · большой файл" },
];

export const statusLabel: Record<Job["status"], string> = {
  queued: "В очереди",
  running: "Загружается",
  packing: "Сохраняем ZIP",
  complete: "Сохранено",
  partial: "Частично сохранено",
  failed: "Не удалось загрузить",
  cancelled: "Отменено",
  interrupted: "Можно продолжить",
};

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-symbol">
        <AudioLines size={21} strokeWidth={2.3} />
      </span>
      <span>
        volna<span className="brand-period">.</span>
      </span>
    </div>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Cover({
  track,
  size = "normal",
}: {
  track?: Track;
  size?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`cover ${size}`}>
      {track?.cover && !failed ? (
        <img
          src={track.cover}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <AudioLines size={size === "large" ? 30 : 18} strokeWidth={1.5} />
      )}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <span style={{ transform: `scaleX(${value / 100})` }} />
    </div>
  );
}

export function ProgressRing({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <svg
      className="progress-ring"
      viewBox="0 0 24 24"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <circle className="ring-track" cx="12" cy="12" r="9" />
      <circle
        className="ring-value"
        cx="12"
        cy="12"
        r="9"
        pathLength="100"
        strokeDasharray="100"
        strokeDashoffset={100 - value}
      />
    </svg>
  );
}

export function Empty({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof Music2;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">
        <Icon size={28} strokeWidth={1.3} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="setting-toggle">
      <div>
        <strong>{label}</strong>
        {description && <span>{description}</span>}
      </div>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

export function TransferDetails({ job }: { job: Job }) {
  const info = transferInfo(job);
  return (
    <div className="transfer-details" aria-label="Скорость и время загрузки">
      {(info.speed || info.remaining) && (
        <div>
          <span>{info.speed}</span>
          <span>{info.remaining}</span>
        </div>
      )}
      {info.volume && <p>{info.volume}</p>}
    </div>
  );
}
