import "./_load-env";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { closeSql, getDb } from "@/db/client";
import { locations } from "@/db/schema";
import { callClaude, estimateCostUsd } from "@/server/intake/claude";
import {
  buildClaudeRequest,
  kyivDay,
  loadClientLines,
  loadDictionaries,
} from "@/server/intake/prompt";
import { parseResultSchema } from "@/server/intake/schema";

/**
 * Оцінка розбору заявок (B11, ТЗ 8.3, D148): прогін справжніх повідомлень через Claude і підрахунок,
 * скільки полів розпізнано так, як очікувалось. Набір зразків у JSON-файлі (формат у
 * docs/intake-eval.md). Нічого не записує в базу: список клієнтів лише читається. Викликає
 * справжній Claude, тож потрібен `ANTHROPIC_API_KEY`, і кожен прогін коштує кілька центів.
 *
 *   npm run intake:eval -- intake-eval/cases.local.json
 */

type Expected = {
  /** Код клієнта зі списку; `null` означає «клієнта не визначено». */
  client_code?: string | null;
  order_date?: string | null;
  kg_sold?: number | null;
  ice_type?: string | null;
  delivery_method?: string | null;
};

type Case = {
  text: string;
  location?: "kyiv" | "lviv";
  /** День повідомлення `YYYY-MM-DD` (для відносних дат); типово сьогодні. */
  today?: string;
  expected: Expected;
};

const FIELDS = ["client_code", "order_date", "kg_sold", "ice_type", "delivery_method"] as const;

async function main() {
  const file = process.argv[2];
  if (!file)
    throw new Error(
      "Вкажіть файл зі зразками: npm run intake:eval -- intake-eval/cases.local.json",
    );
  const cases = JSON.parse(readFileSync(file, "utf8")) as Case[];
  const db = getDb();
  const dictionaries = await loadDictionaries(db);

  const hits = Object.fromEntries(FIELDS.map((f) => [f, { ok: 0, total: 0 }]));
  let full = 0;
  let cost = 0;
  const problems: string[] = [];

  for (const [index, item] of cases.entries()) {
    const code = item.location ?? "kyiv";
    const [location] = await db.select().from(locations).where(eq(locations.code, code));
    const clients = await loadClientLines(db, location?.id ?? null);
    const request = buildClaudeRequest({
      locationName: location?.name ?? "Київ",
      messageDay: item.today ?? kyivDay(new Date()),
      text: item.text,
      clients,
      boxTypes: dictionaries.boxTypes,
    });
    const response = await callClaude(db, request);
    cost += estimateCostUsd(response.usage);
    const parsed = parseResultSchema.parse(response.result);
    const actual: Record<(typeof FIELDS)[number], unknown> = {
      client_code: parsed.client.confidence >= 0.7 ? parsed.client.code : null,
      order_date: parsed.order_date,
      kg_sold: parsed.kg_sold,
      ice_type: parsed.ice_type,
      delivery_method: parsed.delivery.method,
    };
    let allOk = true;
    for (const field of FIELDS) {
      if (!(field in item.expected)) continue;
      hits[field]!.total += 1;
      const ok = (item.expected[field] ?? null) === (actual[field] ?? null);
      if (ok) hits[field]!.ok += 1;
      else {
        allOk = false;
        problems.push(
          `#${index + 1} ${field}: очікувалось ${JSON.stringify(item.expected[field] ?? null)}, отримано ${JSON.stringify(actual[field] ?? null)} | «${item.text.slice(0, 70)}»`,
        );
      }
    }
    if (allOk) full += 1;
  }

  console.log(
    `Зразків: ${cases.length}, повний збіг: ${full} (${Math.round((full / Math.max(cases.length, 1)) * 100)}%)`,
  );
  for (const field of FIELDS) {
    const { ok, total } = hits[field]!;
    if (total > 0) console.log(`  ${field}: ${ok} з ${total}`);
  }
  console.log(`Орієнтовна вартість прогону: ${cost.toFixed(4)} USD`);
  if (problems.length > 0) console.log(`\nРозбіжності:\n${problems.join("\n")}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
