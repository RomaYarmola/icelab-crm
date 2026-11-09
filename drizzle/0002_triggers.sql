-- Автоматичні дії бази: час зміни, автор запису, сума замовлення, історія статусів, журнал змін.
--
-- Хто виконує зміну: сервер у кожній транзакції виставляє параметри app.actor_id (uuid профілю)
-- і за потреби app.change_note (примітка), див. src/db/actor.ts. Порожнє значення означає
-- системну зміну. Параметри діють лише в межах транзакції.

CREATE FUNCTION current_actor() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.actor_id', true), '')::uuid $$;
--> statement-breakpoint

CREATE FUNCTION current_change_note() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.change_note', true), '') $$;
--> statement-breakpoint

-- Час останньої зміни рядка.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- Автор запису, якщо він не заданий явно.
CREATE FUNCTION set_created_by() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := current_actor();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- Сума замовлення = сума позицій. Перераховується після кожної зміни в order_items.
CREATE FUNCTION recalc_order_total() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE orders
       SET total = coalesce((SELECT sum(amount) FROM order_items WHERE order_id = NEW.order_id), 0)
     WHERE id = NEW.order_id;
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id) THEN
    UPDATE orders
       SET total = coalesce((SELECT sum(amount) FROM order_items WHERE order_id = OLD.order_id), 0)
     WHERE id = OLD.order_id;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- Історія статусів: запис про створення (from_status порожній) і про кожну зміну статусу.
CREATE FUNCTION log_order_status() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
    VALUES (NEW.id, NULL, NEW.status, current_actor(), current_change_note());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
    VALUES (NEW.id, OLD.status, NEW.status, current_actor(), current_change_note());
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- Журнал змін. Аргумент тригера: назва колонки первинного ключа (за замовчуванням id).
-- Створення: непорожні поля (new). Зміна: лише змінені поля (old і new). Видалення: поля (old).
-- Зміна, що торкнулася тільки updated_at, у журнал не потрапляє.
CREATE FUNCTION audit_row_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pk_column text := coalesce(TG_ARGV[0], 'id');
  row_key text;
  changes jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    row_key := to_jsonb(NEW) ->> pk_column;
    SELECT coalesce(jsonb_object_agg(n.key, jsonb_build_object('new', n.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(to_jsonb(NEW)) AS n
     WHERE n.key NOT IN ('created_at', 'updated_at') AND n.value <> 'null'::jsonb;
  ELSIF TG_OP = 'UPDATE' THEN
    row_key := to_jsonb(NEW) ->> pk_column;
    SELECT coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(to_jsonb(NEW)) AS n
      LEFT JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
     WHERE n.key <> 'updated_at' AND n.value IS DISTINCT FROM o.value;
    IF changes = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  ELSE
    row_key := to_jsonb(OLD) ->> pk_column;
    SELECT coalesce(jsonb_object_agg(o.key, jsonb_build_object('old', o.value)), '{}'::jsonb)
      INTO changes
      FROM jsonb_each(to_jsonb(OLD)) AS o
     WHERE o.key NOT IN ('created_at', 'updated_at') AND o.value <> 'null'::jsonb;
  END IF;

  INSERT INTO audit_log (table_name, row_id, action, actor_id, diff)
  VALUES (TG_TABLE_NAME, row_key, lower(TG_OP)::audit_action, current_actor(), changes);
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- Час останньої зміни: на всіх таблицях з колонкою updated_at.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'locations', 'profiles', 'ice_types', 'box_types', 'order_sources', 'client_statuses',
    'client_applications', 'settings', 'default_prices', 'clients', 'client_contacts',
    'client_addresses', 'client_prices', 'orders', 'order_items'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- Автор запису: на таблицях з колонкою created_by.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients', 'client_contacts', 'client_addresses', 'client_prices', 'orders', 'order_items'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION set_created_by()',
      t || '_set_created_by', t
    );
  END LOOP;
END
$$;
--> statement-breakpoint

CREATE TRIGGER order_items_recalc_total
  AFTER INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION recalc_order_total();
--> statement-breakpoint

CREATE TRIGGER orders_log_status
  AFTER INSERT OR UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION log_order_status();
--> statement-breakpoint

-- Журнал змін для таблиць цього блоку. Решту таблиць з переліку ТЗ підключаємо в їхніх блоках.
CREATE TRIGGER clients_audit
  AFTER INSERT OR UPDATE OR DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint

CREATE TRIGGER client_prices_audit
  AFTER INSERT OR UPDATE OR DELETE ON client_prices
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint

CREATE TRIGGER orders_audit
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint

CREATE TRIGGER order_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint

CREATE TRIGGER profiles_audit
  AFTER INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint

CREATE TRIGGER settings_audit
  AFTER INSERT OR UPDATE OR DELETE ON settings
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('key');
