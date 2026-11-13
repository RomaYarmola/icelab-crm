"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PRODUCTION_PATH, WALL_MODE_VALUE } from "@/constants/production";
import { PRODUCTION_PARAMS } from "@/utils/productionParams";
import MainButton from "../shared/buttons/MainButton";
import { useDeviceFlag, writeDeviceFlag } from "./deviceSettings";

const WALL_HREF = `${PRODUCTION_PATH}?${PRODUCTION_PARAMS.mode}=${WALL_MODE_VALUE}`;

/**
 * «На стіну» (D66): вмикає режим для старшого локації. Вибір запам'ятовує пристрій, тож планшет
 * на стіні після перезапуску знову відкриє режим «на стіні» (див. `WallModeRestore`).
 */
export function WallModeButton() {
  const router = useRouter();
  return (
    <MainButton
      variant="outline"
      size="sm"
      fullWidth={false}
      onClick={() => {
        writeDeviceFlag("wall", true);
        router.push(WALL_HREF);
      }}
    >
      На стіну
    </MainButton>
  );
}

/** Вихід з режиму «на стіні»: забуває вибір пристрою й повертає звичайний екран. */
export function WallModeExitButton() {
  const router = useRouter();
  return (
    <MainButton
      variant="outline"
      size="sm"
      fullWidth={false}
      onClick={() => {
        writeDeviceFlag("wall", false);
        router.push(PRODUCTION_PATH);
      }}
    >
      Вийти з режиму
    </MainButton>
  );
}

/**
 * Якщо цей пристрій раніше ввімкнули «на стіну», а зараз відкрито звичайний екран (перезапуск
 * планшета, закрита вкладка), повертає режим. Лише для ролі, якій він дозволений.
 */
export function WallModeRestore() {
  const router = useRouter();
  const [remembered] = useDeviceFlag("wall");
  useEffect(() => {
    if (remembered) router.replace(WALL_HREF);
  }, [remembered, router]);
  return null;
}
