import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { MAX_EVENTS_PER_BATCH, processBoxEvents } from "@/server/boxes";
import { ForbiddenError } from "@/server/guards";
import { notifyOrderChange } from "@/server/production-signal";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

const eventSchema = z.object({
  code: z.string().max(200),
  action: z.enum(["issue", "return", "sell", "lose", "find", "retire", "transfer"]),
  orderId: z.string().max(64).nullish(),
  toLocationId: z.string().max(64).nullish(),
  note: z.string().max(300).nullish(),
  occurredAt: z.string().max(40).optional(),
  deviceQueueId: z.string().max(100).nullish(),
});
const bodySchema = z.object({ events: z.array(eventSchema).min(1).max(MAX_EVENTS_PER_BATCH) });

/**
 * Події зі сканера (ТЗ §9, D112): `POST /api/boxes/events` з `{ events: [...] }`, до 20 штук. Відповідь:
 * `{ results: [{ queueId, code, result: ok|warning|error, message, duplicate }] }` у тому ж порядку.
 * Права й правила перевіряють серверні функції; помилка однієї події не зупиняє решту.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Некоректний запит." }, { status: 400, headers: noStore });
  }
  try {
    const results = await processBoxEvents(getDb(), user, parsed.data.events);
    // Екран цеху оновлює лічильник «3 з 4» за сигналом (D116).
    for (const orderId of new Set(
      results.map((r) => r.orderId).filter((id): id is string => !!id),
    )) {
      notifyOrderChange(getDb(), orderId);
    }
    return Response.json({ results }, { headers: noStore });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return Response.json({ error: error.message }, { status: 403, headers: noStore });
    }
    throw error;
  }
}
