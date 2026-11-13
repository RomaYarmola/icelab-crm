"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useOptimistic, useTransition } from "react";

/**
 * Кілька параметрів адреси сторінки разом (день і діапазон дат у списку замовлень): значення
 * `null` прибирає параметр. Як і `useUrlParam`, зберігає решту параметрів, скидає `page` і
 * показує вибране одразу, поки сервер готує нову сторінку.
 */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setOptimisticQuery] = useOptimistic(searchParams.toString());
  const params = useMemo(() => new URLSearchParams(query), [query]);

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      startTransition(() => {
        // Поточну адресу беремо в момент дії, а не з рендера: вона могла змінитись за час очікування.
        const next = new URLSearchParams(window.location.search);
        for (const [name, value] of Object.entries(patch)) {
          if (value === null || value === "") next.delete(name);
          else next.set(name, value);
        }
        next.delete("page");
        setOptimisticQuery(next.toString());
        const text = next.toString();
        router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
      });
    },
    [pathname, router, setOptimisticQuery],
  );

  return { params, update, isPending };
}
