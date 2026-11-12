import type { ClientPriceHistoryItem, DefaultPriceHistoryItem } from "@/server/prices";
import { formatIsoDate } from "@/utils/isoDate";
import { formatPricePerKg } from "@/utils/formatNumber";
import {
  ANY_ICE_TYPE_LABEL,
  effectivePriceFor,
  groupClientPrices,
  type PriceSource,
} from "@/utils/priceView";
import PriceChangeForm from "../pricesPage/PriceChangeForm";
import PriceHistory from "../pricesPage/PriceHistory";
import Card from "../shared/cards/Card";
import Disclosure from "../shared/disclosure/Disclosure";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import SubTitle from "../shared/titles/SubTitle";
import type { FormAction } from "./clientActions";

interface PricesTabProps {
  clientId: string;
  /** Уся історія цін клієнта. */
  prices: ClientPriceHistoryItem[];
  /** Уся історія прайсу: ціна клієнта порівнюється з нею, а без індивідуальної діє прайс. */
  defaults: DefaultPriceHistoryItem[];
  iceTypes: { id: string; name: string }[];
  /** Сьогоднішня дата `YYYY-MM-DD`. */
  today: string;
  /** Роль може міняти ціни клієнта (власник, менеджер), а клієнта не видалено. */
  canEdit: boolean;
  action: FormAction;
}

const SOURCE_LABELS: Record<PriceSource, string> = {
  client: "Ціна клієнта",
  client_any_type: "Ціна клієнта для будь-якого типу",
  default: "За прайсом",
  none: "Ціни немає",
};

/**
 * Вкладка «Ціни» (лише для ролей з правом на ціни): що діє зараз для кожного типу льоду, форма
 * «нова ціна від дати» та історія. Правило вибору: ціна клієнта на цей тип, інакше його ціна для
 * будь-якого типу, інакше прайс (D45).
 */
export default function PricesTab({
  clientId,
  prices,
  defaults,
  iceTypes,
  today,
  canEdit,
  action,
}: PricesTabProps) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="current-prices" className="flex flex-col gap-3">
        <SectionTitle id="current-prices">Ціни зараз</SectionTitle>
        <ul className="grid gap-3 sm:grid-cols-2">
          {iceTypes.map((iceType) => {
            const effective = effectivePriceFor(iceType.id, prices, defaults, today);
            const inPriceList = effectivePriceFor(iceType.id, [], defaults, today).current;
            const isOwnPrice =
              effective.source === "client" || effective.source === "client_any_type";
            return (
              <Card as="li" key={iceType.id} className="flex flex-col gap-1">
                <SubTitle>{iceType.name}</SubTitle>
                <Text variant="lead" className="font-bold">
                  {effective.current ? formatPricePerKg(effective.current.pricePerKg) : "—"}
                </Text>
                <Text variant="muted">
                  {SOURCE_LABELS[effective.source]}
                  {isOwnPrice && effective.current
                    ? ` з ${formatIsoDate(effective.current.validFrom)}`
                    : ""}
                </Text>
                {isOwnPrice && inPriceList ? (
                  <Text variant="muted">У прайсі: {formatPricePerKg(inPriceList.pricePerKg)}</Text>
                ) : null}
                {effective.upcoming ? (
                  <Text>
                    З {formatIsoDate(effective.upcoming.validFrom)}:{" "}
                    {formatPricePerKg(effective.upcoming.pricePerKg)}
                  </Text>
                ) : null}
              </Card>
            );
          })}
        </ul>
        <Text variant="muted">
          Якщо в клієнта немає своєї ціни, береться ціна з прайсу. Своя ціна клієнта завжди
          сильніша.
        </Text>
      </section>

      {canEdit ? (
        <Disclosure
          // Після збереження історія змінюється: ключ повертає форму до початкового стану.
          key={prices.map((price) => price.id).join(",")}
          summary="Нова ціна від дати"
        >
          <PriceChangeForm
            action={action}
            clientId={clientId}
            iceTypeOptions={[
              { value: "", label: ANY_ICE_TYPE_LABEL },
              ...iceTypes.map((iceType) => ({ value: iceType.id, label: iceType.name })),
            ]}
            today={today}
          />
        </Disclosure>
      ) : (
        <Notification variant="info">Ціни клієнта змінює менеджер або власник.</Notification>
      )}

      <Disclosure variant="plain" summary="Історія цін клієнта">
        <PriceHistory groups={groupClientPrices(prices)} today={today} />
      </Disclosure>
    </div>
  );
}
