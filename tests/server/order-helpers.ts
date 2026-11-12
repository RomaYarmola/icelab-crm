import { eq } from "drizzle-orm";
import { clientApplications, iceTypes, profiles } from "@/db/schema";
import { seedReferenceData } from "@/db/seed";
import type { AppUser } from "@/server/guards";
import { createOrder, type CreateOrderInput } from "@/server/orders";
import type { UserRole } from "@/server/permissions";
import { changeDefaultPrice } from "@/server/prices";
import { createTestDb, type TestDb } from "../db/harness";
import { makeAppUsers, makeClient, makeLocation, makeProfile } from "../db/helpers";

export const ORDER_DATE = "2026-11-13";

/** Спільна підготовка для тестів замовлень: база з довідниками, користувачі, прайс, клієнт. */
export async function setupOrderTests() {
  const ctx = await createTestDb();
  const db: TestDb = ctx.db;
  await seedReferenceData(db);
  const users = await makeAppUsers(db);
  const location = users.location_lead.locationId!;
  const otherLocation = (await makeLocation(db)).id;

  const bound = async (role: UserRole, locationId: string): Promise<AppUser> => {
    const profile = await makeProfile(db, { role, fullName: `Інша ${role}`, locationId });
    return {
      id: profile.id,
      email: null,
      fullName: profile.fullName,
      role,
      locationId,
      locationName: null,
    };
  };
  const otherLead = await bound("location_lead", otherLocation);
  const otherProduction = await bound("production", otherLocation);

  const iceId = async (code: string) =>
    (await db.select().from(iceTypes).where(eq(iceTypes.code, code)))[0]!.id;
  const ice16 = await iceId("16mm");
  const ice3 = await iceId("3mm");
  await changeDefaultPrice(db, users.owner, {
    iceTypeId: ice16,
    pricePerKg: "75",
    validFrom: "2026-01-01",
  });
  const applicationId = async (code: string) =>
    (await db.select().from(clientApplications).where(eq(clientApplications.code, code)))[0]!.id;

  const client = await makeClient(db, { name: "Кафе Тест" });

  const create = (overrides: Partial<CreateOrderInput> = {}, actor: AppUser = users.manager) =>
    createOrder(db, actor, {
      clientId: client.id,
      locationId: location,
      orderDate: ORDER_DATE,
      iceTypeId: ice16,
      kgSold: 30,
      ...overrides,
    });

  return {
    ctx,
    db,
    users,
    location,
    otherLocation,
    otherLead,
    otherProduction,
    ice16,
    ice3,
    client,
    applicationId,
    create,
    profilesTable: profiles,
  };
}

export type OrderTestContext = Awaited<ReturnType<typeof setupOrderTests>>;
