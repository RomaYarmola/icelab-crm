# Розклад приймання заявок (Supabase Cron)

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

## Перевірити

- `select * from cron.job where jobname = 'intake-retry';` показує розклад.
- `select * from net._http_response order by created desc limit 5;` показує відповіді застосунку (200 чи 401).
- На екрані «Прийом заявок» видно, чи бот підключений; повідомлення зі статусом «нове» старше хвилини означають, що розклад не працює.

## Вимкнути

```sql
select cron.unschedule('intake-retry');
```
