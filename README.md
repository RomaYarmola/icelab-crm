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

Секрети лежать тільки у Vercel (змінні для Production і Preview) та в локальному `.env.local`. У репозиторії їх немає.

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
| `npm run db:seed` | Додати початкові довідники (нічого не перезаписує) |
| `npm run db:smoke` | Перевірка структури, тригерів і закритих прав на справжній базі (у транзакції з відкатом) |
| `npm run db:reset -- --yes` | Скинути dev-базу (лише `APP_ENV=dev`) |
| `npm run user:create -- --email=... --name=... --role=...` | Створити користувача (перший власник); пароль записується у файл `.dev-users.local` |
| `npm run user:seed-dev -- --email-template="a+{role}@gmail.com"` | Створити в dev по одному тестовому користувачу на кожну роль |
| `npm run clients:seed-dev` | Додати в dev вигаданих клієнтів «Тест: …» (`-- --bulk` ще 35, `-- --remove` видалити). База одна з Production: лише після погодження |
| `npm run orders:seed-dev` | Додати в dev демонстраційні замовлення (спершу демо-клієнти; `-- --remove` видалити). База одна з Production: лише після погодження |
| `npm run check:bundle` | Після `npm run build`: перевірити, що серверних секретів немає у файлах для браузера |
| `npx tsx scripts/generate-pwa-icons.ts` | Створити значки застосунку (PWA) зі знака IceLab; потрібно лише після зміни логотипа |
| `npm run env:check` | Перевірити змінні в `.env.local`: для кожної лише «задано чи ні» і вид ключа, значень не виводить |

CI (GitHub Actions) на кожен PR запускає lint, typecheck, format:check, тести, збірку і `check:bundle`.

## Вхід і користувачі

Два способи входу (Supabase Auth): e-mail і пароль та Google (Gmail). Самостійної реєстрації немає: користувачів створює власник, листів система не надсилає, пароль задає і скидає власник. Вхід за паролем має обмеження спроб (5 невдалих на e-mail за 15 хвилин, 20 з однієї адреси клієнта). Через Google входить лише той, кого власник додав у систему за його адресою Gmail (`npm run user:create -- ... --no-password`); сторонній Gmail не потрапить. Роль і локацію користувача беремо з таблиці `profiles` на кожен запит. Браузер не ходить у таблиці бази напряму: ролям Supabase `anon` і `authenticated` права на таблиці прибрано, усі дані йдуть через сервер.

