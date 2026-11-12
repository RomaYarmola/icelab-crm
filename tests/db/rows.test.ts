import { describe, expect, it } from "vitest";
import { rowsOf } from "@/db/rows";

describe("rowsOf: рядки з db.execute для обох драйверів", () => {
  it("справжній драйвер повертає масив рядків", () => {
    const rows = Object.assign([{ n: 1 }, { n: 2 }], { count: 2 });
    const result = rowsOf<{ n: number }>(rows);
    expect(result).toHaveLength(2);
    expect(result.map((row) => row.n)).toEqual([1, 2]);
  });

  it("тестовий драйвер (PGlite) повертає об'єкт із полем rows", () => {
    expect(rowsOf<{ n: number }>({ rows: [{ n: 3 }], fields: [] })).toEqual([{ n: 3 }]);
  });

  it("порожній чи несподіваний результат дає порожній масив", () => {
    expect(rowsOf([])).toEqual([]);
    expect(rowsOf(undefined)).toEqual([]);
    expect(rowsOf(null)).toEqual([]);
    expect(rowsOf({})).toEqual([]);
    expect(rowsOf({ rows: "не масив" })).toEqual([]);
  });
});
