import { redirect } from "next/navigation";

/** Сканер живе на окремій нейтральній сторінці `/scan` (D112); стара адреса веде туди. */
export default async function OldScanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const order = (await searchParams).order;
  redirect(typeof order === "string" ? `/scan?order=${encodeURIComponent(order)}` : "/scan");
}
