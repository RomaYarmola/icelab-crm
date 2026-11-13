import { describe, expect, it } from "vitest";
import {
  buildChanges,
  collectRefs,
  describeAuditEntry,
  emptyNames,
  formatAuditValue,
} from "@/server/audit-format";
import { AUDIT_TABLES } from "@/server/audit-labels";

const field = (table: string, column: string) => AUDIT_TABLES[table]!.fields[column]!;
const names = () => {
  const n = emptyNames();
  n.client.set("c1", "АА15 Кафе «Вогник»");
  n.user.set("u1", "Олена Коваль");
  return n;
};

describe("журнал: значення простими словами (D90)", () => {
  it("кг, гроші, ціна за кг, відсотки, числа з пробілами й комою", () => {
    const n = emptyNames();
    expect(formatAuditValue(field("orders", "kg_sold"), "30.000", n)).toBe("30 кг");
    expect(formatAuditValue(field("orders", "kg_sold"), "22.500", n)).toBe("22,5 кг");
    expect(formatAuditValue(field("orders", "total"), "2250.00", n)).toBe("2 250 ₴");
    expect(formatAuditValue(field("orders", "price_per_kg_snapshot"), "75.00", n)).toBe("75 ₴/кг");
    expect(formatAuditValue(field("orders", "markup_percent_applied"), "10.00", n)).toBe("10%");
    expect(formatAuditValue(field("orders", "box_count"), 12000, n)).toBe("12 000");
  });

  it("дати, час за Києвом, так/ні, порожнє", () => {
    const n = emptyNames();
    expect(formatAuditValue(field("orders", "order_date"), "2026-11-13", n)).toBe("13.11.2026");
    expect(
      formatAuditValue(field("orders", "confirmed_at"), "2026-11-13T12:05:00.123456+00:00", n),
    ).toBe("13.11.2026, 14:05");
    expect(formatAuditValue(field("orders", "price_manual"), true, n)).toBe("так");
    expect(formatAuditValue(field("orders", "price_manual"), false, n)).toBe("ні");
    expect(formatAuditValue(field("orders", "comment"), null, n)).toBe("порожньо");
    expect(formatAuditValue(field("orders", "comment"), "", n)).toBe("порожньо");
  });

  it("переліки словами, ідентифікатори назвами, невідомий запис позначено", () => {
    const n = names();
    expect(formatAuditValue(field("orders", "status"), "in_production", n)).toBe("У виробництві");
    expect(formatAuditValue(field("orders", "delivery_method"), "np", n)).toBe("Нова Пошта");
    expect(formatAuditValue(field("orders", "client_id"), "c1", n)).toBe("АА15 Кафе «Вогник»");
    expect(formatAuditValue(field("orders", "confirmed_by"), "u1", n)).toBe("Олена Коваль");
    expect(formatAuditValue(field("orders", "client_id"), "nope", n)).toBe("запис видалено");
    expect(formatAuditValue(field("orders", "status"), "щось_нове", n)).toBe("щось_нове");
  });

  it("довгий текст обрізається, налаштування в JSON показуються стисло", () => {
    const n = emptyNames();
    expect(formatAuditValue(field("orders", "comment"), "а".repeat(400), n)).toHaveLength(301);
    expect(formatAuditValue(field("settings", "value"), { a: 1 }, n)).toBe('{"a":1}');
    expect(formatAuditValue(field("settings", "value"), 10, n)).toBe("10");
  });
});

describe("журнал: зміни й речення", () => {
  it("створення показує лише «стало», видалення лише «було», зміна обидва; службові поля пропущені", () => {
    const n = names();
    const created = buildChanges(
      "orders",
      "insert",
      {
        id: { new: "x" },
        status: { new: "draft" },
        created_by: { new: "u1" },
        kg_sold: { new: "30" },
      },
      n,
    );
    expect(created).toEqual([
      { label: "Статус", before: null, after: "Чернетка" },
      { label: "Кількість на продаж", before: null, after: "30 кг" },
    ]);
    const removed = buildChanges("order_items", "delete", { title: { old: "Доставка" } }, n);
    expect(removed).toEqual([{ label: "Назва", before: "Доставка", after: null }]);
    const changed = buildChanges("orders", "update", { kg_sold: { old: "30", new: "35" } }, n);
    expect(changed).toEqual([{ label: "Кількість на продаж", before: "30 кг", after: "35 кг" }]);
  });

  it("поле без підпису не губиться: показується під сирою назвою", () => {
    expect(
      buildChanges("orders", "update", { щось_нове: { old: 1, new: 2 } }, emptyNames()),
    ).toEqual([{ label: "щось_нове", before: "1", after: "2" }]);
  });

  it("збирає ідентифікатори для підстановки назв", () => {
    expect(
      collectRefs("orders", { client_id: { old: "c0", new: "c1" }, kg_sold: { new: "1" } }),
    ).toEqual([
      ["client", "c0"],
      ["client", "c1"],
    ]);
  });

  it("речення: створення, зміна статусу, технічне «цех побачив», видалення чернетки, сторно, вимкнення", () => {
    const n = emptyNames();
    const describe_ = (table: string, action: "insert" | "update" | "delete", diff: never) =>
      describeAuditEntry(table, action, diff, buildChanges(table, action, diff, n));

    expect(describe_("orders", "insert", { status: { new: "draft" } } as never).summary).toBe(
      "Створено замовлення",
    );
    expect(
      describe_("orders", "update", { status: { old: "draft", new: "confirmed" } } as never)
        .summary,
    ).toBe("Змінено статус: Чернетка → Підтверджено");
    const seen = describe_("orders", "update", {
      seen_by_production_at: { old: null, new: "2026-11-13T10:00:00Z" },
    } as never);
    expect(seen).toEqual({ summary: "Цех побачив замовлення", changes: [] });
    expect(
      describe_("orders", "update", {
        deleted_at: { old: null, new: "2026-11-13T10:00:00Z" },
      } as never).summary,
    ).toBe("Видалено чернетку замовлення");
    expect(
      describe_("cash_entries", "update", {
        reversed_at: { old: null, new: "2026-11-13T10:00:00Z" },
        reversal_reason: { old: null, new: "Помилка" },
      } as never).summary,
    ).toBe("Сторновано запис готівки");
    expect(
      describe_("profiles", "update", { is_active: { old: true, new: false } } as never).summary,
    ).toBe("Користувача вимкнено");
    expect(describe_("clients", "update", { name: { old: "А", new: "Б" } } as never).summary).toBe(
      "Змінено клієнта",
    );
    expect(describe_("order_items", "delete", { title: { old: "x" } } as never).summary).toBe(
      "Видалено позицію замовлення",
    );
  });

  it("зміна лише службових полів це «Службова зміна»", () => {
    const diff = { telegram_chat_id: { old: null, new: 1 } } as never;
    const changes = buildChanges("orders", "update", diff, emptyNames());
    expect(describeAuditEntry("orders", "update", diff, changes).summary).toBe("Службова зміна");
  });
});
