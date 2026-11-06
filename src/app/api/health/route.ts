import { NextResponse } from "next/server";
import { getSql } from "@/db/client";
import { EnvError, getEnv } from "@/env";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const startedAt = Date.now();
  try {
    const env = getEnv();
    await getSql()`select 1`;
    return NextResponse.json(
      { status: "ok", db: "ok", env: env.APP_ENV, durationMs: Date.now() - startedAt },
      { headers: noStore },
    );
  } catch (error) {
    // Деталі лише в серверному журналі: у відповідь не потрапляють ні рядок підключення, ні пароль.
    console.error("health: перевірка бази не пройшла:", describeError(error));
    return NextResponse.json({ status: "error", db: "error" }, { status: 503, headers: noStore });
  }
}

function describeError(error: unknown): string {
  if (error instanceof EnvError) return error.message; // тільки імена змінних
  if (error instanceof Error) {
    const code = "code" in error ? ` (${String(error.code)})` : "";
    return `${error.name}${code}`;
  }
  return "невідома помилка";
}
