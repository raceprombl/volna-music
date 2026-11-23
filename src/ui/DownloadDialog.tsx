import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  Check,
  Download,
  FileArchive,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { friendly, progress, rpc } from "../shared";
import type { Collection, Format, Job, Settings, Track } from "../types";
import { fmt, formats, IconButton, ProgressRing, Switch } from "./primitives";

export function DownloadDialog({
  collection,
  settings,
  onClose,
  onStart,
  activeJob,
}: {
  collection: Collection;
  settings: Settings;
  onClose: () => void;
  onStart: (tracks: Track[], s: Settings) => Promise<void>;
  activeJob?: Job;
}) {
  const ownDownload =
    !!activeJob &&
    activeJob.kind !== "page" &&
    activeJob.title === collection.title;
  const ref = useRef<HTMLDialogElement>(null),
    [selected, setSelected] = useState(
      () =>
        new Set(
          collection.tracks
            .filter((t) => t.available !== false)
            .map((t) => t.id),
        ),
    ),
    [s, setS] = useState(settings),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [limit, setLimit] = useState(40),
    [options, setOptions] = useState<
      { codec: string; bitrate: number }[] | null
    >(null),
    [checking, setChecking] = useState(false);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  const available = collection.tracks.filter((t) => t.available !== false),
    filtered = collection.tracks.filter((t) =>
      `${t.title} ${t.artists}`
        .toLocaleLowerCase("ru")
        .includes(query.toLocaleLowerCase("ru")),
    );
  async function probe() {
    const t = available[0];
    if (!t) return;
    setChecking(true);
    try {
      setOptions(await rpc("FORMATS", { id: t.id }));
    } catch (e) {
      setError(friendly(e));
    } finally {
      setChecking(false);
    }
  }
  const supported = (f: Format) =>
    !options ||
    f === "original" ||
    f === "wav" ||
    options.some((o) =>
      f === "aac"
        ? ["aac", "m4a", "mp4"].includes(o.codec)
        : f === "ogg"
          ? ["ogg", "vorbis"].includes(o.codec)
          : o.codec === f,
    );
  return (
    <dialog
      ref={ref}
      className="download-dialog"
      aria-labelledby="download-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            ref.current.close();
        }
      }}
    >
      <div className="dialog-heading">
        <IconButton label="Закрыть" onClick={() => ref.current?.close()}>
          <X size={18} />
        </IconButton>
      </div>
      <h2 id="download-title">{collection.title}</h2>
      <p className="dialog-description">
        {fmt(collection.tracks.length)} композиций
        {collection.partial ? " · список на странице" : ""}
      </p>
      <div className="format-heading">
        <label>Формат файла</label>
        <button
          className="text-button"
          onClick={() => void probe()}
          disabled={checking}
        >
          {checking ? (
            <Loader2 size={12} className="spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          Проверить доступность
        </button>
      </div>
      <div className="format-grid">
        {formats.map((f) => (
          <button
            key={f.value}
            disabled={!supported(f.value)}
            className={s.format === f.value ? "selected" : ""}
            aria-pressed={s.format === f.value}
            onClick={() => setS({ ...s, format: f.value })}
          >
            <strong>
              {f.label}
              {s.format === f.value && <Check size={13} />}
            </strong>
            <span>{!supported(f.value) ? "Не предоставлен API" : f.note}</span>
          </button>
        ))}
      </div>
      {options && (
        <p className="fine-print">
          Проверен первый трек. Форматы остальных могут отличаться.
        </p>
      )}
      <label className="quality-row">
        <span>Качество</span>
        <select
          value={s.quality}
          onChange={(e) =>
            setS({ ...s, quality: e.target.value as Settings["quality"] })
          }
        >
          <option value="best">Лучшее доступное</option>
          <option value="192">До 192 кбит/с</option>
          <option value="128">До 128 кбит/с</option>
        </select>
      </label>
      <label className="quality-row">
        <span>Потоки загрузки</span>
        <select
          value={s.concurrency}
          onChange={(e) => setS({ ...s, concurrency: Number(e.target.value) })}
        >
          {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n === 1 ? "1 (по очереди)" : n}
            </option>
          ))}
        </select>
      </label>
      <Switch
        checked={s.zip}
        onChange={(zip) => setS({ ...s, zip })}
        label="Упаковать в ZIP"
      />
      <div className="track-selection-head">
        <label>
          <input
            type="checkbox"
            checked={selected.size === available.length && available.length > 0}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? new Set(available.map((t) => t.id))
                  : new Set(),
              )
            }
          />{" "}
          Выбрать всё
        </label>
        <span>
          {fmt(selected.size)} / {fmt(collection.tracks.length)}
        </span>
      </div>
      <label className="search-field">
        <Search size={15} />
        <input
          aria-label="Поиск треков"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(40);
          }}
          placeholder="Найти трек или исполнителя"
        />
      </label>
      <div className="track-selection">
        {filtered.slice(0, limit).map((t, i) => (
          <label className="select-track" key={`${t.id}-${i}`}>
            <input
              type="checkbox"
              disabled={t.available === false}
              checked={selected.has(t.id)}
              onChange={(e) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  e.target.checked ? next.add(t.id) : next.delete(t.id);
                  return next;
                })
              }
            />
            <span className="track-index">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <strong>{t.title}</strong>
              <span>{t.available === false ? "Недоступен" : t.artists}</span>
            </div>
          </label>
        ))}
        {filtered.length > limit && (
          <button className="text-button" onClick={() => setLimit(limit + 40)}>
            Показать ещё 40
          </button>
        )}
        {filtered.length === 0 && <p className="muted">Ничего не найдено</p>}
      </div>
      <div className="rights-note">
        <ShieldCheck size={15} />
        <span>
          Только файлы, на получение которых у тебя есть разрешение. Без обхода
          DRM.
        </span>
      </div>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button primary wide"
        disabled={
          !!activeJob || busy || selected.size === 0 || !supported(s.format)
        }
        aria-busy={ownDownload || busy}
        onClick={async () => {
          if (activeJob || busy) return;
          setBusy(true);
          setError("");
          try {
            await onStart(
              collection.tracks.filter((t) => selected.has(t.id)),
              s,
            );
          } catch (e) {
            setError(friendly(e));
            setBusy(false);
          }
        }}
      >
        {ownDownload ? (
          <ProgressRing value={progress(activeJob)} label="Текущая загрузка" />
        ) : busy ? (
          <Loader2 className="spin" size={17} />
        ) : s.zip ? (
          <FileArchive size={17} />
        ) : (
          <Download size={17} />
        )}
        <span>
          {ownDownload
            ? `Загружается · ${progress(activeJob)}%`
            : activeJob
              ? "Дождитесь завершения загрузки"
              : busy
                ? "Добавляем…"
                : `Скачать ${fmt(selected.size)} ${s.zip ? "в ZIP" : "треков"}`}
        </span>
        <ArrowDown size={17} />
      </button>
      <p className="dialog-footnote">
        Загрузка продолжится после закрытия окна
      </p>
    </dialog>
  );
}
