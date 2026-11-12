import { describePeriod, type PriceGroup } from "@/utils/priceView";
import { formatPricePerKg } from "@/utils/formatNumber";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";

interface PriceHistoryProps {
  groups: PriceGroup<{
    id: string;
    pricePerKg: string;
    validFrom: string;
    validTo: string | null;
  }>[];
  /** Сьогоднішня дата `YYYY-MM-DD`: від неї залежить, що діє, а що ще ні. */
  today: string;
}

/** Історія цін за типами льоду: у кожній групі від новішої до старішої, з періодом дії. */
export default function PriceHistory({ groups, today }: PriceHistoryProps) {
  if (groups.length === 0) return <Text variant="muted">Цін ще немає.</Text>;

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.title} className="flex flex-col gap-2">
          <SubTitle>{group.title}</SubTitle>
          <ul className="flex flex-col gap-1.5">
            {group.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <Text as="span" variant="label">
                  {formatPricePerKg(row.pricePerKg)}
                </Text>
                <Text as="span" variant="muted">
                  {describePeriod(row, today)}
                </Text>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
