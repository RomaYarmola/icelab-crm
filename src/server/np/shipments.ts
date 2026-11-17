import { eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import {
  boxTypes,
  clientAddresses,
  clientContacts,
  clients,
  locations,
  orders,
  settings,
  shipments,
} from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { SHIPMENT_STATUS_LABELS, type ShipmentStatus } from "@/constants/np";
import { todayIso } from "@/utils/isoDate";
import { parseInput, ValidationError } from "../errors";
import { type AppUser, requirePermission } from "../guards";
import { can, canAccessLocation } from "../permissions";
import { callNp, NpError } from "./client";
import {
  NP_SERVICE_TYPE,
  normalizeNpPhone,
  npDate,
  shipmentBlockers,
  shipmentParams,
  splitRecipientName,
} from "./shipment-rules";

/**
 * Накладні Нової Пошти із замовлення (B10, PR 3, ТЗ 6.8 і 8.4): стан блока на картці, вартість до
 * створення, створення, видалення до передачі у відділення. Створюємо по одному замовленню на запит
 * (D124); повтор безпечний: якщо `np_ref` уже є, нового виклику не робимо. Суми бачать лише ролі з
 * правом на гроші замовлення (D132).
 */

const uuid = z.string().uuid();
const PAYERS = ["Sender", "Recipient"] as const;
export type NpPayerValue = (typeof PAYERS)[number];

type CallApi = Parameters<typeof callNp>[2];

export type ShipmentView = {
  id: string;
  status: ShipmentStatus;
  statusLabel: string;
  statusText: string | null;
  ttnNumber: string | null;
  errorText: string | null;
  payer: NpPayerValue;
  weightKg: string | null;
  seats: number;
  createdInNpAt: string | null;
  /** Вартість доставки: лише ролям, що бачать гроші замовлення. */
  costUah?: string | null;
};

export type ShipmentCard = {
  shipment: ShipmentView | null;
  /** Чого бракує для створення (порожньо, якщо можна). */
  blockers: string[];
  /** Вага й місця, які підуть у накладну. */
  params: { weightKg: number; seats: number; emptyWeightKnown: boolean };
  canWrite: boolean;
  canSeeMoney: boolean;
};

type SenderData = {
  senderRef: string;
  contactRef: string;
  addressRef: string;
  phone: string;
  cityRef: string;
};

export async function loadSender(
  db: AnyPgDatabase,
  locationId: string,
): Promise<SenderData | null> {
  const [location] = await db.select().from(locations).where(eq(locations.id, locationId));
  if (
    !location?.npSenderRef ||
    !location.npSenderContactRef ||
    !location.npSenderAddressRef ||
    !location.npSenderPhone
  ) {
    return null;
  }
  const [labels] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, `np.sender_labels.${location.code}`));
  const cityRef = (labels?.value as { cityRef?: string } | undefined)?.cityRef;
  if (!cityRef) return null;
  return {
    senderRef: location.npSenderRef,
    contactRef: location.npSenderContactRef,
    addressRef: location.npSenderAddressRef,
    phone: location.npSenderPhone,
    cityRef,
  };
}

type Context = Awaited<ReturnType<typeof loadContext>>;

async function loadContext(db: AnyPgDatabase, orderId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, parseInput(uuid, orderId)));
  if (!order || order.deletedAt) throw new ValidationError("Замовлення не знайдено.");
  const [client] = await db.select().from(clients).where(eq(clients.id, order.clientId));
  const [address] = order.addressId
    ? await db.select().from(clientAddresses).where(eq(clientAddresses.id, order.addressId))
    : [];
  const [boxType] = order.boxTypeId
    ? await db.select().from(boxTypes).where(eq(boxTypes.id, order.boxTypeId))
    : [];
  const [shipment] = await db.select().from(shipments).where(eq(shipments.orderId, order.id));
  const sender = await loadSender(db, order.locationId);
  return {
    order,
    client: client!,
    address: address ?? null,
    boxType: boxType ?? null,
    shipment,
    sender,
  };
}

function blockersFor(ctx: Context): string[] {
  return shipmentBlockers({
    order: {
      status: ctx.order.status,
      deliveryMethod: ctx.order.deliveryMethod,
      recipientName: ctx.order.recipientName,
      recipientPhone: ctx.order.recipientPhone,
      kgToProduce: ctx.order.kgToProduce,
      boxCount: ctx.order.boxCount,
      total: ctx.order.total,
    },
    address: ctx.address
      ? {
          kind: ctx.address.kind,
          isResolved: ctx.address.isResolved,
          npCityRef: ctx.address.npCityRef,
          npWarehouseRef: ctx.address.npWarehouseRef,
        }
      : null,
    senderReady: ctx.sender !== null,
    // Помилкова спроба (немає `np_ref`) не блокує: її можна повторити.
    hasActiveShipment: Boolean(ctx.shipment?.npRef),
  });
}

