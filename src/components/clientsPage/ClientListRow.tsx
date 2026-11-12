import Link from "next/link";
import type { ClientListItem } from "@/server/client-views";
import { formatPhone } from "@/utils/phone";
import Tag from "../shared/chips/Tag";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";

/** Рядок списку клієнтів: код, назва, статус, менеджер і основний телефон. Веде на картку. */
export default function ClientListRow({ client }: { client: ClientListItem }) {
  const details = [client.statusName, client.managerName].filter(Boolean).join(" · ");

  return (
    <li>
      <Link
        href={`/clients/${client.id}`}
        className="flex flex-col gap-1 rounded-card border border-grey-border bg-grey-light p-4 transition active:scale-[98%] lg:hover:border-grey-field"
      >
        <div className="flex items-start justify-between gap-3">
          <SubTitle className="min-w-0 break-words">{client.name}</SubTitle>
          <Tag className="shrink-0">{client.code}</Tag>
        </div>
        {details ? <Text variant="muted">{details}</Text> : null}
        {client.primaryPhone ? <Text>{formatPhone(client.primaryPhone)}</Text> : null}
        {client.isDeleted ? <Tag className="w-fit">Видалено</Tag> : null}
      </Link>
    </li>
  );
}
