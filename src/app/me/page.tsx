import { signOutAction } from "@/app/login/actions";
import { requireUser } from "@/server/auth";
import { ROLE_LABELS } from "@/server/permissions";

export const dynamic = "force-dynamic";

/** Технічна сторінка: показує, під ким увійшли. Справжній екран профілю робимо в B3. */
export default async function MePage() {
  const user = await requireUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Ви увійшли</h1>
      <dl className="flex flex-col gap-3 text-base">
        <div>
          <dt className="text-neutral-600">Ім&apos;я</dt>
          <dd>{user.fullName}</dd>
        </div>
        <div>
          <dt className="text-neutral-600">Роль</dt>
          <dd>{ROLE_LABELS[user.role]}</dd>
        </div>
        <div>
          <dt className="text-neutral-600">Локація</dt>
          <dd>{user.locationName ?? "усі локації"}</dd>
        </div>
        <div>
          <dt className="text-neutral-600">E-mail</dt>
          <dd>{user.email ?? "не вказано"}</dd>
        </div>
      </dl>
      <form action={signOutAction}>
        <button
          type="submit"
          className="min-h-11 w-full rounded border border-neutral-900 px-4 text-base font-medium"
        >
          Вийти
        </button>
      </form>
    </main>
  );
}
