# Розклад ранкових нагадувань (Supabase Cron)

Для B14 потрібен один розклад (ТЗ 7.7, 8.7). Адресу викликаємо кожні 30 хвилин, а застосунок сам складає й надсилає нагадування один раз на день, не раніше 09:00 за Києвом (так не залежимо від літнього часу).

## Що потрібно

1. Змінна `CRON_SECRET` у Vercel і той самий секрет у Supabase Vault під назвою `cron_secret` (уже налаштовано для monobank і Нової Пошти).
2. Адреса застосунку, наприклад `https://icelab-crm.vercel.app`.
3. Міграція `0028` застосована.

## Як увімкнути (SQL Editor у Supabase)

```sql
select cron.schedule(
  'reminders',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://icelab-crm.vercel.app/api/cron/reminders',
    headers := jsonb_build_object(
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 30000
  );
  $$
);
```

Вимкнути: `select cron.unschedule('reminders');`.

## Що робить виклик

1. До 09:00 і після того, як сьогодні вже відпрацював, нічого не робить.
2. Складає нагадування: клієнт давно не замовляв і бокси довго в клієнта (менеджеру клієнта, без менеджера власникам; не частіше ніж раз на 7 днів), нерозпізнані платежі (бухгалтерам, без них власникам; раз на день).
3. Тим, хто прив'язав бота, надсилає одне повідомлення в Telegram зі списком і посиланням на «Аналітика → Нагадування».
4. Без Telegram нагадування лишаються в застосунку. Клієнтам нічого не надсилається.

Прив'язати Telegram: власник на екрані «Прийом заявок» створює код, людина надсилає боту `/start КОД`. Екран пропонує коди менеджерам, власникам, водіям і бухгалтерам.

## Перевірити

```sql
select jobname, active from cron.job where jobname = 'reminders';
select status_code, created from net._http_response order by created desc limit 5;
```

Код 200 означає, що все гаразд; 401: `cron_secret` не збігається з `CRON_SECRET`.
