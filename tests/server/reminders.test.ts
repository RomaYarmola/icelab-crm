import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bankAccounts,
  boxes,
  boxTypes,
  clients,
  clientStatuses,
  npSyncState,
  orders,
  payments,
  profiles,
  reminders,
  settings,
} from "@/db/schema";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import { formatReminderMessage, MESSAGE_LINES } from "@/server/reminder-rules";
import {
  BOX_DAYS_KEY,
  dismissReminder,
  generateReminders,
  listReminders,
  loadBoxReminderDays,
  runReminders,
  sendReminders,
  setBoxReminderDays,
} from "@/server/reminders";
import { transitionOrder } from "@/server/order-status";
import { USER_ROLES } from "@/server/permissions";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const DAY = 86_400_000;
const MORNING = new Date("2026-11-25T07:30:00Z"); // 09:30 за Києвом

describe("ранкові нагадування (B14, D209, D210)", () => {
  let t: OrderTestContext;

  beforeAll(async () => {
    t = await setupOrderTests();
    const [active] = await t.db
      .select()
      .from(clientStatuses)
      .where(eq(clientStatuses.code, "active"));
    await t.db
      .update(clients)
      .set({ statusId: active!.id, managerId: t.users.manager.id })
      .where(eq(clients.id, t.client.id));
    await t.db.insert(bankAccounts).values({ accountId: "fop-r", label: "ФОП" });
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.delete(reminders);
    await t.db.delete(boxes);
    await t.db.delete(payments);
    await t.db.delete(npSyncState).where(eq(npSyncState.key, "reminders"));
    await t.db.delete(settings).where(eq(settings.key, BOX_DAYS_KEY));
    await t.db.update(orders).set({ deletedAt: new Date() });
    await t.db.update(clients).set({ isOneTime: false, managerId: t.users.manager.id });
    await t.db.update(profiles).set({ telegramUserId: null });
  });

  const oldOrder = async () => {
    const { id } = await t.create({ orderDate: "2026-09-01" }, t.users.owner);
    await transitionOrder(t.db, t.users.owner, id, "confirmed");
  };
  const box = async (daysAgo: number, code: string) => {
    const [type] = await t.db.select().from(boxTypes).limit(1);
    await t.db.insert(boxes).values({
      code,
      boxTypeId: type!.id,
      locationId: t.location,
      status: "at_client",
      currentClientId: t.client.id,
      issuedAt: new Date(MORNING.getTime() - daysAgo * DAY),
    });
  };
  const payment = async () =>
    t.db.insert(payments).values({ externalId: "r-1", occurredAt: MORNING, amount: "100.00" });
  const all = () => t.db.select().from(reminders);

  it("клієнт давно не замовляв: нагадування менеджеру клієнта; разовому не створюється", async () => {
    await oldOrder();
    await generateReminders(t.db, MORNING);
    expect(await all()).toMatchObject([
      { kind: "client_inactive", assigneeId: t.users.manager.id },
    ]);
    await t.db.delete(reminders);
    await t.db.update(clients).set({ isOneTime: true });
    await generateReminders(t.db, MORNING);
    expect(await all()).toEqual([]);
  });

  it("без менеджера нагадування отримують власники", async () => {
    await oldOrder();
    await t.db.update(clients).set({ managerId: null });
    await generateReminders(t.db, MORNING);
    const owners = (await t.db.select().from(profiles)).filter(
      (p) => p.role === "owner" && p.isActive,
    );
    expect((await all()).map((r) => r.assigneeId).sort()).toEqual(owners.map((p) => p.id).sort());
  });

  it("не частіше ніж раз на 7 днів, навіть після «Відкласти»; повторний запуск не дублює", async () => {
    await oldOrder();
    expect(await generateReminders(t.db, MORNING)).toHaveLength(1);
    expect(await generateReminders(t.db, MORNING)).toHaveLength(0);
    const [row] = await all();
    await dismissReminder(t.db, t.users.manager, row!.id, MORNING);
    expect(await generateReminders(t.db, new Date(MORNING.getTime() + 6 * DAY))).toHaveLength(0);
    expect(await generateReminders(t.db, new Date(MORNING.getTime() + 8 * DAY))).toHaveLength(1);
  });

  it("бокси: лише довше порога, одне на клієнта; поріг із налаштувань", async () => {
    await box(10, "K-1");
    expect(await generateReminders(t.db, MORNING)).toHaveLength(0);
    await box(21, "K-2");
    await box(16, "K-3");
    await generateReminders(t.db, MORNING);
    const list = await listReminders(t.db, t.users.manager, MORNING);
    expect(list).toHaveLength(1);
    expect(list[0]!.text).toBe("Бокси в «Кафе Тест»: 2 шт, найдовше 21 дн.");
    await setBoxReminderDays(t.db, t.users.owner, 5);
    expect(await loadBoxReminderDays(t.db)).toBe(5);
    expect((await listReminders(t.db, t.users.manager, MORNING))[0]!.text).toContain("3 шт");
  });

  it("нерозпізнані платежі: бухгалтеру щодня, поки черга не порожня", async () => {
    await payment();
    await generateReminders(t.db, MORNING);
    expect(await all()).toMatchObject([
      { kind: "payment_unmatched", assigneeId: t.users.accountant.id },
    ]);
    expect(await generateReminders(t.db, new Date(MORNING.getTime() + DAY))).toHaveLength(1);
    // у списку один актуальний запис, а не по запису на день
    const list = await listReminders(t.db, t.users.accountant, new Date(MORNING.getTime() + DAY));
    expect(list).toHaveLength(1);
    expect(list[0]!.text).toBe("Нерозпізнаних платежів: 1");
    await t.db.delete(payments);
    expect(await listReminders(t.db, t.users.accountant, MORNING)).toEqual([]);
  });

  it("нагадування зникає само, коли причина зникла", async () => {
    await oldOrder();
    await box(30, "K-9");
    await generateReminders(t.db, MORNING);
    expect(await listReminders(t.db, t.users.manager, MORNING)).toHaveLength(2);
    await t.db.update(boxes).set({ status: "in_stock", currentClientId: null, issuedAt: null });
    const { id } = await t.create({ orderDate: "2026-11-25" }, t.users.owner);
    await transitionOrder(t.db, t.users.owner, id, "confirmed");
    expect(await listReminders(t.db, t.users.manager, MORNING)).toEqual([]);
  });

  it("чужі нагадування не видно й не відкласти", async () => {
    await oldOrder();
    await generateReminders(t.db, MORNING);
    const [row] = await all();
    expect(await listReminders(t.db, t.users.accountant, MORNING)).toEqual([]);
    await expect(dismissReminder(t.db, t.users.owner, row!.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await dismissReminder(t.db, t.users.manager, row!.id, MORNING);
    expect(await listReminders(t.db, t.users.manager, MORNING)).toEqual([]);
  });

  it("Telegram: одне повідомлення на людину лише прив'язаним; збій чату не ламає решту", async () => {
    await oldOrder();
    await box(30, "K-7");
    await payment();
    await t.db
      .update(profiles)
      .set({ telegramUserId: 111 })
      .where(eq(profiles.id, t.users.manager.id));
    await t.db
      .update(profiles)
      .set({ telegramUserId: 222 })
      .where(eq(profiles.id, t.users.accountant.id));
    const ids = await generateReminders(t.db, MORNING);
    const send = vi.fn<(chat: number, text: string) => Promise<void>>(async (chat) => {
      if (chat === 222) throw new Error("blocked");
    });
    expect(await sendReminders(t.db, ids, { send, now: MORNING })).toBe(1);
    const toManager = send.mock.calls.find((call) => call[0] === 111)![1];
    expect(toManager).toContain("не замовляє");
    expect(toManager).toContain("Бокси в");
    expect(toManager).toContain("/analytics?tab=reminders");
    const rows = await all();
    expect(rows.filter((r) => r.assigneeId === t.users.manager.id).every((r) => r.sentAt)).toBe(
      true,
    );
    expect(rows.filter((r) => r.assigneeId === t.users.accountant.id).every((r) => !r.sentAt)).toBe(
      true,
    );
  });

  it("розклад: не раніше 09:00 за Києвом і лише раз на день; після збою повторюється", async () => {
    await oldOrder();
    const early = new Date("2026-11-25T06:30:00Z"); // 08:30
    expect(await runReminders(t.db, { now: early })).toEqual({ ran: false, reason: "not_yet" });
    expect(await runReminders(t.db, { now: MORNING })).toMatchObject({ ran: true, created: 1 });
    expect(await runReminders(t.db, { now: MORNING })).toEqual({ ran: false, reason: "already" });
    expect(await runReminders(t.db, { now: new Date(MORNING.getTime() + DAY) })).toMatchObject({
      ran: true,
      created: 0,
    });
  });

  it("довгий список у повідомленні обрізається", () => {
    const lines = Array.from({ length: MESSAGE_LINES + 3 }, (_, i) => `рядок ${i}`);
    const text = formatReminderMessage(lines, "https://x");
    expect(text).toContain("і ще 3");
    expect(text).not.toContain(`рядок ${MESSAGE_LINES}\n`);
    expect(text.endsWith("https://x")).toBe(true);
  });

  it("права: список у власника, менеджера, бухгалтера; поріг боксів лише власник", async () => {
    for (const role of USER_ROLES) {
      const list = listReminders(t.db, t.users[role], MORNING);
      if (["owner", "manager", "accountant"].includes(role))
        await expect(list, role).resolves.toBeTruthy();
      else await expect(list, role).rejects.toBeInstanceOf(ForbiddenError);
      const set = setBoxReminderDays(t.db, t.users[role], 14);
      if (role === "owner") await expect(set).resolves.toBeUndefined();
      else await expect(set, role).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(setBoxReminderDays(t.db, t.users.owner, 0)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
