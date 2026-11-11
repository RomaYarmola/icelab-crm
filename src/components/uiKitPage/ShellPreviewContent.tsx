import { OrderStatus } from "@/constants/constants";
import { formatKg, formatMoney } from "@/utils/formatNumber";
import MainButton from "../shared/buttons/MainButton";
import Card from "../shared/cards/Card";
import Chip from "../shared/chips/Chip";
import StatusChip from "../shared/chips/StatusChip";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";

const ORDERS: {
  number: number;
  code: string;
  client: string;
  kg: number;
  type: string;
  delivery: string;
  amount: number;
  status: OrderStatus;
}[] = [
  {
    number: 3472,
    code: "АА15",
    client: "Кафе «Вогник»",
    kg: 30,
    type: "Гранули",
    delivery: "Самовивіз",
    amount: 2250,
    status: "in_production",
  },
  {
    number: 3471,
    code: "ВС57",
    client: "ФОП Іваненко",
    kg: 12,
    type: "Блоки",
    delivery: "Нова Пошта",
    amount: 900,
    status: "confirmed",
  },
  {
    number: 3470,
    code: "АХ8",
    client: "Івент-агенція «Дим»",
    kg: 60,
    type: "Гранули",
    delivery: "Доставка",
    amount: 4500,
    status: "packed",
  },
  {
    number: 3469,
    code: "ВН3",
    client: "Склад №4",
    kg: 25,
    type: "Гранули",
    delivery: "Самовивіз",
    amount: 1875,
    status: "paid",
  },
];

/**
 * Зразок наповнення оболонки для перегляду `/ui-kit/shell/<роль>`: так виглядатиме список
 * замовлень, зібраний із тих самих компонентів. Дані вигадані.
 */
export default function ShellPreviewContent() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        <Chip selected>Сьогодні</Chip>
        <Chip>Вчора</Chip>
        <Chip>Завтра</Chip>
        <Chip>Тиждень</Chip>
      </div>
      <CustomizedInput
        name="search"
        label="Пошук"
        isLabelHidden
        placeholder="Пошук за кодом або назвою"
      />
      <ul className="grid gap-3 lg:grid-cols-2">
        {ORDERS.map((order) => (
          <Card as="li" key={order.number} interactive className="flex flex-col gap-1">
            <SubTitle>{order.client}</SubTitle>
            <div className="flex items-center justify-between gap-2">
              <Text variant="muted">
                {order.code} · № {order.number}
              </Text>
              <StatusChip status={order.status} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Text>
                {formatKg(order.kg)} · {order.type} · {order.delivery}
              </Text>
              <Text variant="lead" className="font-bold whitespace-nowrap">
                {formatMoney(order.amount)}
              </Text>
            </div>
          </Card>
        ))}
      </ul>
      <MainButton className="lg:max-w-xs">+ Нове замовлення</MainButton>
    </div>
  );
}
