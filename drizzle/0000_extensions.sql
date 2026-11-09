-- Розширення, потрібні схемі. Створюємо до таблиць, бо індекс пошуку клієнтів за назвою
-- (clients_name_trgm_idx) використовує клас операторів gin_trgm_ops.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
