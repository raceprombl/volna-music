<p align="center">
  <img src="docs/assets/wordmark.svg" alt="VOLNA" width="520">
</p>

<p align="center"><b>Музыка с собой. На максимальной скорости, без превью и лишних папок.</b></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-ff9f1c" alt="version 1.0.0">
  <img src="https://img.shields.io/badge/Chrome%20%C2%B7%20Edge-Manifest%20V3-2563eb" alt="Chrome · Edge Manifest V3">
  <img src="https://img.shields.io/badge/TypeScript%20%C2%B7%20React%2019%20%C2%B7%20Vite%206-3178c6" alt="TypeScript · React 19 · Vite 6">
  <img src="https://img.shields.io/badge/MP3%20%C2%B7%20AAC%2FMP4%20%C2%B7%20FLAC%20%C2%B7%20ZIP64-16a34a" alt="MP3 · AAC/MP4 · FLAC · ZIP64">
  <img src="https://img.shields.io/badge/tests-123%20passing-16a34a" alt="123 tests passing">
  <a href="THIRD_PARTY_NOTICES.md"><img src="https://img.shields.io/badge/license-MIT-555" alt="MIT"></a>
</p>

Большинство загрузчиков тянут треки по одному в один поток, молча сохраняют 30-секундные превью вместо полных версий и разбрасывают файлы по десяткам вложенных папок.

**VOLNA** — расширение Chrome/Edge (Manifest V3) для скачивания доступных незашифрованных треков, альбомов, плейлистов и «Мне нравится» из Яндекс Музыки. Многопоточная загрузка, 8-сегментный multipart с проверкой `If-Range`, стриминговый ZIP64 до 10 ГБ, бинарная проверка длительности, ID3/FLAC-теги, обложки и синхронизированные тексты `.lrc`.

## Install

```sh
git clone https://github.com/raceprombl/volna-music.git
cd volna-music
npm ci
npm run build
```

Затем откройте `chrome://extensions` (или `edge://extensions`), включите **Режим разработчика** и нажмите **Загрузить распакованное расширение** → выберите папку `dist/`.

Для сборки готового архива расширения:

```sh
npm run package    # создаёт volna-1.0.0.zip
```

## Use

Откройте Яндекс Музыку в браузере — кнопка **VOLNA** встраивается прямо в интерфейс страниц, альбомов, плейлистов и треков, а очередь и настройки доступны из popup-окна расширения.

| сценарий | что делает | куда сохраняет |
|---|---|---|
| Одиночный трек | качает полный аудиофайл, пишет теги, обложку и `.lrc` | `VOLNA/Треки/` |
| «Мне нравится» | батч-гидратация метаданных + параллельная очередь | `VOLNA/Мне нравится/` |
| Альбом / плейлист / артист | качает всю коллекцию с нумерацией или без | `VOLNA/<Название>/` |
| Режим ZIP64 | потоковая сборка архива до 10 ГБ без переполнения RAM | `VOLNA/<Название>.zip` |
| Тексты и обложки | грузятся параллельно с аудиопотоком, без блокировки трека | рядом (`.lrc`/`.txt`) и внутрь тегов |

## Proof, not vibes

Ни один трек не сохраняется «на веру»:

- **Защита от 15–30 сек превью**: `verifyFullAudio()` сверяет реальную длительность файла с каталожной. Для **MP3**, **FLAC** (`STREAMINFO`) и **AAC/MP4** (`moov → mvhd` v0/v1) длительность вычисляется бинарно за `< 0.05 мс` — без создания DOM `<audio>` и IPC в медиа-демуксер Chromium.
- **Целостность сегментов**: multipart-загрузка использует строгую проверку `Range` / `If-Range` и контрольные границы чанков, а при `429` честно уважает `Retry-After`.
- **Потоковый ZIP64**: `StreamZip` пишет чанками не больше `1 MiB` (подтверждено тестом на 10 GiB ZIP64), принимает `Uint8Array` без лишнего копирования через `Blob` и считает CRC32 таблицей slicing-by-4.
- **Локальность**: токен и сессия хранятся только локально в профиле браузера, без внешних серверов и телеметрии.

## Performance

Оптимизации критического пути загрузки и упаковки:

| узел пайплайна | как работает | эффект |
|---|---|---|
| Параллельность очереди | `1..16` воркеров (по умолчанию `12`) + `ConnectionPool(24)` | полная утилизация канала на плейлистах |
| Multipart CDN | 8 параллельных сегментов от `2 MiB`, `hedgeMs: 150`, один общий `Uint8Array` | до 8× быстрее на крупных FLAC/MP4, без двойного выделения RAM |
| Lookahead источников | `SourceBroker` (`parallel: 6`, `lookahead: 16`) + предзагрузка батчей метаданных по 50 | воркеры не простаивают в ожидании URL и `/tracks` |
| Проверка длительности | бинарные парсеры MP3 / FLAC / MP4 | `< 0.05 мс` на трек вместо DOM `<audio>` |
| Потоковый ZIP64 | slicing-by-4 CRC32 (`~545 MB/s` в V8) + zero-copy `Uint8Array.subarray` | 10 GiB ZIP64 стриминг за `~13 с` без скачков памяти |
| Подпись и сессия | кэшированный `CryptoKey` + кэш активной вкладки `lastMusicTabId` | без повторных `importKey` и лишних `chrome.tabs.query` |

## Architecture

| модуль | ответственность |
|---|---|
| [`src/offscreen.ts`](src/offscreen.ts) | движок очереди, воркеры, bounded-очередь записи ZIP64, сохранение в Downloads / OPFS |
| [`src/engine-item.ts`](src/engine-item.ts) | жизненный цикл трека: батч-метаданные, параллельные lyrics/artwork, тегирование |
| [`src/media-client.ts`](src/media-client.ts) | адаптивный HTTP/Range клиент, 8-сегментный multipart, `ConnectionPool`, hedged-запросы |
| [`src/audio-duration.ts`](src/audio-duration.ts) | бинарные парсеры длительности MP3 / FLAC / MP4 и защита от превью |
| [`src/stream-zip.ts`](src/stream-zip.ts) | потоковый ZIP64-writer с slicing-by-4 CRC32 и лимитом `<= 1 MiB` на запись |
| [`src/web-provider.ts`](src/web-provider.ts) | резолв источников, HMAC-подпись, тексты и метаданные |
| [`src/background.ts`](src/background.ts) | service worker MV3, состояние задач, typed RPC ([`src/rpc.ts`](src/rpc.ts)), auth-мост |
| [`src/content.ts`](src/content.ts) | интеграция кнопок в SPA Яндекс Музыки |
| [`src/ui/`](src/ui) | React 19 popup, прогресс в реальном времени, настройки качества и папок |

## Development

```sh
npm test           # 18 test files / 123 tests (Vitest 5)
npm run build      # tsc --noEmit + Vite production build -> dist/
npm run package    # build + упаковка volna-1.0.0.zip
```

## Disclaimer & License

Неофициальный клиент для личного офлайн-прослушивания доступных незашифрованных аудиопотоков. Используйте в соответствии с условиями сервиса и законодательством вашей юрисдикции.

MIT · сторонние зависимости и уведомления указаны в [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
