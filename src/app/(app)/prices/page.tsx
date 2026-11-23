import type { Metadata } from "next";
import { changeBoxPriceAction, changeDefaultPriceAction } from "@/app/(app)/prices/actions";
import PricesPageContent from "@/components/pricesPage/PricesPageContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { getClientFormOptions } from "@/server/client-options";
import { can } from "@/server/permissions";
import { listDefaultPrices } from "@/server/prices";
import { listBoxPrices } from "@/server/product-prices";
import { todayIso } from "@/utils/isoDate";

export const metadata: Metadata = { title: "Прайс" };

/** Прайс: ціни за замовчуванням за типами льоду (власник міняє, менеджер і бухгалтер дивляться). */
export default async function PricesPage() {
  const user = await requireUser();
  const db = getDb();
  const [prices, options, boxPrices] = await Promise.all([
    listDefaultPrices(db, user),
    getClientFormOptions(db, user),
    listBoxPrices(db, user),
  ]);

  return (
    <PricesPageContent
      prices={prices}
      iceTypes={options.iceTypes}
      today={todayIso()}
      canEdit={can(user.role, "default_prices", "write")}
      action={changeDefaultPriceAction}
      boxTypes={options.boxTypes.filter((type) => !type.isClientOwned)}
      boxPrices={boxPrices}
      boxAction={changeBoxPriceAction}
    />
  );
}
