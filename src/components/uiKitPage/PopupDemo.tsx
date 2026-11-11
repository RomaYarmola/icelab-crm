"use client";

import { useState } from "react";
import MainButton from "../shared/buttons/MainButton";
import BoxIcon from "../shared/icons/BoxIcon";
import LogoutIcon from "../shared/icons/LogoutIcon";
import NavAction from "../shared/navigation/NavAction";
import Popup from "../shared/popup/Popup";
import Text from "../shared/texts/Text";

type DemoPlacement = "bottom" | "top";

/**
 * Демонстрація компактного попапа: знизу над нижньою панеллю (меню «Ще» на телефоні) і зверху під
 * шапкою (меню користувача на ширшому екрані).
 */
export default function PopupDemo() {
  const [openPlacement, setOpenPlacement] = useState<DemoPlacement | null>(null);
  const close = () => setOpenPlacement(null);

  return (
    <>
      <div className="flex max-w-sm flex-col gap-3">
        <MainButton variant="outline" onClick={() => setOpenPlacement("bottom")}>
          Відкрити попап знизу
        </MainButton>
        <MainButton variant="outline" onClick={() => setOpenPlacement("top")}>
          Відкрити попап зверху
        </MainButton>
      </div>
      <Popup
        isOpen={openPlacement !== null}
        onClose={close}
        label="Приклад попапа"
        placement={openPlacement ?? "bottom"}
      >
        <Text variant="muted" className="px-4 py-2">
          Закривається клавішею Esc і кліком поза вікном. Пункти мають розмір підписів нижнього
          меню.
        </Text>
        <NavAction icon={<BoxIcon className="size-6 shrink-0" />} onClick={close}>
          Пункт меню
        </NavAction>
        <NavAction icon={<LogoutIcon className="size-6 shrink-0" />} onClick={close}>
          Ще один пункт
        </NavAction>
      </Popup>
    </>
  );
}
