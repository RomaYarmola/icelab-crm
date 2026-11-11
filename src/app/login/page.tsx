import type { Metadata } from "next";
import LoginForm from "@/components/loginPage/LoginForm";
import Logo from "@/components/shared/logo/Logo";
import Text from "@/components/shared/texts/Text";
import PageTitle from "@/components/shared/titles/PageTitle";
import { messageForReason } from "@/server/sign-in";

export const metadata: Metadata = { title: "Вхід" };

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const { reason } = await searchParams;
  const initialMessage = messageForReason(Array.isArray(reason) ? reason[0] : reason);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo priority className="w-36" />
          <PageTitle className="sr-only">Вхід у IceLab CRM</PageTitle>
          <Text variant="lead">CRM · облік замовлень</Text>
        </div>
        <LoginForm initialMessage={initialMessage} />
        <Text variant="muted" className="text-center">
          Немає доступу? Зверніться до власника: самостійної реєстрації немає.
        </Text>
      </div>
    </main>
  );
}