function toView(row: typeof shipments.$inferSelect, canSeeMoney: boolean): ShipmentView {
  const view: ShipmentView = {
    id: row.id,
    status: row.status,
    statusLabel: SHIPMENT_STATUS_LABELS[row.status],
    statusText: row.statusText,
    ttnNumber: row.ttnNumber,
    errorText: row.errorText,
    payer: row.payer,
    weightKg: row.weightKg,
    seats: row.seats,
    createdInNpAt: row.createdInNpAt?.toISOString() ?? null,
  };
  if (canSeeMoney) view.costUah = row.costUah;
  return view;
}

/** Права на накладні: створюють власник, менеджер і старший локації (лише своєї локації). */
function assertCanWrite(actor: AppUser, locationId: string): void {
  requirePermission(actor, "shipments", "write", { recordLocationId: locationId });
}

/**
 * Блок «Нова Пошта» для картки замовлення. `null`, якщо замовлення не про Нову Пошту чи роль не
 * має права на накладні (цех, бухгалтер, водій) або це чужа локація.
 */
export async function getShipmentCard(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
): Promise<ShipmentCard | null> {
  if (!can(actor.role, "shipments", "write")) return null;
  const ctx = await loadContext(db, orderId);
  if (ctx.order.deliveryMethod !== "np" && !ctx.shipment) return null;
  if (!canAccessLocation(actor, ctx.order.locationId)) return null;
  const canSeeMoney = can(actor.role, "order_money", "read");
  const params = shipmentParams({
    kgToProduce: ctx.order.kgToProduce,
    boxCount: ctx.order.boxCount,
    emptyWeightKg: ctx.boxType?.emptyWeightKg ?? null,
  });
  return {
    shipment: ctx.shipment ? toView(ctx.shipment, canSeeMoney) : null,
    blockers: ctx.shipment?.npRef ? [] : blockersFor(ctx),
    params: {
      weightKg: params.weightKg,
      seats: params.seats,
      emptyWeightKnown: params.emptyWeightKnown,
    },
    canWrite: true,
    canSeeMoney,
  };
}

// ---------------------------------------------------------------------------------------------
// Одержувач у Новій Пошті
// ---------------------------------------------------------------------------------------------

type Recipient = { counterpartyRef: string; contactRef: string };

type SaveCounterparty = {
  Ref?: string;
  ContactPerson?: { data?: { Ref?: string }[] };
};

/**
 * Контрагент і контактна особа одержувача. Якщо їхні посилання вже збережені в контакті клієнта з
 * цим телефоном, нових викликів немає; інакше створюємо (Нова Пошта сама повертає наявного, якщо
 * такий уже є) і запам'ятовуємо в контакті.
 */
async function ensureRecipient(
  db: AnyPgDatabase,
  actor: AppUser,
  ctx: Context,
  api: CallApi,
): Promise<Recipient> {
  const phone = normalizeNpPhone(ctx.order.recipientPhone)!;
  const e164 = `+${phone}`;
  const contacts = await db
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.clientId, ctx.client.id));
  const known = contacts.find((c) => c.phone === e164);
  if (known?.npCounterpartyRef && known.npContactRef) {
    return { counterpartyRef: known.npCounterpartyRef, contactRef: known.npContactRef };
  }

  const name = splitRecipientName(ctx.order.recipientName ?? known?.name ?? ctx.client.name);
  if (!name) {
    throw new ValidationError("Вкажіть одержувача як «Прізвище Ім'я» (Нова Пошта вимагає обидва).");
  }
  const person = {
    FirstName: name.firstName,
    MiddleName: name.middleName,
    LastName: name.lastName,
    Phone: phone,
  };
  let recipient: Recipient;
  const isOrganization =
    (ctx.client.legalType === "company" || ctx.client.legalType === "fop") &&
    Boolean(ctx.client.edrpou?.trim());
  if (isOrganization) {
    const counterparty = await callNp<SaveCounterparty>(
      db,
      {
        modelName: "Counterparty",
        calledMethod: "save",
        methodProperties: {
          CounterpartyType: "Organization",
          CounterpartyProperty: "Recipient",
          EDRPOU: ctx.client.edrpou!.trim(),
        },
      },
      api,
    );
    const counterpartyRef = counterparty.data[0]?.Ref;
    if (!counterpartyRef) throw new NpError("Нова Пошта не повернула контрагента-одержувача.");
    const contact = await callNp<{ Ref?: string }>(
      db,
      {
        modelName: "ContactPerson",
        calledMethod: "save",
        methodProperties: { CounterpartyRef: counterpartyRef, ...person },
      },
      api,
    );
    const contactRef = contact.data[0]?.Ref;
    if (!contactRef) throw new NpError("Нова Пошта не повернула контактну особу одержувача.");
    recipient = { counterpartyRef, contactRef };
  } else {
    const counterparty = await callNp<SaveCounterparty>(
      db,
      {
        modelName: "Counterparty",
        calledMethod: "save",
        methodProperties: {
          ...person,
          Email: "",
          CounterpartyType: "PrivatePerson",
          CounterpartyProperty: "Recipient",
        },
      },
      api,
    );
    const first = counterparty.data[0];
    const contactRef = first?.ContactPerson?.data?.[0]?.Ref;
    if (!first?.Ref || !contactRef) throw new NpError("Нова Пошта не повернула одержувача.");
    recipient = { counterpartyRef: first.Ref, contactRef };
  }

  if (known) {
    await withActor(db, actor.id, (tx) =>
      tx
        .update(clientContacts)
        .set({ npCounterpartyRef: recipient.counterpartyRef, npContactRef: recipient.contactRef })
        .where(eq(clientContacts.id, known.id)),
    );
  }
  return recipient;
}

