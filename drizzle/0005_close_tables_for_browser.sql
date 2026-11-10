-- B2 (рішення D19): браузер не ходить у таблиці напряму, усі дані йдуть через сервер.
-- Ролям Supabase `anon` (не увійшов) і `authenticated` (увійшов) прибираємо всі права на наші
-- таблиці, послідовності й функції. RLS на таблицях лишається увімкненим. Сервер працює з прямим
-- підключенням до бази (роль-власник), тому на нього це не впливає.
-- Якщо таких ролей немає (не Supabase), міграція нічого не робить.
-- Функції з розширень (наприклад, pg_trgm) не чіпаємо.
DO $$
DECLARE
	browser_roles text;
	fn record;
BEGIN
	SELECT string_agg(quote_ident(rolname), ', ') INTO browser_roles
		FROM pg_roles
		WHERE rolname IN ('anon', 'authenticated');
	IF browser_roles IS NULL THEN
		RETURN;
	END IF;

	EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %s', browser_roles);
	EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %s', browser_roles);
	EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %s', browser_roles);

	-- Майбутні таблиці, послідовності й функції в public теж не відкриваємо за замовчуванням.
	EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %s', browser_roles);
	EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %s', browser_roles);
	EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %s', browser_roles);

	-- Postgres за замовчуванням дозволяє виконувати функції всім (PUBLIC), тому для наших функцій
	-- право забираємо і в PUBLIC.
	FOR fn IN
		SELECT p.oid::regprocedure AS signature
			FROM pg_proc p
			WHERE p.pronamespace = 'public'::regnamespace
				AND NOT EXISTS (
					SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
				)
	LOOP
		EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.signature);
	END LOOP;
END
$$;
