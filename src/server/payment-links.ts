import { eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import { settings } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { linkKey, splitPaymentGroups } from "@/utils/debtMessage";
import { parseInput, ValidationError } from "./errors";
import { type AppUser, requirePermission } from "./guards";
import {
  type CallOptions,
  createIbanInvoice,
  getIbanOplataKey,
  type IbanAccount,
  IbanOplataError,
  listIbanAccounts,
} from "./ibanoplata/client";
import { listDebts } from "./payment-views";

/**
 * Автоматичні посилання на оплату (D239, варіант А з D202). Суму й призначення з номерами замовлень
 * рахує сервер за поточними боргами; реквізити беремо зі збережених у кабінеті IBAN oplata, який
 * саме рахунок, обирають на вкладці «Банк». Ручний спосіб (D203) лишається запасним.
 */

export const IBAN_ACCOUNT_KEY = "payment.ibanoplata_account";

const uuid = z.uuid("Некоректний ідентифікатор.");

async function savedAccountUid(db: AnyPgDatabase): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, IBAN_ACCOUNT_KEY));
  return typeof row?.value === "string" ? row.value : null;
}

/** Рахунок для посилань: вибраний, а якщо вибору не було, то єдиний чинний. */
function pickAccount(accounts: IbanAccount[], saved: string | null): IbanAccount | null {
  const active = accounts.filter((account) => !account.isSuspended);
  if (saved) return active.find((account) => account.ibanAccountUid === saved) ?? null;
  return active.length === 1 ? active[0]! : null;
}

export type PaymentLinkStatus = {
  hasKey: boolean;
  /** Чинні рахунки з кабінету сервісу; IBAN показуємо лише кінцівкою. */
  accounts: { uid: string; label: string }[];
  selectedUid: string | null;
  error: string | null;
};

/** Стан підключення для вкладки «Банк»: ключ, рахунки сервісу й вибраний. */
export async function getPaymentLinkStatus(
  db: AnyPgDatabase,
  actor: AppUser,
  options: CallOptions = {},
): Promise<PaymentLinkStatus> {
  requirePermission(actor, "bank_payments", "read");
  const hasKey = Boolean(options.key === undefined ? getIbanOplataKey() : options.key);
  if (!hasKey) return { hasKey, accounts: [], selectedUid: null, error: null };
  const saved = await savedAccountUid(db);
  try {
    const accounts = await listIbanAccounts(db, options);
    return {
      hasKey,
      accounts: accounts
        .filter((account) => !account.isSuspended)
        .map((account) => ({
          uid: account.ibanAccountUid,
          label: `${account.organizationName}, рахунок …${account.iban.slice(-4)}`,
        })),
      selectedUid: pickAccount(accounts, saved)?.ibanAccountUid ?? null,
      error: null,
    };
  } catch (error) {
    if (!(error instanceof IbanOplataError)) throw error;
    return { hasKey, accounts: [], selectedUid: saved, error: error.message };
  }
}

export async function setPaymentLinkAccount(
  db: AnyPgDatabase,
  actor: AppUser,
  accountUid: string,
  options: CallOptions = {},
): Promise<void> {
  requirePermission(actor, "bank_payments", "write");
  let accounts: IbanAccount[];
  try {
    accounts = await listIbanAccounts(db, options);
  } catch (error) {
    if (error instanceof IbanOplataError) throw new ValidationError(error.message);
    throw error;
  }
  if (!pickAccount(accounts, accountUid)) {
    throw new ValidationError("Оберіть чинний рахунок зі списку.");
  }
  await withActor(db, actor.id, async (tx) => {
    await tx
      .insert(settings)
      .values({ key: IBAN_ACCOUNT_KEY, value: accountUid })
      .onConflictDoUpdate({ target: settings.key, set: { value: accountUid } });
  });
}

const requestSchema = z.object({
  clientId: uuid,
  orderIds: z.array(uuid).min(1, "Відзначте хоча б одне замовлення.").max(200),
});

export type CreatedLinks = {
  /** Посилання за ключем групи (`linkKey`). */
  links: Record<string, string>;
  /** Чому створено не всі; `null`, якщо все вдалось. */
  error: string | null;
};

/**
 * Створює посилання на оплату відзначених замовлень боргу клієнта: по одному на кожну групу, що
 * вміщається в призначення платежу. Помилка на котромусь не губить уже створені.
 */
export async function createPaymentLinks(
  db: AnyPgDatabase,
  actor: AppUser,
  input: z.input<typeof requestSchema>,
  options: CallOptions & { now?: Date } = {},
): Promise<CreatedLinks> {
  requirePermission(actor, "bank_payments", "write");
  const data = parseInput(requestSchema, input);
  const debt = (await listDebts(db, actor, options.now)).find(
    (item) => item.clientId === data.clientId,
  );
  const wanted = new Set(data.orderIds);
  const selected = debt?.orders.filter((order) => wanted.has(order.id)) ?? [];
  if (selected.length !== wanted.size) {
    throw new ValidationError("Борги змінились: оновіть сторінку й повторіть.");
  }
  const links: Record<string, string> = {};
  try {
    const account = pickAccount(await listIbanAccounts(db, options), await savedAccountUid(db));
    if (!account) {
      return { links, error: "Оберіть рахунок для посилань на вкладці «Банк»." };
    }
    for (const group of splitPaymentGroups(selected)) {
      const invoice = await createIbanInvoice(
        db,
        {
          organizationName: account.organizationName,
          identificationCode: account.identificationCode,
          iban: account.iban,
          amount: group.kopecks / 100,
          paymentPurpose: group.purpose,
        },
        options,
      );
      links[linkKey(group)] = invoice.ibanInvoiceUrl;
    }
  } catch (error) {
    if (!(error instanceof IbanOplataError)) throw error;
    return { links, error: error.message };
  }
  return { links, error: null };
}
