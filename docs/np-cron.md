# Розклад Нової Пошти на бойовій базі (Supabase Cron)

Для B10 потрібні два розклади (рішення D29): оновлення довідників і трекінг накладних. Вмикаємо їх **лише на бойовій базі**, на `icelab-dev` усе запускається кнопками на екрані «Нова Пошта».

## Що потрібно

1. Змінна `CRON_SECRET` у Vercel (довгий випадковий рядок, позначити як sensitive). Адреси розкладу без неї завжди відповідають 401.
2. Той самий секрет у Supabase Vault під назвою `cron_secret`.
3. Адреса застосунку, наприклад `https://icelab-crm.vercel.app` (поки без постійного домену; зміниться разом із ним).

## Як увімкнути (SQL Editor у Supabase, бойова база)

Розширення `pg_cron` і `pg_net` доступні на безкоштовному проєкті. Секрет читаємо з Vault, у тексті розкладу його немає.

```sql
-- Трекінг накладних кожні 15 хвилин.
select cron.schedule(
  'np-tracking',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://icelab-crm.vercel.app/api/cron/np-tracking',
    headers := jsonb_build_object(
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 10000
  );
  $$
);

-- Довідники: щодоби о 04:00 починаємо, далі кожні 2 хвилини до 04:30 продовжуємо (один виклик бере
-- кілька сторінок, коли довідники свіжі, відповідь приходить одразу).
select cron.schedule(
  'np-directories',
  '*/2 4 * * *',
  $$
  select net.http_post(
    url := 'https://icelab-crm.vercel.app/api/cron/np-directories',
    headers := jsonb_build_object(
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 10000
  );
  $$
);
```

Час `pg_cron` за UTC: 04:00 UTC це 06:00 чи 07:00 у Києві. Це підходить: у цей час замовлень ще немає. Щоб змінити, поправте години в розкладі.

## Як перевірити

- `select * from cron.job;` показує два розклади.
- `select * from cron.job_run_details order by start_time desc limit 10;` показує запуски.
- `select * from net._http_response order by created desc limit 10;` показує відповіді застосунку (200 чи 401).
- На екрані «Нова Пошта» є час останнього оновлення довідників і час останнього трекінгу.

## Як вимкнути

```sql
select cron.unschedule('np-tracking');
select cron.unschedule('np-directories');
```

Якщо проєкт Supabase призупиниться (безкоштовний план), розклад зупиниться теж, і статуси накладних перестануть оновлюватись. Тоді «Оновити статуси зараз» на екрані «Нова Пошта» підтягне їх вручну.
