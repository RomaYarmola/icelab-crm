import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, orderItems, orderPriceChanges, orders } from "@/db/schema";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import {
  cancelAsDuplicate,
  changeOrderPrice,
  closeIfDone,
  transitionOrder,
} from "@/server/order-status";
import { getOrder, updateOrder } from "@/server/orders";
import { changeClientPrice, changeDefaultPrice } from "@/server/prices";
import { USER_ROLES } from "@/server/permissions";
import { makeClient } from "../db/helpers";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("замовлення: переходи статусів і зміна ціни (D51, D52)", () => {
  let t: OrderTestContext;

  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const row = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;
  const draft = async (overrides: Parameters<typeof t.create>[0] = {}) =>
    (await t.create(overrides)).id;
  const history = async (id: string) =>
    (await getOrder(t.db, t.users.owner, id))!.history.map(
      (h) => `${h.fromStatus ?? "∅"}>${h.toStatus}`,
    );

  describe("крок назад на «Оплачено» (D69)", () => {
    it("повернення з «Закрито» на «Оплачено» не закриває замовлення знову", async () => {
      const id = await draft();
      for (const to of ["confirmed", "in_production", "packed", "shipped"] as const) {
        await transitionOrder(t.db, t.users.owner, id, to);
      }
      await transitionOrder(t.db, t.users.owner, id, "paid", { note: "Оплата" });
      expect((await row(id)).status).toBe("closed");
      await transitionOrder(t.db, t.users.owner, id, "paid", { note: "Виправляємо касу" });
      expect((await row(id)).status).toBe("paid");
      await transitionOrder(t.db, t.users.owner, id, "shipped", { note: "Ще крок назад" });
      expect((await row(id)).status).toBe("shipped");
    });
  });

  describe("підтвердження фіксує ціну (D52)", () => {
    it("ціна за прайсом фіксується, час і автор підтвердження записані", async () => {
      const id = await draft();
      const result = await transitionOrder(t.db, t.users.manager, id, "confirmed");
      expect(result.status).toBe("confirmed");
      const order = await row(id);
      expect(order).toMatchObject({
        status: "confirmed",
        pricePerKgSnapshot: "75.00",
        confirmedBy: t.users.manager.id,
      });
      expect(order.confirmedAt).toBeInstanceOf(Date);
      expect(await history(id)).toEqual(["∅>draft", "draft>confirmed"]);
    });

    it("ціна, змінена в прайсі до підтвердження, береться в момент підтвердження", async () => {
      const id = await draft();
      await changeDefaultPrice(t.db, t.users.owner, {
        iceTypeId: t.ice16,
        pricePerKg: "82",
        validFrom: "2026-11-05",
      });
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      expect((await row(id)).pricePerKgSnapshot).toBe("82.00");
      expect(
        (await t.db.select().from(orderItems).where(eq(orderItems.orderId, id)))[0]?.price,
      ).toBe("82.00");
      await changeDefaultPrice(t.db, t.users.owner, {
        iceTypeId: t.ice16,
        pricePerKg: "75",
        validFrom: "2026-11-06",
      });
    });

    it("ціна, вказана вручну, зберігається як є", async () => {
      const id = await draft({ price: "65" });
      await transitionOrder(t.db, t.users.owner, id, "confirmed");
      expect(await row(id)).toMatchObject({ pricePerKgSnapshot: "65.00", total: "1950.00" });
    });

    it("після підтвердження зміна прайсу замовлення не чіпає", async () => {
      const id = await draft();
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      await changeDefaultPrice(t.db, t.users.owner, {
        iceTypeId: t.ice16,
        pricePerKg: "99",
        validFrom: "2026-11-10",
      });
      expect(await row(id)).toMatchObject({ pricePerKgSnapshot: "75.00", total: "2250.00" });
      await changeDefaultPrice(t.db, t.users.owner, {
        iceTypeId: t.ice16,
        pricePerKg: "75",
        validFrom: "2026-11-11",
      });
    });

    it("після підтвердження зміна ціни в картці клієнта замовлення не чіпає (ТЗ §13, критерій 3)", async () => {
      const client = await makeClient(t.db, { name: "Клієнт із власною ціною" });
      await changeClientPrice(t.db, t.users.manager, {
        clientId: client.id,
        iceTypeId: t.ice16,
        pricePerKg: "60",
        validFrom: "2026-11-10",
      });
      const id = await draft({ clientId: client.id });
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      expect(await row(id)).toMatchObject({ pricePerKgSnapshot: "60.00", total: "1800.00" });

      await changeClientPrice(t.db, t.users.manager, {
        clientId: client.id,
        iceTypeId: t.ice16,
        pricePerKg: "99",
        validFrom: "2026-11-11",
      });
      expect(await row(id)).toMatchObject({ pricePerKgSnapshot: "60.00", total: "1800.00" });

      // Нове замовлення цього клієнта вже за новою ціною: зміна справді подіяла.
      const next = await draft({ clientId: client.id });
      await transitionOrder(t.db, t.users.manager, next, "confirmed");
      expect(await row(next)).toMatchObject({ pricePerKgSnapshot: "99.00", total: "2970.00" });
    });

    it("без ціни, типу льоду чи кг підтвердити не можна", async () => {
      const noPrice = await draft({ iceTypeId: t.ice3 });
      await expect(transitionOrder(t.db, t.users.manager, noPrice, "confirmed")).rejects.toThrow(
        "Немає ціни",
      );
      const noIce = await draft({ iceTypeId: null });
      await expect(transitionOrder(t.db, t.users.manager, noIce, "confirmed")).rejects.toThrow(
        "Вкажіть тип льоду",
      );
      const noKg = await draft({ kgSold: 0 });
      await expect(transitionOrder(t.db, t.users.manager, noKg, "confirmed")).rejects.toThrow(
        "скільки кілограмів",
      );
      expect((await row(noPrice)).status).toBe("draft");
    });

    it("двоє підтверджують одночасно: спрацьовує один, історія без дубля", async () => {
      const id = await draft();
      const results = await Promise.allSettled([
        transitionOrder(t.db, t.users.manager, id, "confirmed"),
        transitionOrder(t.db, t.users.owner, id, "confirmed"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(failed.reason).toBeInstanceOf(ValidationError);
      expect(await history(id)).toEqual(["∅>draft", "draft>confirmed"]);
    });
  });

  describe("увесь шлях до закриття", () => {
    it("підтверджено → виробництво → запаковано → відправлено → оплачено → закрито", async () => {
      const id = await draft();
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      await transitionOrder(t.db, t.users.production, id, "in_production");
      await transitionOrder(t.db, t.users.location_lead, id, "packed");
      await transitionOrder(t.db, t.users.manager, id, "shipped");
      const paid = await transitionOrder(t.db, t.users.owner, id, "paid", {
        note: "Готівка в касі",
      });
      // Оплачене замовлення без боргів по боксах закривається саме (D51).
      expect(paid.status).toBe("closed");
      const order = await row(id);
      for (const column of [
        "confirmedAt",
        "packedAt",
        "producedAt",
        "shippedAt",
        "paidAt",
        "closedAt",
      ] as const) {
        expect(order[column], column).toBeInstanceOf(Date);
      }
      expect(await history(id)).toEqual([
        "∅>draft",
        "draft>confirmed",
        "confirmed>in_production",
        "in_production>packed",
        "packed>shipped",
        "shipped>paid",
        "paid>closed",
      ]);
      const card = await getOrder(t.db, t.users.owner, id);
      expect(card?.history.at(-2)?.note).toBe("Готівка в касі");
      expect(card?.history.at(-1)?.note).toBe("Закрито автоматично: замовлення оплачене");
    });

    it("борг по боксах (B9) тримає замовлення відкритим", async () => {
      const id = await draft();
      await t.db
        .update(orders)
        .set({ status: "paid", pricePerKgSnapshot: "75" })
        .where(eq(orders.id, id));
      expect(await closeIfDone(t.db, id, 2)).toBe(false);
      expect((await row(id)).status).toBe("paid");
      expect(await closeIfDone(t.db, id, 0)).toBe(true);
      expect((await row(id)).status).toBe("closed");
    });

    it("пропустити статус не можна ніким, у тому числі власником", async () => {
      const id = await draft();
      await expect(transitionOrder(t.db, t.users.owner, id, "in_production")).rejects.toThrow(
        ValidationError,
      );
      await expect(transitionOrder(t.db, t.users.owner, id, "shipped")).rejects.toThrow(
        ValidationError,
      );
      await expect(transitionOrder(t.db, t.users.owner, id, "closed")).rejects.toThrow(
        ValidationError,
      );
      await expect(transitionOrder(t.db, t.users.owner, id, "draft")).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("хто що може (D51)", () => {
    it("підтверджують власник і менеджер, решті відмовлено", async () => {
      for (const role of USER_ROLES) {
        const id = await draft();
        const attempt = transitionOrder(t.db, t.users[role], id, "confirmed");
        if (role === "owner" || role === "manager")
          await expect(attempt, role).resolves.toBeDefined();
        else await expect(attempt, role).rejects.toThrow(ForbiddenError);
      }
    });

    it("«У виробництві» й «Запаковано»: власник, старший локації й виробництво своєї локації", async () => {
      for (const role of USER_ROLES) {
        const id = await draft();
        await transitionOrder(t.db, t.users.manager, id, "confirmed");
        const attempt = transitionOrder(t.db, t.users[role], id, "in_production");
        if (role === "owner" || role === "location_lead" || role === "production")
          await expect(attempt, role).resolves.toBeDefined();
        else await expect(attempt, role).rejects.toThrow(ForbiddenError);
      }
    });

    it("чужа локація не може ні виробляти, ні пакувати", async () => {
      const id = await draft();
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      await expect(transitionOrder(t.db, t.otherProduction, id, "in_production")).rejects.toThrow(
        ForbiddenError,
      );
      await expect(transitionOrder(t.db, t.otherLead, id, "in_production")).rejects.toThrow(
        ForbiddenError,
      );
      await transitionOrder(t.db, t.users.production, id, "in_production");
      await expect(transitionOrder(t.db, t.otherProduction, id, "packed")).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("«Відправлено»: власник, менеджер, старший локації своєї локації", async () => {
      for (const role of USER_ROLES) {
        const id = await draft();
        await transitionOrder(t.db, t.users.manager, id, "confirmed");
        await transitionOrder(t.db, t.users.production, id, "in_production");
        await transitionOrder(t.db, t.users.production, id, "packed");
        const attempt = transitionOrder(t.db, t.users[role], id, "shipped");
        if (role === "owner" || role === "manager" || role === "location_lead")
          await expect(attempt, role).resolves.toBeDefined();
        else await expect(attempt, role).rejects.toThrow(ForbiddenError);
      }
    });

    it("«Оплачено» вручну лише власник і лише з приміткою", async () => {
      const id = await draft();
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      await transitionOrder(t.db, t.users.production, id, "in_production");
      await transitionOrder(t.db, t.users.production, id, "packed");
      await transitionOrder(t.db, t.users.manager, id, "shipped");
      await expect(
        transitionOrder(t.db, t.users.manager, id, "paid", { note: "х" }),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        transitionOrder(t.db, t.users.accountant, id, "paid", { note: "х" }),
      ).rejects.toThrow(ForbiddenError);
      await expect(transitionOrder(t.db, t.users.owner, id, "paid")).rejects.toThrow(
        "Вкажіть примітку",
      );
      await expect(
        transitionOrder(t.db, t.users.owner, id, "paid", { note: "  " }),
      ).rejects.toThrow("Вкажіть примітку");
    });

    it("«Закрито» вручну ніхто не ставить", async () => {
      const id = await draft();
      await t.db
        .update(orders)
        .set({ status: "paid", pricePerKgSnapshot: "75" })
        .where(eq(orders.id, id));
      for (const role of USER_ROLES) {
        await expect(transitionOrder(t.db, t.users[role], id, "closed"), role).rejects.toThrow();
      }
    });
  });

  describe("скасування", () => {
    it("менеджер скасовує чернетку й підтверджене з причиною, причина в історії й замовленні", async () => {
      const id = await draft();
      await expect(transitionOrder(t.db, t.users.manager, id, "cancelled")).rejects.toThrow(
        "Вкажіть причину скасування.",
      );
      await transitionOrder(t.db, t.users.manager, id, "cancelled", { note: "Клієнт передумав" });
      expect(await row(id)).toMatchObject({
        status: "cancelled",
        cancelReason: "Клієнт передумав",
      });
      const card = await getOrder(t.db, t.users.manager, id);
      expect(card?.history.at(-1)).toMatchObject({
        toStatus: "cancelled",
        note: "Клієнт передумав",
      });
    });

    it("після відправлення лише власник, виробництво й старший локації не скасовують", async () => {
      const id = await draft();
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      await expect(
        transitionOrder(t.db, t.users.location_lead, id, "cancelled", { note: "х" }),
      ).rejects.toThrow(ForbiddenError);
      await transitionOrder(t.db, t.users.production, id, "in_production");
      await transitionOrder(t.db, t.users.production, id, "packed");
      await transitionOrder(t.db, t.users.manager, id, "shipped");
      await expect(
        transitionOrder(t.db, t.users.manager, id, "cancelled", { note: "х" }),
      ).rejects.toThrow(ForbiddenError);
      await transitionOrder(t.db, t.users.owner, id, "cancelled", { note: "Повернення" });
      expect((await row(id)).status).toBe("cancelled");
    });

    it("скасоване й закрите далі не рухаються", async () => {
      const id = await draft();
      await transitionOrder(t.db, t.users.owner, id, "cancelled", { note: "х" });
      for (const to of ["draft", "confirmed", "cancelled"] as const) {
        await expect(transitionOrder(t.db, t.users.owner, id, to, { note: "х" })).rejects.toThrow(
          ValidationError,
        );
      }
    });
  });

  describe("крок назад (лише власник)", () => {
    it("з підтвердженого в чернетку: ціна розморожується, мітки знімаються", async () => {
      const id = await draft();
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      await expect(
        transitionOrder(t.db, t.users.manager, id, "draft", { note: "х" }),
      ).rejects.toThrow(ForbiddenError);
      await expect(transitionOrder(t.db, t.users.owner, id, "draft")).rejects.toThrow(
        "Вкажіть, чому",
      );
      await transitionOrder(t.db, t.users.owner, id, "draft", { note: "Клієнт змінює склад" });
      expect(await row(id)).toMatchObject({
        status: "draft",
        pricePerKgSnapshot: null,
        confirmedAt: null,
        confirmedBy: null,
      });
      // Чернетку знову можна міняти й підтвердити.
      await updateOrder(t.db, t.users.manager, id, { kgSold: 20 });
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      expect(await row(id)).toMatchObject({ pricePerKgSnapshot: "75.00", total: "1500.00" });
    });

    it("з запакованого у виробництво: знімаються час пакування й виготовлення", async () => {
      const id = await draft();
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      await transitionOrder(t.db, t.users.production, id, "in_production");
      await transitionOrder(t.db, t.users.production, id, "packed");
      expect((await row(id)).packedAt).toBeInstanceOf(Date);
      await transitionOrder(t.db, t.users.owner, id, "in_production", { note: "Ще не запаковано" });
      expect(await row(id)).toMatchObject({
        status: "in_production",
        packedAt: null,
        producedAt: null,
      });
    });
  });

  describe("зміна ціни підтвердженого замовлення (D52)", () => {
    const confirmed = async () => {
      const id = await draft();
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      return id;
    };

    it("власник змінює ціну з приміткою: слід, позиція й сума оновлені", async () => {
      const id = await confirmed();
      await changeOrderPrice(t.db, t.users.owner, id, {
        pricePerKg: "70,50",
        note: "Домовились про знижку",
      });
      expect(await row(id)).toMatchObject({
        pricePerKgSnapshot: "70.50",
        priceManual: true,
        total: "2115.00",
      });
      expect(
        (
          await t.db
            .select()
            .from(orderItems)
            .where(and(eq(orderItems.orderId, id), eq(orderItems.kind, "ice")))
        )[0]?.price,
      ).toBe("70.50");
      const [change] = await t.db
        .select()
        .from(orderPriceChanges)
        .where(eq(orderPriceChanges.orderId, id));
      expect(change).toMatchObject({
        oldPrice: "75.00",
        newPrice: "70.50",
        note: "Домовились про знижку",
        changedBy: t.users.owner.id,
      });
      const audited = await t.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "order_price_changes"), eq(auditLog.rowId, change!.id)));
      expect(audited).toHaveLength(1);
    });

    it("ще раз: стара ціна в записі це попередня, а не початкова", async () => {
      const id = await confirmed();
      await changeOrderPrice(t.db, t.users.owner, id, { pricePerKg: 70, note: "Перша зміна" });
      await changeOrderPrice(t.db, t.users.owner, id, { pricePerKg: 68, note: "Друга зміна" });
      const card = await getOrder(t.db, t.users.owner, id);
      expect(card?.priceChanges?.map((c) => `${c.oldPrice}>${c.newPrice}`)).toEqual([
        "70.00>68.00",
        "75.00>70.00",
      ]);
    });

    it("лише власник; менеджер, бухгалтер, старший локації й виробництво отримують відмову", async () => {
      const id = await confirmed();
      for (const role of USER_ROLES) {
        if (role === "owner") continue;
        await expect(
          changeOrderPrice(t.db, t.users[role], id, { pricePerKg: 70, note: "х" }),
          role,
        ).rejects.toThrow(ForbiddenError);
      }
      expect((await row(id)).pricePerKgSnapshot).toBe("75.00");
    });

    it("потрібна примітка, нова ціна, відмінна від поточної, і статус після підтвердження", async () => {
      const id = await confirmed();
      await expect(
        changeOrderPrice(t.db, t.users.owner, id, { pricePerKg: 70, note: "  " }),
      ).rejects.toThrow("Вкажіть причину зміни ціни.");
      await expect(
        changeOrderPrice(t.db, t.users.owner, id, { pricePerKg: 75, note: "х" }),
      ).rejects.toThrow("збігається");
      await expect(
        changeOrderPrice(t.db, t.users.owner, id, { pricePerKg: "abc", note: "х" }),
      ).rejects.toThrow("Вкажіть ціну числом");
      await expect(
        changeOrderPrice(t.db, t.users.owner, id, { pricePerKg: 0, note: "х" }),
      ).rejects.toThrow("більшою за нуль");
      const d = await draft();
      await expect(
        changeOrderPrice(t.db, t.users.owner, d, { pricePerKg: 70, note: "х" }),
      ).rejects.toThrow("У чернетці");
      await transitionOrder(t.db, t.users.owner, id, "cancelled", { note: "х" });
      await expect(
        changeOrderPrice(t.db, t.users.owner, id, { pricePerKg: 70, note: "х" }),
      ).rejects.toThrow("закритому чи скасованому");
    });
  });

  describe("скасування як дубля (D56)", () => {
    it("нове замовлення скасовується з посиланням на перше й номером у причині", async () => {
      const first = await t.create();
      const second = await t.create();
      await cancelAsDuplicate(t.db, t.users.manager, second.id, first.id);
      const cancelled = await row(second.id);
      expect(cancelled).toMatchObject({ status: "cancelled", duplicateOf: first.id });
      expect(cancelled.cancelReason).toBe(`Дубль замовлення №${first.number}`);
    });

    it("сам себе, чужого клієнта й скасоване замовлення дублем не вважаємо", async () => {
      const first = await t.create();
      const stranger = await makeClient(t.db, { name: "Інший клієнт" });
      const foreign = await t.create({ clientId: stranger.id });
      const gone = await t.create();
      await transitionOrder(t.db, t.users.owner, gone.id, "cancelled", { note: "х" });
      await expect(cancelAsDuplicate(t.db, t.users.manager, first.id, first.id)).rejects.toThrow(
        "самого себе",
      );
      await expect(cancelAsDuplicate(t.db, t.users.manager, foreign.id, first.id)).rejects.toThrow(
        "того самого клієнта",
      );
      await expect(cancelAsDuplicate(t.db, t.users.manager, first.id, gone.id)).rejects.toThrow(
        "скасоване",
      );
    });
  });
});
