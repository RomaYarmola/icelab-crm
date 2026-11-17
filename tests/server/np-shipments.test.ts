import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditLog,
  boxTypes,
  clientAddresses,
  clientContacts,
  integrationLogs,
  orders,
  shipments,
} from "@/db/schema";
import { ForbiddenError } from "@/server/guards";
import { NpError } from "@/server/np/client";
import { saveLocationSender } from "@/server/np/settings";
import {
  createShipment,
  deleteShipment,
  getShipmentCard,
  loadShipmentForSticker,
  previewShipmentPrice,
} from "@/server/np/shipments";
import { fetchStickerPdf, stickerUrl } from "@/server/np/sticker";
import { transitionOrder } from "@/server/order-status";
import { USER_ROLES } from "@/server/permissions";
import { ValidationError } from "@/server/errors";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

type Handler = (method: string, props: Record<string, unknown>) => unknown;

/** Підмінений API Нової Пошти: відповідь за методом, усі виклики запам'ятовуються. */
function fakeNp(handler: Handler) {
  const calls: { method: string; props: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as {
      modelName: string;
      calledMethod: string;
      methodProperties: Record<string, unknown>;
    };
    const method = `${body.modelName}/${body.calledMethod}`;
    calls.push({ method, props: body.methodProperties });
    const result = handler(method, body.methodProperties);
    if (result instanceof Error) return Promise.reject(result);
    const payload =
      typeof result === "object" && result !== null && "errors" in result
        ? { success: false, data: [], ...(result as object) }
        : { success: true, data: result, errors: [] };
    return Promise.resolve(new Response(JSON.stringify(payload)));
  });
  return { calls, api: { apiKey: "key", fetchImpl: fetchImpl as never, retryDelayMs: 0 } };
}

const HAPPY: Handler = (method) => {
  switch (method) {
    case "Counterparty/save":
      return [{ Ref: "cp1", ContactPerson: { data: [{ Ref: "cn1" }] } }];
    case "ContactPerson/save":
      return [{ Ref: "cn1" }];
    case "InternetDocument/getDocumentPrice":
      return [{ Cost: 85 }];
    case "InternetDocument/save":
      return [{ Ref: "doc-ref-1", IntDocNumber: "20450000000001", CostOnSite: "85" }];
    case "InternetDocument/delete":
      return [{ Ref: "doc-ref-1" }];
    default:
      return [];
  }
};

