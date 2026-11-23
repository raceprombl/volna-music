<p align="center">
  <img src="docs/assets/wordmark-animated.gif" alt="VOLNA" width="520">
</p>

<p align="center"><b>Yandex Music downloader for Chrome and Edge. Быстро, без превью и лишних папок.</b></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-ff9f1c" alt="version 1.0.0">
  <img src="https://img.shields.io/badge/Chrome%20%C2%B7%20Edge-Manifest%20V3-2563eb" alt="Chrome · Edge Manifest V3">
  <img src="https://img.shields.io/badge/TypeScript%20%C2%B7%20React%2019%20%C2%B7%20Vite%206-3178c6" alt="TypeScript · React 19 · Vite 6">
  <img src="https://img.shields.io/badge/MP3%20%C2%B7%20AAC%2FMP4%20%C2%B7%20FLAC%20%C2%B7%20ZIP64-16a34a" alt="MP3 · AAC/MP4 · FLAC · ZIP64">
  <img src="https://img.shields.io/badge/tests-123%20passing-16a34a" alt="123 tests passing">
  <a href="THIRD_PARTY_NOTICES.md"><img src="https://img.shields.io/badge/license-MIT-555" alt="MIT"></a>
</p>

Обычные загрузчики для Yandex Music тянут треки по одному, молча сохраняют 30-секундные превью вместо полных версий и раскидывают музыку по куче вложенных папок.

**VOLNA** это быстрое расширение (Yandex Music downloader) для Chrome и Edge на Manifest V3, которое скачивает доступные незашифрованные треки, альбомы, плейлисты и "Мне нравится" из Яндекс Музыки. Внутри многопоточная очередь, загрузка в 8 сегментов с проверкой `If-Range`, потоковый ZIP64 до 10 ГБ, теги MP3/FLAC, обложки и тексты `.lrc`.

## Установка

```sh
git clone https://github.com/raceprombl/volna-music.git
cd volna-music
npm ci
npm run build
```

Откройте `chrome://extensions` (или `edge://extensions`), включите режим разработчика, нажмите "Загрузить распакованное расширение" и выберите папку `dist/`.

Собрать готовый архив расширения:

```sh
npm run package    # создаёт volna-1.0.0.zip
```

## Как пользоваться

Откройте Яндекс Музыку. Кнопка VOLNA появится прямо на страницах треков, альбомов и плейлистов, а очередь и настройки живут в окне расширения.

| сценарий | что делает | куда сохраняет |
|---|---|---|
| Одиночный трек | качает полный файл, дописывает теги, обложку и `.lrc` | `VOLNA/Треки/` |
| "Мне нравится" | подгружает метаданные пачками по 50 и качает в несколько потоков | `VOLNA/Мне нравится/` |
| Альбом, плейлист или артист | сохраняет всю подборку с нумерацией или без | `VOLNA/<Название>/` |
| Режим ZIP64 | собирает архив до 10 ГБ на лету, не раздувая память | `VOLNA/<Название>.zip` |
| Тексты и обложки | тянутся параллельно с аудио и не тормозят скачивание | рядом (`.lrc`/`.txt`) и в тегах |

## Проверка, а не на глаз

Перед сохранением расширение сверяет реальную длительность файла с каталогом через `verifyFullAudio()`. Если вместо полной песни прилетело превью на 15 или 30 секунд, такой файл не попадёт на диск. Для MP3, FLAC (`STREAMINFO`) и AAC/MP4 (`moov -> mvhd` v0/v1) длительность считается прямо по байтам меньше чем за 0.05 мс, без создания DOM `<audio>` и лишнего IPC в браузере.

Сегменты при многопоточной загрузке проверяются по `Range` и `If-Range`, а на ответ `429` клиент честно ждёт `Retry-After`. В режиме архива `StreamZip` пишет чанками не больше 1 MiB (в тестах прогоняется потоковый ZIP64 на 10 GiB), работает напрямую с `Uint8Array` без лишних копий через `Blob` и считает CRC32 таблицей slicing-by-4.

Токен и данные сессии остаются только в вашем профиле браузера. Внешних серверов и телеметрии нет.

## Скорость

| часть пайплайна | как устроено | что даёт |
|---|---|---|
| Очередь | от 1 до 16 воркеров (по умолчанию 12) и `ConnectionPool(24)` | канал загружается на максимум на больших плейлистах |
| Multipart CDN | 8 сегментов от `2 MiB`, `hedgeMs: 150`, один общий `Uint8Array` | ускоряет тяжёлые FLAC/MP4 и не выделяет память дважды |
| Предзагрузка | `SourceBroker` (`parallel: 6`, `lookahead: 16`) и батчи метаданных по 50 | воркеры не ждут ссылки на аудио и ответы `/tracks` |
| Проверка длительности | бинарные парсеры MP3, FLAC и MP4 | `< 0.05 мс` на трек вместо `<audio>` |
| Потоковый ZIP64 | slicing-by-4 CRC32 (`~545 MB/s` в V8) и `Uint8Array.subarray` | 10 GiB ZIP64 проходит за `~13 с` без скачков RAM |
| Подпись и сессия | кэш `CryptoKey` и последней вкладки `lastMusicTabId` | без повторных `importKey` и лишних `chrome.tabs.query` |

## Устройство проекта

| модуль | за что отвечает |
|---|---|
| [`src/offscreen.ts`](src/offscreen.ts) | очередь загрузок, воркеры, запись ZIP64 и сохранение файлов |
| [`src/engine-item.ts`](src/engine-item.ts) | скачивание трека, пачки метаданных, тексты, обложка и теги |
| [`src/media-client.ts`](src/media-client.ts) | HTTP/Range клиент, 8-сегментный multipart, пул соединений и hedged-запросы |
| [`src/audio-duration.ts`](src/audio-duration.ts) | бинарный расчёт длительности MP3, FLAC, MP4 и защита от превью |
| [`src/stream-zip.ts`](src/stream-zip.ts) | потоковый ZIP64 с slicing-by-4 CRC32 и лимитом `<= 1 MiB` на запись |
| [`src/web-provider.ts`](src/web-provider.ts) | получение ссылок на треки, HMAC-подпись, тексты и метаданные |
| [`src/background.ts`](src/background.ts) | service worker MV3, состояние задач, typed RPC ([`src/rpc.ts`](src/rpc.ts)) и auth-мост |
| [`src/content.ts`](src/content.ts) | кнопки скачивания в интерфейсе Яндекс Музыки |
| [`src/ui/`](src/ui) | popup на React 19: прогресс, настройки качества и папок |

## Команды для разработки

```sh
npm test           # 18 файлов, 123 теста (Vitest 5)
npm run build      # tsc --noEmit и сборка Vite в dist/
npm run package    # сборка и упаковка volna-1.0.0.zip
```

## Примечание и лицензия

Неофициальное расширение для личного офлайн-прослушивания доступных незашифрованных треков. Используйте с учётом правил сервиса и законов вашей страны.

MIT. Список сторонних библиотек лежит в [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
