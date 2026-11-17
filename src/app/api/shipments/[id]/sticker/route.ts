import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import { NpError } from "@/server/np/client";
import { loadShipmentForSticker } from "@/server/np/shipments";
import { fetchStickerPdf } from "@/server/np/sticker";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * Стікер накладної PDF (B10): сервер сам завантажує його з Нової Пошти й віддає браузеру, тож адреса
 * з ключем нікуди не потрапляє. Без входу веде на `/login`, без права 403, нема накладної 404.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const user = await requireUser();
  try {
    const db = getDb();
    const shipment = await loadShipmentForSticker(db, user, id);
    const pdf = await fetchStickerPdf(db, shipment.npRef);
    return new Response(Buffer.from(pdf), {
      headers: {
        ...noStore,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="ttn-${shipment.ttnNumber}.pdf"`,
        "Content-Length": String(pdf.length),
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return new Response(error.message, { status: 403, headers: noStore });
    }
    if (error instanceof ValidationError) {
      return new Response(error.message, { status: 404, headers: noStore });
    }
    if (error instanceof NpError) {
      return new Response(error.message, { status: 502, headers: noStore });
    }
    throw error;
  }
}
