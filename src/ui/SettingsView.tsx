import { Check, Monitor, Moon, Settings2, Sun } from "lucide-react";
import type { Format, Settings } from "../types";
import { Brand, formats, Switch } from "./primitives";
import { LibrarySettings } from "./LibrarySettings";
import { TokenSettings } from "./TokenSettings";

export function SettingsView({
  librarySetup,
  settings,
  tokenPresent,
  active,
  onChangeSettings,
  onRefresh,
  notify,
}: {
  librarySetup: boolean;
  settings: Settings;
  tokenPresent: boolean;
  active: boolean;
  onChangeSettings: (next: Partial<Settings>) => void;
  onRefresh: () => void;
  notify: (text: string) => void;
}) {
  return (
    <section
      className={`view settings-view ${librarySetup ? "folder-setup" : ""}`}
      aria-labelledby="settings-title"
    >
      <div className="page-heading">
        <h1 id="settings-title">
          {librarySetup ? "Папка «Треки»" : "Настройки"}
          <Settings2 size={24} strokeWidth={1.3} />
        </h1>
        <p>
          {librarySetup
            ? "Подключи папку один раз. Дальше номера выравниваются сами."
            : "Подстрой VOLNA под себя."}
        </p>
      </div>
      <div className="settings-section">
        <h2>Оформление</h2>
        <div className="theme-picker" aria-label="Тема интерфейса">
          {(
            [
              { value: "dark", label: "Тёмная", icon: Moon },
              { value: "light", label: "Светлая", icon: Sun },
              { value: "system", label: "Системная", icon: Monitor },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              className={settings.theme === value ? "selected" : ""}
              aria-pressed={settings.theme === value}
              onClick={() => onChangeSettings({ theme: value })}
            >
              <Icon size={18} />
              {label}
              {settings.theme === value && <Check size={13} />}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-section">
        <h2>Загрузки по умолчанию</h2>
        <label className="select-setting">
          <span>Формат</span>
          <select
            value={settings.format}
            onChange={(e) =>
              onChangeSettings({ format: e.target.value as Format })
            }
          >
            {formats.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label} · {f.note}
              </option>
            ))}
          </select>
        </label>
        <label className="select-setting">
          <span>Качество</span>
          <select
            value={settings.quality}
            onChange={(e) =>
              onChangeSettings({
                quality: e.target.value as Settings["quality"],
              })
            }
          >
            <option value="best">Лучшее доступное</option>
            <option value="192">До 192 кбит/с</option>
            <option value="128">До 128 кбит/с</option>
          </select>
        </label>
        <label className="select-setting">
          <span>Потоки загрузки</span>
          <select
            value={settings.concurrency}
            onChange={(e) =>
              onChangeSettings({ concurrency: Number(e.target.value) })
            }
          >
            {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="select-setting">
          <span>Размер обложки</span>
          <select
            value={settings.coverSize}
            onChange={(e) =>
              onChangeSettings({
                coverSize: Number(e.target.value) as Settings["coverSize"],
              })
            }
          >
            {[400, 600, 800, 1000].map((size) => (
              <option key={size} value={size}>
                {size} × {size}
              </option>
            ))}
          </select>
        </label>
        <label className="select-setting">
          <span>Логи расширения</span>
          <select
            value={settings.logLevel}
            onChange={(e) =>
              onChangeSettings({
                logLevel: e.target.value as Settings["logLevel"],
              })
            }
          >
            <option value="off">Выключены</option>
            <option value="error">Только ошибки</option>
            <option value="warn">Ошибки и предупреждения</option>
            <option value="info">Информационные</option>
            <option value="debug">Debug</option>
          </select>
        </label>
        <Switch
          label="Один ZIP-архив"
          checked={settings.zip}
          onChange={(zip) => onChangeSettings({ zip })}
        />
        <Switch
          label="Нумерация треков"
          description="В том же порядке, что и в плейлисте"
          checked={settings.numbering}
          onChange={(numbering) => onChangeSettings({ numbering })}
        />
        <Switch
          label="Обложки"
          description="В MP3 и отдельным файлом внутри ZIP"
          checked={settings.covers}
          onChange={(covers) => onChangeSettings({ covers })}
        />
        <Switch
          label="Автоматические теги"
          description="MP3 / FLAC: исполнитель, альбом, год и жанр"
          checked={settings.metadata}
          onChange={(metadata) => onChangeSettings({ metadata })}
        />
        <Switch
          label="Текст трека в тегах"
          description="Для MP3 и FLAC при включённых тегах"
          checked={settings.lyricsTags}
          onChange={(lyricsTags) => onChangeSettings({ lyricsTags })}
        />
        <Switch
          label="Сохранять текст в файл"
          description="Доступный текст в .lrc или .txt рядом с треком"
          checked={settings.lyricsFile}
          onChange={(lyricsFile) => onChangeSettings({ lyricsFile })}
        />
        <Switch
          label="Спецсимволы в именах"
          description="Похожие Unicode-символы вместо запрещённых"
          checked={settings.unicodeFilenames}
          onChange={(unicodeFilenames) =>
            onChangeSettings({ unicodeFilenames })
          }
        />
        <Switch
          label="Структурировать библиотеку"
          description="Папка по названию для отдельных файлов и «Треки» для одиночных"
          checked={settings.structuredFolders}
          onChange={(structuredFolders) =>
            onChangeSettings({ structuredFolders })
          }
        />
        <label className="input-setting">
          <span>Папка в «Загрузках»</span>
          <input
            aria-label="Папка загрузок"
            defaultValue={settings.folder}
            maxLength={60}
            onBlur={(e) => onChangeSettings({ folder: e.target.value })}
          />
        </label>
      </div>
      <LibrarySettings active={active} notify={notify} />
      <TokenSettings
        present={tokenPresent}
        onChange={onRefresh}
        notify={notify}
      />
      <div className="settings-about">
        <Brand small />
        <p>
          Независимое расширение для Яндекс Музыки.
          <br />
          Не обходит DRM. Не собирает аналитику.
        </p>
        <span>Версия 1.0.0</span>
      </div>
    </section>
  );
}
