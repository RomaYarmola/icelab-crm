"use client";

import { useSyncExternalStore } from "react";
import MainButton from "../buttons/MainButton";
import Notification from "./Notification";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const getSnapshot = () => navigator.onLine;
// На сервері вважаємо, що зв'язок є: банер з'являється лише в браузері.
const getServerSnapshot = () => true;

/**
 * Банер «Немає зв’язку» з кнопкою «Повторити» (вимога ТЗ §6). Показується внизу екрана над
 * нижньою панеллю і зникає сам, коли зв'язок повернувся. Слухає події online і offline браузера.
 */
export default function OfflineNotification() {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (isOnline) return null;

  return (
    <div className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-96">
      <Notification
        variant="warning"
        title="Немає зв’язку"
        action={
          <MainButton
            variant="outline"
            size="sm"
            fullWidth={false}
            onClick={() => window.location.reload()}
          >
            Повторити
          </MainButton>
        }
      >
        Показано збережене. Дії з’являться, коли зв’язок повернеться.
      </Notification>
    </div>
  );
}
