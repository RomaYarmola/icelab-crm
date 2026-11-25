const formatter = new Intl.DateTimeFormat("uk-UA", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** «2026-11» як «лист. 2026 р.». */
export const monthLabel = (month: string): string =>
  formatter.format(new Date(`${month}-01T00:00:00Z`));
