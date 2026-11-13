import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { cashEntries, clients, iceTypes, locations, orderItems, orders } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import type { OrderStatus } from "@/constants/constants";
import type { AppUser } from "@/server/guards";
import { recordCashEntry, reverseCashEntry } from "@/server/cash";
import { addOrderItem } from "@/server/order-items";
import { transitionOrder } from "@/server/order-status";
import { createOrder, type CreateOrderInput } from "@/server/orders";
import { addDays, todayIso } from "@/utils/isoDate";

/**
 * Демонстраційні замовлення для перевірки екранів «Замовлення» (D59). Усі мають внутрішній
 * коментар, що починається з «Тест:», за ним їх і видаляє `--remove`. Беруть клієнтів «Тест: …»
 * (спершу `npm run clients:seed-dev`). Ціни вказані вручну, тож прайс не потрібен. База одна з
 * Production (D22), тому скрипт запускаємо лише після «так» розробника.
 */

export const DEMO_ORDER_MARK = "Тест: демо-замовлення";

type DemoOrder = {
  /** Скільки днів від сьогодні виконання (від'ємне: у минулому). */
  day: number;
  /** Номер клієнта в списку демо-клієнтів за назвою (за модулем кількості). */
  client: number;
  location: "kyiv" | "lviv";
  ice: "3mm" | "16mm" | "19mm";
  kg: number;
  price: number;
  delivery: CreateOrderInput["deliveryMethod"];
  /** До якого статусу довести замовлення. */
  until: Exclude<OrderStatus, "closed"> | "closed";
  comment?: string;
  /** Додаткова позиція «Доставка». */
  deliveryFee?: number;
};

export const DEMO_ORDERS: DemoOrder[] = [
  {
    day: 0,
    client: 0,
    location: "kyiv",
    ice: "16mm",
    kg: 30,
    price: 75,
    delivery: "np",
    until: "in_production",
    comment: "Пакувати в два бокси, привезти до 10:00.",
  },
  {
    day: 0,
    client: 1,
    location: "kyiv",
    ice: "3mm",
    kg: 12,
    price: 85,
    delivery: "pickup",
    until: "confirmed",
  },
  {
    day: 0,
    client: 2,
    location: "lviv",
    ice: "16mm",
    kg: 60,
    price: 75,
    delivery: "our_delivery",
    until: "packed",
    deliveryFee: 150,
  },
  {
    day: 0,
    client: 3,
    location: "lviv",
    ice: "19mm",
    kg: 25,
    price: 72,
    delivery: "bus",
    until: "draft",
  },
  {
    day: 0,
    client: 4,
    location: "kyiv",
    ice: "16mm",
    kg: 40,
    price: 70,
    delivery: "np",
    until: "shipped",
  },
  {
    day: 1,
    client: 0,
    location: "kyiv",
    ice: "16mm",
    kg: 45,
    price: 75,
    delivery: "np",
    until: "confirmed",
  },
  {
    day: 1,
    client: 5,
    location: "lviv",
    ice: "3mm",
    kg: 20,
    price: 85,
    delivery: "pickup",
    until: "draft",
  },
  {
    day: 1,
    client: 6,
    location: "kyiv",
    ice: "19mm",
    kg: 100,
    price: 72,
    delivery: "our_delivery",
    until: "confirmed",
    deliveryFee: 300,
  },
  {
    day: 2,
    client: 7,
    location: "lviv",
    ice: "16mm",
    kg: 15,
    price: 75,
    delivery: "np",
    until: "draft",
  },
  {
    day: -1,
    client: 0,
    location: "kyiv",
    ice: "16mm",
    kg: 30,
    price: 75,
    delivery: "np",
    until: "closed",
  },
  {
    day: -1,
    client: 2,
    location: "lviv",
    ice: "16mm",
    kg: 50,
    price: 75,
    delivery: "our_delivery",
    until: "paid",
  },
  {
    day: -1,
    client: 1,
    location: "kyiv",
    ice: "3mm",
    kg: 10,
    price: 85,
    delivery: "pickup",
    until: "cancelled",
  },
  {
    day: -2,
    client: 3,
    location: "lviv",
    ice: "19mm",
    kg: 35,
    price: 72,
    delivery: "bus",
    until: "closed",
  },
  {
    day: -3,
    client: 4,
    location: "kyiv",
    ice: "16mm",
    kg: 28,
    price: 70,
    delivery: "np",
    until: "closed",
  },
  {
    day: -3,
    client: 8,
    location: "lviv",
    ice: "16mm",
    kg: 80,
    price: 75,
    delivery: "np",
    until: "shipped",
  },
  {
    day: -5,
    client: 5,
    location: "lviv",
    ice: "3mm",
    kg: 22,
    price: 85,
    delivery: "pickup",
    until: "closed",
  },
  {
    day: -6,
    client: 6,
    location: "kyiv",
    ice: "19mm",
    kg: 55,
    price: 72,
    delivery: "our_delivery",
    until: "closed",
    deliveryFee: 200,
  },
  // Навмисний дубль до першого замовлення: той самий клієнт, дата й тип льоду.
  {
    day: 0,
    client: 0,
    location: "kyiv",
    ice: "16mm",
    kg: 30,
    price: 75,
    delivery: "np",
    until: "draft",
    comment: "Дубль для перевірки підказки.",
  },
];

