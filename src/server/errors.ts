import type { z } from "zod";

/** Некоректні дані від користувача: повідомлення українською можна показувати на екрані. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Розбирає дані за схемою zod. Якщо вони некоректні, кидає ValidationError з першим повідомленням. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? "Некоректні дані.");
  }
  return result.data;
}