// ---------------------------------------------------------------------------------------------
// Створення, вартість, видалення
// ---------------------------------------------------------------------------------------------

const inputSchema = z.object({
  orderId: uuid,
  payer: z.enum(PAYERS, { error: "Оберіть платника." }).default("Recipient"),
});

export type ShipmentInput = z.input<typeof inputSchema>;

function prepare(ctx: Context, payer: NpPayerValue) {
  const blockers = blockersFor(ctx);
  if (blockers.length > 0) throw new ValidationError(blockers[0]!);
  const params = shipmentParams({
    kgToProduce: ctx.order.kgToProduce,
    boxCount: ctx.order.boxCount,
    emptyWeightKg: ctx.boxType?.emptyWeightKg ?? null,
  });
  const sender = ctx.sender!;
  const address = ctx.address!;
  const common = {
    PayerType: payer,
    PaymentMethod: "Cash",
    CargoType: "Cargo",
    Weight: String(Math.max(params.weightKg, 0.1)),
    ServiceType: NP_SERVICE_TYPE,
    SeatsAmount: String(params.seats),
    Description: "Сухий лід",
    Cost: String(Math.max(Math.round(Number(ctx.order.total)), 1)),
    CitySender: sender.cityRef,
    Sender: sender.senderRef,
    SenderAddress: sender.addressRef,
    ContactSender: sender.contactRef,
    SendersPhone: normalizeNpPhone(sender.phone) ?? sender.phone,
    CityRecipient: address.npCityRef!,
    RecipientAddress: address.npWarehouseRef!,
    RecipientsPhone: normalizeNpPhone(ctx.order.recipientPhone)!,
  };
  return { params, common, address };
}

/** Вартість доставки до створення (`getDocumentPrice`). Для ролей, що бачать гроші замовлення. */
export async function previewShipmentPrice(
  db: AnyPgDatabase,
  actor: AppUser,
  input: ShipmentInput,
  api?: CallApi,
): Promise<{ costUah: number }> {
  const data = parseInput(inputSchema, input);
  const ctx = await loadContext(db, data.orderId);
  assertCanWrite(actor, ctx.order.locationId);
  requirePermission(actor, "order_money", "read");
  const { common } = prepare(ctx, data.payer);
  const result = await callNp<{ Cost?: number | string }>(
    db,
    {
      modelName: "InternetDocument",
      calledMethod: "getDocumentPrice",
      methodProperties: {
        CitySender: common.CitySender,
        CityRecipient: common.CityRecipient,
        Weight: common.Weight,
        ServiceType: common.ServiceType,
        Cost: common.Cost,
        CargoType: common.CargoType,
        SeatsAmount: common.SeatsAmount,
      },
    },
    api,
  );
  const cost = Number(result.data[0]?.Cost);
  if (!Number.isFinite(cost)) throw new NpError("Нова Пошта не повернула вартість.");
  return { costUah: cost };
}

type SaveDocument = {
  Ref?: string;
  IntDocNumber?: string;
  CostOnSite?: string | number;
  EstimatedDeliveryDate?: string;
};

/**
 * Створює ТТН для замовлення (D124, D128). Помилку Нової Пошти записуємо в накладну зі статусом
 * `error` і показуємо текстом; повтор оновлює той самий запис. Якщо `np_ref` уже є, повертаємо
 * наявну накладну без нового виклику.
 */
