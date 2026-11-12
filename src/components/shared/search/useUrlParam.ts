"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useOptimistic, useTransition } from "react";

/**
 * Один параметр адреси сторінки як стан екрана (D47): пошук, фільтри, вкладки. Адресу можна
 * надіслати, «Назад» повертає до попереднього стану. Інші параметри адреси зберігаються, параметр
 * `page` скидається (нова вибірка починається з першої частини).
 *
 * `value` одразу показує вибране (оптимістично), поки сервер готує нову сторінку, а `isPending`
 * каже, що сторінка ще оновлюється.
 */
export function useUrlParam(name: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlValue = searchParams.get(name) ?? "";
  const [isPending, startTransition] = useTransition();
  const [value, setOptimisticValue] = useOptimistic(urlValue);

  const push = useCallback(
    (next: string) => {
      startTransition(() => {
        setOptimisticValue(next);
        // Поточну адресу беремо в момент дії, а не з рендера: вона могла змінитись за час очікування.
        const params = new URLSearchParams(window.location.search);
        if (next === "") params.delete(name);
        else params.set(name, next);
        params.delete("page");
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [name, pathname, router, setOptimisticValue],
  );

  return { urlValue, value, isPending, push };
}
