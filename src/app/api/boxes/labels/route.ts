import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { buildLabelsPdf, getPublicUrl } from "@/server/box-labels";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import { parseLabelFormat } from "@/utils/boxListParams";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * PDF з наклейками (B9): `?codes=K-0001,K-0002&format=sheet_3x8&dx=0&dy=0` чи `?test=1` для
 * пробного аркуша. Лише власник і старший локації (реєстр, ТЗ 6.7). Коди читають з QR на екрані
 * створення чи з картки бокса.
 */
export async function GET(request: NextRequest) {
  const user = await requireUser();
  if (user.role !== "owner" && user.role !== "location_lead") {
    return new Response(new ForbiddenError().message, { status: 403, headers: noStore });
  }
  const params = request.nextUrl.searchParams;
  try {
    const bytes = await buildLabelsPdf({
      codes: (params.get("codes") ?? "").split(",").filter(Boolean),
      publicUrl: await getPublicUrl(getDb()),
      format: parseLabelFormat(params.get("format")),
      offsetXmm: Number((params.get("dx") ?? "0").replace(",", ".")),
      offsetYmm: Number((params.get("dy") ?? "0").replace(",", ".")),
      test: params.get("test") === "1",
    });
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...noStore,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="icelab-labels.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return new Response(error.message, { status: 422, headers: noStore });
    }
    throw error;
  }
}