const FLOW: OrderStatus[] = ["confirmed", "in_production", "packed", "shipped", "paid"];

export type AddDemoOrdersResult = { added: number; skipped: boolean };

/** Додає демо-замовлення від імені власника. Якщо вони вже є, нічого не робить. */
export async function addDemoOrders(
  db: AnyPgDatabase,
  actor: AppUser,
): Promise<AddDemoOrdersResult> {
  const [existing] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(like(orders.internalComment, `${DEMO_ORDER_MARK}%`))
    .limit(1);
  if (existing) return { added: 0, skipped: true };

  const demoClients = await db
    .select({ id: clients.id })
    .from(clients)
    .where(like(clients.name, "Тест:%"))
    .orderBy(asc(clients.name));
  if (demoClients.length === 0) {
    throw new Error("Немає демонстраційних клієнтів: спершу npm run clients:seed-dev.");
  }

  const locationId = async (code: string) => {
    const [row] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.code, code));
    if (!row) throw new Error(`Немає локації «${code}» (запустіть npm run db:seed).`);
    return row.id;
  };
  const iceId = async (code: string) => {
    const [row] = await db
      .select({ id: iceTypes.id })
      .from(iceTypes)
      .where(eq(iceTypes.code, code));
    if (!row) throw new Error(`Немає типу льоду «${code}» (запустіть npm run db:seed).`);
    return row.id;
  };

  const today = todayIso();
  for (const spec of DEMO_ORDERS) {
    const created = await createOrder(db, actor, {
      clientId: demoClients[spec.client % demoClients.length]!.id,
      locationId: await locationId(spec.location),
      orderDate: addDays(today, spec.day),
      iceTypeId: await iceId(spec.ice),
      kgSold: spec.kg,
      price: spec.price,
      deliveryMethod: spec.delivery,
      comment: spec.comment,
      internalComment: DEMO_ORDER_MARK,
    });
    if (spec.deliveryFee) {
      await addOrderItem(db, actor, created.id, {
        kind: "delivery",
        title: "Доставка",
        qty: 1,
        price: spec.deliveryFee,
      });
    }
    if (spec.until === "draft") continue;
    if (spec.until === "cancelled") {
      await transitionOrder(db, actor, created.id, "cancelled", {
        note: "Клієнт передумав (демо).",
      });
      continue;
    }
    const target = spec.until === "closed" ? "paid" : spec.until;
    for (const status of FLOW.slice(0, FLOW.indexOf(target) + 1)) {
      await transitionOrder(db, actor, created.id, status, {
        note: status === "paid" ? "Оплата готівкою (демо)." : undefined,
      });
    }
  }
  return { added: DEMO_ORDERS.length, skipped: false };
}

/** Видаляє демо-замовлення разом із позиціями, історією й змінами ціни. */
export async function removeDemoOrders(db: AnyPgDatabase): Promise<{ removed: number }> {
  // Демо-готівка: записи готівки видаляються лише тут (див. `removeDemoCash`).
  const cash = await removeDemoCash(db);
  const demo = await db
    .select({ id: orders.id })
    .from(orders)
    .where(like(orders.internalComment, `${DEMO_ORDER_MARK}%`));
  // Дублі посилаються на перші замовлення: знімаємо посилання, щоб порядок видалення був байдужий.
  await db
    .update(orders)
    .set({ duplicateOf: null })
    .where(like(orders.internalComment, `${DEMO_ORDER_MARK}%`));
  for (const { id } of demo) {
    await db.delete(orderItems).where(and(eq(orderItems.orderId, id)));
    await db.delete(orders).where(eq(orders.id, id));
  }
  return { removed: demo.length + cash.removed };
}

// ---------------------------------------------------------------------------------------------
// Демо-готівка (B6, D71)
// ---------------------------------------------------------------------------------------------

/** Позначка демо-замовлень з готівкою: за нею їх знаходить `--remove`. */
export const DEMO_CASH_MARK = "Тест: демо-готівка";

type DemoCashEntry = {
  amount: number;
  receivedBy?: string;
  note?: string;
  /** Запис додано через бота водія (приклад для екрана). */
  viaBot?: boolean;
  /** Одразу сторнувати з цією причиною. */
  reverseReason?: string;
};

type DemoCashOrder = Omit<DemoOrder, "until"> & {
  until: "confirmed" | "packed" | "shipped";
  entries: DemoCashEntry[];
};

/**
 * Замовлення з готівковою оплатою на сьогодні: без оплати, часткова з записом від водія, з
 * помилковим записом під сторно, повністю сплачене (стає «Закрито» саме). Усі на демо-клієнтів.
 */