describe("накладні Нової Пошти із замовлення (B10, PR 3)", () => {
  let t: OrderTestContext;
  let orderId: string;
  let addressId: string;
  let typeId: string;
  const owner = () => t.users.owner;

  beforeAll(async () => {
    t = await setupOrderTests();
    await saveLocationSender(t.db, owner(), {
      locationId: t.location,
      senderRef: "s1",
      contactRef: "c1",
      addressRef: "a1",
      cityRef: "sender-city",
      phone: "+380441112233",
    });
    typeId = (await t.db.select().from(boxTypes)).find((x) => !x.isClientOwned)!.id;
    await t.db.update(boxTypes).set({ emptyWeightKg: "1.500" }).where(eq(boxTypes.id, typeId));
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  beforeEach(async () => {
    await t.db.delete(shipments);
    await t.db.delete(clientContacts);
    const [address] = await t.db
      .insert(clientAddresses)
      .values({
        clientId: t.client.id,
        kind: "np_warehouse",
        cityText: "Київ",
        npCityRef: "city-kyiv",
        npWarehouseRef: "wh-5",
        npWarehouseNumber: "5",
        isResolved: true,
      })
      .returning();
    addressId = address!.id;
    const created = await t.create({
      orderDate: "2034-02-10",
      deliveryMethod: "np",
      addressId,
      recipientName: "Коваль Олена",
      recipientPhone: "+380501234567",
      boxTypeId: typeId,
      boxCount: 2,
      kgSold: 30,
    });
    orderId = created.id;
    await transitionOrder(t.db, owner(), orderId, "confirmed");
  });

  it("блок: ТТН ще немає, умови виконані, вага = лід + бокси, суми бачать ролі з грошима", async () => {
    const card = (await getShipmentCard(t.db, t.users.manager, orderId))!;
    expect(card.blockers).toEqual([]);
    expect(card.shipment).toBeNull();
    expect(card.params.seats).toBe(2);
    expect(card.params.emptyWeightKnown).toBe(true);
    expect(card.params.weightKg).toBeGreaterThan(30);
    expect(card.canSeeMoney).toBe(true);
    const lead = (await getShipmentCard(t.db, t.users.location_lead, orderId))!;
    expect(lead.canSeeMoney).toBe(false);
  });

  it("блок бачать лише власник, менеджер і старший своєї локації", async () => {
    for (const role of USER_ROLES) {
      const card = await getShipmentCard(t.db, t.users[role], orderId);
      const allowed = role === "owner" || role === "manager" || role === "location_lead";
      expect(card !== null, role).toBe(allowed);
    }
    expect(await getShipmentCard(t.db, t.otherLead, orderId)).toBeNull();
  });

  it("створення: одержувач, вартість, накладна; усе записано, у журналі викликів немає ключа", async () => {
    const np = fakeNp(HAPPY);
    const result = await createShipment(
      t.db,
      t.users.manager,
      { orderId, payer: "Recipient" },
      np.api,
    );
    expect(result).toMatchObject({ ttnNumber: "20450000000001", duplicate: false });
    const doc = np.calls.find((c) => c.method === "InternetDocument/save")!.props;
    expect(doc).toMatchObject({
      PayerType: "Recipient",
      PaymentMethod: "Cash",
      Description: "Сухий лід",
      SeatsAmount: "2",
      CitySender: "sender-city",
      Sender: "s1",
      CityRecipient: "city-kyiv",
      RecipientAddress: "wh-5",
      RecipientsPhone: "380501234567",
      SendersPhone: "380441112233",
      Recipient: "cp1",
      ContactRecipient: "cn1",
    });
    expect(Number(doc.Weight)).toBeGreaterThan(30);
    expect(np.calls.find((c) => c.method === "Counterparty/save")!.props).toMatchObject({
      LastName: "Коваль",
      FirstName: "Олена",
      Phone: "380501234567",
      CounterpartyType: "PrivatePerson",
    });
    const [row] = await t.db.select().from(shipments).where(eq(shipments.orderId, orderId));
    expect(row).toMatchObject({
      status: "created",
      npRef: "doc-ref-1",
      ttnNumber: "20450000000001",
      costUah: "85.00",
      recipientCounterpartyRef: "cp1",
    });
    expect(JSON.stringify(await t.db.select().from(integrationLogs))).not.toContain('"key"');
    // Запис про накладну потрапив у журнал змін.
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.tableName, "shipments"));
    expect(audit.length).toBeGreaterThan(0);
    const card = (await getShipmentCard(t.db, t.users.manager, orderId))!;
    expect(card.shipment).toMatchObject({ ttnNumber: "20450000000001", costUah: "85.00" });
    expect(card.blockers).toEqual([]);
    // Старший локації вартості не бачить.
    const lead = (await getShipmentCard(t.db, t.users.location_lead, orderId))!;
    expect(lead.shipment!.costUah).toBeUndefined();
  });

  it("контрагент запам'ятовується в контакті з тим самим телефоном і вдруге не створюється", async () => {
    await t.db.insert(clientContacts).values({
      clientId: t.client.id,
      name: "Олена",
      phone: "+380501234567",
    });
    const first = fakeNp(HAPPY);
    await createShipment(t.db, owner(), { orderId }, first.api);
    const [contact] = await t.db.select().from(clientContacts);
    expect(contact).toMatchObject({ npCounterpartyRef: "cp1", npContactRef: "cn1" });
    await deleteShipment(t.db, owner(), orderId, first.api);
    const second = fakeNp(HAPPY);
    await createShipment(t.db, owner(), { orderId }, second.api);
    expect(second.calls.some((c) => c.method === "Counterparty/save")).toBe(false);
  });

  it("повторне створення не робить нового виклику і не дублює накладну", async () => {
    const first = fakeNp(HAPPY);
    await createShipment(t.db, owner(), { orderId }, first.api);
    const second = fakeNp(HAPPY);
    const again = await createShipment(t.db, owner(), { orderId }, second.api);
    expect(again).toMatchObject({ duplicate: true, ttnNumber: "20450000000001" });
    expect(second.calls).toHaveLength(0);
    expect(await t.db.select().from(shipments)).toHaveLength(1);
  });

  it("помилка Нової Пошти: накладна зі статусом «Помилка» й текстом, повтор оновлює той самий запис", async () => {
    const failing = fakeNp((method) =>
      method === "InternetDocument/save"
        ? { errors: ["RecipientAddress is invalid"] }
        : HAPPY(method, {}),
    );
    await expect(createShipment(t.db, owner(), { orderId }, failing.api)).rejects.toThrow(
      "RecipientAddress is invalid",
    );
    let [row] = await t.db.select().from(shipments).where(eq(shipments.orderId, orderId));
    expect(row).toMatchObject({
      status: "error",
      errorText: "RecipientAddress is invalid",
      npRef: null,
    });
    const card = (await getShipmentCard(t.db, owner(), orderId))!;
    expect(card.shipment!.errorText).toContain("RecipientAddress");
    // Помилкова спроба не блокує повторне створення.
    expect(card.blockers).toEqual([]);
    await createShipment(t.db, owner(), { orderId }, fakeNp(HAPPY).api);
    [row] = await t.db.select().from(shipments).where(eq(shipments.orderId, orderId));
    expect(row).toMatchObject({ status: "created", errorText: null });
    expect(await t.db.select().from(shipments)).toHaveLength(1);
  });

  it("мережева помилка теж записується, наступна спроба проходить", async () => {
    const down = fakeNp((method) =>
      method === "Counterparty/save" ? new TypeError("fetch failed") : [],
    );
    await expect(createShipment(t.db, owner(), { orderId }, down.api)).rejects.toBeInstanceOf(
      NpError,
    );
    const [row] = await t.db.select().from(shipments);
    expect(row!.status).toBe("error");
    expect(row!.errorText).toContain("Немає зв'язку");
  });

  it("умови: без телефона, з неуточненою адресою, одним словом у імені створити не можна, нічого не викликається", async () => {
    const np = fakeNp(HAPPY);
    await t.db.update(orders).set({ recipientPhone: null }).where(eq(orders.id, orderId));
    await expect(createShipment(t.db, owner(), { orderId }, np.api)).rejects.toThrow("телефон");
    await t.db
      .update(orders)
      .set({ recipientPhone: "+380501234567" })
      .where(eq(orders.id, orderId));
    await t.db
      .update(clientAddresses)
      .set({ isResolved: false })
      .where(eq(clientAddresses.id, addressId));
    await expect(createShipment(t.db, owner(), { orderId }, np.api)).rejects.toThrow("уточнення");
    await t.db
      .update(clientAddresses)
      .set({ isResolved: true })
      .where(eq(clientAddresses.id, addressId));
    await t.db.update(orders).set({ recipientName: "Олена" }).where(eq(orders.id, orderId));
    await expect(createShipment(t.db, owner(), { orderId }, np.api)).rejects.toThrow("Прізвище");
    expect(np.calls.filter((c) => c.method === "InternetDocument/save")).toHaveLength(0);
    // Помилка введення не лишає чернетки з «помилкою» для іншої причини: запис є лише після перевірок.
  });

  it("права: цех, бухгалтер, водій, чужий старший локації й менеджер без права не створюють", async () => {
    for (const role of ["production", "accountant", "driver"] as const) {
      await expect(
        createShipment(t.db, t.users[role], { orderId }, fakeNp(HAPPY).api),
        role,
      ).rejects.toThrow(ForbiddenError);
    }
    await expect(createShipment(t.db, t.otherLead, { orderId }, fakeNp(HAPPY).api)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      createShipment(t.db, t.users.location_lead, { orderId }, fakeNp(HAPPY).api),
    ).resolves.toMatchObject({ duplicate: false });
  });

  it("вартість до створення: лише ролям з грошима, нічого не записує", async () => {
    const np = fakeNp(HAPPY);
    expect(await previewShipmentPrice(t.db, owner(), { orderId }, np.api)).toEqual({ costUah: 85 });
    await expect(
      previewShipmentPrice(t.db, t.users.location_lead, { orderId }, np.api),
    ).rejects.toThrow(ForbiddenError);
    expect(await t.db.select().from(shipments)).toHaveLength(0);
  });

  it("видалення: викликає Нову Пошту, прибирає запис, дозволяє створити нову; відмова Нової Пошти нічого не видаляє", async () => {
    await createShipment(t.db, owner(), { orderId }, fakeNp(HAPPY).api);
    const refusing = fakeNp((method) =>
      method === "InternetDocument/delete" ? { errors: ["Document already sent"] } : [],
    );
    await expect(deleteShipment(t.db, owner(), orderId, refusing.api)).rejects.toThrow(
      "Document already sent",
    );
    expect(await t.db.select().from(shipments)).toHaveLength(1);
    const ok = fakeNp(HAPPY);
    await deleteShipment(t.db, owner(), orderId, ok.api);
    expect(ok.calls.find((c) => c.method === "InternetDocument/delete")!.props).toEqual({
      DocumentRefs: "doc-ref-1",
    });
    expect(await t.db.select().from(shipments)).toHaveLength(0);
    await expect(deleteShipment(t.db, owner(), orderId, ok.api)).rejects.toThrow(ValidationError);
    await createShipment(t.db, owner(), { orderId }, fakeNp(HAPPY).api);
    expect(await t.db.select().from(shipments)).toHaveLength(1);
  });

  it("стікер: адреса з ключем лише на сервері, PDF віддається, помилки без адреси", async () => {
    expect(stickerUrl("ref/1", "k")).toContain("/apiKey/k");
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
    const okFetch = vi.fn(() => Promise.resolve(new Response(pdf, { status: 200 })));
    const bytes = await fetchStickerPdf(t.db, "doc-ref-1", {
      apiKey: "SECRETKEY",
      fetchImpl: okFetch as never,
    });
    expect(bytes.length).toBe(pdf.length);
    const html = vi.fn(() => Promise.resolve(new Response("<html>err</html>", { status: 200 })));
    const error = await fetchStickerPdf(t.db, "doc-ref-1", {
      apiKey: "SECRETKEY",
      fetchImpl: html as never,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(NpError);
    expect(error.message).not.toContain("SECRETKEY");
    await expect(
      fetchStickerPdf(t.db, "x", { apiKey: null, fetchImpl: okFetch as never }),
    ).rejects.toThrow("Ключ Нової Пошти не налаштовано");
    const logs = JSON.stringify(await t.db.select().from(integrationLogs));
    expect(logs).not.toContain("SECRETKEY");
    expect(logs).toContain("printMarking100x100");
  });

  it("доступ до стікера: лише з правом і своєї локації", async () => {
    await createShipment(t.db, owner(), { orderId }, fakeNp(HAPPY).api);
    const [row] = await t.db.select().from(shipments);
    expect(await loadShipmentForSticker(t.db, t.users.manager, row!.id)).toMatchObject({
      ttnNumber: "20450000000001",
    });
    await expect(loadShipmentForSticker(t.db, t.users.production, row!.id)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(loadShipmentForSticker(t.db, t.otherLead, row!.id)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      loadShipmentForSticker(t.db, owner(), "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow(ValidationError);
  });
});