export async function createShipment(
  db: AnyPgDatabase,
  actor: AppUser,
  input: ShipmentInput,
  api?: CallApi,
  now: Date = new Date(),
): Promise<{ id: string; ttnNumber: string; duplicate: boolean }> {
  const data = parseInput(inputSchema, input);
  const ctx = await loadContext(db, data.orderId);
  assertCanWrite(actor, ctx.order.locationId);

  if (ctx.shipment?.npRef && ctx.shipment.ttnNumber) {
    return { id: ctx.shipment.id, ttnNumber: ctx.shipment.ttnNumber, duplicate: true };
  }
  const { params, common, address } = prepare(ctx, data.payer);

  const base = {
    orderId: ctx.order.id,
    locationId: ctx.order.locationId,
    payer: data.payer,
    recipientCityRef: address.npCityRef,
    recipientWarehouseRef: address.npWarehouseRef,
    weightKg: params.weightKg.toFixed(3),
    seats: params.seats,
    description: common.Description,
  };
  const shipmentId = await withActor(db, actor.id, async (tx) => {
    if (ctx.shipment) {
      await tx
        .update(shipments)
        .set({ ...base, status: "draft", errorText: null })
        .where(eq(shipments.id, ctx.shipment.id));
      return ctx.shipment.id;
    }
    const [created] = await tx
      .insert(shipments)
      .values({ ...base, status: "draft" })
      .returning({ id: shipments.id });
    return created!.id;
  });

  const fail = async (error: unknown): Promise<never> => {
    const message = error instanceof NpError ? error.message : "Не вдалося створити ТТН.";
    await withActor(db, actor.id, (tx) =>
      tx
        .update(shipments)
        .set({ status: "error", errorText: message })
        .where(eq(shipments.id, shipmentId)),
    );
    throw error;
  };

  try {
    const recipient = await ensureRecipient(db, actor, ctx, api);
    const properties = {
      ...common,
      DateTime: npDate(ctx.order.orderDate, todayIso(now)),
      Recipient: recipient.counterpartyRef,
      ContactRecipient: recipient.contactRef,
    };
    const result = await callNp<SaveDocument>(
      db,
      { modelName: "InternetDocument", calledMethod: "save", methodProperties: properties },
      api,
    );
    const document = result.data[0];
    if (!document?.Ref || !document.IntDocNumber) {
      throw new NpError("Нова Пошта не повернула номер накладної.");
    }
    const cost = Number(document.CostOnSite);
    await withActor(db, actor.id, (tx) =>
      tx
        .update(shipments)
        .set({
          status: "created",
          npRef: document.Ref,
          ttnNumber: document.IntDocNumber,
          costUah: Number.isFinite(cost) ? cost.toFixed(2) : null,
          recipientCounterpartyRef: recipient.counterpartyRef,
          recipientContactRef: recipient.contactRef,
          createdInNpAt: now,
          errorText: null,
          statusText: null,
          requestPayload: properties,
          responsePayload: { ...document, warnings: result.warnings },
        })
        .where(eq(shipments.id, shipmentId)),
    );
    return { id: shipmentId, ttnNumber: document.IntDocNumber, duplicate: false };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Видаляє ТТН у Новій Пошті й у нас. Нова Пошта дозволяє це лише до передачі у відділення; якщо
 * вже не можна, її текст помилки показуємо як є й нічого не видаляємо (D130). Запис про накладну
 * лишається в журналі змін.
 */
export async function deleteShipment(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
  api?: CallApi,
): Promise<void> {
  const ctx = await loadContext(db, orderId);
  assertCanWrite(actor, ctx.order.locationId);
  const shipment = ctx.shipment;
  if (!shipment) throw new ValidationError("ТТН для цього замовлення немає.");
  if (shipment.npRef) {
    await callNp(
      db,
      {
        modelName: "InternetDocument",
        calledMethod: "delete",
        methodProperties: { DocumentRefs: shipment.npRef },
      },
      api,
    );
  }
  await withActor(db, actor.id, (tx) => tx.delete(shipments).where(eq(shipments.id, shipment.id)));
}

/** Накладна за ідентифікатором для стікера: право й локація перевіряються тут. */
export async function loadShipmentForSticker(
  db: AnyPgDatabase,
  actor: AppUser,
  shipmentId: string,
): Promise<{ npRef: string; ttnNumber: string }> {
  const id = parseInput(uuid, shipmentId);
  const [row] = await db.select().from(shipments).where(eq(shipments.id, id));
  if (!row?.npRef || !row.ttnNumber) throw new ValidationError("Накладну не знайдено.");
  assertCanWrite(actor, row.locationId);
  return { npRef: row.npRef, ttnNumber: row.ttnNumber };
}
