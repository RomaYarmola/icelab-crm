import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { intakeMessages, locations, profiles, settings, telegramLinkCodes } from "@/db/schema";
import { setTelegramSettings } from "@/server/telegram/settings";
import { handleUpdate, type TgMessage, type TgUpdate } from "@/server/telegram/updates";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const GROUP = -1001111111111;
const KYIV_TOPIC = 11;
const LVIV_TOPIC = 22;

describe("події Telegram: приймання й прив'язка (B11, PR 1)", () => {
  let t: OrderTestContext;
  let nextId = 1000;
  let kyivId: string;
  let lvivId: string;
  const sent: { chatId: number; text: string; threadId?: number }[] = [];
  const send = async (params: { chatId: number; text: string; threadId?: number }) => {
    sent.push(params);
  };

  const message = (
    overrides: Partial<TgMessage> & { chat?: TgMessage["chat"] } = {},
  ): TgMessage => ({
    message_id: (nextId += 1),
    chat: { id: GROUP, type: "supergroup" },
    message_thread_id: KYIV_TOPIC,
    from: { id: 5001, first_name: "Олена" },
    text: "ДСВ завтра 40 кг",
    ...overrides,
  });
  const update = (m: TgMessage, edited = false): TgUpdate =>
    edited ? { update_id: nextId, edited_message: m } : { update_id: nextId, message: m };
  const run = (u: TgUpdate) => handleUpdate(t.db, u, { send });

  beforeAll(async () => {
    t = await setupOrderTests();
    kyivId = (await t.db.select().from(locations).where(eq(locations.code, "kyiv")))[0]!.id;
    lvivId = (await t.db.select().from(locations).where(eq(locations.code, "lviv")))[0]!.id;
    // Менеджер з підключеним Telegram.
    await t.db
      .update(profiles)
      .set({ telegramUserId: 5001 })
      .where(eq(profiles.id, t.users.manager.id));
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    sent.length = 0;
    await t.db.delete(intakeMessages);
    await setTelegramSettings(t.db, null, {
      groupChatId: GROUP,
      topicKyiv: KYIV_TOPIC,
      topicLviv: LVIV_TOPIC,
      capture: null,
    });
  });

  it("повідомлення менеджера в топіку Київ записується як нове з локацією за топіком", async () => {
    const outcome = await run(update(message()));
    expect(outcome).toMatchObject({ kind: "stored", status: "new", location: "kyiv" });
    const [row] = await t.db.select().from(intakeMessages);
    expect(row).toMatchObject({
      parseStatus: "new",
      text: "ДСВ завтра 40 кг",
      locationId: kyivId,
      telegramUserId: 5001,
      telegramThreadId: KYIV_TOPIC,
    });
    const lviv = await run(update(message({ message_thread_id: LVIV_TOPIC })));
    expect(lviv).toMatchObject({ kind: "stored", location: "lviv" });
    const rows = await t.db.select().from(intakeMessages);
    expect(rows.find((r) => r.telegramThreadId === LVIV_TOPIC)!.locationId).toBe(lvivId);
  });

  it("поза топіками, чужа група, команди й службові повідомлення ігноруються і не зберігаються", async () => {
    const cases: TgMessage[] = [
      message({ message_thread_id: 999 }),
      message({ message_thread_id: undefined }),
      message({ chat: { id: -5, type: "supergroup" } }),
      message({ text: "/start" }),
      message({ text: undefined }),
      message({ chat: { id: -7, type: "channel" } }),
    ];
    for (const item of cases) {
      expect((await run(update(item))).kind, JSON.stringify(item)).toBe("ignored");
    }
    expect(await t.db.select().from(intakeMessages)).toHaveLength(0);
    expect((await run({ update_id: 1, callback_query: { id: "q" } })).kind).toBe("ignored");
  });

  it("не менеджер, не підключений і бот зберігаються як «пропущено» з причиною", async () => {
    const stranger = await run(update(message({ from: { id: 777 } })));
    const bot = await run(update(message({ from: { id: 888, is_bot: true } })));
    await t.db
      .update(profiles)
      .set({ telegramUserId: 6001 })
      .where(eq(profiles.id, t.users.accountant.id));
    const accountant = await run(update(message({ from: { id: 6001 } })));
    for (const outcome of [stranger, bot, accountant]) {
      expect(outcome).toMatchObject({ kind: "stored", status: "skipped" });
    }
    const rows = await t.db.select().from(intakeMessages);
    expect(rows.map((r) => r.skipReason).sort()).toEqual([
      "відправник не підключений до CRM",
      "заявки приймаємо лише від менеджерів і власника",
      "повідомлення від бота",
    ]);
    expect(rows.every((r) => r.parseStatus === "skipped")).toBe(true);
    await t.db
      .update(profiles)
      .set({ telegramUserId: null })
      .where(eq(profiles.id, t.users.accountant.id));
  });

  it("повторна подія не дублює; змінене повідомлення оновлює текст, поки заявку не розібрано", async () => {
    const original = message();
    await run(update(original));
    expect((await run(update(original))).kind).toBe("ignored");
    expect(await t.db.select().from(intakeMessages)).toHaveLength(1);
    const edited = await run(update({ ...original, text: "ДСВ завтра 45 кг" }, true));
    expect(edited.kind).toBe("updated");
    expect((await t.db.select().from(intakeMessages))[0]!.text).toBe("ДСВ завтра 45 кг");
    // Вже розібрану заявку редагування не чіпає.
    await t.db.update(intakeMessages).set({ parseStatus: "parsed" });
    expect((await run(update({ ...original, text: "інше" }, true))).kind).toBe("ignored");
    expect((await t.db.select().from(intakeMessages))[0]!.text).toBe("ДСВ завтра 45 кг");
  });

  it("голосове від менеджера зберігається як пропущене (поки не підтримуємо)", async () => {
    const outcome = await run(update(message({ text: undefined, voice: { file_id: "abc" } })));
    expect(outcome).toMatchObject({ kind: "stored", status: "skipped" });
    const [row] = await t.db.select().from(intakeMessages);
    expect(row).toMatchObject({
      channel: "voice",
      voiceFileId: "abc",
      skipReason: "голосові поки не підтримуємо",
    });
  });

  it("прив'язка: /start КОД підключає Telegram, код одноразовий і діє лише свій термін", async () => {
    const private_ = (code: string, userId: number): TgUpdate =>
      update({
        message_id: (nextId += 1),
        chat: { id: userId, type: "private" },
        from: { id: userId },
        text: `/start ${code}`,
      });
    const expires = new Date(Date.now() + 3_600_000);
    await t.db.insert(telegramLinkCodes).values([
      { code: "GOODCODE", profileId: t.users.production.id, expiresAt: expires },
      {
        code: "OLDCODE1",
        profileId: t.users.production.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    ]);
    expect((await run(private_("OLDCODE1", 9100))).kind).toBe("bind_failed");
    expect((await run(private_("nonsense", 9100))).kind).toBe("bind_failed");
    const bound = await run(private_("goodcode", 9100));
    expect(bound).toMatchObject({ kind: "bound", profileId: t.users.production.id });
    const [profile] = await t.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, t.users.production.id));
    expect(profile!.telegramUserId).toBe(9100);
    expect(sent.at(-1)!.text).toContain("Telegram підключено");
    // Код використано, повторно не працює.
    expect((await run(private_("GOODCODE", 9200))).kind).toBe("bind_failed");
    // Той самий Telegram не можна підключити до іншого користувача.
    await t.db
      .insert(telegramLinkCodes)
      .values({ code: "OTHER123", profileId: t.users.accountant.id, expiresAt: expires });
    expect((await run(private_("OTHER123", 9100))).kind).toBe("bind_failed");
    expect(sent.at(-1)!.text).toContain("уже підключений");
    await t.db
      .update(profiles)
      .set({ telegramUserId: null })
      .where(eq(profiles.id, t.users.production.id));
  });

  it("/start без коду й інші особисті повідомлення дають підказку й нічого не змінюють", async () => {
    const dm = (text: string): TgUpdate =>
      update({
        message_id: (nextId += 1),
        chat: { id: 9300, type: "private" },
        from: { id: 9300 },
        text,
      });
    await run(dm("/start"));
    expect(sent.at(-1)!.text).toContain("візьміть код");
    await run(dm("привіт"));
    expect(sent.at(-1)!.text).toContain("Заявки приймаю в групі");
  });

  it("власник підключає свій Telegram: його чат запам'ятовується для підсумків", async () => {
    await t.db.insert(telegramLinkCodes).values({
      code: "OWNERCODE",
      profileId: t.users.owner.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await run(
      update({
        message_id: (nextId += 1),
        chat: { id: 4242, type: "private" },
        from: { id: 4242 },
        text: "/start OWNERCODE",
      }),
    );
    const [row] = await t.db
      .select()
      .from(settings)
      .where(eq(settings.key, "telegram.owner_chat_id"));
    expect(row!.value).toBe(4242);
    await t.db
      .update(profiles)
      .set({ telegramUserId: null })
      .where(eq(profiles.id, t.users.owner.id));
  });

  it("«визначити топік»: лише підключений власник у топіку, налаштування зберігаються, чужим не вдається", async () => {
    await setTelegramSettings(t.db, null, {
      groupChatId: null,
      topicKyiv: null,
      topicLviv: null,
      capture: { target: "lviv", expiresAt: new Date(Date.now() + 600_000).toISOString() },
    });
    // Менеджер не може визначити топік.
    await run(update(message({ message_thread_id: 77 })));
    const stillEmpty = await t.db
      .select()
      .from(settings)
      .where(eq(settings.key, "telegram.topic_lviv_id"));
    expect(stillEmpty[0]?.value ?? null).toBeNull();
    // Власник без топіка: підказка.
    await t.db
      .update(profiles)
      .set({ telegramUserId: 5100 })
      .where(eq(profiles.id, t.users.owner.id));
    expect(
      (await run(update(message({ from: { id: 5100 }, message_thread_id: undefined })))).kind,
    ).toBe("ignored");
    expect(sent.at(-1)!.text).toContain("у потрібному топіку");
    // Власник у топіку: запам'ятовуємо.
    const outcome = await run(update(message({ from: { id: 5100 }, message_thread_id: 77 })));
    expect(outcome).toEqual({ kind: "captured", target: "lviv" });
    const rows = await t.db.select().from(settings);
    expect(rows.find((r) => r.key === "telegram.topic_lviv_id")!.value).toBe(77);
    expect(rows.find((r) => r.key === "telegram.group_chat_id")!.value).toBe(GROUP);
    expect(rows.find((r) => r.key === "telegram.capture")).toBeUndefined();
    await t.db
      .update(profiles)
      .set({ telegramUserId: null })
      .where(eq(profiles.id, t.users.owner.id));
    vi.restoreAllMocks();
  });
});
