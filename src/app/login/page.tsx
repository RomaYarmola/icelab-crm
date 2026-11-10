import { messageForReason } from "@/server/sign-in";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const { reason } = await searchParams;
  const initialMessage = messageForReason(Array.isArray(reason) ? reason[0] : reason);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">CRM IceLab</h1>
      <LoginForm initialMessage={initialMessage} />
    </main>
  );
}
