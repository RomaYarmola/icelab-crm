import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addAddressAction,
  addContactAction,
  assignRegionAction,
  changeClientPriceAction,
  createClientAction,
  deleteClientAction,
  findSimilarClientsAction,
  loadMoreClientsAction,
  mergeClientsAction,
  previewClientCodeAction,
  restoreClientAction,
  updateClientAction,
} from "@/app/(app)/clients/actions";
import { changeDefaultPriceAction } from "@/app/(app)/more/prices/actions";
import { getDb } from "@/db/client";
import {
  clientAddresses,
  clientContacts,
  clientPrices,
  clients,
  defaultPrices,
  iceTypes,
} from "@/db/schema";
import { seedReferenceData } from "@/db/seed";
import { requireUser } from "@/server/auth";
import { createClient } from "@/server/clients";
import type { AppUser } from "@/server/guards";
import type { UserRole } from "@/server/permissions";
import { INITIAL_FORM_STATE, type FormState } from "@/utils/formState";
import { createTestDb, type TestDb } from "../db/harness";
import { makeAppUsers } from "../db/helpers";

vi.mock("@/server/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const run = (
  action: (previous: FormState, data: FormData) => Promise<FormState>,
  fields: Record<string, string>,
) => action(INITIAL_FORM_STATE, form(fields));

/** Дія з redirect кидає службову помилку Next.js: дістаємо з неї адресу переходу. */
async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw error;
  }
  throw new Error("Перехід не відбувся");
}

