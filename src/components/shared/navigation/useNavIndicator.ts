import { useEffect, useRef, useState } from "react";
import { NavItemId } from "@/constants/navigation";

/** Атрибут пункту списку, за яким хук знаходить активний пункт. */
export const NAV_ID_ATTRIBUTE = "data-nav-id";

/**
 * Плаваючий індикатор активного пункту нижньої панелі: одна смужка, яка плавно їде до нового
 * пункту (а не зникає в одному і з'являється в іншому). Положення рахуємо з розкладки (пункти за
 * шириною вмісту, тож зсув за CSS не передбачити) і ставимо прямо на елемент, без стану React:
 * стан змінювався б на кожен перехід і перемальовував би панель.
 *
 * Перше положення ставиться без анімації, щоб смужка не «в'їжджала» зліва під час завантаження.
 * Доки JS не розташував її (перший показ із сервера), пункти малюють власні смужки: `isPlaced`
 * вказує, що власні смужки вже не потрібні. Плавність єдина: клас `transition` на смужці.
 */
export function useNavIndicator(activeId: NavItemId | null) {
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const hasPlacedRef = useRef(false);
  const [isPlaced, setIsPlaced] = useState(false);

  useEffect(() => {
    const list = listRef.current;
    const indicator = indicatorRef.current;
    if (!list || !indicator) return;

    const place = () => {
      const active = activeId
        ? list.querySelector<HTMLElement>(`[${NAV_ID_ATTRIBUTE}="${activeId}"]`)
        : null;

      // Активного пункту немає або він сховався (наприклад, «Ще» на широкому екрані).
      if (!active || active.offsetParent === null) {
        indicator.style.opacity = "0";
        return;
      }

      // Через getBoundingClientRect, а не offsetLeft: той округлює до цілих пікселів.
      const listBox = list.getBoundingClientRect();
      const activeBox = active.getBoundingClientRect();
      const x = activeBox.left - listBox.left + activeBox.width / 2 - indicator.offsetWidth / 2;

      if (!hasPlacedRef.current) {
        indicator.style.transitionDuration = "0s";
        indicator.style.transform = `translateX(${x}px)`;
        indicator.style.opacity = "1";
        // Примусова розкладка: без неї браузер злив би зміни й усе одно анімував би перший показ.
        void indicator.offsetWidth;
        indicator.style.transitionDuration = "";
        hasPlacedRef.current = true;
        setIsPlaced(true);
        return;
      }

      indicator.style.transform = `translateX(${x}px)`;
      indicator.style.opacity = "1";
    };

    // Спостерігач спрацьовує одразу після підключення і щоразу, коли змінилась розкладка
    // (ширина екрана, пункти з'явились чи сховались на межі `sm`).
    const observer = new ResizeObserver(place);
    observer.observe(list);
    list.querySelectorAll("li").forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [activeId]);

  return { listRef, indicatorRef, isPlaced };
}
