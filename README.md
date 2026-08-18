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

Больше нет дневного лимита — теперь у каждого пользователя баланс
генераций (`users.credits` в базе): 1 бесплатная при регистрации, дальше
покупка пакетов через Telegram Stars или TON. Настраивается в
`lib/pricing.ts` — цены пакетов и стоимость видео в генерациях (по
умолчанию видео = 3, картинка/фото = 1).

## Монетизация

Есть два способа оплаты, оба настроены сразу:

**Telegram Stars** — работает из коробки, без дополнительной настройки.
Telegram берёт свою комиссию (обычно около 30% с мобильных платформ) и
задерживает вывод на 21 день — это его стандартные условия, изменить
нельзя.

**USDT в сети TON (крипта)** — комиссия меньше (~1-2%), деньги приходят
сразу, курс не "гуляет" (USDT привязан к доллару). Требует:
1. Получить TON-адрес в некастодиальном кошельке — Tonkeeper, MyTonWallet
   или @wallet. Нужен только публичный адрес, не приватный ключ
2. Добавить `TON_WALLET_ADDRESS` в переменные окружения на Vercel
3. Получить бесплатный API-ключ на [tonconsole.com](https://tonconsole.com)
   (нужен для проверки платежей через TonAPI) → добавить как `TONAPI_KEY`
4. Добавить свой Telegram ID как `TELEGRAM_ADMIN_ID` (узнать через
   @userinfobot) — включает команду `/credit`, ручное начисление

⚠️ **Честная оговорка:** проверка платежей в USDT (`lib/ton.ts`) обращается
к TonAPI, который декодирует токен-переводы в удобный формат — но точную
структуру ответа для этого конкретного случая не удалось протестировать
на живом платеже при написании кода. **Перед тем как давать ссылку на
оплату реальным людям — сделайте один тестовый платёж на маленькую сумму
сами** и проверьте, что баланс пополнился автоматически. Если через
минуту не сработало — команда `/credit <telegram_id> <количество>`
(только для вас, через `TELEGRAM_ADMIN_ID`) начислит генерации вручную, а
в логах функции на Vercel (Vercel → Deployments → Logs) будет видна
причина — сырые данные транзакции для отладки.

Важный юридический нюанс: правило Telegram обязывает использовать Stars
только для покупок **внутри** приложения Telegram (в чате бота или Mini
App). Оплата USDT у нас происходит на **отдельной внешней странице**
(`/pay/[id]`), открытой обычной ссылкой, а не как Mini App — поэтому это
не подпадает под требование Stars. Страница специально не использует
Telegram WebApp SDK, чтобы сохранить этот статус "снаружи" приложения.
Не превращайте эту страницу в кнопку `web_app` в боте — она должна
открываться обычной ссылкой.

Проверка оплаты происходит вручную/периодически — пользователь после
отправки платежа нажимает кнопку "Я оплатил" на странице `/pay/[id]`,
которая также сама перепроверяет раз в 8 секунд. Ручная/периодическая
проверка вместо автоматического вебхука — потому что бесплатный уровень
Vercel не даёт фоновых процессов; для готового продукта можно добавить
Vercel Cron.

## Структура проекта

```
app/
  page.tsx                — экран "Рисовать" (главный)
  edit/page.tsx           — экран "Фото" (редактирование)
  video/page.tsx          — экран "Видео"
  gallery/page.tsx        — экран "Галерея"
  pay/[id]/page.tsx       — внешняя страница оплаты TON (не Mini App!)
  api/telegram/route.ts   — вебхук бота
  api/generate/route.ts   — генерация картинки из Mini App
  api/edit/route.ts       — редактирование фото из Mini App
  api/video/route.ts      — генерация видео из Mini App
  api/gallery/route.ts    — список картинок пользователя
  api/orders/[id]/route.ts — статус/проверка заказа TON
components/
  PromptForm.tsx          — форма генерации картинки
  EditForm.tsx            — форма редактирования фото
  VideoForm.tsx           — форма генерации видео
  GalleryGrid.tsx          — сетка галереи
  PayStatus.tsx            — внешняя страница оплаты TON
  BottomNavigation.tsx     — нижняя навигация
lib/
  vertex-ai.ts             — вызов Gemini 2.5 Flash Image (картинки/фото)
  veo.ts                   — вызов Veo (видео)
  generate-image.ts        — общая логика (баланс + генерация + сохранение)
  pricing.ts               — пакеты и цены
  orders.ts                — заказы TON
  ton.ts                   — проверка платежей в блокчейне TON
  bot.ts                   — Telegraf-бот
  bot-session-store.ts      — состояние между сообщениями (фото/видео режим)
  telegram.ts              — проверка initData (защита от подделки)
  supabase-server.ts        — клиент Supabase (сервер)
supabase/schema.sql        — SQL-схема базы
```
