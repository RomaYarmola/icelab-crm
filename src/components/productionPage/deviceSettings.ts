"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEVICE_STORAGE_KEYS } from "@/constants/production";

/**
 * Налаштування пристрою екрана виробництва: звук, вібрація, режим «на стіні». Їх пам'ятає браузер
 * (`localStorage`), а не профіль: планшет на стіні це окремий пристрій. Якщо сховище недоступне
 * (приватне вікно), усе працює, просто налаштування не зберігається.
 */

type DeviceKey = keyof typeof DEVICE_STORAGE_KEYS;

const CHANGE_EVENT = "icelab-device-settings";

function read(key: DeviceKey): boolean {
  try {
    return window.localStorage.getItem(DEVICE_STORAGE_KEYS[key]) === "1";
  } catch {
    return false;
  }
}

export function writeDeviceFlag(key: DeviceKey, value: boolean): void {
  try {
    if (value) window.localStorage.setItem(DEVICE_STORAGE_KEYS[key], "1");
    else window.localStorage.removeItem(DEVICE_STORAGE_KEYS[key]);
  } catch {
    // Сховища немає: налаштування діє лише до перезавантаження.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Прапорець налаштування пристрою й функція, що його змінює. На сервері завжди вимкнено. */
export function useDeviceFlag(key: DeviceKey): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  const set = useCallback((next: boolean) => writeDeviceFlag(key, next), [key]);
  return [value, set];
}
