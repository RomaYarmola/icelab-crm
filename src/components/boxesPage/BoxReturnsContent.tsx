import Link from "next/link";
import { SCREEN_HINTS } from "@/constants/hints";
import type { PostReturn, PostReturnGroup } from "@/server/np/return-list";
import { formatIsoDate } from "@/utils/isoDate";
import Tag from "../shared/chips/Tag";
import EmptyState from "../shared/emptyState/EmptyState";
import ScreenHint from "../shared/hint/ScreenHint";
import BoxIcon from "../shared/icons/BoxIcon";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import BoxesTabs from "./BoxesTabs";
import CopyTextButton from "./CopyTextButton";

interface BoxReturnsContentProps {
  groups: PostReturnGroup[];
  showRegistry: boolean;
  production: boolean;
  /** Назва клієнта веде на картку лише тим, хто бачить клієнтів. */
  canOpenClient: boolean;
}

const STATE_LABELS: Record<PostReturn["state"], string> = {
  waiting: "Чекає на відділенні",
  transit: "В дорозі",
  registered: "Оформлено, ще не відправлено",
};

/** «Бокси → Чекають на пошті» (B17, D224): повернення боксів Новою Поштою окремо по містах. */
export default function BoxReturnsContent({
  groups,
  showRegistry,
  production,
  canOpenClient,
}: BoxReturnsContentProps) {
  return (
    <div className="flex flex-col gap-5">
      <BoxesTabs active="returns" showRegistry={showRegistry} production={production} />
      <ScreenHint hint={SCREEN_HINTS.boxReturns} />
      {groups.length === 0 ? (
        <EmptyState
          icon={<BoxIcon />}
          title="На пошті нічого не чекає"
          description="Тут з'являться «легкі повернення» за накладними, створеними в CRM. Бокси, повернені звичайною відправкою, сюди не потрапляють."
        />
      ) : (
        groups.map((group) => (
          <section
            key={group.locationId}
            aria-labelledby={`returns-${group.locationId}`}
            className="flex flex-col gap-3"
          >
            <SectionTitle id={`returns-${group.locationId}`}>
              {group.locationName} · {group.items.length}
            </SectionTitle>
            <ul className="flex flex-col gap-3">
              {group.items.map((item) => (
                <ReturnRow key={item.id} item={item} canOpenClient={canOpenClient} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ReturnRow({ item, canOpenClient }: { item: PostReturn; canOpenClient: boolean }) {
  const warehouse =
    item.warehouseName ?? (item.warehouseNumber ? `Відділення №${item.warehouseNumber}` : null);
  return (
    <li className="flex flex-col gap-2 rounded-card border border-grey-field bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {canOpenClient ? (
            <Link
              href={`/clients/${item.clientId}?tab=boxes`}
              className="text-h2 break-words text-navy underline-offset-2 lg:hover:underline"
            >
              {item.clientName}
            </Link>
          ) : (
            <span className="text-h2 break-words text-navy">{item.clientName}</span>
          )}
          <Text variant="muted">
            Замовлення № {item.orderNumber}
            {item.boxSummary ? ` · ${item.boxSummary}` : ""}
          </Text>
          {item.boxCodes.length > 0 ? (
            <Text variant="muted">{item.boxCodes.join(", ")}</Text>
          ) : null}
        </div>
        {item.waitingDays !== null ? <Tag>{item.waitingDays} дн.</Tag> : null}
      </div>
      <Text>
        <span className="font-semibold">{STATE_LABELS[item.state]}</span>
        {item.state === "transit" && item.statusText ? `: ${item.statusText}` : ""}
      </Text>
      {item.city || warehouse ? (
        <Text>{[item.city, warehouse].filter(Boolean).join(", ")}</Text>
      ) : null}
      {item.paidStorageDay ? (
        <p
          className={item.urgent ? "text-body font-semibold text-red-error" : "text-body text-navy"}
        >
          Платне зберігання з {formatIsoDate(item.paidStorageDay)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-body font-semibold text-navy">ТТН {item.ttnNumber}</span>
        <CopyTextButton text={item.ttnNumber}>Копіювати номер</CopyTextButton>
      </div>
    </li>
  );
}
