import Text from "../shared/texts/Text";
import { monthLabel } from "./monthLabel";

interface MonthBarsProps {
  /** Підпис графіка (для екранних читалок і заголовком). */
  label: string;
  points: { month: string; value: number; text: string }[];
}

/**
 * Прості горизонтальні стовпчики по місяцях без бібліотек (D206): місяць, смуга, значення словами.
 * Числа написані поруч, тож графік читається й без кольору та на вузькому екрані.
 */
export default function MonthBars({ label, points }: MonthBarsProps) {
  const max = Math.max(0, ...points.map((point) => point.value));
  return (
    <figure className="flex flex-col gap-2">
      <figcaption>
        <Text variant="label">{label}</Text>
      </figcaption>
      <ul className="flex flex-col gap-2">
        {points.map((point) => (
          <li key={point.month} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-caption text-grey-text">
              {monthLabel(point.month)}
            </span>
            <span className="h-3 min-w-0 flex-1 rounded-full bg-grey-light" aria-hidden="true">
              <span
                className="block h-3 rounded-full bg-blue"
                style={{ width: max > 0 ? `${(point.value / max) * 100}%` : "0%" }}
              />
            </span>
            <span className="w-28 shrink-0 text-right text-caption font-semibold text-navy">
              {point.text}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
