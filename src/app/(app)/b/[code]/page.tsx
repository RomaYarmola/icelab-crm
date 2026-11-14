import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { parseBoxCode } from "@/server/box-rules";

/**
 * Адреса з QR на наклейці (`/b/K-0001`, D105): тому, хто увійшов, відкриває картку бокса, решту
 * веде на вхід. Некоректний код веде в реєстр.
 */
export default async function BoxQrPage({ params }: { params: Promise<{ code: string }> }) {
  await requireUser();
  const code = parseBoxCode(decodeURIComponent((await params).code));
  redirect(code ? `/boxes/${code}` : "/boxes");
}
