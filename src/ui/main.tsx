import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  CheckCircle2,
  CircleAlert,
  Clock3,
  House,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  activeJobs,
  defaults,
  type AppState,
  type Collection,
  type Settings,
} from "../types";
import type { RpcCommand, RpcMap } from "../rpc";
import { friendly, rpc } from "../shared";
import { getPage, getState, installed, saveSettings } from "./bridge";
import { Brand, IconButton, type Tab } from "./primitives";
import { HomeView } from "./HomeView";
import { DownloadsView } from "./DownloadsView";
import { HistoryView } from "./HistoryView";
import { SettingsView } from "./SettingsView";
import { DownloadDialog } from "./DownloadDialog";
import "./styles.css";

function App() {
  const librarySetup =
    new URLSearchParams(location.search).get("folder") === "connect";
  const [tab, setTab] = useState<Tab>(
      new URLSearchParams(location.search).get("view") === "settings"
        ? "settings"
        : "home",
    ),
    [state, setState] = useState<AppState>({
      settings: defaults,
      jobs: [],
      tokenPresent: false,
    }),
    [page, setPage] = useState<{
      collection: Collection;
      tabId: number;
    } | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [collection, setCollection] = useState<Collection | null>(null),
    [expanding, setExpanding] = useState(false);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((text: string) => {
    setToast(text);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(""), 3600);
  }, []);
  const refresh = useCallback(async () => {
    try {
      setState(await getState());
    } catch (e) {
      setError(friendly(e));
    }
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        const [s, p] = await Promise.all([getState(), getPage()]);
        setState(s);
        setPage(p);
      } catch (e) {
        setError(friendly(e));
      } finally {
        setLoading(false);
      }
    })();
    if (!installed) return;
    const listen = () => void refresh();
    chrome.storage.onChanged.addListener(listen);
    return () => chrome.storage.onChanged.removeListener(listen);
  }, [refresh]);
  useEffect(() => {
    const apply = () =>
      (document.documentElement.dataset.theme =
        state.settings.theme === "system"
          ? matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark"
          : state.settings.theme);
    const mq = matchMedia("(prefers-color-scheme: light)");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [state.settings.theme]);
  useEffect(
    () => () => {
      if (toastRef.current) clearTimeout(toastRef.current);
    },
    [],
  );
  const changeSettings = async (next: Partial<Settings>) => {
    try {
      const settings = await saveSettings({ ...state.settings, ...next });
      setState((s) => ({ ...s, settings }));
    } catch (e) {
      notify(friendly(e));
    }
  };
  const run = async <K extends RpcCommand>(
    type: K,
    payload?: RpcMap[K]["req"],
    success?: string,
  ) => {
    try {
      await (rpc as (cmd: K, data?: RpcMap[K]["req"]) => Promise<unknown>)(
        type,
        payload,
      );
      await refresh();
      if (success) notify(success);
    } catch (e) {
      notify(friendly(e));
    }
  };
  const openCollection = async () => {
    if (!page || expanding || state.jobs.some(activeJobs)) return;
    setExpanding(true);
    try {
      const result = await getPage(true);
      if (!result?.collection.tracks.length)
        throw new Error(
          "На этой странице пока нет композиций. Откройте альбом или плейлист.",
        );
      setCollection(result.collection);
    } catch (e) {
      notify(friendly(e));
    } finally {
      setExpanding(false);
    }
  };
  const active = state.jobs.filter(activeJobs),
    completed = state.jobs.filter((j) => !activeJobs(j)),
    saved = state.jobs.reduce(
      (n, j) => n + j.items.filter((i) => i.status === "complete").length,
      0,
    );
  const collectionActive =
    !!active[0] &&
    active[0].kind !== "page" &&
    active[0].title === page?.collection.title;
  const navigate = (next: Tab) => {
    setTab(next);
    setError("");
  };
  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand />
        <div className="header-actions">
          <IconButton label="Настройки" onClick={() => navigate("settings")}>
            <SlidersHorizontal size={19} />
          </IconButton>
        </div>
      </header>
      <nav className="tabs" aria-label="Разделы расширения">
        {(
          [
            { id: "home", label: "Главная", icon: House },
            { id: "downloads", label: "Загрузки", icon: ArrowDownToLine },
            { id: "history", label: "История", icon: Clock3 },
            { id: "settings", label: "Настройки", icon: Settings2 },
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => navigate(id)}
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
          >
            <span>{label}</span>
            {id === "downloads" && active.length > 0 && (
              <i className="nav-count">{active.length}</i>
            )}
          </button>
        ))}
      </nav>
      <main>
        {error && (
          <div className="error-banner" role="alert">
            <CircleAlert size={17} />
            <span>{error}</span>
            <IconButton label="Скрыть ошибку" onClick={() => setError("")}>
              <X size={15} />
            </IconButton>
          </div>
        )}
        {tab === "home" && (
          <HomeView
            loading={loading}
            page={page}
            active={active}
            collectionActive={collectionActive}
            expanding={expanding}
            saved={saved}
            installed={installed}
            onOpenCollection={() => void openCollection()}
            onOpenMusic={() => void run("OPEN_MUSIC")}
            onNavigate={navigate}
          />
        )}
        {tab === "downloads" && (
          <DownloadsView
            jobs={state.jobs}
            activeCount={active.length}
            onNavigate={navigate}
            onCancel={(id) =>
              void run("CANCEL_JOB", { id }, "Загрузка отменена")
            }
            onRetry={(id) => void run("RETRY", { id }, "Повторяем загрузку")}
            onShow={(id) => void run("SHOW_FILE", { id })}
          />
        )}
        {tab === "history" && (
          <HistoryView
            completed={completed}
            saved={saved}
            retryDisabled={active.length > 0}
            onRetry={(id) => void run("RETRY", { id })}
            onShow={(id) => void run("SHOW_FILE", { id })}
            onClear={() => void run("CLEAR_HISTORY", {}, "История очищена")}
          />
        )}
        {tab === "settings" && (
          <SettingsView
            librarySetup={librarySetup}
            settings={state.settings}
            tokenPresent={state.tokenPresent}
            active={active.length > 0}
            onChangeSettings={(next) => void changeSettings(next)}
            onRefresh={() => void refresh()}
            notify={notify}
          />
        )}
      </main>
      <footer className="app-footer">
        <span className="footer-tag">Независимое расширение</span>
        <span>1.0.0</span>
      </footer>
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <CheckCircle2 size={17} />
          <span>{toast}</span>
          <button aria-label="Закрыть уведомление" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {collection && (
        <DownloadDialog
          collection={collection}
          settings={state.settings}
          activeJob={active[0]}
          onClose={() => setCollection(null)}
          onStart={async (tracks, settings) => {
            await rpc("ENQUEUE", {
              title: collection.title,
              kind: collection.kind,
              tracks,
              settings,
            });
            setCollection(null);
            navigate("downloads");
            await refresh();
            notify("Загрузка началась");
          }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
