import type { OrderBox } from "@/server/boxes";
import Tag from "../shared/chips/Tag";
import SectionTitle from "../shared/titles/SectionTitle";

interface OrderBoxesProps {
  boxes: OrderBox[];
}

/** Бокси замовлення з кодами (ТЗ 6.3). Продажу боксів немає: ми продаємо лише лід (20.11.2026). */
export default function OrderBoxes({ boxes }: OrderBoxesProps) {
  if (boxes.length === 0) return null;
  return (
    <section aria-labelledby="order-boxes" className="flex flex-col gap-3">
      <SectionTitle id="order-boxes">Бокси</SectionTitle>
      <ul className="flex flex-wrap gap-2">
        {boxes.map((box) => (
          <li key={box.code}>
            <Tag>
              {box.code} · {box.statusLabel}
            </Tag>
          </li>
        ))}
      </ul>
    </section>
  );
}