describe("серверні дії розділу «Клієнти»", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let users: Record<UserRole, AppUser>;
  let ice16: string;

  const as = (role: UserRole) => vi.mocked(requireUser).mockResolvedValue(users[role]);

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    await seedReferenceData(db);
    users = await makeAppUsers(db);
    ice16 = (await db.select().from(iceTypes).where(eq(iceTypes.code, "16mm")))[0]!.id;
  });
  afterAll(async () => {
    await ctx.client.close();
  });
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
    as("manager");
  });

  const newClient = async (name: string, regionPrefix: string | null = "АА") =>
    (await createClient(db, users.owner, { name, regionPrefix })).id;

  describe("читання для екранів", () => {
    it("«Показати ще»: наступна частина списку з ознакою, чи є ще", async () => {
      as("owner");
      for (let i = 1; i <= 3; i++) await newClient(`Список-${i}`, "АХ");
      const first = await loadMoreClientsAction({ search: "Список-", offset: 0 });
      expect(first.ok && first.page.items.map((item) => item.name)).toEqual([
        "Список-1",
        "Список-2",
        "Список-3",
      ]);
      const tail = await loadMoreClientsAction({ search: "Список-", offset: 2 });
      expect(tail.ok && tail.page.items.map((item) => item.name)).toEqual(["Список-3"]);
      expect(tail.ok && tail.page.hasMore).toBe(false);
    });

    it("«Показати ще»: сміття у фільтрах дає повідомлення, а не помилку сервера", async () => {
      const bad = await loadMoreClientsAction({ statusId: "не-ідентифікатор", offset: 0 });
      expect(bad).toEqual({ ok: false, message: "Некоректний ідентифікатор." });
      const negative = await loadMoreClientsAction({ offset: -5 });
      expect(negative.ok).toBe(false);
    });

    it("«Показати ще»: роль без права на клієнтів отримує відмову", async () => {
      as("production");
      expect(await loadMoreClientsAction({ offset: 0 })).toEqual({
        ok: false,
        message: "Недостатньо прав для цієї дії.",
      });
    });

    it("схожі клієнти: знаходить за назвою, а помилка дає порожній список", async () => {
      as("owner");
      await newClient("Кафе Унікальне", "АІ");
      const found = await findSimilarClientsAction({ name: "Кафе Унікальне" });
      expect(found.map((item) => item.name)).toContain("Кафе Унікальне");
      expect(await findSimilarClientsAction({ name: "ab" })).toEqual([]);
      as("production");
      expect(await findSimilarClientsAction({ name: "Кафе Унікальне" })).toEqual([]);
    });

    it("підказка коду: код за областю, null для невідомої області й без прав", async () => {
      expect(await previewClientCodeAction("ВН")).toMatch(/^ВН[0-9]+$/);
      expect(await previewClientCodeAction("")).toMatch(/^[0-9]+$/);
      expect(await previewClientCodeAction("ЯЯ")).toBeNull();
      as("accountant");
      expect(await previewClientCodeAction("АА")).toBeNull();
    });
  });

  describe("створення", () => {
    it("менеджер створює клієнта: код за областю, телефон нормалізовано, перехід на картку", async () => {
      const target = await redirectOf(
        run(createClientAction, {
          name: "Кафе «Тест»",
          regionPrefix: "ВС",
          phone: "050 123 45 67",
          contactName: "Олена",
          notes: "",
        }),
      );
      const [client] = await db.select().from(clients).where(eq(clients.name, "Кафе «Тест»"));
      expect(client?.code).toBe("ВС1");
      expect(target).toBe(`/clients/${client!.id}?created=1`);
      const [contact] = await db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, client!.id));
      expect(contact).toMatchObject({ phone: "+380501234567", name: "Олена", isPrimary: true });
      expect(client?.statusId).not.toBeNull();
      expect(client?.managerId).toBe(users.manager.id);
    });

    it("помилка введення: повідомлення українською і введені значення, клієнта не створено", async () => {
      const before = (await db.select().from(clients)).length;
      const state = await run(createClientAction, {
        name: "Хтось",
        regionPrefix: "АА",
        phone: "12-34",
        notes: "нотатка",
      });
      expect(state.status).toBe("error");
      expect(state.message).toContain("розпізнати телефон");
      expect(state.values).toMatchObject({ name: "Хтось", phone: "12-34", notes: "нотатка" });
      expect((await db.select().from(clients)).length).toBe(before);
    });

    it("порожня назва і невідома область дають зрозуміле повідомлення", async () => {
      expect((await run(createClientAction, { name: "  ", regionPrefix: "АА" })).message).toContain(
        "Вкажіть назву",
      );
      expect((await run(createClientAction, { name: "Х", regionPrefix: "ЯЯ" })).message).toContain(
        "Область не знайдено",
      );
    });

    it("бухгалтер і старший локації створити не можуть", async () => {
      for (const role of ["accountant", "location_lead", "production"] as const) {
        as(role);
        const state = await run(createClientAction, { name: `Від ${role}`, regionPrefix: "АА" });
        expect(state, role).toMatchObject({
          status: "error",
          message: "Недостатньо прав для цієї дії.",
        });
      }
      expect(
        await db.select().from(clients).where(eq(clients.name, "Від accountant")),
      ).toHaveLength(0);
    });
  });

  describe("зміна, область, видалення", () => {
    it("змінює клієнта, поганий id дає «Запис не знайдено»", async () => {
      const id = await newClient("До зміни");
      const state = await run(updateClientAction, {
        id,
        name: "Після зміни",
        edrpou: "12345678",
        markupPercentOverride: "10,5",
        inactiveDaysThreshold: "45",
        legalType: "company",
      });
      expect(state).toMatchObject({ status: "success", message: "Зміни збережено." });
      const [row] = await db.select().from(clients).where(eq(clients.id, id));
      expect(row).toMatchObject({
        name: "Після зміни",
        edrpou: "12345678",
        markupPercentOverride: "10.50",
        inactiveDaysThreshold: 45,
        legalType: "company",
      });
      expect((await run(updateClientAction, { id: "не-uuid", name: "Х" })).message).toBe(
        "Запис не знайдено.",
      );
    });

    it("порожні необов'язкові поля очищають значення, а не пишуть порожній рядок", async () => {
      const id = await newClient("Очищення");
      await run(updateClientAction, { id, name: "Очищення", notes: "Було", edrpou: "12345678" });
      await run(updateClientAction, { id, name: "Очищення", notes: "", edrpou: "" });
      const [row] = await db.select().from(clients).where(eq(clients.id, id));
      expect(row).toMatchObject({ notes: null, edrpou: null });
    });

    it("клієнту без області додає область: новий код, старий у примітці", async () => {
      const id = await newClient("Цифровий", null);
      const state = await run(assignRegionAction, { id, regionPrefix: "АІ" });
      expect(state.status).toBe("success");
      const [row] = await db.select().from(clients).where(eq(clients.id, id));
      expect(row?.code).toMatch(/^АІ[0-9]+$/);
      expect(row?.notes).toContain("Старий код");
    });

    it("видаляє і повертає лише власник; після видалення перехід на список", async () => {
      const id = await newClient("Видалення");
      expect(await run(deleteClientAction, { id })).toMatchObject({
        status: "error",
        message: "Недостатньо прав для цієї дії.",
      });
      as("owner");
      expect(await redirectOf(run(deleteClientAction, { id }))).toBe("/clients");
      expect(
        (await db.select().from(clients).where(eq(clients.id, id)))[0]?.deletedAt,
      ).not.toBeNull();
      expect(await run(restoreClientAction, { id })).toMatchObject({
        status: "success",
        message: "Клієнта повернуто до списку.",
      });
    });
  });

  describe("контакти й адреси", () => {
    it("додає контакт і адресу, помилки показує українською зі значеннями", async () => {
      const clientId = await newClient("З контактами");
      expect(
        await run(addContactAction, {
          clientId,
          name: "Іван",
          phone: "067 111 22 33",
          isPrimary: "on",
        }),
      ).toMatchObject({ status: "success" });
      const [contact] = await db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, clientId));
      expect(contact).toMatchObject({ phone: "+380671112233", isPrimary: true });
      const bad = await run(addContactAction, { clientId, name: "", phone: "" });
      expect(bad).toMatchObject({ status: "error", message: "Вкажіть ім'я або телефон контакту." });

      expect(
        await run(addAddressAction, {
          clientId,
          kind: "np_warehouse",
          cityText: "Київ",
          npWarehouseNumber: "15",
          isDefault: "on",
        }),
      ).toMatchObject({ status: "success" });
      const [address] = await db
        .select()
        .from(clientAddresses)
        .where(eq(clientAddresses.clientId, clientId));
      expect(address).toMatchObject({
        kind: "np_warehouse",
        cityText: "Київ",
        npWarehouseNumber: "15",
        isDefault: true,
      });
      const noText = await run(addAddressAction, { clientId, kind: "delivery" });
      expect(noText.message).toContain("місто, адресу або номер");
    });

    it("відмова не власнику і не менеджеру", async () => {
      const clientId = await newClient("Для відмови");
      as("accountant");
      expect(await run(addContactAction, { clientId, name: "Х" })).toMatchObject({
        status: "error",
        message: "Недостатньо прав для цієї дії.",
      });
    });
  });

  describe("ціни", () => {
    it("менеджер ставить ціну клієнту «від дати»; та сама ціна й раніша дата дають помилку", async () => {
      const clientId = await newClient("З ціною");
      const ok = await run(changeClientPriceAction, {
        clientId,
        iceTypeId: ice16,
        pricePerKg: "60,5",
        validFrom: "2026-11-01",
      });
      expect(ok).toMatchObject({ status: "success" });
      const [price] = await db
        .select()
        .from(clientPrices)
        .where(eq(clientPrices.clientId, clientId));
      expect(price).toMatchObject({ pricePerKg: "60.50", validFrom: "2026-11-01", validTo: null });

      expect(
        (
          await run(changeClientPriceAction, {
            clientId,
            iceTypeId: ice16,
            pricePerKg: "60.50",
            validFrom: "2026-11-10",
          })
        ).message,
      ).toContain("вже діє");
      const earlier = await run(changeClientPriceAction, {
        clientId,
        iceTypeId: ice16,
        pricePerKg: "70",
        validFrom: "2026-10-01",
      });
      expect(earlier.message).toContain("раніше початку");
      expect(earlier.values).toMatchObject({ pricePerKg: "70", validFrom: "2026-10-01" });
    });

    it("порожній тип льоду означає «для будь-якого типу»", async () => {
      const clientId = await newClient("Для будь-якого");
      await run(changeClientPriceAction, {
        clientId,
        iceTypeId: "",
        pricePerKg: "55",
        validFrom: "2026-11-01",
      });
      const [price] = await db
        .select()
        .from(clientPrices)
        .where(eq(clientPrices.clientId, clientId));
      expect(price?.iceTypeId).toBeNull();
    });

    it("бухгалтер і старший локації ціни клієнта не міняють", async () => {
      const clientId = await newClient("Чужі ціни");
      for (const role of ["accountant", "location_lead"] as const) {
        as(role);
        expect(
          await run(changeClientPriceAction, {
            clientId,
            iceTypeId: ice16,
            pricePerKg: "50",
            validFrom: "2026-11-01",
          }),
          role,
        ).toMatchObject({ status: "error", message: "Недостатньо прав для цієї дії." });
      }
      expect(
        await db.select().from(clientPrices).where(eq(clientPrices.clientId, clientId)),
      ).toHaveLength(0);
    });

    it("прайс змінює лише власник", async () => {
      as("owner");
      expect(
        await run(changeDefaultPriceAction, {
          iceTypeId: ice16,
          pricePerKg: "60",
          validFrom: "2026-11-01",
        }),
      ).toMatchObject({ status: "success" });
      expect(
        (await db.select().from(defaultPrices).where(eq(defaultPrices.iceTypeId, ice16)))[0]
          ?.pricePerKg,
      ).toBe("60.00");
      expect(
        (
          await run(changeDefaultPriceAction, {
            iceTypeId: "",
            pricePerKg: "60",
            validFrom: "2026-11-01",
          })
        ).message,
      ).toBe("Оберіть тип льоду.");
      for (const role of ["manager", "accountant", "location_lead"] as const) {
        as(role);
        expect(
          await run(changeDefaultPriceAction, {
            iceTypeId: ice16,
            pricePerKg: "99",
            validFrom: "2026-12-01",
          }),
          role,
        ).toMatchObject({ status: "error", message: "Недостатньо прав для цієї дії." });
      }
      expect(
        await db.select().from(defaultPrices).where(eq(defaultPrices.iceTypeId, ice16)),
      ).toHaveLength(1);
    });
  });

  describe("об'єднання", () => {
    it("власник об'єднує, далі перехід на головну картку; менеджеру відмовлено", async () => {
      const mainId = await newClient("Головний");
      const duplicateId = await newClient("Дубль");
      expect(await run(mergeClientsAction, { mainId, duplicateId })).toMatchObject({
        status: "error",
        message: "Недостатньо прав для цієї дії.",
      });
      as("owner");
      expect(await redirectOf(run(mergeClientsAction, { mainId, duplicateId }))).toBe(
        `/clients/${mainId}?merged=1`,
      );
      expect(
        (await db.select().from(clients).where(eq(clients.id, duplicateId)))[0]?.mergedIntoId,
      ).toBe(mainId);
    });

    it("того самого клієнта чи поганий id: повідомлення, без переходу", async () => {
      as("owner");
      const id = await newClient("Сам із собою");
      expect((await run(mergeClientsAction, { mainId: id, duplicateId: id })).message).toContain(
        "двох різних",
      );
      expect((await run(mergeClientsAction, { mainId: "x", duplicateId: id })).message).toBe(
        "Запис не знайдено.",
      );
    });
  });
});
