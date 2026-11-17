# Розклад приймання заявок і вечірнього зведення (Supabase Cron)

Розбір заявки йде одразу після відповіді Telegram (рішення D138). Якщо функція впала чи не встигла, повідомлення лишається «новим», і запасний розклад добирає його. Вмикаємо **лише на бойовій базі**, як і розклад Нової Пошти ([np-cron.md](np-cron.md)), із тим самим секретом `cron_secret` у Vault і `CRON_SECRET` у Vercel.

## Увімкнути (SQL Editor у Supabase, бойова база)

```sql
-- Запасний розбір заявок щохвилини: бере повідомлення, що чекають довше за хвилину.
select cron.schedule(
  'intake-retry',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://icelab-crm.vercel.app/api/cron/intake-retry',
    headers := jsonb_build_object(
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);
```

За один виклик береться до трьох повідомлень (кожне це виклик Claude до 20 секунд). Коли нічого не застрягло, відповідь приходить одразу.

## Вечірнє зведення власнику

Адресу викликаємо **кожні півгодини**, а зведення піде один раз на день, коли за київським часом настане час із налаштування `report.daily_time` (за замовчуванням 21:00). Supabase рахує час за UTC, і саме тому розклад не прив'язаний до години: літній і зимовий час нічого не ламають.

```sql
select cron.schedule(
  'daily-report',
  '0,30 * * * *',
  $$
  select net.http_post(
    url := 'https://icelab-crm.vercel.app/api/cron/daily-report',
    headers := jsonb_build_object(
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 30000
  );
  $$
);
```

Зведення йде в чат власника з налаштування «Чат власника» на екрані «Прийом заявок» (його записує `/start` власника в особистому чаті з ботом). Поки чату немає, відповідь розкладу `{"sent":false,"reason":"no_chat"}`. Інші відповіді: `not_yet` (ще рано), `already` (сьогодні вже надіслано), `failed` (Telegram не відповів, наступний виклик повторить).

## Перевірити

- `select * from cron.job where jobname in ('intake-retry', 'daily-report');` показує розклади.
- `select * from net._http_response order by created desc limit 5;` показує відповіді застосунку (200 чи 401).
- На екрані «Прийом заявок» видно, чи бот підключений; повідомлення зі статусом «нове» старше хвилини означають, що розклад не працює.

## Вимкнути

```sql
select cron.unschedule('intake-retry');
select cron.unschedule('daily-report');
```
