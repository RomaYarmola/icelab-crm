import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAddresses, clientContacts } from "@/db/schema";
import {
  addAddress,
  addContact,
  deleteAddress,
  deleteContact,
  updateAddress,
  updateContact,
} from "@/server/client-details";
import { createClient, deleteClient } from "@/server/clients";
import { seedReferenceData } from "@/db/seed";
import { ValidationError } from "@/server/errors";
import { ForbiddenError, type AppUser } from "@/server/guards";
import { type UserRole, USER_ROLES } from "@/server/permissions";
import { createTestDb, type TestDb } from "../db/harness";
import { makeAppUsers } from "../db/helpers";

describe("контакти й адреси клієнта", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let users: Record<UserRole, AppUser>;
  let counter = 0;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    await seedReferenceData(db);
    users = await makeAppUsers(db);
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const newClient = async () =>
    (await createClient(db, users.manager, { name: `Клієнт ${++counter}`, regionPrefix: "АА" })).id;
  const contactsOf = (clientId: string) =>
    db
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, clientId))
      .orderBy(clientContacts.createdAt);
  const addressesOf = (clientId: string) =>
    db
      .select()
      .from(clientAddresses)
      .where(eq(clientAddresses.clientId, clientId))
      .orderBy(clientAddresses.createdAt);

  describe("контакти", () => {
    it("перший контакт завжди основний, наступні ні", async () => {
      const id = await newClient();
      await addContact(db, users.manager, id, { name: "Перший", phone: "050 111 22 33" });
      await addContact(db, users.manager, id, { name: "Другий", phone: "067 111 22 33" });
      expect((await contactsOf(id)).map((c) => [c.name, c.isPrimary])).toEqual([
        ["Перший", true],
        ["Другий", false],
      ]);
    });

    it("новий основний знімає попередній: основний завжди один", async () => {
      const id = await newClient();
      await addContact(db, users.manager, id, { name: "А", phone: "050 111 22 33" });
      await addContact(db, users.manager, id, {
        name: "Б",
        phone: "050 111 22 44",
        isPrimary: true,
      });
      const rows = await contactsOf(id);
      expect(rows.filter((c) => c.isPrimary).map((c) => c.name)).toEqual(["Б"]);
    });

    it("телефон зберігається в E.164, нерозпізнаний відхиляється", async () => {
      const id = await newClient();
      await addContact(db, users.manager, id, { phone: "(050) 123-45-67" });
      expect((await contactsOf(id))[0]?.phone).toBe("+380501234567");
      await expect(addContact(db, users.manager, id, { phone: "12-34" })).rejects.toThrow(
        "розпізнати телефон",
      );
    });

    it("потрібне ім'я або телефон, порожні рядки вважаються відсутніми", async () => {
      const id = await newClient();
      await expect(addContact(db, users.manager, id, {})).rejects.toThrow("ім'я або телефон");
      await expect(addContact(db, users.manager, id, { name: "  ", phone: " " })).rejects.toThrow(
        "ім'я або телефон",
      );
      await addContact(db, users.manager, id, { name: "Лише ім'я" });
      await addContact(db, users.manager, id, { phone: "050 000 11 22" });
      expect(await contactsOf(id)).toHaveLength(2);
    });

    it("змінює контакт; основним стає за запитом; єдиного основного зняти не можна", async () => {
      const id = await newClient();
      const first = await addContact(db, users.manager, id, { name: "А", phone: "050 111 22 33" });
      const second = await addContact(db, users.manager, id, { name: "Б" });

      await updateContact(db, users.manager, second.id, {
        name: "Б2",
        phone: "067 000 11 22",
        role: "бухгалтер",
        isPrimary: true,
      });
      let rows = await contactsOf(id);
      expect(rows.find((c) => c.id === second.id)).toMatchObject({
        name: "Б2",
        phone: "+380670001122",
        role: "бухгалтер",
        isPrimary: true,
      });
      expect(rows.find((c) => c.id === first.id)?.isPrimary).toBe(false);

      // Зняти «основний» із єдиного основного контакту не можна: хтось має бути основним.
      await updateContact(db, users.manager, second.id, { name: "Б2", isPrimary: false });
      rows = await contactsOf(id);
      expect(rows.filter((c) => c.isPrimary)).toHaveLength(1);
    });

    it("видалення основного робить основним найстаріший із решти", async () => {
      const id = await newClient();
      const a = await addContact(db, users.manager, id, { name: "А" });
      await addContact(db, users.manager, id, { name: "Б" });
      await addContact(db, users.manager, id, { name: "В" });
      await deleteContact(db, users.manager, a.id);
      const rows = await contactsOf(id);
      expect(rows.map((c) => [c.name, c.isPrimary])).toEqual([
        ["Б", true],
        ["В", false],
      ]);
      // Видалення останнього теж працює.
      for (const row of rows) await deleteContact(db, users.manager, row.id);
      expect(await contactsOf(id)).toEqual([]);
    });

    it("неіснуючий контакт чи клієнт, видалений клієнт, поганий id: помилка", async () => {
      const id = await newClient();
      await expect(
        addContact(db, users.manager, crypto.randomUUID(), { name: "Х" }),
      ).rejects.toThrow("Клієнта не знайдено");
      await expect(
        updateContact(db, users.manager, crypto.randomUUID(), { name: "Х" }),
      ).rejects.toThrow("Контакт не знайдено");
      await expect(deleteContact(db, users.manager, crypto.randomUUID())).rejects.toThrow(
        "Контакт не знайдено",
      );
      await expect(addContact(db, users.manager, "не-uuid", { name: "Х" })).rejects.toBeInstanceOf(
        ValidationError,
      );
      const contact = await addContact(db, users.manager, id, { name: "Х" });
      await deleteClient(db, users.owner, id);
      await expect(addContact(db, users.manager, id, { name: "Новий" })).rejects.toThrow(
        "видалено",
      );
      await expect(updateContact(db, users.manager, contact.id, { name: "Y" })).rejects.toThrow(
        "видалено",
      );
      await expect(deleteContact(db, users.manager, contact.id)).rejects.toThrow("видалено");
    });

    it("змінюють власник і менеджер, решті відмовлено і нічого не записано", async () => {
      const id = await newClient();
      for (const role of USER_ROLES) {
        if (role === "owner" || role === "manager") continue;
        await expect(addContact(db, users[role], id, { name: role }), role).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
      expect(await contactsOf(id)).toHaveLength(0);
      await addContact(db, users.owner, id, { name: "Від власника" });
      const [row] = await contactsOf(id);
      await expect(
        updateContact(db, users.accountant, row!.id, { name: "Х" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(deleteContact(db, users.location_lead, row!.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });

  describe("адреси", () => {
    it("перша адреса за замовчуванням, нова за запитом знімає попередню", async () => {
      const id = await newClient();
      await addAddress(db, users.manager, id, {
        kind: "delivery",
        addressText: "вул. Перша, 1",
        label: "Склад",
      });
      await addAddress(db, users.manager, id, {
        kind: "np_warehouse",
        cityText: "Київ",
        npWarehouseNumber: "15",
      });
      await addAddress(db, users.manager, id, {
        kind: "bus",
        cityText: "Бровари",
        isDefault: true,
      });
      const rows = await addressesOf(id);
      expect(rows.map((a) => [a.kind, a.isDefault])).toEqual([
        ["delivery", false],
        ["np_warehouse", false],
        ["bus", true],
      ]);
    });

    it("потрібне місто, адреса або номер відділення; вид зі списку", async () => {
      const id = await newClient();
      await expect(addAddress(db, users.manager, id, { kind: "delivery" })).rejects.toThrow(
        "місто, адресу або номер",
      );
      await expect(
        addAddress(db, users.manager, id, { kind: "delivery", addressText: "   " }),
      ).rejects.toThrow("місто, адресу");
      await expect(
        addAddress(db, users.manager, id, { kind: "teleport" as never, addressText: "х" }),
      ).rejects.toThrow("вид адреси");
    });

    it("змінює адресу, робить за замовчуванням, скидає зіставлення з Новою Поштою", async () => {
      const id = await newClient();
      const first = await addAddress(db, users.manager, id, {
        kind: "delivery",
        addressText: "вул. Стара, 1",
      });
      const second = await addAddress(db, users.manager, id, {
        kind: "np_address",
        cityText: "Львів",
        addressText: "вул. Друга, 2",
      });
      await db
        .update(clientAddresses)
        .set({ isResolved: true })
        .where(eq(clientAddresses.id, second.id));

      await updateAddress(db, users.manager, second.id, {
        kind: "np_address",
        cityText: "Львів",
        addressText: "вул. Нова, 5",
        recipientName: "Іван",
        timeWindow: "9-11",
        isDefault: true,
      });
      const rows = await addressesOf(id);
      const changed = rows.find((a) => a.id === second.id)!;
      expect(changed).toMatchObject({
        addressText: "вул. Нова, 5",
        recipientName: "Іван",
        timeWindow: "9-11",
        isDefault: true,
        isResolved: false,
      });
      expect(rows.find((a) => a.id === first.id)?.isDefault).toBe(false);
    });

    it("видалення адреси за замовчуванням робить такою найстарішу з решти", async () => {
      const id = await newClient();
      const a = await addAddress(db, users.manager, id, { kind: "delivery", addressText: "А" });
      await addAddress(db, users.manager, id, { kind: "delivery", addressText: "Б" });
      await addAddress(db, users.manager, id, { kind: "delivery", addressText: "В" });
      await deleteAddress(db, users.manager, a.id);
      expect((await addressesOf(id)).map((x) => [x.addressText, x.isDefault])).toEqual([
        ["Б", true],
        ["В", false],
      ]);
    });

    it("неіснуюча адреса, видалений клієнт: помилка; права як у контактів", async () => {
      const id = await newClient();
      await expect(
        updateAddress(db, users.manager, crypto.randomUUID(), { kind: "bus", cityText: "х" }),
      ).rejects.toThrow("Адресу не знайдено");
      await expect(deleteAddress(db, users.manager, crypto.randomUUID())).rejects.toThrow(
        "Адресу не знайдено",
      );
      const address = await addAddress(db, users.manager, id, { kind: "bus", cityText: "Ірпінь" });
      for (const role of ["location_lead", "accountant", "production", "driver"] as const) {
        await expect(
          addAddress(db, users[role], id, { kind: "bus", cityText: "х" }),
          role,
        ).rejects.toBeInstanceOf(ForbiddenError);
      }
      await deleteClient(db, users.owner, id);
      await expect(
        addAddress(db, users.manager, id, { kind: "bus", cityText: "х" }),
      ).rejects.toThrow("видалено");
      await expect(deleteAddress(db, users.manager, address.id)).rejects.toThrow("видалено");
    });
  });
});
