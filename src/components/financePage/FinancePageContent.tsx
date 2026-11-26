import type { Co2PageData, Co2UseView } from "@/server/finance/co2";
import { formatKg, formatMoney, formatNumber, formatPricePerKg } from "@/utils/formatNumber";
import { formatIsoDate } from "@/utils/isoDate";
import { parseDecimal } from "@/utils/orderMath";
import type { FormAction } from "../clientsPage/clientActions";
import DeleteRecordForm from "../clientsPage/DeleteRecordForm";
import Card from "../shared/cards/Card";
import Disclosure from "../shared/disclosure/Disclosure";
import Notification from "../shared/notification/Notification";
import TabLinks from "../shared/tabs/TabLinks";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import SubTitle from "../shared/titles/SubTitle";
import Co2Form from "./Co2Form";
import FinanceTabs from "./FinanceTabs";
import { monthTitle } from "./monthTitle";

export interface FinanceActions {
  addReceipt: FormAction;
  addWriteoff: FormAction;
  setStock: FormAction;
  setNorm: FormAction;
  deleteReceipt: FormAction;
  deleteWriteoff: FormAction;
  deleteAdjustment: FormAction;
  deleteNorm: FormAction;
}

interface FinancePageContentProps {
  data: Co2PageData;
  actions: FinanceActions;
}

const money = (value: string) => formatMoney(parseDecimal(value));

function UseLine({ label, use }: { label: string; use: Co2UseView }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-x-3">
        <Text as="span" variant="label">
          {label}
        </Text>
        <Text as="span" variant="label" className="whitespace-nowrap">
          {money(use.cost)}
        </Text>
      </div>
      <Text variant="muted">
        Лід {formatKg(use.iceKg)}, CO2 {formatKg(use.co2Kg)}
      </Text>
    </div>
  );
}

function History({
  title,
  empty,
  rows,
  action,
}: {
  title: string;
  empty: string;
  rows: { id: string; main: string; note?: string | null }[];
  action: FormAction;
}) {
  return (
    <Disclosure variant="plain" summary={`${title} (${rows.length})`}>
      {rows.length === 0 ? (
        <Text variant="muted">{empty}</Text>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <Card as="li" key={row.id} className="flex flex-col gap-1">
              <Text variant="label">{row.main}</Text>
              {row.note ? <Text variant="muted">{row.note}</Text> : null}
              <DeleteRecordForm
                action={action}
                id={row.id}
                summary="Видалити запис"
                warning="Залишок і вартість CO2 перерахуються без цього запису."
              />
            </Card>
          ))}
        </ul>
      )}
    </Disclosure>
  );
}

/**
 * Екран «Фінрезультат», сировина CO2 (B15, D232, D233, D240): по містах залишок і норма, витрата
 * за місяцями, форми приходу, списаного льоду, залишку й норми та історія записів.
 */
