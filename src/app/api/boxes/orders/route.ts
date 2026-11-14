import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { listBoxIssueOrders } from "@/server/boxes";
import { ForbiddenError } from "@/server/guards";
import { todayIso } from "@/utils/isoDate";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * Замовлення, до яких сьогодні видають бокси (B9, D112): сторінка сканера бере їх тут, а не з
 * розмітки, щоб сама сторінка не містила чужих даних і її можна було кешувати для офлайн-режиму.
 */
export async function GET() {
  const user = await requireUser();
  try {
    const date = todayIso();
    const orders = await listBoxIssueOrders(getDb(), user, date);
    return Response.json({ date, orders }, { headers: noStore });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return Response.json({ error: error.message }, { status: 403, headers: noStore });
    }
    throw error;
  }
}
