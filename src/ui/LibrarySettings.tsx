import { useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { friendly, rpc } from "../shared";
import {
  connectLibrary,
  disconnectLibrary,
  getLibraryDirectory,
  libraryStatus,
  type LibraryDirectory,
} from "../library";
import { installed } from "./bridge";

export function LibrarySettings({
  active,
  notify,
}: {
  active: boolean;
  notify: (text: string) => void;
}) {
  const [folder, setFolder] = useState<{
    connected: boolean;
    name?: string;
    permission: PermissionState;
  }>({ connected: false, permission: "prompt" });
  const [busy, setBusy] = useState(false);
  const directoryRef = useRef<LibraryDirectory | undefined>(undefined);
  const fullPage =
    new URLSearchParams(location.search).get("folder") === "connect";
  const refreshFolder = async () => {
    try {
      const [directory, status] = await Promise.all([
        getLibraryDirectory(),
        libraryStatus(),
      ]);
      directoryRef.current = directory;
      setFolder(status);
    } catch {}
  };
  useEffect(() => {
    void refreshFolder();
  }, []);
  const connect = async () => {
    if (!fullPage) {
      try {
        await rpc("OPEN_LIBRARY_SETTINGS");
      } catch (e) {
        notify(friendly(e));
      }
      return;
    }
    const picker = (
      window as Window & {
        showDirectoryPicker?: (options: {
          mode: string;
          id: string;
        }) => Promise<LibraryDirectory>;
      }
    ).showDirectoryPicker;
    if (!picker) {
      notify("Выбор папки доступен в Chrome / Edge на компьютере.");
      return;
    }
    setBusy(true);
    try {
      // Call directly from the click, before any awaits, preserving user activation.
      let handle: LibraryDirectory;
      if (
        folder.connected &&
        folder.permission !== "granted" &&
        directoryRef.current
      ) {
        handle = directoryRef.current;
        // This call is made from the click, with no asynchronous work before it.
        if (
          (await handle.requestPermission({ mode: "readwrite" })) !== "granted"
        )
          throw new Error("Chrome не разрешил доступ к папке.");
      } else
        handle = await picker.call(window, {
          mode: "readwrite",
          id: "volna-tracks",
        });
      await connectLibrary(handle);
      const result = await rpc("SORT_LIBRARY");
      notify(`Папка подключена: ${result.count} песен`);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") notify(friendly(e));
    } finally {
      setBusy(false);
      void refreshFolder();
    }
  };
  return (
    <div className="settings-section token-form library-settings">
      <h3>
        <FolderOpen size={17} /> Папка «Треки» и номера
      </h3>
      <p>
        Перед скачиванием читаем файлы в выбранной папке и выравниваем номера.
        Одна песня с номером 07 станет 01, следующая получит 02. Вложенные папки
        не меняем.
      </p>
      <p className={folder.permission === "granted" ? "success" : "muted"}>
        {folder.connected
          ? folder.permission === "granted"
            ? "Подключено · сортировка включена"
            : "Нужно восстановить доступ к папке"
          : "Папка ещё не подключена"}
      </p>
      <button
        className="button subtle wide"
        disabled={!installed || active || busy}
        onClick={() => void connect()}
      >
        <FolderOpen size={16} />
        <span>
          {busy
            ? "Сортируем…"
            : folder.connected
              ? folder.permission !== "granted"
                ? "Восстановить доступ к папке"
                : "Выбрать другую папку"
              : fullPage
                ? "Выбрать папку «Треки»"
                : "Подключить папку «Треки»"}
        </span>
      </button>
      {folder.permission === "granted" && (
        <button
          className="text-button"
          disabled={active || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await rpc("SORT_LIBRARY");
              notify(`Номера выровнены · ${r.count} песен`);
            } catch (e) {
              notify(friendly(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Выровнять номера сейчас
        </button>
      )}
      {folder.connected && (
        <button
          className="text-button"
          disabled={active || busy}
          onClick={async () => {
            try {
              await disconnectLibrary();
              await refreshFolder();
              notify("Автосортировка отключена");
            } catch (e) {
              notify(friendly(e));
            }
          }}
        >
          Отключить папку
        </button>
      )}
      <p className="fine-print">
        Выбери именно папку «Треки». Chrome один раз запросит чтение и изменение
        её файлов. Новые одиночные песни будут сохраняться в неё; существующие
        аудиофайлы и их тексты получат последовательные номера.
      </p>
      {folder.connected && folder.permission !== "granted" && (
        <p className="fine-print">
          В запросе Chrome можно разрешить доступ при каждом посещении до
          самостоятельного отключения разрешения.
        </p>
      )}
    </div>
  );
}
