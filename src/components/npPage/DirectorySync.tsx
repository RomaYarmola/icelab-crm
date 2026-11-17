"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import MainButton from "../shared/buttons/MainButton";
import Notification from "../shared/notification/Notification";
import type { NpActions } from "./npTypes";

/** Скільки викликів підряд робимо за одне натискання: захист від нескінченного циклу. */
const MAX_STEPS = 200;

interface DirectorySyncProps {
  sync: NpActions["sync"];
}

/**
 * «Оновити зараз»: викликає крок оновлення довідників знову й знову, поки він не повідомить «готово»,
 * і показує, на якій сторінці зараз (кожен крок вкладається в ліміт часу функції, D125).
 */
export default function DirectorySync({ sync }: DirectorySyncProps) {
  const router = useRouter();
  const [isRunning, startRun] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  function run() {
    setMessage(null);
    startRun(async () => {
      for (let step = 0; step < MAX_STEPS; step += 1) {
        const outcome = await sync();
        if (!outcome.ok) {
          setMessage({ text: outcome.message, ok: false });
          return;
        }
        setMessage({ text: outcome.result.message, ok: true });
        if (outcome.result.status !== "progress") break;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {message ? (
        <Notification variant={message.ok ? "info" : "error"}>{message.text}</Notification>
      ) : null}
      <MainButton variant="outline" onClick={run} isLoading={isRunning} loadingText="Оновлюємо…">
        Оновити зараз
      </MainButton>
    </div>
  );
}
