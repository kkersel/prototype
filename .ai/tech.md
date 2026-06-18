# Технический контекст

## Стек

| | Название | Версия | Причина выбора |
|-|---------|--------|----------------|
| Язык | TypeScript | 5.5 | типобезопасность клиента |
| Сервер | Node + Express | 22 / 4.x | простой локальный сервер на ПК |
| UI | React | 18 | привычно, экосистема |
| Сборка | Vite | 5 | быстрый dev + статический билд |
| Стили | CSS + токены (CSS-переменные) | — | без рантайм-зависимостей, без хардкода |
| Роутинг | react-router-dom | 6 | SPA-маршруты editor/play/heatmaps |
| Холст редактора | @xyflow/react (React Flow) | 12 | все экраны на полотне + стрелки-связи (Figma-like) |
| Хранилище (сервер) | файловый стор (JSON + NDJSON) | — | без нативных зависимостей, прозрачно на диске |
| Хранилище (клиент) | IndexedDB | — | офлайн-очередь тапов |
| Загрузка медиа | multer | 2.x | картинки/видео |

Запрещено добавлять новые зависимости без обсуждения (анти-паттерн #2).

---

## Архитектура

### Структура проекта
```
server/
  index.js        # Express: API + статика (prod) + uploads; http(+https если есть сертификаты)
  store.js        # файловый стор: prototypes/*.json, events/*.ndjson, uploads/*
client/src/
  styles/         # tokens.css (дизайн-токены) + global.css (база, утилиты, компоненты)
  components/ui/  # дизайн-система: примитивы (Button, Field, Modal, Sheet, Segmented, Icon, ...)
  pages/          # Home, Editor, Player, Heatmaps
  api.ts          # тонкий клиент REST
  db.ts           # IndexedDB-очередь + фоновый синк
  heatmap.ts      # рендер тепловой карты на canvas
  types.ts        # доменные типы (Prototype, Screen, Hotspot, TapEvent, ...)
```

### Слои (Allowed / Forbidden)
| Слой | Где | Можно | Нельзя |
|------|-----|-------|--------|
| **UI** | components/, pages | рендер, локальный стейт, вызов api.ts/db.ts | бизнес-правила хранения, прямой fetch в обход api.ts |
| **Logic/Client** | api.ts, db.ts, heatmap.ts | сетевые вызовы, очередь, рендер данных | разметка/JSX |
| **API** | server/index.js | валидация, маршрут, вызов стора | UI-логика |
| **Data** | server/store.js | чтение/запись файлов, дедуп | знание про HTTP/React |

### Движение данных
```
Component → api.ts/db.ts → /api → store.js → диск
Плеер: тап → db.enqueue (IndexedDB) → фоновый flush → POST /events (дедуп по id)
```

### State management
- **Server state**: запрашивается напрямую через `api.ts`, держится в `useState` страниц (объём мал, react-query не нужен).
- **Offline-очередь**: `db.ts` (IndexedDB), синк по таймеру и событию `online`.
- **Локальный UI**: `useState` — выбор экрана/зоны, модалки, режимы тепловой карты.

### Критичные правила (источник истины — сервер/стор)
- Дедуп событий по `id` — в `store.appendEvents` (идемпотентность импорта/ресинка).
- `prototypeId` события проставляется сервером, не доверяем клиенту.
> Не обходить дедуп из UI.

---

## API
Base: тот же origin. Формат ошибок: HTTP-коды 400/404/503 + `{ error }`.

- `GET /api/prototypes` — список (сводки)
- `POST /api/prototypes` — создать; `POST /api/prototypes/import` — импорт документа (новый id)
- `GET|PUT|DELETE /api/prototypes/:id` — чтение/сохранение/удаление
- `POST /api/upload` — загрузка медиа (multipart) → `{ url, type, mime }`
- `POST /api/prototypes/:id/events` — батч тапов (дедуп) ; `GET .../events?screen=&sessions=`
- `GET /api/prototypes/:id/sessions` — сводка по сессиям

---

## Hard constraints
- Не хардкодить цвета/размеры в компонентах — только токены из `styles/tokens.css`.
- Не вызывать `fetch` из страниц в обход `api.ts`.
- Медиа и логи — только под `data/` (gitignore).
- Эмодзи не используем как иконки — только набор `components/ui/Icon`.

## Деплой
Локально на ПК: `npm run build && npm start` → `http://<IP-ПК>:5174`. Терминалы — по Wi-Fi.
Опционально HTTPS (service worker офлайн) — сертификаты в `data/certs/` (mkcert).