Налаштування Supabase для нового проєкту: Authentication, вимкнути самостійну реєстрацію; ліміти в Rate Limits не змінювати (див. D20 у `docs/decisions.md`); увімкнути провайдера Google (Client ID і Client Secret з Google Cloud, адреса повернення Supabase `https://<project-ref>.supabase.co/auth/v1/callback`); у URL Configuration додати адреси застосунку в Redirect URLs: `http://localhost:3000/**`, `https://icelab-crm.vercel.app/**` (Production), `https://*-romayarmolas-projects.vercel.app/**` (прев'ю PR); окремого домену для CRM не буде (D39). Якщо адреси якогось середовища немає в списку, Supabase після Google веде не на `/auth/callback`, і сторінка входу відкривається знову без жодного повідомлення. Перший власник: `npm run user:create` (див. таблицю вище). Докладно: [docs/blocks/B2-auth.md](docs/blocks/B2-auth.md).

## Середовища

Окремих баз `icelab-staging` і `icelab-prod` поки немає, тому всі три середовища тимчасово працюють з однією базою `icelab-dev` (рішення D22 у [docs/decisions.md](docs/decisions.md)). Плани: Vercel Hobby і безкоштовний Supabase (D28).

| Середовище | Де працює | База | Де змінні |
|---|---|---|---|
| Локально | `http://localhost:3000` | Supabase `icelab-dev` | `.env.local` |
| Preview | прев'ю кожного PR на Vercel | Supabase `icelab-dev` (тимчасово) | Vercel, Preview |
| Production | `https://icelab-crm.vercel.app`, гілка `main` | Supabase `icelab-dev` (тимчасово) | Vercel, Production |

Кожен PR автоматично розгортається на Vercel як preview. Гілка `main` розгортається в Production. Регіон функцій Vercel: `fra1` (Франкфурт), база Supabase теж у Франкфурті.

Змінна `APP_ENV` (`dev`, `staging` або `prod`) потрібна захисним скриптам: `db:reset`, `user:seed-dev`, `clients:seed-dev` і `orders:seed-dev` працюють лише при `APP_ENV=dev`, а `user:create` в інших середовищах вимагає `--yes`.

**Поки Production і Preview на `icelab-dev`:**

- Справжніх даних клієнтів у систему не вносимо: `npm run db:reset` стирає dev-базу повністю.
- Vercel міграції не запускає (`build` це лише `next build`). Міграції з PR застосовуємо до `icelab-dev` вручну командою `npm run db:migrate`, до злиття PR.
- Коли з'явиться `icelab-prod` (безкоштовний проєкт в організації замовника, D28): замінити у Vercel для Production значення чотирьох змінних (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`), створити там власника (`npm run user:create -- ... --yes`), налаштувати Supabase (самореєстрація вимкнена, Google, Redirect URLs) і створити окремий OAuth-клієнт Google для бойової адреси.
- `icelab-staging` (безкоштовний проєкт, у тій самій організації, що й `icelab-dev`) для Preview створимо до того, як у системі з'являться справжні дані.

## Структура

```
src/app/                     сторінки і route handlers (Next.js App Router); (app) це розділи після входу
src/components/shared/       повторно використовувані компоненти за групами (buttons, titles, form, ...)
src/components/<назва>Page/  компоненти конкретної сторінки (loginPage, morePage, ...)
src/constants/               константи і списки (назви статусів, розділи меню)
src/utils/                   чисті функції (cn, формат дат і чисел, меню за ролями)
src/db/                      підключення до бази і схема Drizzle (src/db/schema)
src/lib/                     клієнти й допоміжні модулі (Supabase, адреса клієнта)
src/server/                  серверна логіка: права, вхід, користувачі, локація, журнал помилок
src/instrumentation.ts       запис помилок сервера в таблицю error_log (Next.js onRequestError)
public/sw.js                 service worker: кеш статики і сторінка «Немає зв'язку» (public/offline.html)
drizzle/                     SQL-міграції
tests/                       тести (Vitest)
docs/                        план, рішення, докладні плани блоків, варіанти дизайну
```

## Інтерфейс

Інтерфейс збирається з компонентів-«цеглинок» у `src/components/shared`, як у nbyg-front: окрема папка на групу (`buttons`, `titles`, `texts`, `form`, `customizedInput`, `chips`, `notification`, ...), файл на компонент (`MainButton.tsx`), default export, `className` приймається і зливається через `cn` (`src/utils/cn.ts`).

Усі кольори, розміри тексту, закруглення, брейкпоінти й фокус задаються в одному місці, `src/app/globals.css` (Tailwind 4, `@theme inline`). Брейкпоінти: `xs` 27rem, далі стандартні `sm` 640, `md` 768, `lg` 1024, `xl` 1280. Телефон (PWA) це все, що менше `lg`, комп'ютер (веб) від `lg`. Hover діє лише від `lg`. Курсор-«пойнтер» на всьому клікабельному і плавність (один ефект для наведення, натиснення і фокуса, `--transition-duration` у `:root`) теж задані лише в `globals.css`: у компонентах пишемо `transition`, без `duration-*` і `ease-*`.

Застосунок на телефоні (PWA): маніфест `src/app/manifest.ts`, значки в `public/icons` і `src/app`, service worker `public/sw.js` реєструється лише у збірці. Він кешує тільки статику, сторінки з даними не кешуються (D34). Помилки сервера пишуться в таблицю `error_log` (D40). Ручна перевірка блока: [docs/blocks/B3-checklist.md](docs/blocks/B3-checklist.md).

Клієнти і ціни (B4): розділ «Клієнти» (пошук, картка з контактами, адресами й цінами, об'єднання дублів), екран «Прайс» у «Ще → Прайс». Код клієнта це область і номер («АА16»), його видає сервер (D42). Рішення D42–D50 у [docs/decisions.md](docs/decisions.md), ручна перевірка: [docs/blocks/B4-checklist.md](docs/blocks/B4-checklist.md).

Живий каталог усіх компонентів: `npm run dev`, потім http://localhost:3000/ui-kit. Перегляд оболонки для будь-якої ролі: `/ui-kit/shell/manager` (`owner`, `manager`, `location_lead`, `production`, `accountant`). Екрани клієнтів і прайсу з вигаданими даними: `?screen=clients`, `client` (`&tab=contacts|addresses|prices`), `new-client`, `prices`, `merge`; замовлення: `order-list`, `order`, `new-order`, `edit-order` (`&status=draft|confirmed|…|cancelled`). Ручна перевірка замовлень: [docs/blocks/B5-checklist.md](docs/blocks/B5-checklist.md). Обидва адреси відкриті лише в режимі розробки, у збірці закриті. Правила: [docs/decisions.md](docs/decisions.md), D37.

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

Безкоштовний Supabase резервних копій не робить, тому ми робимо власні щоденні зашифровані копії. Схема, відновлення й кроки налаштування: [docs/backups.md](docs/backups.md) (блок B7a). До появи справжніх даних бойової бази копії налаштовуємо обов'язково.
