import ButtonLink from "../shared/buttons/ButtonLink";
import BackLink from "../shared/links/BackLink";
import type { UserListItem } from "@/server/users";
import UsersList from "./UsersList";

/** Екран «Користувачі»: перехід назад, «Новий користувач» і список. */
export default function UsersPageContent({ users }: { users: UserListItem[] }) {
  return (
    <div className="flex max-w-md flex-col gap-6">
      <BackLink href="/more">Профіль</BackLink>
      <ButtonLink href="/more/users/new" fullWidth>
        Новий користувач
      </ButtonLink>
      <UsersList users={users} />
    </div>
  );
}
