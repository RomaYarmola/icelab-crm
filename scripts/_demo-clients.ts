import { and, asc, eq, like, sql } from "drizzle-orm";
import { clientApplications, clientStatuses, clients, iceTypes, profiles } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { addAddress, addContact } from "@/server/client-details";
import { createClient } from "@/server/clients";
import type { AppUser } from "@/server/guards";
import { changeClientPrice } from "@/server/prices";
import { addDays, todayIso } from "@/utils/isoDate";

/**
 * Демонстраційні клієнти для перевірки екранів «Клієнти» (D49). Усі назви починаються з «Тест:»,
 * за цим префіксом їх і видаляє `--remove`. База одна з Production (D22), тому скрипт запускаємо
 * лише після «так» розробника. Вигадані дані: телефони 050 111…, назви без реальних людей.
 */

export const DEMO_PREFIX = "Тест:";

type DemoContact = { name: string; phone: string; role?: string };
type DemoAddress = {
  kind: "delivery" | "np_warehouse" | "np_address" | "bus";
  label?: string;
  cityText?: string;
  addressText?: string;
  npWarehouseNumber?: string;
  recipientName?: string;
  timeWindow?: string;
  isDefault?: boolean;
};
type DemoPrice = {
  /** Код типу льоду (`3mm`, `16mm`, `19mm`); без нього ціна «для будь-якого типу». */
  ice?: string;
  pricePerKg: string;
  /** На скільки днів від сьогодні починається ціна (від'ємне означає в минулому). */
  startsInDays: number;
};

type DemoClient = {
  name: string;
  region: string | null;
  status: "active" | "warm" | "in_mind" | "paused" | "irrelevant";
  application?: string;
  legalType?: "person" | "fop" | "company";
  edrpou?: string;
  phone?: string;
  contactName?: string;
  contacts?: DemoContact[];
  addresses?: DemoAddress[];
  prices?: DemoPrice[];
  notes?: string;
};

export const DEMO_CLIENTS: DemoClient[] = [
  {
    name: `${DEMO_PREFIX} Кафе «Вогник»`,
    region: "АА",
    status: "active",
    application: "bar",
    legalType: "fop",
    phone: "050 111 22 33",
    contactName: "Марія Петренко",
    contacts: [{ name: "Іван", phone: "067 111 22 44", role: "Бармен" }],
    addresses: [
      {
        kind: "delivery",
        label: "Кафе на Подолі",
        cityText: "Київ",
        addressText: "вул. Сагайдачного, 12",
        timeWindow: "10:00-14:00",
        isDefault: true,
      },
    ],
    prices: [{ ice: "16mm", pricePerKg: "70", startsInDays: -30 }],
    notes: "Просить привозити до 10:00.",
  },
  {
    // Навмисний дубль до «Вогника»: той самий телефон, щоб перевірити підказку і об'єднання.
    name: `${DEMO_PREFIX} Кафе «Вогнік» (дубль)`,
    region: "АА",
    status: "warm",
    phone: "050 111 22 33",
    contactName: "Марія Петренко",
    addresses: [
      {
        kind: "np_warehouse",
        cityText: "Київ",
        npWarehouseNumber: "14",
        recipientName: "Марія",
        isDefault: true,
      },
    ],
    prices: [
      { ice: "16mm", pricePerKg: "72", startsInDays: -10 },
      { ice: "3mm", pricePerKg: "85", startsInDays: -10 },
    ],
  },
  {
    name: `${DEMO_PREFIX} ФОП Іваненко Петро Олексійович`,
    region: "ВС",
    status: "warm",
    legalType: "fop",
    phone: "067 999 88 77",
    contactName: "Петро",
  },
  {
    name: `${DEMO_PREFIX} Бар «Левів»`,
    region: "ВС",
    status: "active",
    application: "bar",
    phone: "093 555 44 33",
    contactName: "Андрій",
    prices: [{ pricePerKg: "65", startsInDays: -20 }],
  },
  {
    name: `${DEMO_PREFIX} Івент-агенція «Дим»`,
    region: "АІ",
    status: "active",
    application: "heavy_smoke",
    legalType: "company",
    edrpou: "12345678",
    phone: "063 222 11 00",
    contactName: "Олена",
    addresses: [
      { kind: "delivery", cityText: "Бровари", addressText: "вул. Київська, 5", isDefault: true },
    ],
  },
  {
    name: `${DEMO_PREFIX} Склад №4`,
    region: null,
    status: "paused",
    application: "logistics",
    phone: "044 123 45 67",
  },
  {
    name: `${DEMO_PREFIX} Ресторан «Золотий ключ»`,
    region: "АА",
    status: "irrelevant",
    application: "bar",
  },
  {
    name: `${DEMO_PREFIX} Дитячі свята «Зайчик»`,
    region: "АІ",
    status: "active",
    application: "kids_parties",
    phone: "099 700 80 90",
    contactName: "Наталя",
  },
  {
    name: `${DEMO_PREFIX} Логістика «Північ»`,
    region: "ВО",
    status: "active",
    application: "logistics",
    phone: "096 310 20 30",
    contactName: "Сергій",
    addresses: [
      { kind: "np_warehouse", cityText: "Тернопіль", npWarehouseNumber: "3", isDefault: true },
      { kind: "bus", label: "Автобус до Львова", cityText: "Тернопіль" },
    ],
  },
  {
    name: `${DEMO_PREFIX} Кав'ярня «Ранок»`,
    region: "АА",
    status: "in_mind",
    phone: "050 900 10 20",
  },
  {
    name: `${DEMO_PREFIX} Заморозка «Холод»`,
    region: "ВС",
    status: "active",
    application: "freezing",
    phone: "097 444 55 66",
    contactName: "Василь",
    prices: [
      { ice: "19mm", pricePerKg: "68", startsInDays: -15 },
      // Майбутня ціна: на вкладці «Ціни» має бути видно, що вона ще не діє.
      { ice: "19mm", pricePerKg: "66", startsInDays: 14 },
    ],
  },
  {
    name: `${DEMO_PREFIX} Клуб «Нічний»`,
    region: "АА",
    status: "active",
    application: "bar",
    phone: "050 777 66 55",
    contactName: "Денис",
  },
  {
    name: `${DEMO_PREFIX} Піцерія «Мілано»`,
    region: "АІ",
    status: "active",
    phone: "068 123 00 11",
    contactName: "Оксана",
  },
  {
    name: `${DEMO_PREFIX} ТОВ «Лід-Сервіс»`,
    region: "АА",
    status: "active",
    legalType: "company",
    edrpou: "87654321",
    phone: "044 200 30 40",
    contactName: "Бухгалтерія",
  },
  {
    name: `${DEMO_PREFIX} Клієнт без телефону`,
    region: "ВС",
    status: "paused",
  },
];

