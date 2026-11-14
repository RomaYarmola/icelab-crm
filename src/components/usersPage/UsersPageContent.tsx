import ButtonLink from "../shared/buttons/ButtonLink";
import type { UserListItem } from "@/server/users";
import UsersList from "./UsersList";

/** Екран «Користувачі»: перехід назад, «Новий користувач» і список. */
export default function UsersPageContent({ users }: { users: UserListItem[] }) {
  return (
    <div className="flex flex-col gap-6">
      <ButtonLink href="/users/new" className="w-full lg:w-auto lg:self-start">
        Новий користувач
      </ButtonLink>
      <UsersList users={users} />
    </div>
  );
}
