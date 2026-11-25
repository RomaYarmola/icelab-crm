import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clients, clientStatuses, dataExports } from "@/db/schema";
import { exportAnalytics } from "@/server/export";
import { runExport } from "@/server/export-request";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { USER_ROLES } from "@/server/permissions";
import { makeClient } from "../db/helpers";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";
import { readXlsx } from "./xlsx-reader";

describe("експорт аналітики (B14, D212)", () => {
  let t: OrderTestContext;
  const query = { from: "2026-10", to: "2026-11" };

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
    const other = await makeClient(t.db, { name: "Чужий бар" });
    for (const clientId of [t.client.id, other.id]) {
      const { id } = await t.create({ orderDate: "2026-11-02", clientId }, t.users.owner);
      await transitionOrder(t.db, t.users.owner, id, "confirmed");
    }
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const sheetsOf = async (tab: string, actor = t.users.owner) => {
    const file = await exportAnalytics(t.db, actor, { ...query, tab });
    return { file, book: readXlsx(new Uint8Array(file.buffer)) };
  };

  it("панель: шість аркушів; сума й кг збігаються з даними", async () => {
    const { file, book } = await sheetsOf("panel");
    expect(file.kind).toBe("analytics");
    expect(file.fileName).toBe("icelab-analytics-panel-2026-11.xlsx");
    expect(book.sheets.map((s) => s.name)).toEqual([
      "По місяцях",
      "Клієнти",
      "Менеджери",
      "Типи льоду",
      "Застосування",
      "Джерела",
    ]);
    const months = book.sheets[0]!.rows;
    expect(months.at(-1)!.C!.value).toBe(60);
    expect(book.sheets[1]!.rows).toHaveLength(3);
  });

  it("бокси, доставки й «Давно не замовляли» мають свої аркуші", async () => {
    expect((await sheetsOf("boxes")).book.sheets.map((s) => s.name)).toEqual([
      "По місяцях",
      "Типи тари",
      "Клієнти",
      "Менеджери",
    ]);
    expect((await sheetsOf("delivery")).book.sheets.map((s) => s.name)).toEqual([
      "По місяцях",
      "Локації",
      "Клієнти",
      "Менеджери",
    ]);
    const inactive = await sheetsOf("inactive");
    expect(inactive.book.sheets.map((s) => s.name)).toEqual(["Давно не замовляли"]);
    expect(inactive.file.fileName).toMatch(/^icelab-analytics-inactive-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("менеджер отримує лише своїх клієнтів, як на екрані", async () => {
    const { book } = await sheetsOf("panel", t.users.manager);
    const names = book.sheets[1]!.rows.map((row) => row.B?.value);
    expect(names).toContain("Кафе Тест");
    expect(names).not.toContain("Чужий бар");
  });

  it("адреса експорту читає вкладку й період; невідома вкладка стає панеллю; запис у журнал", async () => {
    const file = await runExport(t.db, t.users.accountant, "analytics", {
      tab: "щось",
      ...query,
    });
    expect(file.fileName).toBe("icelab-analytics-panel-2026-11.xlsx");
    const [log] = await t.db
      .select()
      .from(dataExports)
      .where(eq(dataExports.fileName, file.fileName));
    expect(log).toMatchObject({ kind: "analytics" });
  });

  it("права: власник, менеджер, бухгалтер", async () => {
    for (const role of USER_ROLES) {
      const attempt = exportAnalytics(t.db, t.users[role], { ...query, tab: "panel" });
      if (["owner", "manager", "accountant"].includes(role))
        await expect(attempt, role).resolves.toBeTruthy();
      else await expect(attempt, role).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
