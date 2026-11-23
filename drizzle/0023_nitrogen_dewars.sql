ALTER TABLE "client_own_boxes" ADD COLUMN "kind" text DEFAULT 'ice' NOT NULL;--> statement-breakpoint
ALTER TABLE "box_types" ADD COLUMN "kind" text DEFAULT 'ice' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_own_boxes" ADD CONSTRAINT "client_own_boxes_kind_ok" CHECK ("client_own_boxes"."kind" in ('ice', 'dewar'));--> statement-breakpoint
ALTER TABLE "box_types" ADD CONSTRAINT "box_types_kind_ok" CHECK ("box_types"."kind" in ('ice', 'dewar'));
--> statement-breakpoint
-- Рідкий азот (D176): кг, виробляє цех, поштою не відправляємо (лише самовивіз і власна доставка).
INSERT INTO "products" ("code", "name", "kind", "unit", "produced_by_workshop", "allowed_delivery_methods", "sort")
VALUES ('nitrogen', 'Рідкий азот', 'other', 'кг', true, ARRAY['pickup', 'our_delivery'], 3)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
-- Тара для азоту: сосуд Дьюара, наш і клієнта, аналогічно до боксів (Роман, 23.11.2026).
INSERT INTO "box_types" ("code", "name", "kind", "is_returnable", "is_client_owned", "sort")
VALUES ('dewar', 'Сосуд Дюара', 'dewar', true, false, 7)
ON CONFLICT ("code") DO NOTHING;
