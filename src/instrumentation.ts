import type { Instrumentation } from "next";

/**
 * Next.js викликає цю функцію для кожної непередбаченої помилки сервера: відображення сторінки,
 * обробника маршруту, серверної дії, проксі. Пишемо їх у журнал помилок (таблиця `error_log`),
 * бо логи Vercel Hobby зберігаються лише годину (D28).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // База потрібна лише в Node.js; Edge-середовища в нас немає, але перевірка дешева.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/server/error-log");
  await reportError({
    source: context.routeType,
    error,
    // Шлях маршруту (`/more/users/[id]`), а не адреса запиту: без ідентифікаторів і групує помилки.
    path: context.routePath || request.path,
    method: request.method,
  });
};
