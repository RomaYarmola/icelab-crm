import Card from "../shared/cards/Card";
import InstallHint from "../shared/pwa/InstallHint";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import ChangePasswordForm from "./ChangePasswordForm";

interface ProfileContentProps {
  fullName: string;
  email: string | null;
  roleLabel: string;
  locationLabel: string;
}

/**
 * Сторінка «Ще»: хто увійшов і зміна пароля. «Прайс» і «Користувачі» власника в основному меню. «Вийти» тут
 * немає: вихід лежить лише в меню (меню «Ще», мітка користувача, бічна панель).
 */
export default function ProfileContent({
  fullName,
  email,
  roleLabel,
  locationLabel,
}: ProfileContentProps) {
  return (
    <div className="flex max-w-md flex-col gap-8">
      {/* Заголовок «Профіль» уже в шапці, тут лише картка. */}
      <section aria-label="Профіль" className="flex flex-col gap-3">
        <Card className="flex flex-col gap-1">
          <Text variant="label">{fullName}</Text>
          <Text variant="muted">
            {roleLabel} · {locationLabel}
          </Text>
          {email ? (
            <Text variant="muted" className="break-all">
              {email}
            </Text>
          ) : null}
        </Card>
      </section>

      <InstallHint />

      <section aria-labelledby="password-title" className="flex flex-col gap-3">
        <SectionTitle id="password-title">Змінити пароль</SectionTitle>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
