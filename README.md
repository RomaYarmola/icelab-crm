# CRM IceLab

Веб-застосунок (PWA) для обліку клієнтів, замовлень, виробничих завдань, оборотної тари (боксів), відправок Новою Поштою та оплат для виробника сухого льоду. Дві локації: Київ і Львів. Інтерфейс українською.

Стек: Next.js 16 (App Router, TypeScript), Supabase (Postgres, Auth, RLS, Realtime), Drizzle ORM, Vercel.

Статус і план робіт: [docs/PLAN.md](docs/PLAN.md). Прийняті технічні рішення: [docs/decisions.md](docs/decisions.md).

## Вимоги

- Node.js 26 (версія зафіксована в `.nvmrc` і `engines`)
- npm (разом з Node)
- Доступ до проєкту Supabase `icelab-dev` (база для розробки)

Docker, pnpm і Supabase CLI не потрібні: локальної бази немає, застосунок працює з хмарним dev-проєктом.

## Швидкий старт

```bash
npm install
cp .env.example .env.local
```

Заповніть `.env.local` значеннями з проєкту `icelab-dev` (Supabase: кнопка Connect і Settings, API Keys). Файл не потрапляє в git. Потім:

```bash
npm run dev
```

Застосунок відкриється на http://localhost:3000. Перевірка підключення до бази: http://localhost:3000/api/health (очікується `{"status":"ok","db":"ok",...}`).

## Змінні середовища

Усі змінні описані в [.env.example](.env.example) із поясненням, у якому блоці кожна потрібна. Застосунок перевіряє їх під час першого звернення (`src/env.ts`) і повідомляє імена некоректних змінних, але не їхні значення.

Секрети лежать тільки у Vercel (staging і production) та в локальному `.env.local`. У репозиторії їх немає.

## Скрипти

| Команда | Що робить |
|---|---|
| `npm run dev` | Запуск для розробки |
| `npm run build` / `npm start` | Збірка і запуск збірки |
| `npm run lint` | ESLint |
| `npm run typecheck` | Перевірка типів TypeScript |
| `npm test` / `npm run test:watch` | Тести Vitest |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run db:generate` | Згенерувати міграцію зі схеми Drizzle |
| `npm run db:migrate` | Застосувати міграції до бази з `DATABASE_URL` |
| `npm run db:studio` | Drizzle Studio |

CI (GitHub Actions) на кожен PR запускає lint, typecheck, format:check, тести і збірку.

## Середовища

| Середовище | Код | База | Де змінні |
|---|---|---|---|
| dev | `APP_ENV=dev` | Supabase `icelab-dev` (безкоштовний проєкт) | `.env.local` |
| staging | `APP_ENV=staging` | Supabase `icelab-staging` (безкоштовний проєкт) | Vercel, Preview |
| prod | `APP_ENV=prod` | Supabase `icelab-prod` (Pro) | Vercel, Production |

Кожен PR автоматично розгортається на Vercel як preview і працює зі staging-базою. Гілка `main` розгортається в production. Регіон функцій Vercel: `fra1` (Франкфурт), база Supabase теж у Франкфурті.

## Структура

```
src/app/        сторінки і route handlers (Next.js App Router)
src/db/         підключення до бази і схема Drizzle (src/db/schema)
src/lib/        спільні утиліти
src/server/     серверна логіка (сервіси, інтеграції)
src/features/   модулі за предметними областями
drizzle/        згенеровані SQL-міграції (з'являться в блоці B1)
docs/           план, рішення, докладні плани блоків
```

## База даних

Схема описана в `src/db/schema/` (Drizzle), міграції лежать у `drizzle/`: `0000` розширення, `0001` таблиці, `0002` тригери й функції, `0003` час записів журналів. Огляд рішень: [docs/decisions.md](docs/decisions.md).

| Команда | Що робить |
|---|---|
| `npm run db:generate` | Створює міграцію зі змін у схемі. Для тригерів і функцій: `npx drizzle-kit generate --custom --name=<назва>` і далі пишемо SQL вручну |
| `npm run db:migrate` | Застосовує міграції до бази з `DATABASE_URL` |
| `npm run db:seed` | Додає початкові дані довідників. Повторний запуск нічого не змінює і не перезаписує правок |
| `npm run db:reset -- --yes` | Лише для dev: видаляє всі таблиці, застосовує міграції й seed |
| `npm run db:smoke` | Перевіряє структуру й тригери на справжній базі в транзакції, яку скасовує (дані не лишаються). Запускати після міграцій |

**Автор змін.** Усі записи в базу з серверного коду робимо через `withActor`, щоб тригери знали, хто змінив дані:

```ts
await withActor(getDb(), user.id, (tx) =>
  tx.update(orders).set({ status: "confirmed" }).where(eq(orders.id, orderId)),
  { note: "Причина зміни (за потреби)" },
);
```

**Тести бази** (`tests/db/`) працюють на PGlite: Postgres у пам'яті, без Docker і без підключення до хмари. Вони застосовують ті самі міграції, тож перевіряють реальну структуру. Запуск: `npm test`.

## Відновлення з резервної копії

Процедура буде описана в блоці B8 (резервні копії й експорт).
