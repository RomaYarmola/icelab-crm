import type { NextRequest } from "next/server";
import { XLSX_CONTENT_TYPE } from "@/constants/export";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { ValidationError } from "@/server/errors";
import { isExportList, runExport } from "@/server/export-request";
import { ForbiddenError } from "@/server/guards";
import { getLocationFilter } from "@/server/location-filter";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * Файл Excel для списку (B8, D92): `/api/export/orders|clients|cash|all` з параметрами сторінки.
 * Без входу веде на `/login`, без права віддає 403, надто великий список 422 з порадою звузити
 * фільтр. Права й межі локації перевіряють самі функції читання, а не ця адреса.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ list: string }> }) {
  const { list } = await context.params;
  if (!isExportList(list)) {
    return new Response("Такого списку немає.", { status: 404, headers: noStore });
  }
  const user = await requireUser();
  // Вибір локації в шапці діє на замовлення й готівку так само, як на екранах.
  const location = list === "orders" || list === "cash" ? await getLocationFilter() : null;

  try {
    const file = await runExport(
      getDb(),
      user,
      list,
      Object.fromEntries(request.nextUrl.searchParams),
      location?.selectedId ?? undefined,
    );
    return new Response(new Uint8Array(file.buffer), {
      headers: {
        ...noStore,
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Content-Length": String(file.buffer.length),
        "X-Export-Rows": String(file.rowCount),
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return new Response(error.message, { status: 403, headers: noStore });
    }
    if (error instanceof ValidationError) {
      return new Response(error.message, { status: 422, headers: noStore });
    }
    throw error;
  }
}
