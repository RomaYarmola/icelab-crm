"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { runFormAction } from "@/server/form-state";
import { syncMonobankNow } from "@/server/monobank/status";
import type { FormState } from "@/utils/formState";

/** «Перевірити з'єднання й забрати виписку» (B13). Права перевіряє `syncMonobankNow`. */
export async function syncMonobankAction(): Promise<FormState> {
  const actor = await requireUser();
  let message = "";
  const state = await runFormAction(
    async () => {
      message = await syncMonobankNow(getDb(), actor);
      revalidatePath("/payments");
    },
    { success: "" },
  );
  if (state.status === "error") return state;
  // Помилки банку повертаємо як помилку, успіх як успіх.
  return /^З'єднання працює/.test(message)
    ? { status: "success", message }
    : { status: "error", message };
}
