import type { UserListItem } from "@/server/users";
import type { FormState } from "@/utils/formState";
import Tag from "../shared/chips/Tag";
import BackLink from "../shared/links/BackLink";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import ResetPasswordForm from "./ResetPasswordForm";
import UserForm from "./UserForm";
import UserStatusForm from "./UserStatusForm";

interface UserDetailContentProps {
  user: UserListItem;
  locations: { id: string; name: string }[];
  /** Це обліковий запис самого власника: вимкнути себе не можна. */
  isSelf: boolean;
  /** Користувача щойно створено: показуємо підтвердження. */
  isJustCreated: boolean;
  updateAction: (previous: FormState, formData: FormData) => Promise<FormState>;
}

/** Екран користувача: зміна профілю, новий пароль і вимкнення (лише власник). */
export default function UserDetailContent({
  user,
  locations,
  isSelf,
  isJustCreated,
  updateAction,
}: UserDetailContentProps) {
  return (
    <div className="flex max-w-md flex-col gap-8">
      <BackLink href="/more/users">Користувачі</BackLink>

      {isJustCreated ? (
        <Notification variant="success">
          Користувача створено. Якщо пароль не задано, він входитиме через Google.
        </Notification>
      ) : null}

      <section aria-labelledby="user-title" className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <SectionTitle id="user-title" className="min-w-0 break-words">
            {user.fullName}
          </SectionTitle>
          {user.isActive ? null : <Tag className="shrink-0">Вимкнено</Tag>}
        </div>
        <UserForm
          // Після збереження сервер віддає нові дані: ключ перестворює форму зі свіжими значеннями.
          key={`${user.id}-${user.fullName}-${user.role}-${user.locationId}-${user.phone}`}
          mode="edit"
          userId={user.id}
          locations={locations}
          defaults={{
            email: user.email ?? "",
            fullName: user.fullName,
            role: user.role,
            locationId: user.locationId ?? "",
            phone: user.phone ?? "",
          }}
          action={updateAction}
          submitLabel="Зберегти зміни"
        />
      </section>

      <section aria-labelledby="password-title" className="flex flex-col gap-3">
        <SectionTitle id="password-title">Пароль</SectionTitle>
        <ResetPasswordForm userId={user.id} />
      </section>

      <section aria-labelledby="status-title" className="flex flex-col gap-3">
        <SectionTitle id="status-title">Доступ</SectionTitle>
        <UserStatusForm userId={user.id} isActive={user.isActive} isSelf={isSelf} />
      </section>

      <Text variant="muted">Користувачів не видаляємо: вимкнений акаунт лишається в історії.</Text>
    </div>
  );
}