const BULK_COUNT = 35;

async function idByCode(
  db: AnyPgDatabase,
  table: typeof clientStatuses | typeof clientApplications | typeof iceTypes,
  code: string,
): Promise<string> {
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.code, code));
  if (!row) throw new Error(`Немає значення «${code}» у довіднику (запустіть npm run db:seed).`);
  return row.id;
}

/** Власник, від імені якого додаємо клієнтів: тестовий, інакше будь-який активний. */
export async function findOwnerActor(db: AnyPgDatabase): Promise<AppUser> {
  const owners = await db
    .select({ id: profiles.id, fullName: profiles.fullName })
    .from(profiles)
    .where(and(eq(profiles.role, "owner"), eq(profiles.isActive, true)))
    .orderBy(sql`(${profiles.fullName} like 'Тест:%') desc`, asc(profiles.createdAt));
  const owner = owners[0];
  if (!owner) throw new Error("Немає активного власника: спершу створіть користувачів.");
  return {
    id: owner.id,
    email: null,
    fullName: owner.fullName,
    role: "owner",
    locationId: null,
    locationName: null,
  };
}

export type AddDemoResult = { added: number; skipped: boolean };

/**
 * Додає демонстраційних клієнтів. Якщо вони вже є, нічого не робить (запустіть спершу `--remove`).
 * `bulk` додає ще 35 простих клієнтів, щоб перевірити довантаження списку («Показати ще»).
 */
export async function addDemoClients(
  db: AnyPgDatabase,
  actor: AppUser,
  options: { bulk?: boolean } = {},
): Promise<AddDemoResult> {
  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(like(clients.name, `${DEMO_PREFIX}%`))
    .limit(1);
  if (existing) return { added: 0, skipped: true };

  const today = todayIso();
  const specs: DemoClient[] = [...DEMO_CLIENTS];
  if (options.bulk) {
    for (let i = 1; i <= BULK_COUNT; i++) {
      specs.push({
        name: `${DEMO_PREFIX} Масовий клієнт ${String(i).padStart(2, "0")}`,
        region: i % 2 === 0 ? "АА" : "ВС",
        status: "active",
        phone: `050 000 ${String(i).padStart(2, "0")} ${String(i).padStart(2, "0")}`,
      });
    }
  }

  for (const spec of specs) {
    const created = await createClient(db, actor, {
      name: spec.name,
      regionPrefix: spec.region,
      statusId: await idByCode(db, clientStatuses, spec.status),
      applicationId: spec.application
        ? await idByCode(db, clientApplications, spec.application)
        : undefined,
      legalType: spec.legalType ?? null,
      edrpou: spec.edrpou ?? null,
      phone: spec.phone ?? null,
      contactName: spec.contactName ?? null,
      notes: spec.notes ?? null,
    });
    for (const contact of spec.contacts ?? []) {
      await addContact(db, actor, created.id, { ...contact, isPrimary: false });
    }
    for (const address of spec.addresses ?? []) {
      await addAddress(db, actor, created.id, address);
    }
    for (const price of spec.prices ?? []) {
      await changeClientPrice(db, actor, {
        clientId: created.id,
        iceTypeId: price.ice ? await idByCode(db, iceTypes, price.ice) : null,
        pricePerKg: price.pricePerKg,
        validFrom: addDays(today, price.startsInDays),
      });
    }
  }
  return { added: specs.length, skipped: false };
}

export type RemoveDemoResult = { removed: number; kept: number };

/**
 * Видаляє демонстраційних клієнтів з усім, що на них посилається (контакти, адреси, ціни). Клієнта,
 * на якого вже посилаються замовлення, не чіпає й рахує в `kept`.
 */
export async function removeDemoClients(db: AnyPgDatabase): Promise<RemoveDemoResult> {
  const demo = await db
    .select({ id: clients.id })
    .from(clients)
    .where(like(clients.name, `${DEMO_PREFIX}%`));

  // Об'єднані дублі посилаються на головних: знімаємо посилання, щоб порядок видалення був байдужий.
  await db
    .update(clients)
    .set({ mergedIntoId: null })
    .where(like(clients.name, `${DEMO_PREFIX}%`));

  let removed = 0;
  let kept = 0;
  for (const { id } of demo) {
    try {
      await db.delete(clients).where(eq(clients.id, id));
      removed += 1;
    } catch {
      kept += 1;
    }
  }
  return { removed, kept };
}
