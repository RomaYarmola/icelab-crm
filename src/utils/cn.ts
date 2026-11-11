import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Єдине місце, де склеюються класи Tailwind: `clsx` і `tailwind-merge` (як у nbyg-front).
 * Власні токени з `globals.css` (розміри тексту і закруглення) потрібно повідомити
 * tailwind-merge, інакше він сплутає `text-h1` з кольором тексту і прибере один із класів.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["h1", "h2", "h3", "lead", "body", "nav", "caption", "kpi"] }],
    },
    theme: {
      radius: ["field", "card"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
