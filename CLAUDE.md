# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Глобальные правила
→ ~/.claude/ai-system/global.md

## Контекст проекта
→ .ai/ (читай в порядке: memory → context → tech → design → overrides)

## База паттернов
→ ~/.claude/ai-system/starter-kit/patterns/ — проверять relevant-файл перед реализацией.

---

## Project Overview

**Terminal Prototyper** — веб-инструмент для сборки простых интерактивных прототипов
(как в Figma) из картинок/видео и их воспроизведения на платёжных терминалах (P10, Android +
Chrome) с записью тапов в тепловые карты. Редактор работает на ПК, плеер (PWA) — в браузере
терминала по локальной Wi-Fi. Терминалы разных моделей и разрешений (вкл. квадратный) →
всё адаптивно, координаты нормализованы. Работает онлайн и офлайн.

## Commands
```bash
npm run dev      # сервер :5174 + Vite :5173 (HMR)
npm run build    # статический билд клиента → dist/
npm start        # прод: сервер отдаёт dist на :5174 (так открывают терминалы)
```
> Авто-тестов пока нет — проверка вручную в браузере.

## Architecture

### Tech Stack
- **Framework:** React 18 + Vite 5 + TypeScript (клиент); Node + Express (сервер)
- **Styling:** CSS + токены (`client/src/styles/tokens.css`) — НЕ хардкодить значения
- **State:** `useState` страниц (server state) + IndexedDB-очередь (`db.ts`, офлайн)
- **DB / Backend:** файловый стор `server/store.js` (JSON + NDJSON в `data/`)

> Не добавлять новые зависимости без обсуждения.

### Source Layout
```
server/{index.js, store.js}
client/src/{styles/, components/ui/, pages/, api.ts, db.ts, heatmap.ts, types.ts}
```

### Layer Rules
| Слой | Где | Можно | Нельзя |
|------|-----|-------|--------|
| UI | components/, pages | рендер, локальный стейт, вызов api.ts/db.ts | прямой fetch, логика хранения |
| Logic | api.ts, db.ts, heatmap.ts | сеть, очередь, рендер canvas | JSX |
| API | server/index.js | валидация, маршрут, стор | UI-логика |
| Data | server/store.js | файлы, дедуп | знание про HTTP/React |

### Data Flow
```
Component → api.ts/db.ts → /api → store.js → диск
тап → db.enqueue (IndexedDB) → фоновый flush → POST /events (дедуп по id)
```

## Hard Constraints
- Не хардкодить цвета/размеры — только токены.
- Эмодзи как иконки запрещены — только `components/ui/Icon`.
- Минимум `border`: разделять фоном/тенью/воздухом (см. `.ai/design.md`).
- Тач-контекст-меню (плеер) — Sheet, не dropdown. Деструктив — подтверждение Modal.
- `fetch` из страниц — только через `api.ts`.

## Environment Variables
```env
PORT=5174           # порт сервера (terminals)
HTTPS_PORT=5175     # если есть data/certs/{key,cert}.pem
NODE_ENV=production # отдача dist + SPA-fallback
```
