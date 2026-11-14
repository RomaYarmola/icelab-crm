import Link from "next/link";
import type { BoxDebtRow, LegacyDebtItem } from "@/server/box-debts";
import { formatIsoDate } from "@/utils/isoDate";
import { INLINE_HINTS, SCREEN_HINTS } from "@/constants/hints";
import ExportButton from "../shared/export/ExportButton";
import ScreenHint from "../shared/hint/ScreenHint";
import type { FormAction } from "../clientsPage/clientActions";
import BoxIcon from "../shared/icons/BoxIcon";
import Disclosure from "../shared/disclosure/Disclosure";
import EmptyState from "../shared/emptyState/EmptyState";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import BoxesTabs from "./BoxesTabs";
import DebtRows from "./DebtRows";
import { ResolveLegacyForm } from "./LegacyDebtForms";

interface BoxDebtsContentProps {
  rows: BoxDebtRow[];
  legacy: LegacyDebtItem[];
  showRegistry: boolean;
  /** Роль закриває старі борги (власник, старший локації). */
  canResolve: boolean;
  resolveAction: FormAction;
  canExport: boolean;
}

/**
 * «Бокси → Борги» (ТЗ 6.7, D113): хто скільки боксів винен, з якого дня, «Нагадати» копіює текст.
 * Нижче старі борги «за таблицею» з кнопкою «Закрити». Додають їх на картці клієнта.
 */
export default function BoxDebtsContent({
  rows,
  legacy,
  showRegistry,
  canResolve,
  resolveAction,
  canExport,
}: BoxDebtsContentProps) {
  return (
    <div className="flex flex-col gap-5">
      <BoxesTabs active="debts" showRegistry={showRegistry} />
      <ScreenHint hint={SCREEN_HINTS.boxDebts} />
      {canExport ? (
        <ExportButton
          list="box-debts"
          hint={INLINE_HINTS.exportBoxDebts}
          className="w-full lg:w-auto"
        />
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={<BoxIcon />}
          title="Боргів по боксах немає"
          description="Тут з'являться клієнти, за якими числяться бокси. Старі борги з таблиці додають на картці клієнта, вкладка «Бокси»."
        />
      ) : (
        <DebtRows rows={rows} />
      )}

      {legacy.length > 0 ? (
        <section aria-labelledby="legacy-debts" className="flex flex-col gap-3">
          <SectionTitle id="legacy-debts">Борги за таблицею</SectionTitle>
          <Text variant="muted">
            Бокси без наклейок, які ще в клієнтів. Коли клієнт їх повернув, закрийте борг.
          </Text>
          <ul className="flex flex-col gap-3">
            {legacy.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-card border border-grey-field bg-white p-4"
              >
                <Link
                  href={`/clients/${item.clientId}?tab=boxes`}
                  className="text-h2 break-words text-navy"
                >
                  {item.clientName}
                </Link>
                <Text variant="muted">
                  {item.boxTypeName} · лишилось {item.openCount} з {item.count}
                  {item.sinceDate ? ` · з ${formatIsoDate(item.sinceDate)}` : ""}
                </Text>
                {item.sourceRow ? <Text>{item.sourceRow}</Text> : null}
                {canResolve ? (
                  <Disclosure summary={`Закрити ${item.openCount} шт.`}>
                    <ResolveLegacyForm
                      action={resolveAction}
                      id={item.id}
                      openCount={item.openCount}
                    />
                  </Disclosure>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
