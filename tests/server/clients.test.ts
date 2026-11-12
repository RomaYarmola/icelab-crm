import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  clientApplications,
  clientContacts,
  clientStatuses,
  clients,
  iceTypes,
} from "@/db/schema";
import { seedReferenceData } from "@/db/seed";
import { findForbiddenFields } from "@/server/dto";
import { ValidationError } from "@/server/errors";
import {
  assignClientRegion,
  createClient,
  deleteClient,
  findSimilarClients,
  getClient,
  listClients,
  previewClientCode,
  restoreClient,
  updateClient,
} from "@/server/clients";
import { ForbiddenError, type AppUser } from "@/server/guards";
import { type UserRole, USER_ROLES } from "@/server/permissions";
import { changeClientPrice } from "@/server/prices";
import { createTestDb, type TestDb } from "../db/harness";
import { makeAppUsers, makeClient } from "../db/helpers";

describe("клієнти: створення, зміна, список, картка", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let users: Record<UserRole, AppUser>;
  let ice16: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    await seedReferenceData(db);
    users = await makeAppUsers(db);
    const [ice] = await db.select().from(iceTypes).where(eq(iceTypes.code, "16mm"));
    ice16 = ice!.id;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const create = (overrides: Record<string, unknown> = {}, actor: AppUser = users.manager) =>
    createClient(db, actor, { name: "Кафе «Вогник»", regionPrefix: "АА", ...overrides });

  describe("створення і код (D42)", () => {
    it("код видається за областю: номер по порядку в префіксі", async () => {
      const first = await create({ name: "Перший київський" });
      const second = await create({ name: "Другий київський" });
      const lviv = await create({ name: "Львівський", regionPrefix: "ВС" });
      expect([first.code, second.code, lviv.code]).toEqual(["АА1", "АА2", "ВС1"]);
    });

    it("префікс латиницею приймається і зводиться до кирилиці", async () => {
      const client = await create({ name: "Латиницею", regionPrefix: "AI" });
      expect(client.code).toBe("АІ1");
    });

    it("без області код з самих цифр", async () => {
      const a = await create({ name: "Без області 1", regionPrefix: null });
      const b = await create({ name: "Без області 2", regionPrefix: "" });
      expect([a.code, b.code]).toEqual(["1", "2"]);
    });

    it("невідома область чи сміття відхиляються", async () => {
      await expect(create({ regionPrefix: "ЯЯ" })).rejects.toThrow("Область не знайдено");
      await expect(create({ regionPrefix: "Київ" })).rejects.toBeInstanceOf(ValidationError);
    });

    it("назва обов'язкова", async () => {
      await expect(create({ name: "   " })).rejects.toThrow("Вкажіть назву");
      await expect(create({ name: "" })).rejects.toBeInstanceOf(ValidationError);
    });

    it("телефон нормалізується і стає основним контактом", async () => {
      const client = await create({
        name: "З телефоном",
        phone: "050 123 45 67",
        contactName: "Олена",
      });
      const contacts = await db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, client.id));
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({ phone: "+380501234567", name: "Олена", isPrimary: true });
    });

    it("нерозпізнаний телефон відхиляється, клієнта не створено", async () => {
      const before = (await db.select().from(clients)).length;
      await expect(create({ name: "Поганий телефон", phone: "12-34" })).rejects.toThrow(
        "розпізнати телефон",
      );
      expect((await db.select().from(clients)).length).toBe(before);
    });

    it("за замовчуванням статус «Активний», менеджер це той, хто створює", async () => {
      const client = await create({ name: "Типовий" }, users.manager);
      const [row] = await db.select().from(clients).where(eq(clients.id, client.id));
      const [status] = await db
        .select()
        .from(clientStatuses)
        .where(eq(clientStatuses.code, "active"));
      expect(row?.statusId).toBe(status?.id);
      expect(row?.managerId).toBe(users.manager.id);
      expect(row?.createdBy).toBe(users.manager.id);
    });

    it("власник створює без прив'язки до себе, якщо менеджера вказано явно", async () => {
      const client = await create(
        { name: "Чужий менеджер", managerId: users.manager.id },
        users.owner,
      );
      const [row] = await db.select().from(clients).where(eq(clients.id, client.id));
      expect(row?.managerId).toBe(users.manager.id);
    });

    it("посилання на неіснуючі довідники й некоректні значення відхиляються", async () => {
      const missing = crypto.randomUUID();
      await expect(create({ iceTypeId: missing })).rejects.toThrow("Тип льоду не знайдено");
      await expect(create({ applicationId: missing })).rejects.toThrow("Застосування не знайдено");
      await expect(create({ statusId: missing })).rejects.toThrow("Статус не знайдено");
      await expect(create({ sourceId: missing })).rejects.toThrow("Джерело не знайдено");
      await expect(create({ managerId: users.accountant.id })).rejects.toThrow(
        "Менеджера не знайдено",
      );
      await expect(create({ edrpou: "123" })).rejects.toThrow("ЄДРПОУ");
      await expect(create({ legalType: "інше" })).rejects.toBeInstanceOf(ValidationError);
      await expect(create({ markupPercentOverride: "150" })).rejects.toThrow("від 0 до 100");
      await expect(create({ inactiveDaysThreshold: 0 })).rejects.toThrow("більшою за нуль");
    });

    it("створення записується в журнал з автором", async () => {
      const client = await create({ name: "Для журналу" }, users.owner);
      const rows = await db.select().from(auditLog).where(eq(auditLog.rowId, client.id));
      expect(
        rows.some((row) => row.tableName === "clients" && row.actorId === users.owner.id),
      ).toBe(true);
    });

    it("створюють власник і менеджер, решті відмовлено", async () => {
      for (const role of USER_ROLES) {
        const result = create({ name: `Від ${role}` }, users[role]);
        if (role === "owner" || role === "manager") {
          await expect(result, role).resolves.toHaveProperty("code");
        } else {
          await expect(result, role).rejects.toBeInstanceOf(ForbiddenError);
        }
      }
    });
  });

  describe("підказка коду в формі", () => {
    it("показує код, який отримає наступний клієнт, не створюючи його", async () => {
      const before = (await db.select().from(clients)).length;
      const hint = await previewClientCode(db, users.manager, "ВС");
      expect(hint).toMatch(/^ВС[0-9]+$/);
      expect((await db.select().from(clients)).length).toBe(before);
      const created = await create({ regionPrefix: "ВС" });
      expect(created.code).toBe(hint);
    });

    it("без області підказує цифровий код, латиниця в області приймається", async () => {
      expect(await previewClientCode(db, users.manager, "")).toMatch(/^[0-9]+$/);
      expect(await previewClientCode(db, users.manager, null)).toMatch(/^[0-9]+$/);
      expect(await previewClientCode(db, users.manager, "BC")).toMatch(/^ВС[0-9]+$/);
    });

    it("невідому область відхиляє, права як у створення", async () => {
      await expect(previewClientCode(db, users.manager, "ЯЯ")).rejects.toThrow(ValidationError);
      for (const role of ["location_lead", "production", "accountant", "driver"] as const) {
        await expect(previewClientCode(db, users[role], "АА")).rejects.toThrow(ForbiddenError);
      }
    });
  });

  describe("зміна клієнта", () => {
    it("змінює поля, надбавка з комою зберігається з двома знаками", async () => {
      const { id } = await create({ name: "До зміни" });
      const [app] = await db.select().from(clientApplications).limit(1);
      await updateClient(db, users.manager, id, {
        name: "Після зміни",
        legalType: "fop",
        edrpou: "1234567890",
        iceTypeId: ice16,
        applicationId: app!.id,
        markupPercentOverride: "10,5",
        inactiveDaysThreshold: 45,
        notes: "  Важливий клієнт ",
      });
      const [row] = await db.select().from(clients).where(eq(clients.id, id));
      expect(row).toMatchObject({
        name: "Після зміни",
        legalType: "fop",
        edrpou: "1234567890",
        iceTypeId: ice16,
        markupPercentOverride: "10.50",
        inactiveDaysThreshold: 45,
        notes: "Важливий клієнт",
      });
    });

    it("код клієнта змінити не можна: його немає серед полів зміни", async () => {
      const { id, code } = await create({ name: "Код незмінний" });
      await updateClient(db, users.manager, id, { name: "Код незмінний 2", code: "ЯЯ99" } as never);
      const [row] = await db.select().from(clients).where(eq(clients.id, id));
      expect(row?.code).toBe(code);
    });

    it("порожнє значення очищає поле, відсутнє поле не чіпає", async () => {
      const { id } = await create({ name: "Очищення", notes: "Було" });
      await updateClient(db, users.manager, id, { name: "Очищення 2" });
      expect((await db.select().from(clients).where(eq(clients.id, id)))[0]?.notes).toBe("Було");
      await updateClient(db, users.manager, id, { notes: null });
      expect((await db.select().from(clients).where(eq(clients.id, id)))[0]?.notes).toBeNull();
    });

    it("неіснуючого, видаленого клієнта і поганий ідентифікатор відхиляє", async () => {
      await expect(
        updateClient(db, users.manager, crypto.randomUUID(), { name: "Х" }),
      ).rejects.toThrow("не знайдено");
      await expect(
        updateClient(db, users.manager, "не-uuid", { name: "Х" }),
      ).rejects.toBeInstanceOf(ValidationError);
      const { id } = await create({ name: "Буде видалений" });
      await deleteClient(db, users.owner, id);
      await expect(updateClient(db, users.manager, id, { name: "Х" })).rejects.toThrow("видалено");
    });

    it("міняють власник і менеджер, решті відмовлено", async () => {
      const { id } = await create({ name: "Права на зміну" });
      for (const role of USER_ROLES) {
        const result = updateClient(db, users[role], id, { notes: role });
        if (role === "owner" || role === "manager")
          await expect(result, role).resolves.toBeUndefined();
        else await expect(result, role).rejects.toBeInstanceOf(ForbiddenError);
      }
    });
  });

  describe("область для клієнта без області (відповідь Романа А1.4)", () => {
    it("цифровий код стає «літери + номер», старий код записано в примітку", async () => {
      const { id, code } = await create({ name: "Цифровий", regionPrefix: null, notes: "Нотатка" });
      expect(code).toMatch(/^[0-9]+$/);
      const result = await assignClientRegion(db, users.manager, id, "ВС");
      expect(result.code).toMatch(/^ВС[0-9]+$/);
      const [row] = await db.select().from(clients).where(eq(clients.id, id));
      expect(row?.code).toBe(result.code);
      expect(row?.notes).toBe(`Нотатка\nСтарий код: ${code}.`);
    });

    it("клієнт, у якого вже є область, не перекодується", async () => {
      const { id } = await create({ name: "Уже з областю" });
      await expect(assignClientRegion(db, users.manager, id, "ВС")).rejects.toThrow(
        "вже є область",
      );
    });

    it("невідома область і відсутній клієнт відхиляються; права як у зміни", async () => {
      const { id } = await create({ name: "Цифровий 2", regionPrefix: null });
      await expect(assignClientRegion(db, users.manager, id, "ЯЯ")).rejects.toThrow(
        "Область не знайдено",
      );
      await expect(
        assignClientRegion(db, users.manager, crypto.randomUUID(), "ВС"),
      ).rejects.toThrow("не знайдено");
      await expect(assignClientRegion(db, users.accountant, id, "ВС")).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });

  describe("видалення і відновлення (D43)", () => {
    it("видаляє й повертає лише власник; код лишається зайнятим", async () => {
      const { id, code } = await create({ name: "Видалення", regionPrefix: "СА" });
      await expect(deleteClient(db, users.manager, id)).rejects.toBeInstanceOf(ForbiddenError);
      await deleteClient(db, users.owner, id);

      const next = await create({ name: "Після видаленого", regionPrefix: "СА" });
      expect(next.code).not.toBe(code);

      await expect(restoreClient(db, users.manager, id)).rejects.toBeInstanceOf(ForbiddenError);
      await restoreClient(db, users.owner, id);
      const [row] = await db.select().from(clients).where(eq(clients.id, id));
      expect(row?.deletedAt).toBeNull();
    });

    it("повторне видалення, відновлення живого, службовий клієнт: помилка", async () => {
      const { id } = await create({ name: "Двічі" });
      await deleteClient(db, users.owner, id);
      await expect(deleteClient(db, users.owner, id)).rejects.toThrow("вже видалено");
      await restoreClient(db, users.owner, id);
      await expect(restoreClient(db, users.owner, id)).rejects.toThrow("не видалено");
      const placeholder = await makeClient(db, {
        code: "404",
        name: "Новий клієнт",
        isPlaceholder: true,
      });
      await expect(deleteClient(db, users.owner, placeholder.id)).rejects.toThrow("Службового");
    });

    it("об'єднаного клієнта відновити не можна", async () => {
      const main = await makeClient(db, { code: "ВХ77" });
      const merged = await makeClient(db, {
        code: "ВХ78",
        deletedAt: new Date(),
        mergedIntoId: main.id,
      });
      await expect(restoreClient(db, users.owner, merged.id)).rejects.toThrow("об'єднано");
    });
  });

  describe("список і пошук (D47)", () => {
    let kyivCafe: { id: string; code: string };
    let lvivBar: { id: string; code: string };

    beforeAll(async () => {
      await db.delete(clients);
      kyivCafe = await create({
        name: "Кафе Вогник",
        regionPrefix: "АА",
        phone: "050 111 22 33",
        contactName: "Марія Петренко",
      });
      lvivBar = await create({
        name: "Бар Левів",
        regionPrefix: "ВС",
        phone: "067 999 88 77",
        contactName: "Іван",
      });
      await create({ name: "Ресторація Золотий ключ", regionPrefix: "АА" });
      await create({ name: "100% Лід_Плюс", regionPrefix: "АІ" });
    });

    const names = async (query: Parameters<typeof listClients>[2], actor = users.manager) =>
      (await listClients(db, actor, query)).items.map((item) => item.name);

    it("пошук за частиною назви без урахування регістру", async () => {
      expect(await names({ search: "вогник" })).toEqual(["Кафе Вогник"]);
      expect(await names({ search: "ВОГН" })).toEqual(["Кафе Вогник"]);
    });

    it("терпить помилку в літері (триграми)", async () => {
      expect(await names({ search: "Кафе Вогнік" })).toContain("Кафе Вогник");
    });

    it("знаходить за одним словом із помилкою всередині довгої назви", async () => {
      expect(await names({ search: "Вогнік" })).toContain("Кафе Вогник");
      expect(await names({ search: "вогнiк" })).toContain("Кафе Вогник");
    });

    it("зовсім інше слово нічого не знаходить", async () => {
      expect(await names({ search: "Кіт" })).toEqual([]);
      expect(await names({ search: "Автомобіль" })).toEqual([]);
    });

    it("пошук за кодом: повний, початок і латиницею", async () => {
      expect(await names({ search: kyivCafe.code })).toEqual(["Кафе Вогник"]);
      expect(await names({ search: kyivCafe.code.toLowerCase() })).toContain("Кафе Вогник");
      expect(await names({ search: "AA1" })).toContain("Кафе Вогник");
      expect(await names({ search: "ВС" })).toEqual(["Бар Левів"]);
    });

    it("лише цифри знаходять той самий номер у будь-якій області", async () => {
      const result = await names({ search: "1" });
      expect(result).toEqual(expect.arrayContaining(["Кафе Вогник", "Бар Левів"]));
    });

    it("пошук за частиною телефону в будь-якому запису", async () => {
      expect(await names({ search: "111 22" })).toEqual(["Кафе Вогник"]);
      expect(await names({ search: "+38 067" })).toEqual(["Бар Левів"]);
      expect(await names({ search: "8877" })).toEqual(["Бар Левів"]);
    });

    it("пошук за іменем контакту", async () => {
      expect(await names({ search: "петренко" })).toEqual(["Кафе Вогник"]);
    });

    it("символи % і _ у запиті шукаються як звичайні", async () => {
      expect(await names({ search: "100%" })).toEqual(["100% Лід_Плюс"]);
      expect(await names({ search: "Лід_П" })).toEqual(["100% Лід_Плюс"]);
      // Просто % не повинен знаходити всіх.
      expect(await names({ search: "%" })).toEqual(["100% Лід_Плюс"]);
    });

    it("порожній пошук дає всіх за назвою, нічого не знайдено дає порожній список", async () => {
      expect((await names({})).length).toBe(4);
      expect(await names({ search: "щось-неіснуюче-xyz" })).toEqual([]);
    });

    it("точний збіг коду стоїть першим", async () => {
      const page = await listClients(db, users.manager, { search: "АА1" });
      expect(page.items[0]?.code).toBe("АА1");
    });

    it("фільтри за статусом, менеджером і застосуванням", async () => {
      const [irrelevant] = await db
        .select()
        .from(clientStatuses)
        .where(eq(clientStatuses.code, "irrelevant"));
      await updateClient(db, users.owner, lvivBar.id, { statusId: irrelevant!.id });
      expect(await names({ statusId: irrelevant!.id })).toEqual(["Бар Левів"]);
      expect(await names({ managerId: users.manager.id })).toHaveLength(4);
      expect(await names({ managerId: users.owner.id })).toEqual([]);
      const [app] = await db.select().from(clientApplications).limit(1);
      await updateClient(db, users.owner, kyivCafe.id, { applicationId: app!.id });
      expect(await names({ applicationId: app!.id })).toEqual(["Кафе Вогник"]);
    });

    it("список частинами: hasMore і зсув", async () => {
      const page1 = await listClients(db, users.manager, { limit: 3 });
      expect(page1.items).toHaveLength(3);
      expect(page1.hasMore).toBe(true);
      const page2 = await listClients(db, users.manager, { limit: 3, offset: 3 });
      expect(page2.items).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
      const ids = new Set([...page1.items, ...page2.items].map((i) => i.id));
      expect(ids.size).toBe(4);
    });

    it("видалених приховано; їх показує лише власник за ознакою", async () => {
      await deleteClient(db, users.owner, lvivBar.id);
      expect(await names({})).not.toContain("Бар Левів");
      expect(await names({ includeDeleted: true }, users.manager)).not.toContain("Бар Левів");
      expect(await names({ includeDeleted: true }, users.owner)).toContain("Бар Левів");
      await restoreClient(db, users.owner, lvivBar.id);
    });

    it("рядок містить основний телефон, статус і менеджера, але не ціни", async () => {
      await changeClientPrice(db, users.manager, {
        clientId: kyivCafe.id,
        iceTypeId: ice16,
        pricePerKg: "60",
        validFrom: "2026-11-01",
      });
      const page = await listClients(db, users.manager, { search: kyivCafe.code });
      expect(page.items[0]).toMatchObject({
        code: kyivCafe.code,
        primaryPhone: "+380501112233",
        managerName: "Тест manager",
        isDeleted: false,
      });
      expect(JSON.stringify(page)).not.toMatch(/price/i);
    });

    it("читають власник, менеджер, старший локації й бухгалтер; виробництво і водій ні", async () => {
      for (const role of USER_ROLES) {
        const result = listClients(db, users[role], {});
        if (["owner", "manager", "location_lead", "accountant"].includes(role)) {
          await expect(result, role).resolves.toHaveProperty("items");
        } else {
          await expect(result, role).rejects.toBeInstanceOf(ForbiddenError);
        }
      }
    });

    it("некоректні фільтри відхиляються", async () => {
      await expect(listClients(db, users.manager, { statusId: "не-uuid" })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe("картка клієнта і ціни (правило: ціни лише з правом)", () => {
    let clientId: string;

    beforeAll(async () => {
      clientId = (await create({ name: "Картка з цінами", phone: "050 333 44 55" })).id;
      await changeClientPrice(db, users.manager, {
        clientId,
        iceTypeId: ice16,
        pricePerKg: "58",
        validFrom: "2026-11-01",
      });
    });

    it("власник, менеджер і бухгалтер бачать ціни в картці", async () => {
      for (const role of ["owner", "manager", "accountant"] as const) {
        const card = await getClient(db, users[role], clientId);
        expect(card?.prices, role).toHaveLength(1);
        expect(card?.prices?.[0]).toMatchObject({ pricePerKg: "58.00", iceTypeName: "16 мм" });
        expect(card?.contacts[0]).toMatchObject({ phone: "+380503334455", isPrimary: true });
      }
    });

    it("старший локації бачить картку без цін: ключа prices немає зовсім", async () => {
      const card = await getClient(db, users.location_lead, clientId);
      expect(card).not.toBeNull();
      expect(card).not.toHaveProperty("prices");
      expect(JSON.stringify(card)).not.toMatch(/pricePerKg|price/i);
    });

    it("жодна відповідь про клієнта не містить заборонених для ролі полів", async () => {
      for (const role of ["owner", "manager", "location_lead", "accountant"] as const) {
        const card = await getClient(db, users[role], clientId);
        const list = await listClients(db, users[role], {});
        expect(findForbiddenFields(card, role), `картка, ${role}`).toEqual([]);
        expect(findForbiddenFields(list, role), `список, ${role}`).toEqual([]);
      }
      // Контроль: перевірка справді ловить ціну для ролі без права.
      const withPrices = await getClient(db, users.manager, clientId);
      expect(findForbiddenFields(withPrices, "location_lead").length).toBeGreaterThan(0);
      expect(findForbiddenFields(withPrices, "production").length).toBeGreaterThan(0);
    });

    it("виробництво і водій картку не відкривають", async () => {
      for (const role of ["production", "driver"] as const) {
        await expect(getClient(db, users[role], clientId), role).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
    });

    it("неіснуючий клієнт дає null, поганий ідентифікатор помилку", async () => {
      expect(await getClient(db, users.manager, crypto.randomUUID())).toBeNull();
      await expect(getClient(db, users.manager, "не-uuid")).rejects.toBeInstanceOf(ValidationError);
    });

    it("видаленого клієнта бачить лише власник", async () => {
      const { id } = await create({ name: "Прихований" });
      await deleteClient(db, users.owner, id);
      expect((await getClient(db, users.owner, id))?.isDeleted).toBe(true);
      expect(await getClient(db, users.manager, id)).toBeNull();
      expect(await getClient(db, users.accountant, id)).toBeNull();
    });
  });

  describe("схожі клієнти (D48)", () => {
    let phoneOwnerId: string;
    beforeAll(async () => {
      phoneOwnerId = (
        await create({ name: "Унікальна Назва Тест", regionPrefix: "ВК", phone: "063 555 66 77" })
      ).id;
    });

    it("знаходить за тим самим телефоном, у будь-якому записі", async () => {
      const found = await findSimilarClients(db, users.manager, { phone: "+38 (063) 555-66-77" });
      expect(found).toEqual([expect.objectContaining({ id: phoneOwnerId, reason: "phone" })]);
    });

    it("знаходить схожу назву, терпить помилку, але не дуже різну", async () => {
      expect(
        (await findSimilarClients(db, users.manager, { name: "Унікальна Назва Тест" }))[0]?.id,
      ).toBe(phoneOwnerId);
      expect(
        (await findSimilarClients(db, users.manager, { name: "Унікальна Назва Тесм" }))[0]?.id,
      ).toBe(phoneOwnerId);
      expect(await findSimilarClients(db, users.manager, { name: "Зовсім інша назва" })).toEqual(
        [],
      );
    });

    it("коротка назва, порожній ввід і видалені не дають підказок", async () => {
      expect(await findSimilarClients(db, users.manager, { name: "Ун" })).toEqual([]);
      expect(await findSimilarClients(db, users.manager, {})).toEqual([]);
      await deleteClient(db, users.owner, phoneOwnerId);
      expect(
        await findSimilarClients(db, users.manager, {
          name: "Унікальна Назва Тест",
          phone: "063 555 66 77",
        }),
      ).toEqual([]);
    });

    it("підказки бачать ті, хто читає клієнтів", async () => {
      await expect(
        findSimilarClients(db, users.production, { name: "Тест" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        findSimilarClients(db, users.accountant, { name: "Тест" }),
      ).resolves.toBeInstanceOf(Array);
    });
  });
});
