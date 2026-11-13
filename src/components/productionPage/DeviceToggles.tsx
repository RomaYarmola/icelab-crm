"use client";

import { useSyncExternalStore } from "react";
import { playAlertSound, vibrateAlert } from "./alerts";
import { useDeviceFlag } from "./deviceSettings";
import Chip from "../shared/chips/Chip";

const subscribeNever = () => () => undefined;
const canVibrate = () => typeof navigator.vibrate === "function";

/**
 * Звук і вібрація при новому замовленні (D65): за бажанням, вимкнені за замовчуванням. Звук
 * вмикається дотиком до кнопки (браузер інакше не дозволить грати), і одразу лунає для прикладу.
 * Налаштування пам'ятає пристрій. Вібрацію показуємо лише там, де вона є (на iPhone її немає).
 */
export default function DeviceToggles() {
  const [sound, setSound] = useDeviceFlag("sound");
  const [vibration, setVibration] = useDeviceFlag("vibration");
  const vibrationAvailable = useSyncExternalStore(subscribeNever, canVibrate, () => false);

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Сигнал про нове замовлення">
      <Chip
        selected={sound}
        onClick={() => {
          const next = !sound;
          setSound(next);
          if (next) playAlertSound();
        }}
      >
        {sound ? "Звук увімкнено" : "Звук вимкнено"}
      </Chip>
      {vibrationAvailable ? (
        <Chip
          selected={vibration}
          onClick={() => {
            const next = !vibration;
            setVibration(next);
            if (next) vibrateAlert();
          }}
        >
          {vibration ? "Вібрацію увімкнено" : "Вібрацію вимкнено"}
        </Chip>
      ) : null}
    </div>
  );
}
