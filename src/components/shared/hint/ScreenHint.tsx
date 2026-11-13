import { type ScreenHintData, visibleHintItems } from "@/constants/hints";
import Disclosure from "../disclosure/Disclosure";
import InfoIcon from "../icons/InfoIcon";

interface ScreenHintProps {
  hint: ScreenHintData;
  /** Що користувач може на цьому екрані: від цього залежить, які пункти показуємо. */
  access?: { work?: boolean; edit?: boolean };
  className?: string;
}

/**
 * Коротка підказка екрана (B8, ТЗ §12): кнопка «Що означають статуси» розкриває кілька пунктів
 * «поняття: що це». Згорнута, щоб не займати місце там, де все й так зрозуміло. Тексти в
 * `src/constants/hints.ts`.
 */
export default function ScreenHint({ hint, access, className }: ScreenHintProps) {
  const items = visibleHintItems(hint, access);
  return (
    <Disclosure
      className={className}
      summary={
        <span className="inline-flex items-center gap-2">
          <InfoIcon className="size-5 shrink-0 text-blue" />
          {hint.title}
        </span>
      }
    >
      <dl className="flex flex-col gap-3 rounded-field bg-grey-light px-4 py-3">
        {items.map((item) => (
          <div key={item.term} className="flex flex-col gap-0.5">
            <dt className="text-body font-semibold text-navy">{item.term}</dt>
            <dd className="text-body text-grey-text">{item.text}</dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  );
}
