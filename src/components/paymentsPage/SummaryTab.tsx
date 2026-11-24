"use client";

import type { MonthSummary, SummaryTotals } from "@/server/month-summary";
import { formatMoney } from "@/utils/formatNumber";
import { parseDecimal } from "@/utils/orderMath";
import { PAYMENT_PARAMS } from "@/utils/paymentParams";
import Card from "../shared/cards/Card";
import Tag from "../shared/chips/Tag";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import EmptyState from "../shared/emptyState/EmptyState";
import ExportButton from "../shared/export/ExportButton";
import { useUrlParams } from "../shared/search/useUrlParams";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import SubTitle from "../shared/titles/SubTitle";

const money = (value: string) => formatMoney(parseDecimal(value));

function Figures({ row }: { row: SummaryTotals }) {
  return (
    <>
      <dl className="grid grid-cols-3 gap-3">
        {[
          ["Разом", row.total],
          ["Оплачено", row.paid],
          ["Борг", row.debt],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt>
              <Text as="span" variant="muted">
                {label}
              </Text>
            </dt>
            <dd className="text-body font-semibold text-navy">{money(value!)}</dd>
          </div>
        ))}
      </dl>
      <Text variant="muted">
        Замовлень {row.orders} · {row.kg} кг · лід {money(row.ice)} · доставки {money(row.delivery)}{" "}
        · бокси {money(row.boxes)} · інші товари {money(row.other)}
      </Text>
    </>
  );
}

/**
 * «Зведення за місяць» (ТЗ 6.10): по клієнтах кг, дохід по льоду, доставки, бокси, інші товари,
 * разом, оплачено й борг; підсумки по локаціях; експорт у Excel. Дохід це сума замовлень місяця
 * за зафіксованими цінами. Місяць і локація (вибір у шапці) в адресі сторінки.
 */
export default function SummaryTab({ summary, month }: { summary: MonthSummary; month: string }) {
  const { update } = useUrlParams();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <CustomizedInput
          name="month"
          type="month"
          label="Місяць"
          defaultValue={month}
          onChange={(event) => update({ [PAYMENT_PARAMS.month]: event.target.value })}
        />
        <ExportButton list="month-summary" hint="Два аркуші: по клієнтах і по локаціях.">
          Експорт у Excel
        </ExportButton>
      </div>

      {summary.totals.orders === 0 ? (
        <EmptyState title="За цей місяць замовлень немає" description="Оберіть інший місяць." />
      ) : (
        <>
          <section aria-labelledby="summary-total" className="flex flex-col gap-3">
            <SectionTitle id="summary-total">Разом за місяць</SectionTitle>
            <Card className="flex flex-col gap-3">
              <Figures row={summary.totals} />
            </Card>
            {summary.locations.length > 1 ? (
              <ul className="grid gap-3 lg:grid-cols-2">
                {summary.locations.map((row) => (
                  <Card as="li" key={row.locationId} className="flex flex-col gap-3">
                    <SubTitle>{row.locationName}</SubTitle>
                    <Figures row={row} />
                  </Card>
                ))}
              </ul>
            ) : null}
          </section>

          <section aria-labelledby="summary-clients" className="flex flex-col gap-3">
            <SectionTitle id="summary-clients">По клієнтах</SectionTitle>
            <ul className="flex flex-col gap-3">
              {summary.clients.map((row) => (
                <Card as="li" key={row.clientId} className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <SubTitle className="min-w-0 break-words">{row.clientName}</SubTitle>
                    <Tag className="shrink-0">{row.clientCode}</Tag>
                  </div>
                  <Figures row={row} />
                </Card>
              ))}
            </ul>
          </section>
          <Disclosure variant="plain" summary="Як рахуємо">
            <Text variant="muted">
              Беремо підтверджені замовлення з датою виконання в цьому місяці (без чернеток і
              скасованих). Дохід це сума замовлень за цінами, зафіксованими при підтвердженні.
              «Оплачено» це готівка й платежі з банку, не більше суми замовлення; замовлення зі
              статусом «Оплачено» чи «Закрито» вважаємо сплаченими.
            </Text>
          </Disclosure>
        </>
      )}
    </div>
  );
}
