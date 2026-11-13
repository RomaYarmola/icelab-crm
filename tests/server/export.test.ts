import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataExports, settings } from "@/db/schema";
import { listAuditEntries } from "@/server/audit";
import { recordCashEntry } from "@/server/cash";
import { createClient } from "@/server/clients";
import { addContact } from "@/server/client-details";
import { ValidationError } from "@/server/errors";
import {
  EXPORT_MAX_ROWS,
  exportCash,
  exportClients,
  exportEverything,
  exportOrders,
  type ExportFile,
} from "@/server/export";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { USER_ROLES } from "@/server/permissions";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";
import { excelSerial, readXlsx, sheetValues } from "./xlsx-reader";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const CAN_EXPORT = ["owner", "manager", "accountant"];
const read = (file: ExportFile) => readXlsx(new Uint8Array(file.buffer));

describe("експорт у Excel: права, зміст, журнал (B8, D92–D96)", () => {
  let t: OrderTestContext;
  let firstOrder: { id: string; number: number | null };
  let cashOrderId: string;
  let hostileClientId: string;

  beforeAll(async () => {
    t = await setupOrderTests();

    firstOrder = await t.create({ orderDate: "2032-05-10", kgSold: 40 });
    await t.create({ orderDate: "2032-05-11", kgSold: 20 });
    const confirmed = await t.create({ orderDate: "2032-05-12", kgSold: 10 });
    await transitionOrder(t.db, t.users.owner, confirmed.id, "confirmed");

    // Замовлення з готівкою й одним записом.
    cashOrderId = (await t.create({ orderDate: "2032-06-01", paymentKind: "cash" })).id;
    await transitionOrder(t.db, t.users.owner, cashOrderId, "confirmed");
    await transitionOrder(t.db, t.users.location_lead, cashOrderId, "in_production");
    await transitionOrder(t.db, t.users.location_lead, cashOrderId, "packed");
    await transitionOrder(t.db, t.users.location_lead, cashOrderId, "shipped");
    await recordCashEntry(t.db, t.users.location_lead, { orderId: cashOrderId, amount: "500" });

    // Клієнт із «формулою» в назві й телефоном.
    const hostile = await createClient(t.db, t.users.manager, {
      name: '=HYPERLINK("http://x","клік")',
      regionPrefix: "АА",
    });
    hostileClientId = hostile.id;
    await addContact(t.db, t.users.manager, hostile.id, { name: "Марія", phone: "0501234567" });
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const logged = () => t.db.select().from(dataExports);

  describe("права", () => {
    it("списки й готівку вивантажують власник, менеджер і бухгалтер, решта ні", async () => {
      for (const role of USER_ROLES) {
        const user = t.users[role];
        const attempts = [
          () => exportOrders(t.db, user, {}),
          () => exportClients(t.db, user, {}),
          () => exportCash(t.db, user, { date: "2032-06-01" }),
        ];
        for (const attempt of attempts) {
          if (CAN_EXPORT.includes(role)) {
            await expect(attempt(), `${role} має змогу`).resolves.toMatchObject({
              rowCount: expect.any(Number),
            });
          } else {
            await expect(attempt(), `${role} не має права`).rejects.toBeInstanceOf(ForbiddenError);
          }
        }
      }
    });

    it("«Експорт усього» лише власнику", async () => {
      for (const role of USER_ROLES) {
        const attempt = exportEverything(t.db, t.users[role]);
        if (role === "owner") await expect(attempt).resolves.toMatchObject({ kind: "all" });
        else await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
      }
    });

    it("відмова нічого не пише в журнал експортів", async () => {
      const before = (await logged()).length;
      await expect(exportOrders(t.db, t.users.production, {})).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(exportEverything(t.db, t.users.manager)).rejects.toBeInstanceOf(ForbiddenError);
      expect((await logged()).length).toBe(before);
    });
  });

  describe("замовлення", () => {
    it("файл містить заголовки українською, дати, числа, статуси словами й суму", async () => {
      const file = await exportOrders(t.db, t.users.owner, {
        dateFrom: "2032-05-10",
        dateTo: "2032-05-12",
      });
      const sheet = read(file).sheets[0]!;
      expect(sheet.name).toBe("Замовлення");
      expect(
        sheetValues(sheet, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"])[0],
      ).toEqual([
        "№",
        "Дата виконання",
        "Код клієнта",
        "Клієнт",
        "Локація",
        "Статус",
        "Лід",
        "Кг на продаж",
        "Кг виготовити",
        "Доставка",
        "Сума, ₴",
      ]);
      expect(sheet.rows).toHaveLength(4);
      // Нові дати першими: 12, 11, 10 травня.
      expect(sheet.rows[1]!.B).toMatchObject({ type: "n", value: excelSerial(2032, 5, 12) });
      expect(sheet.rows[1]!.F!.value).toBe("Підтверджено");
      expect(sheet.rows[3]!.F!.value).toBe("Чернетка");
      expect(sheet.rows[3]!.A).toMatchObject({ type: "n", value: firstOrder.number });
      expect(sheet.rows[3]!.H).toMatchObject({ type: "n", value: 40 });
      expect(sheet.rows[3]!.K!.type).toBe("n");
      expect(sheet.rows[3]!.K!.format).toBe("#,##0.00");
      expect(file.rowCount).toBe(3);
      expect(file.fileName).toMatch(/^icelab-orders-\d{4}-\d{2}-\d{2}\.xlsx$/);
    });

    it("враховує фільтри екрана: статус, пошук за номером", async () => {
      const byStatus = await exportOrders(t.db, t.users.manager, {
        dateFrom: "2032-05-10",
        dateTo: "2032-05-12",
        statuses: ["confirmed"],
      });
      expect(byStatus.rowCount).toBe(1);
      const byNumber = await exportOrders(t.db, t.users.accountant, {
        search: String(firstOrder.number),
      });
      expect(byNumber.rowCount).toBe(1);
      expect(read(byNumber).sheets[0]!.rows[1]!.A!.value).toBe(firstOrder.number);
      const none = await exportOrders(t.db, t.users.owner, { dateFrom: "2040-01-01" });
      expect(none.rowCount).toBe(0);
      expect(read(none).sheets[0]!.rows).toHaveLength(1);
    });

    it("не змінює екранні межі списку: понад ліміт не віддає, а просить звузити фільтр", async () => {
      const before = (await logged()).length;
      await expect(
        exportOrders(
          t.db,
          t.users.owner,
          { dateFrom: "2032-05-10", dateTo: "2032-05-12" },
          { maxRows: 2 },
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        exportOrders(
          t.db,
          t.users.owner,
          { dateFrom: "2032-05-10", dateTo: "2032-05-12" },
          { maxRows: 2 },
        ),
      ).rejects.toThrow(/Звузьте фільтр/);
      expect((await logged()).length).toBe(before);
      // Рівно в ліміт ще можна.
      await expect(
        exportOrders(
          t.db,
          t.users.owner,
          { dateFrom: "2032-05-10", dateTo: "2032-05-12" },
          { maxRows: 3 },
        ),
      ).resolves.toMatchObject({ rowCount: 3 });
      expect(EXPORT_MAX_ROWS).toBe(20_000);
    });
  });

  describe("клієнти", () => {
    it("«формула» в назві не виконується, телефон лишається текстом", async () => {
      const file = await exportClients(t.db, t.users.manager, { search: "HYPERLINK" });
      const sheet = read(file).sheets[0]!;
      expect(sheet.xml).not.toMatch(/<f[\s>]/);
      expect(sheetValues(sheet, ["A", "B", "C", "D", "E"])[0]).toEqual([
        "Код",
        "Назва",
        "Статус",
        "Менеджер",
        "Телефон",
      ]);
      const row = sheet.rows[1]!;
      expect(row.B!.type).toBe("s");
      expect(String(row.B!.value).startsWith("'=HYPERLINK")).toBe(true);
      expect(row.E).toMatchObject({ type: "s", value: "+380501234567" });
    });

    it("колонку «Видалено» бачить лише власник, що ввімкнув видалених", async () => {
      const owner = await exportClients(t.db, t.users.owner, { includeDeleted: true });
      expect(sheetValues(read(owner).sheets[0]!, ["F"])[0]).toEqual(["Видалено"]);
      const manager = await exportClients(t.db, t.users.manager, { includeDeleted: true });
      expect(read(manager).sheets[0]!.rows[0]!.F).toBeUndefined();
    });
  });

  describe("готівка", () => {
    it("віддає замовлення дня, записи й підсумок", async () => {
      const file = await exportCash(t.db, t.users.accountant, { date: "2032-06-01" });
      const { sheets } = read(file);
      expect(sheets.map((s) => s.name)).toEqual(["Готівка", "Записи", "Підсумок"]);
      expect(sheets[0]!.rows).toHaveLength(2);
      expect(sheets[0]!.rows[1]!.G!.type).toBe("n");
      expect(sheets[1]!.rows).toHaveLength(2);
      expect(sheets[1]!.rows[1]!.D).toMatchObject({ type: "n", value: 500 });
      expect(sheets[1]!.rows[1]!.F!.value).toBe("веб");
      expect(sheetValues(sheets[2]!, ["A"]).map((r) => r[0])).toEqual(
        expect.arrayContaining(["Мало надійти", "Внесено", "Різниця"]),
      );
      expect(file.fileName).toBe("icelab-cash-2032-06-01.xlsx");
    });

    it("некоректна дата відхиляється", async () => {
      await expect(exportCash(t.db, t.users.owner, { date: "вчора" })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe("експорт усього", () => {
    let file: ExportFile;
    beforeAll(async () => {
      await t.db.insert(settings).values([
        { key: "integrations.np_api_key", value: "секрет-123" },
        { key: "telegram.bot_token", value: "токен-456" },
        { key: "markup.demo_percent", value: 7 },
      ]);
      file = await exportEverything(t.db, t.users.owner);
    });

    it("має аркуш на кожну робочу таблицю й жодного з акаунтами", () => {
      const names = read(file).sheets.map((s) => s.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "Клієнти",
          "Контакти",
          "Адреси",
          "Ціни клієнтів",
          "Прайс",
          "Замовлення",
          "Позиції замовлень",
          "Історія статусів",
          "Зміни ціни",
          "Готівка",
          "Локації",
          "Типи льоду",
          "Типи боксів",
          "Джерела замовлень",
          "Статуси клієнтів",
          "Застосування",
          "Області",
          "Налаштування",
        ]),
      );
      expect(names.join("|")).not.toMatch(/Користувач|Акаунт|Профіл|Пароль/);
    });

    it("рядків стільки, скільки в базі, а посилання показані назвами, не ідентифікаторами", async () => {
      const { sheets } = read(file);
      const ordersSheet = sheets.find((s) => s.name === "Замовлення")!;
      expect(ordersSheet.rows.length - 1).toBe(4);
      const clientsSheet = sheets.find((s) => s.name === "Клієнти")!;
      expect(
        clientsSheet.rows.some((r) => r.A?.value === "Кафе Тест" || r.B?.value === "Кафе Тест"),
      ).toBe(true);
      for (const sheet of sheets) {
        for (const row of sheet.rows) {
          for (const cell of Object.values(row)) {
            if (cell.type === "s") expect(String(cell.value), sheet.name).not.toMatch(UUID);
          }
        }
      }
      // Клієнт у замовленні названий кодом і назвою.
      expect(String(ordersSheet.rows[1]!.C!.value)).toContain("Кафе Тест");
    });

    it("налаштування-секрети не виходять, звичайні виходять", () => {
      const sheet = read(file).sheets.find((s) => s.name === "Налаштування")!;
      const keys = sheet.rows.map((r) => String(r.A?.value ?? ""));
      expect(keys).toContain("markup.demo_percent");
      expect(keys).not.toContain("integrations.np_api_key");
      expect(keys).not.toContain("telegram.bot_token");
      const all = sheet.xml;
      expect(all).not.toContain("секрет-123");
      expect(all).not.toContain("токен-456");
    });
  });

  describe("журнал експортів", () => {
    it("кожне вивантаження лишає запис: хто, що, фільтри, рядків, файл", async () => {
      const before = new Set((await logged()).map((r) => r.id));
      const file = await exportOrders(t.db, t.users.accountant, {
        dateFrom: "2032-05-10",
        statuses: ["draft", "confirmed"],
        search: "Кафе",
      });
      const added = (await logged()).filter((r) => !before.has(r.id));
      expect(added).toHaveLength(1);
      const row = added[0]!;
      expect(row.createdBy).toBe(t.users.accountant.id);
      expect(row.fileName).toBe(file.fileName);
      expect(row).toMatchObject({ kind: "orders", rowCount: file.rowCount });
      expect(row.params).toEqual({
        "Дата виконання від": "10.05.2032",
        Статус: "Чернетка, Підтверджено",
        Пошук: "Кафе",
      });
    });

    it("експорт видно власнику в журналі змін словами й заборонено змінювати", async () => {
      await exportClients(t.db, t.users.manager, { search: "Тест" });
      const page = await listAuditEntries(t.db, t.users.owner, { section: "exports" });
      const entry = page.items.find((i) => i.summary === "Вивантажено в Excel: Клієнти")!;
      expect(entry).toBeDefined();
      expect(entry.actorName).toBe(t.users.manager.fullName);
      expect(entry.sectionLabel).toBe("Експорт");
      expect(entry.subject).toMatch(/^Файл icelab-clients-/);
      const labels = entry.changes.map((c) => c.label);
      expect(labels).toEqual(
        expect.arrayContaining(["Що вивантажено", "Фільтри", "Рядків", "Файл"]),
      );
      expect(entry.changes.find((c) => c.label === "Фільтри")!.after).toBe("Пошук: Тест");
      // Службові поля не показуємо, а після експорту сам файл не потрапляє в журнал.
      expect(labels).not.toContain("Ідентифікатор");
      expect(JSON.stringify([entry.summary, entry.subject, entry.changes])).not.toMatch(UUID);
      await expect(
        t.db
          .update(dataExports)
          .set({ rowCount: 0 })
          .where(eq(dataExports.createdBy, t.users.manager.id)),
      ).rejects.toThrow();
    });

    it("«Експорт усього» пишеться з видом «Усі дані» й порожніми фільтрами", async () => {
      const rows = await logged();
      const all = rows.find((r) => r.kind === "all")!;
      expect(all).toMatchObject({ createdBy: t.users.owner.id, params: {} });
      expect(all.rowCount).toBeGreaterThan(0);
      const page = await listAuditEntries(t.db, t.users.accountant, { section: "exports" });
      const entry = page.items.find((i) => i.summary === "Вивантажено в Excel: Усі дані")!;
      expect(entry.changes.find((c) => c.label === "Фільтри")!.after).toBe("без фільтрів");
    });
  });

  it("клієнт, створений для перевірки, існує (страховка від тихої зміни фікстури)", () => {
    expect(hostileClientId).toMatch(UUID);
  });
});
