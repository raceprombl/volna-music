import {
  ArrowUpRight,
  ChevronRight,
  Download,
  Headphones,
  Loader2,
} from "lucide-react";
import { progress } from "../shared";
import { transferInfo } from "../transfer-meter";
import type { Collection, Job } from "../types";
import { Cover, fmt, ProgressRing, statusLabel, type Tab } from "./primitives";

export function HomeView({
  loading,
  page,
  active,
  collectionActive,
  expanding,
  saved,
  installed,
  onOpenCollection,
  onOpenMusic,
  onNavigate,
}: {
  loading: boolean;
  page: { collection: Collection; tabId: number } | null;
  active: Job[];
  collectionActive: boolean;
  expanding: boolean;
  saved: number;
  installed: boolean;
  onOpenCollection: () => void;
  onOpenMusic: () => void;
  onNavigate: (tab: Tab) => void;
}) {
  return (
    <section className="view home-view" aria-labelledby="home-title">
      <div className="connection">
        <span className={`status-dot ${page ? "online" : ""}`} />
        <span>
          {loading
            ? "Проверяем подключение…"
            : page
              ? "Яндекс Музыка подключена"
              : "Ждём Яндекс Музыку"}
        </span>
      </div>
      <div className="page-heading">
        <h1 id="home-title">Скачать музыку</h1>
      </div>
      {loading ? (
        <div className="skeleton-card" aria-label="Загрузка">
          <div />
          <div />
          <div />
        </div>
      ) : page ? (
        <div className="collection-card">
          <div className="collection-info">
            <Cover track={page.collection.tracks[0]} size="large" />
            <div>
              <span className="overline">
                {
                  {
                    playlist: "Плейлист",
                    album: "Альбом",
                    likes: "Коллекция",
                    page: "Страница",
                  }[page.collection.kind]
                }
              </span>
              <h2 title={page.collection.title}>{page.collection.title}</h2>
              <p>
                {page.collection.tracks.length
                  ? `${fmt(page.collection.tracks.length)} на странице`
                  : "Получим полный список"}
                <span className="text-dot">·</span>Яндекс Музыка
              </p>
            </div>
          </div>
          <button
            className="button primary wide"
            onClick={onOpenCollection}
            disabled={expanding || active.length > 0}
            aria-busy={collectionActive || expanding}
            title={
              active.length
                ? "Дождитесь завершения или отмените текущую загрузку"
                : undefined
            }
          >
            {collectionActive ? (
              <ProgressRing
                value={progress(active[0])}
                label="Текущая загрузка"
              />
            ) : expanding ? (
              <Loader2 size={18} className="spin" />
            ) : (
              <Download size={18} />
            )}
            <span>
              {collectionActive
                ? `${active[0].status === "packing" ? "Сохраняем ZIP" : "Загружается"} · ${progress(active[0])}%`
                : expanding
                  ? "Получаем треки…"
                  : page.collection.kind === "album"
                    ? "Скачать альбом"
                    : "Скачать плейлист"}
            </span>
            <ChevronRight size={17} />
          </button>
        </div>
      ) : (
        <div className="connect-card">
          <div className="connect-icon">
            <Headphones size={25} strokeWidth={1.5} />
          </div>
          <div>
            <h2>Нет открытого плейлиста</h2>
            <p>
              Выбери плейлист или альбом
              <br />в Яндекс Музыке
            </p>
          </div>
          <button
            className="button primary wide"
            onClick={() =>
              installed
                ? onOpenMusic()
                : window.open(
                    "https://music.yandex.kz/",
                    "_blank",
                    "noopener",
                  )
            }
          >
            <span>Открыть Яндекс Музыку</span>
            <ArrowUpRight size={18} />
          </button>
        </div>
      )}
      {active.length > 0 && (
        <button
          className="queue-shortcut"
          onClick={() => onNavigate("downloads")}
        >
          <div className="queue-icon">
            <ProgressRing
              value={progress(active[0])}
              label="Прогресс загрузки"
            />
          </div>
          <div>
            <strong>{active[0].title}</strong>
            <span>
              {statusLabel[active[0].status]} · {progress(active[0])}%
            </span>
            <span>
              {[transferInfo(active[0]).speed, transferInfo(active[0]).remaining]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <ChevronRight size={17} />
        </button>
      )}
      <div className="home-bottom">
        <button onClick={() => onNavigate("history")}>
          {saved ? `${fmt(saved)} сохранено` : "История загрузок"}
          <ArrowUpRight size={12} />
        </button>
      </div>
    </section>
  );
}
