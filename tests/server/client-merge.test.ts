import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  clientAddresses,
  clientContacts,
  clientPrices,
  clients,
  iceTypes,
  orders,
} from "@/db/schema";
import { seedReferenceData } from "@/db/seed";
import { findClientReferences, mergeClients, previewMerge } from "@/server/client-merge";
import { addAddress, addContact } from "@/server/client-details";
import { createClient, getClient, restoreClient } from "@/server/clients";
import { ValidationError } from "@/server/errors";
import { ForbiddenError, type AppUser } from "@/server/guards";
import { type UserRole, USER_ROLES } from "@/server/permissions";
import { changeClientPrice } from "@/server/prices";
import { createTestDb, type TestDb } from "../db/harness";
import { makeAppUsers, makeClient, makeLocation, makeOrder } from "../db/helpers";

describe("об'єднання дублів (D46)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let users: Record<UserRole, AppUser>;
  let locationId: string;
  let mm3: string;
  let mm16: string;
  let counter = 0;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    await seedReferenceData(db);
    users = await makeAppUsers(db);
    locationId = (await makeLocation(db, "kyiv-merge")).id;
    const ice = await db.select().from(iceTypes);
    mm3 = ice.find((i) => i.code === "3mm")!.id;
    mm16 = ice.find((i) => i.code === "16mm")!.id;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const newClient = async (name: string, extra: Record<string, unknown> = {}) =>
    (
      await createClient(db, users.owner, {
        name: `${name} ${++counter}`,
        regionPrefix: "АА",
        ...extra,
      })
    ).id;

  /** Дві картки з контактами, адресами, цінами й замовленням: типовий дубль. */
  async function makePair() {
    const main = await newClient("Головний", { notes: "Примітка головного" });
    const duplicate = await newClient("Дубль", {
      notes: "Примітка дубля",
      legalType: "fop",
      iceTypeId: mm16,
    });
    await addContact(db, users.owner, main, { name: "Головний контакт", phone: "050 111 11 11" });
    await addContact(db, users.owner, duplicate, { name: "Контакт дубля", phone: "067 222 22 22" });
    await addAddress(db, users.owner, main, { kind: "delivery", addressText: "вул. Головна, 1" });
    await addAddress(db, users.owner, duplicate, {
      kind: "delivery",
      addressText: "вул. Дубля, 2",
    });
    // В обох є ціна на 3 мм (конфлікт), на 16 мм лише в дубля.
    await changeClientPrice(db, users.owner, {
      clientId: main,
      iceTypeId: mm3,
      pricePerKg: "60",
      validFrom: "2026-01-01",
    });
    await changeClientPrice(db, users.owner, {
      clientId: duplicate,
      iceTypeId: mm3,
      pricePerKg: "50",
      validFrom: "2026-01-01",
    });
    await changeClientPrice(db, users.owner, {
      clientId: duplicate,
      iceTypeId: mm16,
      pricePerKg: "65",
      validFrom: "2026-01-01",
    });
    await makeOrder(db, { clientId: duplicate, locationId });
    await makeOrder(db, { clientId: duplicate, locationId });
    await makeOrder(db, { clientId: main, locationId });
    return { main, duplicate };
  }

  it("попередній перегляд показує, що перейде, і нічого не змінює", async () => {
    const { main, duplicate } = await makePair();
    const preview = await previewMerge(db, users.owner, main, duplicate);
    expect(preview.moves).toEqual({
      contacts: 1,
      addresses: 1,
      priceTypes: 1,
      priceTypesKept: 1,
      references: { orders: 2 },
    });
    expect(preview.main.id).toBe(main);
    expect(
      (await db.select().from(clients).where(eq(clients.id, duplicate)))[0]?.deletedAt,
    ).toBeNull();
  });

  it("контакти й адреси переходять; основний контакт і адреса за замовчуванням лишаються головного", async () => {
    const { main, duplicate } = await makePair();
    await mergeClients(db, users.owner, main, duplicate);

    const contacts = await db
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, main));
    expect(contacts.map((c) => [c.name, c.isPrimary]).sort()).toEqual([
      ["Головний контакт", true],
      ["Контакт дубля", false],
    ]);
    const addresses = await db
      .select()
      .from(clientAddresses)
      .where(eq(clientAddresses.clientId, main));
    expect(addresses.map((a) => [a.addressText, a.isDefault]).sort()).toEqual([
      ["вул. Головна, 1", true],
      ["вул. Дубля, 2", false],
    ]);
    expect(
      await db.select().from(clientContacts).where(eq(clientContacts.clientId, duplicate)),
    ).toEqual([]);
  });

  it("якщо в головного немає основного контакту й адреси, ті, що прийшли, лишаються основними", async () => {
    const main = await newClient("Порожній головний");
    const duplicate = await newClient("Дубль із даними");
    await addContact(db, users.owner, duplicate, { name: "Єдиний", phone: "050 999 88 77" });
    await addAddress(db, users.owner, duplicate, { kind: "bus", cityText: "Ірпінь" });
    await mergeClients(db, users.owner, main, duplicate);
    const [contact] = await db
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, main));
    const [address] = await db
      .select()
      .from(clientAddresses)
      .where(eq(clientAddresses.clientId, main));
    expect(contact?.isPrimary).toBe(true);
    expect(address?.isDefault).toBe(true);
  });

  it("ціни: типи, яких в головного немає, переходять; конфліктні лишаються закритими на дублі", async () => {
    const { main, duplicate } = await makePair();
    await mergeClients(db, users.owner, main, duplicate);

    const mainPrices = await db.select().from(clientPrices).where(eq(clientPrices.clientId, main));
    expect(mainPrices.map((p) => [p.iceTypeId, p.pricePerKg, p.validTo]).sort()).toEqual(
      [
        [mm3, "60.00", null],
        [mm16, "65.00", null],
      ].sort(),
    );
    // Ціна дубля на 3 мм лишилась на дублі і закрита, щоб не діяла.
    const duplicatePrices = await db
      .select()
      .from(clientPrices)
      .where(eq(clientPrices.clientId, duplicate));
    expect(duplicatePrices).toHaveLength(1);
    expect(duplicatePrices[0]?.validTo).not.toBeNull();
    expect(
      await db
        .select()
        .from(clientPrices)
        .where(and(eq(clientPrices.clientId, duplicate), isNull(clientPrices.validTo))),
    ).toEqual([]);
  });

  it("замовлення переходять до головного", async () => {
    const { main, duplicate } = await makePair();
    await mergeClients(db, users.owner, main, duplicate);
    expect(await db.select().from(orders).where(eq(orders.clientId, main))).toHaveLength(3);
    expect(await db.select().from(orders).where(eq(orders.clientId, duplicate))).toHaveLength(0);
  });

  it("картка головного: порожні поля з дубля, примітка про об'єднання", async () => {
    const { main, duplicate } = await makePair();
    const [dupRow] = await db.select().from(clients).where(eq(clients.id, duplicate));
    await mergeClients(db, users.owner, main, duplicate);

    const [row] = await db.select().from(clients).where(eq(clients.id, main));
    // legalType і iceTypeId були порожні в головного, а в дубля задані.
    expect(row).toMatchObject({ legalType: "fop", iceTypeId: mm16 });
    expect(row?.notes).toContain("Примітка головного");
    expect(row?.notes).toContain(`Об'єднано з ${dupRow!.code} «${dupRow!.name}»`);
    expect(row?.notes).toContain(`Примітка з ${dupRow!.code}: Примітка дубля`);
  });

  it("заповнені поля головного не перезаписуються даними дубля", async () => {
    const main = await newClient("З типом", { legalType: "company", edrpou: "12345678" });
    const duplicate = await newClient("З іншим типом", { legalType: "person", edrpou: "87654321" });
    await mergeClients(db, users.owner, main, duplicate);
    const [row] = await db.select().from(clients).where(eq(clients.id, main));
    expect(row).toMatchObject({ legalType: "company", edrpou: "12345678" });
  });

  it("дубль прихований з посиланням на головного, код лишається зайнятим, відновити не можна", async () => {
    const { main, duplicate } = await makePair();
    const [before] = await db.select().from(clients).where(eq(clients.id, duplicate));
    await mergeClients(db, users.owner, main, duplicate);

    const [dup] = await db.select().from(clients).where(eq(clients.id, duplicate));
    expect(dup?.deletedAt).not.toBeNull();
    expect(dup?.mergedIntoId).toBe(main);
    expect(dup?.code).toBe(before?.code);

    const next = await createClient(db, users.owner, {
      name: "Новий після об'єднання",
      regionPrefix: "АА",
    });
    expect(next.code).not.toBe(before?.code);

    await expect(restoreClient(db, users.owner, duplicate)).rejects.toThrow("об'єднано");
    expect((await getClient(db, users.owner, duplicate))?.mergedIntoId).toBe(main);
  });

  it("підсумок після об'єднання збігається з попереднім переглядом", async () => {
    const { main, duplicate } = await makePair();
    const preview = await previewMerge(db, users.owner, main, duplicate);
    const result = await mergeClients(db, users.owner, main, duplicate);
    expect(result.moves).toEqual(preview.moves);
  });

  it("зміни записані в журнал з автором", async () => {
    const { main, duplicate } = await makePair();
    await mergeClients(db, users.owner, main, duplicate);
    const rows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tableName, "clients"),
          eq(auditLog.rowId, duplicate),
          eq(auditLog.action, "update"),
        ),
      );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.actorId === users.owner.id)).toBe(true);
    expect(JSON.stringify(rows.at(-1)?.diff)).toContain("merged_into_id");
  });

  it("таблиці, що посилаються на клієнта, переносяться самі (приклад: майбутні бокси)", async () => {
    await db.execute(sql`create table box_log_demo (
      id uuid primary key default gen_random_uuid(),
      client_id uuid not null references clients(id),
      note text)`);
    const main = await newClient("Для боксів головний");
    const duplicate = await newClient("Для боксів дубль");
    await db.execute(
      sql`insert into box_log_demo (client_id, note) values (${duplicate}, 'a'), (${duplicate}, 'b')`,
    );

    const references = await findClientReferences(db);
    expect(references).toEqual(
      expect.arrayContaining([
        { table: "orders", column: "client_id" },
        { table: "box_log_demo", column: "client_id" },
      ]),
    );
    // Контакти, адреси й ціни переносяться окремою логікою і в загальний список не потрапляють.
    expect(references.map((r) => r.table)).not.toContain("client_contacts");

    const preview = await previewMerge(db, users.owner, main, duplicate);
    expect(preview.moves.references.box_log_demo).toBe(2);
    await mergeClients(db, users.owner, main, duplicate);
    const moved = await db.execute(
      sql`select count(*)::int as n from box_log_demo where client_id = ${main}`,
    );
    expect((moved.rows[0] as { n: number }).n).toBe(2);
    await db.execute(sql`drop table box_log_demo`);
  });

  it("не можна об'єднати клієнта із самим собою, неіснуючого, службового, видаленого", async () => {
    const a = await newClient("А");
    const b = await newClient("Б");
    await expect(mergeClients(db, users.owner, a, a)).rejects.toThrow("двох різних");
    await expect(mergeClients(db, users.owner, a, crypto.randomUUID())).rejects.toThrow(
      "не знайдено",
    );
    await expect(mergeClients(db, users.owner, "не-uuid", b)).rejects.toBeInstanceOf(
      ValidationError,
    );

    const placeholder = await makeClient(db, {
      code: "404",
      name: "Новий клієнт",
      isPlaceholder: true,
    });
    await expect(mergeClients(db, users.owner, a, placeholder.id)).rejects.toThrow("Службового");

    await mergeClients(db, users.owner, a, b);
    // Дубль уже об'єднано: вдруге його не беруть, а об'єднаного не можна зробити головним.
    const c = await newClient("В");
    await expect(mergeClients(db, users.owner, c, b)).rejects.toThrow("уже видалено або об'єднано");
    await expect(mergeClients(db, users.owner, b, c)).rejects.toThrow("Головного клієнта видалено");
  });

  it("об'єднує лише власник; менеджер і решта дістають відмову, нічого не змінилось", async () => {
    const { main, duplicate } = await makePair();
    for (const role of USER_ROLES) {
      if (role === "owner") continue;
      await expect(mergeClients(db, users[role], main, duplicate), role).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(previewMerge(db, users[role], main, duplicate), role).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect(
      (await db.select().from(clients).where(eq(clients.id, duplicate)))[0]?.deletedAt,
    ).toBeNull();
    expect(await db.select().from(orders).where(eq(orders.clientId, duplicate))).toHaveLength(2);
  });
});
