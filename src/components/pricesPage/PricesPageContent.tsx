import type { DefaultPriceHistoryItem } from "@/server/prices";
import { formatIsoDate } from "@/utils/isoDate";
import { formatPricePerKg } from "@/utils/formatNumber";
import { effectivePriceFor, groupDefaultPrices } from "@/utils/priceView";
import type { FormAction } from "../clientsPage/clientActions";
import Card from "../shared/cards/Card";
import Disclosure from "../shared/disclosure/Disclosure";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";
import type { BoxPriceHistoryItem } from "@/server/product-prices";
import BoxPricesSection from "./BoxPricesSection";
import PriceChangeForm from "./PriceChangeForm";
import PriceHistory from "./PriceHistory";

interface PricesPageContentProps {
  /** Уся історія прайсу за типами льоду. */
  prices: DefaultPriceHistoryItem[];
  iceTypes: { id: string; name: string }[];
  /** Сьогоднішня дата `YYYY-MM-DD`. */
  today: string;
  /** Прайс змінює лише власник (D44), решта дивиться. */
  canEdit: boolean;
  action: FormAction;
  /** Бокси на продаж: ціни з історією й дія зміни ціни (D175). */
  boxTypes: { id: string; name: string }[];
  boxPrices: BoxPriceHistoryItem[];
  boxAction: FormAction;
}

/**
 * Екран «Прайс»: ціни за замовчуванням за типами льоду. Вони однакові для всіх клієнтів і діють,
 * поки в клієнта немає своєї ціни (D26). Власник міняє ціну «від дати», решта бачить чинні ціни
 * й історію.
 */
export default function PricesPageContent({
  prices,
  iceTypes,
  today,
  canEdit,
  action,
  boxTypes,
  boxPrices,
  boxAction,
}: PricesPageContentProps) {
  return (
    <div className="flex flex-col gap-6">
      <Text variant="muted" className="max-w-xl">
        Ціна за кілограм для кожного типу льоду. Вона однакова для всіх клієнтів, поки в клієнта
        немає своєї ціни.
      </Text>
      {canEdit ? null : <Notification variant="info">Прайс змінює власник.</Notification>}

      <ul className="grid items-start gap-4 lg:grid-cols-2">
        {iceTypes.map((iceType) => {
          const own = prices.filter((price) => price.iceTypeId === iceType.id);
          const effective = effectivePriceFor(iceType.id, [], own, today);
          return (
            <Card as="li" key={iceType.id} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <SubTitle>{iceType.name}</SubTitle>
                <Text variant="kpi" className="font-extrabold">
                  {effective.current
                    ? formatPricePerKg(effective.current.pricePerKg)
                    : "Немає ціни"}
                </Text>
                {effective.current ? (
                  <Text variant="muted">Діє з {formatIsoDate(effective.current.validFrom)}</Text>
                ) : null}
                {effective.upcoming ? (
                  <Text>
                    З {formatIsoDate(effective.upcoming.validFrom)}:{" "}
                    {formatPricePerKg(effective.upcoming.pricePerKg)}
                  </Text>
                ) : null}
              </div>
              {canEdit ? (
                <Disclosure
                  key={own.map((price) => price.id).join(",")}
                  summary="Нова ціна від дати"
                >
                  <PriceChangeForm action={action} fixedIceTypeId={iceType.id} today={today} />
                </Disclosure>
              ) : null}
              <Disclosure variant="plain" summary="Історія цін">
                <PriceHistory groups={groupDefaultPrices(own)} today={today} />
              </Disclosure>
            </Card>
          );
        })}
      </ul>
      <BoxPricesSection
        boxTypes={boxTypes}
        prices={boxPrices}
        today={today}
        canEdit={canEdit}
        action={boxAction}
      />
    </div>
  );
}
