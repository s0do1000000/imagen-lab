# Imagen Lab — бот-генератор картинок

Telegram-бот и Mini App: пишете текст — получаете картинку через Gemini 2.5
Flash Image (Vertex AI / Agent Platform), с тратой ваших облачных кредитов
Google Cloud. Работает и прямо в чате с ботом, и через мини-приложение
(кнопка "Открыть галерею").

Технологии: Next.js на Vercel (без Docker) · Supabase (база + хранение
картинок) · Telegraf (бот, вебхук) · Vertex AI (генерация).

## 0. Что уже понадобится

- Проект Google Cloud с привязанными кредитами (у вас уже есть)
- Аккаунт [supabase.com](https://supabase.com)
- Аккаунт [vercel.com](https://vercel.com)
- Бот в Telegram через [@BotFather](https://t.me/BotFather) (`/newbot`,
  сохраните токен)

## 1. Service account с JSON-ключом

Ключи сервисных аккаунтов по умолчанию заблокированы политикой
организации. Нужно снять запрет **один раз**:

1. [console.cloud.google.com/iam-admin/orgpolicies](https://console.cloud.google.com/iam-admin/orgpolicies)
   → найдите **"Disable service account key creation"**
2. Edit → отключите для вашего проекта (Override parent's policy → Off /
   Google default is not enforced) → Save

Затем создайте сервисный аккаунт:

1. [console.cloud.google.com/iam-admin/serviceaccounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
   → **Create service account** → имя, например `imagen-bot`
2. На шаге ролей добавьте **Vertex AI User** (может отображаться как
   **Agent Platform User** — это та же роль `roles/aiplatform.user`)
3. Откройте созданный аккаунт → вкладка **Keys** → **Add key** → **Create
   new key** → JSON → скачается файл
4. Откройте файл в блокноте, скопируйте **всё содержимое одной строкой**
   (это и есть значение `GOOGLE_SERVICE_ACCOUNT_JSON` ниже)

⚠️ Никому не показывайте этот файл — он даёт полный доступ к генерации от
имени вашего проекта.

## 2. Supabase

1. Создайте проект на [supabase.com](https://supabase.com)
2. **SQL Editor** → вставьте содержимое `supabase/schema.sql` → Run
3. **Storage** → **New bucket** → имя `generations` → включите **Public
   bucket** → Create
4. **Project Settings → API** — сохраните:
   - `Project URL` → это `NEXT_PUBLIC_SUPABASE_URL`
   - `service_role` секретный ключ → это `SUPABASE_SERVICE_ROLE_KEY`

## 3. Переменные окружения

Скопируйте `.env.local.example` в `.env.local` и заполните:

```
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
TELEGRAM_BOT_TOKEN=...
NEXT_PUBLIC_APP_URL=https://ваш-проект.vercel.app   # заполните после деплоя
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}   # ОДНОЙ строкой
GOOGLE_CLOUD_PROJECT_ID=project-04659f6b-9be6-4ebc-b15
DAILY_GENERATION_LIMIT=15
```

**Важное про регион:** в коде (`lib/vertex-ai.ts`) специально используется
эндпоинт с `locations/global`, а не `us-central1` — модель
`gemini-2.5-flash-image` отдаёт 404 на региональных эндпоинтах прямо
сейчас. Если Google это поменяет и появится 404 — первое, что проверять.

## 4. Деплой на Vercel

1. Залейте папку проекта в GitHub-репозиторий (или используйте
   `vercel` CLI: `npm i -g vercel`, затем `vercel` в этой папке)
2. На [vercel.com/new](https://vercel.com/new) импортируйте репозиторий
3. **Settings → Environment Variables** — добавьте все переменные из
   шага 3 (кроме `NEXT_PUBLIC_APP_URL` — его заполните ПОСЛЕ первого
   деплоя, когда узнаете реальный адрес, затем передеплойте)
4. Deploy

## 5. Подключить вебхук бота

После деплоя (адрес вида `https://ваш-проект.vercel.app`) откройте в
браузере:

```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://ваш-проект.vercel.app/api/telegram
```

Ответ `{"ok":true,...}` значит, что бот подключён.

## 6. Подключить Mini App кнопку в BotFather

1. Откройте [@BotFather](https://t.me/BotFather) → выберите вашего бота
   → **Bot Settings → Menu Button** → **Configure menu button**
2. Укажите URL: `https://ваш-проект.vercel.app`
3. Название кнопки, например: `🖼 Открыть`

Теперь у бота внизу чата появится кнопка, открывающая мини-приложение.

## Локальная разработка (без деплоя)

```
npm install
npm run bot:dev   # бот через long polling, без вебхука и без Vercel
```

Mini App локально можно смотреть через `npm run dev` (localhost:3000), но
Telegram-функции (initData) внутри обычного браузера работать не будут —
для полноценной проверки Mini App нужен реальный деплой.

## Настройка лимита

`DAILY_GENERATION_LIMIT` в `.env.local` / Vercel — сколько картинок в
сутки разрешено одному пользователю. Защищает ваши кредиты от случайного
исчерпания. Меняйте и передеплойте, если нужно другое число.

## Структура проекта

```
app/
  page.tsx              — экран "Рисовать" (главный)
  gallery/page.tsx       — экран "Галерея"
  api/telegram/route.ts  — вебхук бота
  api/generate/route.ts  — генерация из Mini App
  api/gallery/route.ts   — список картинок пользователя
components/
  PromptForm.tsx          — форма генерации
  GalleryGrid.tsx          — сетка галереи
  BottomNavigation.tsx     — нижняя навигация
lib/
  vertex-ai.ts             — вызов Gemini 2.5 Flash Image
  generate-image.ts        — общая логика (лимит + генерация + сохранение)
  bot.ts                   — Telegraf-бот
  telegram.ts              — проверка initData (защита от подделки)
  supabase-server.ts        — клиент Supabase (сервер)
supabase/schema.sql        — SQL-схема базы
```