export default function FinancePageContent({ data, actions }: FinancePageContentProps) {
  const { location, today } = data;
  const note = { name: "note", label: "Примітка", optional: true };

  return (
    <div className="flex flex-col gap-5">
      <FinanceTabs active="co2" />
      <TabLinks
        label="Місто"
        activeId={location.code}
        items={data.locations.map((item) => ({
          id: item.code,
          label: item.name,
          href: `/finance?location=${item.code}`,
        }))}
      />

      {data.startedOn === null ? (
        <Notification>Додайте перший прихід CO2: облік міста почнеться з його дати.</Notification>
      ) : null}
      {data.shortageKg > 0 ? (
        <Notification variant="warning" title="CO2 не вистачає">
          Бракує {formatKg(data.shortageKg)}: пораховано за останньою ціною. Перевірте, чи внесені
          всі приходи.
        </Notification>
      ) : null}
      {data.missingNorm ? (
        <Notification variant="warning">
          Вкажіть норму: без неї CO2 на лід не рахується.
        </Notification>
      ) : null}

      <section aria-labelledby="co2-stock" className="flex flex-col gap-3">
        <SectionTitle id="co2-stock">Сировина CO2</SectionTitle>
        <Card className="flex flex-col gap-1">
          <Text variant="label">Залишок на {formatIsoDate(today)}</Text>
          <Text variant="kpi" className="font-extrabold">
            {formatKg(data.stockKg)}
          </Text>
          <Text variant="muted">
            Вартість залишку {money(data.stockValue)}.
            {data.startedOn ? ` Облік з ${formatIsoDate(data.startedOn)}.` : ""}
          </Text>
          <Text variant="muted">
            {data.norm === null
              ? "Норму не задано."
              : `Норма: ${formatNumber(data.norm)} кг CO2 на 1 кг льоду.`}
          </Text>
        </Card>
        <Disclosure summary="Додати прихід CO2">
          <Co2Form
            key={location.id}
            action={actions.addReceipt}
            locationId={location.id}
            submitLabel="Зберегти прихід"
            fields={[
              { name: "receivedOn", label: "Дата приходу", type: "date", initial: today },
              { name: "kg", label: "CO2, кг", decimal: true },
              { name: "pricePerKg", label: "Ціна, ₴/кг", decimal: true },
              note,
            ]}
          />
        </Disclosure>
        <Disclosure summary="Записати списаний лід">
          <Co2Form
            key={location.id}
            action={actions.addWriteoff}
            locationId={location.id}
            submitLabel="Зберегти списання"
            fields={[
              { name: "writtenOffOn", label: "Дата", type: "date", initial: today },
              { name: "kg", label: "Викинули льоду, кг", decimal: true },
              note,
            ]}
          />
        </Disclosure>
        {data.startedOn ? (
          <Disclosure summary="Виправити залишок">
            <Co2Form
              key={location.id}
              action={actions.setStock}
              locationId={location.id}
              submitLabel="Виправити залишок"
              fields={[
                {
                  name: "actualKg",
                  label: "Скільки CO2 є насправді, кг",
                  decimal: true,
                  hint: `За розрахунком зараз ${formatKg(data.stockKg)}. Збережемо різницю.`,
                },
                { name: "note", label: "Причина" },
              ]}
            />
          </Disclosure>
        ) : null}
        <Disclosure summary="Змінити норму">
          <Co2Form
            key={location.id}
            action={actions.setNorm}
            locationId={location.id}
            submitLabel="Зберегти норму"
            fields={[
              { name: "norm", label: "CO2 на 1 кг льоду, кг", decimal: true },
              {
                name: "validFrom",
                label: "Діє з дати",
                type: "date",
                initial: today,
                hint: "Лід до цієї дати рахується за попередньою нормою.",
              },
            ]}
          />
        </Disclosure>
      </section>

      <section aria-labelledby="co2-months" className="flex flex-col gap-3">
        <SectionTitle id="co2-months">Витрата за місяцями</SectionTitle>
        {data.months.length === 0 ? (
          <Text variant="muted">Витрати ще немає.</Text>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.months.map((month) => (
              <Card as="li" key={month.month} className="flex flex-col gap-1">
                <SubTitle>{monthTitle(month.month)}</SubTitle>
                <UseLine label="Замовлення" use={month.orders} />
                {month.writeoffs.iceKg > 0 ? (
                  <UseLine label="Списано" use={month.writeoffs} />
                ) : null}
                {month.shortageKg > 0 ? (
                  <Text variant="muted">Не вистачило CO2: {formatKg(month.shortageKg)}.</Text>
                ) : null}
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="co2-history" className="flex flex-col gap-1">
        <SectionTitle id="co2-history">Записи</SectionTitle>
        <History
          title="Приходи CO2"
          empty="Приходів ще немає."
          action={actions.deleteReceipt}
          rows={data.receipts.map((row) => ({
            id: row.id,
            main: `${formatIsoDate(row.date)}: ${formatKg(row.kg)} по ${formatPricePerKg(row.pricePerKg)}`,
            note: row.note,
          }))}
        />
        <History
          title="Списаний лід"
          empty="Списань ще немає."
          action={actions.deleteWriteoff}
          rows={data.writeoffs.map((row) => ({
            id: row.id,
            main: `${formatIsoDate(row.date)}: ${formatKg(row.kg)} льоду`,
            note: row.note,
          }))}
        />
        <History
          title="Виправлення залишку"
          empty="Виправлень ще не було."
          action={actions.deleteAdjustment}
          rows={data.adjustments.map((row) => ({
            id: row.id,
            main: `${formatIsoDate(row.date)}: ${row.kg > 0 ? "+" : ""}${formatKg(row.kg)}`,
            note: row.note,
          }))}
        />
        <History
          title="Норми"
          empty="Норм ще немає."
          action={actions.deleteNorm}
          rows={data.norms.map((row) => ({
            id: row.id,
            main: `З ${formatIsoDate(row.validFrom)}: ${formatNumber(row.norm)} кг на кг льоду`,
          }))}
        />
      </section>
    </div>
  );
}