export const DEMO_CASH_ORDERS: DemoCashOrder[] = [
  {
    day: 0,
    client: 4,
    location: "kyiv",
    ice: "16mm",
    kg: 40,
    price: 70,
    delivery: "np",
    until: "shipped",
    entries: [
      { amount: 1000, receivedBy: "Водій Іван", viaBot: true, note: "Решту обіцяв доплатити" },
    ],
  },
  {
    day: 0,
    client: 1,
    location: "kyiv",
    ice: "3mm",
    kg: 12,
    price: 85,
    delivery: "pickup",
    until: "packed",
    entries: [],
  },
  {
    day: 0,
    client: 6,
    location: "kyiv",
    ice: "19mm",
    kg: 100,
    price: 72,
    delivery: "our_delivery",
    until: "confirmed",
    deliveryFee: 300,
    entries: [],
  },
  {
    day: 0,
    client: 0,
    location: "kyiv",
    ice: "16mm",
    kg: 20,
    price: 75,
    delivery: "our_delivery",
    until: "shipped",
    entries: [{ amount: 500, reverseReason: "Записано не в те замовлення" }, { amount: 600 }],
  },
  {
    day: 0,
    client: 2,
    location: "lviv",
    ice: "16mm",
    kg: 60,
    price: 75,
    delivery: "our_delivery",
    until: "shipped",
    deliveryFee: 150,
    entries: [{ amount: 4650, note: "Оплатили повністю" }],
  },
];

const CASH_FLOW = ["confirmed", "in_production", "packed", "shipped"] as const;

export type AddDemoCashResult = { added: number; entries: number; skipped: boolean };

/**
 * Додає демо-замовлення з готівкою й записи готівки від імені власника. Записи йдуть тією самою
 * функцією, що й на екрані (`recordCashEntry`), тож статуси й автозакриття справжні. Якщо демо-готівка
 * вже є, нічого не робить.
 */
export async function addDemoCash(db: AnyPgDatabase, actor: AppUser): Promise<AddDemoCashResult> {
  const [existing] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(like(orders.internalComment, `${DEMO_CASH_MARK}%`))
    .limit(1);
  if (existing) return { added: 0, entries: 0, skipped: true };

  const demoClients = await db
    .select({ id: clients.id })
    .from(clients)
    .where(like(clients.name, "Тест:%"))
    .orderBy(asc(clients.name));
  if (demoClients.length === 0) {
    throw new Error("Немає демонстраційних клієнтів: спершу npm run clients:seed-dev.");
  }
  const lookup = async (table: typeof locations | typeof iceTypes, code: string) => {
    const [row] = await db.select({ id: table.id }).from(table).where(eq(table.code, code));
    if (!row) throw new Error(`Немає «${code}» (запустіть npm run db:seed).`);
    return row.id;
  };

  const today = todayIso();
  let entriesAdded = 0;
  for (const spec of DEMO_CASH_ORDERS) {
    const created = await createOrder(db, actor, {
      clientId: demoClients[spec.client % demoClients.length]!.id,
      locationId: await lookup(locations, spec.location),
      orderDate: addDays(today, spec.day),
      iceTypeId: await lookup(iceTypes, spec.ice),
      kgSold: spec.kg,
      price: spec.price,
      deliveryMethod: spec.delivery,
      paymentKind: "cash",
      internalComment: DEMO_CASH_MARK,
    });
    if (spec.deliveryFee) {
      await addOrderItem(db, actor, created.id, {
        kind: "delivery",
        title: "Доставка",
        qty: 1,
        price: spec.deliveryFee,
      });
    }
    for (const status of CASH_FLOW.slice(0, CASH_FLOW.indexOf(spec.until) + 1)) {
      await transitionOrder(db, actor, created.id, status);
    }
    for (const entry of spec.entries) {
      const result = await recordCashEntry(db, actor, {
        orderId: created.id,
        amount: entry.amount,
        receivedBy: entry.receivedBy,
        note: entry.note,
        via: entry.viaBot ? "driver_bot" : "web",
      });
      entriesAdded += 1;
      if (entry.reverseReason) {
        await reverseCashEntry(db, actor, result.entryId, entry.reverseReason);
      }
    }
  }
  return { added: DEMO_CASH_ORDERS.length, entries: entriesAdded, skipped: false };
}

/**
 * Видаляє демо-замовлення з готівкою разом із записами готівки. Записи готівки в застосунку не
 * видаляються (їх береже тригер бази, D67), тому на час видалення тригер вимикається в транзакції:
 * вона або проходить повністю й тригер знову увімкнено, або скасовується цілком.
 */
export async function removeDemoCash(db: AnyPgDatabase): Promise<{ removed: number }> {
  const demo = await db
    .select({ id: orders.id })
    .from(orders)
    .where(like(orders.internalComment, `${DEMO_CASH_MARK}%`));
  if (demo.length === 0) return { removed: 0 };
  const ids = demo.map((row) => row.id);

  await db.transaction(async (tx) => {
    await tx.execute(sql`alter table cash_entries disable trigger cash_entries_guard`);
    await tx.delete(cashEntries).where(inArray(cashEntries.orderId, ids));
    await tx.execute(sql`alter table cash_entries enable trigger cash_entries_guard`);
    await tx.delete(orderItems).where(inArray(orderItems.orderId, ids));
    await tx.delete(orders).where(inArray(orders.id, ids));
  });
  return { removed: ids.length };
}
