import Link from "next/link";
import { ALL_LOCATIONS_LABEL } from "@/constants/constants";
import { ROLE_LABELS } from "@/server/permissions";
import type { UserListItem } from "@/server/users";
import EmptyState from "../shared/emptyState/EmptyState";
import Tag from "../shared/chips/Tag";
import UsersIcon from "../shared/icons/UsersIcon";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";

interface UsersListProps {
  users: UserListItem[];
}

/** Список користувачів: картка веде на екран користувача. Вимкнені позначені й стоять у кінці. */
export default function UsersList({ users }: UsersListProps) {
  if (users.length === 0) {
    return <EmptyState icon={<UsersIcon className="size-10" />} title="Користувачів ще немає" />;
  }

  return (
    <ul className="flex flex-col gap-3">
      {users.map((user) => (
        <li key={user.id}>
          <Link
            href={`/more/users/${user.id}`}
            className="flex flex-col gap-1 rounded-card border border-grey-border bg-grey-light p-4 transition active:scale-[98%] lg:hover:border-grey-field"
          >
            <div className="flex items-start justify-between gap-3">
              <SubTitle className="min-w-0 truncate">{user.fullName}</SubTitle>
              {user.isActive ? null : <Tag className="shrink-0">Вимкнено</Tag>}
            </div>
            <Text variant="muted">
              {ROLE_LABELS[user.role]} · {user.locationName ?? ALL_LOCATIONS_LABEL}
            </Text>
            <Text variant="muted" className="truncate">
              {user.email ?? "E-mail не вказано"}
            </Text>
          </Link>
        </li>
      ))}
    </ul>
  );
}
