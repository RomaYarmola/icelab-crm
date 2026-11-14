import Link from "next/link";
import type { BoxDebtRow, ClientBoxItem, LegacyDebtItem } from "@/server/box-debts";
import { formatIsoDate } from "@/utils/isoDate";
import DebtRows from "../boxesPage/DebtRows";
import { AddLegacyDebtForm, ResolveLegacyForm } from "../boxesPage/LegacyDebtForms";
import Disclosure from "../shared/disclosure/Disclosure";
import Tag from "../shared/chips/Tag";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import type { FormAction } from "./clientActions";

export interface ClientBoxesData {
  debts: BoxDebtRow[];
  boxes: ClientBoxItem[];
  legacy: LegacyDebtItem[];
  types: { id: string; name: string }[];
  /** Старші локації й власник вносять і закривають старі борги. */
  canManageLegacy: boolean;
  addLegacy: FormAction;
  resolveLegacy: FormAction;
}

interface ClientBoxesTabProps {
  clientId: string;
  data: ClientBoxesData;
  /** Клієнта видалено: лише перегляд. */
  readOnly: boolean;
}

/**
 * Вкладка «Бокси» на картці клієнта (ТЗ 4.4): скільки боксів на ньому за типами, які саме бокси з
 * наклейками, старі борги «за таблицею» з кнопкою «Закрити» та форма «Додати борг за таблицею».
 */
export default function ClientBoxesTab({ clientId, data, readOnly }: ClientBoxesTabProps) {
  const canEdit = data.canManageLegacy && !readOnly;
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="client-box-debts" className="flex flex-col gap-3">
        <SectionTitle id="client-box-debts">Борг по боксах</SectionTitle>
        {data.debts.length === 0 ? (
          <Text variant="muted">Боксів за клієнтом немає.</Text>
        ) : (
          <DebtRows rows={data.debts} showClient={false} />
        )}
      </section>

      {data.boxes.length > 0 ? (
        <section aria-labelledby="client-box-list" className="flex flex-col gap-3">
          <SectionTitle id="client-box-list">Бокси з наклейками</SectionTitle>
          <ul className="flex flex-col gap-2">
            {data.boxes.map((box) => (
              <li key={box.code}>
                <Link
                  href={`/boxes/${box.code}`}
                  className="flex items-center justify-between gap-3 rounded-card border border-grey-field bg-white p-4 lg:hover:bg-grey-light"
                >
                  <span className="text-h2 text-navy">{box.code}</span>
                  <Text variant="muted">
                    {box.boxTypeName}
                    {box.issuedAt ? `, з ${formatIsoDate(box.issuedAt.slice(0, 10))}` : ""}
                    {box.days !== null ? ` · ${box.days} дн.` : ""}
                  </Text>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.legacy.length > 0 ? (
        <section aria-labelledby="client-legacy" className="flex flex-col gap-3">
          <SectionTitle id="client-legacy">Борги за таблицею</SectionTitle>
          <ul className="flex flex-col gap-3">
            {data.legacy.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-card border border-grey-field bg-white p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-h2 text-navy">{item.boxTypeName}</span>
                  <Tag>
                    лишилось {item.openCount} з {item.count}
                  </Tag>
                </div>
                {item.sinceDate ? (
                  <Text variant="muted">З {formatIsoDate(item.sinceDate)}</Text>
                ) : null}
                {item.sourceRow ? <Text>{item.sourceRow}</Text> : null}
                {canEdit ? (
                  <Disclosure summary={`Закрити ${item.openCount} шт.`}>
                    <ResolveLegacyForm
                      action={data.resolveLegacy}
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

      {canEdit ? (
        <Disclosure summary="Додати борг за таблицею">
          <AddLegacyDebtForm action={data.addLegacy} fixedClientId={clientId} types={data.types} />
        </Disclosure>
      ) : null}
    </div>
  );
}
