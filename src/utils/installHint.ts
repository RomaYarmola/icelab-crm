export interface InstallHintEnvironment {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** Застосунок уже відкрито з головного екрана (без адресного рядка). */
  isStandalone: boolean;
}

/**
 * Чи показувати підказку «Додати на головний екран». На iPhone і iPad автоматичного запиту немає
 * (як в Android), тож пояснюємо вручну. iPad у режимі «сайт для комп'ютера» видає себе за Mac,
 * його впізнаємо за дотиковим екраном. Якщо застосунок уже на головному екрані, підказка зайва.
 */
export function shouldShowInstallHint(environment: InstallHintEnvironment): boolean {
  if (environment.isStandalone) return false;
  const isIosDevice = /iPhone|iPad|iPod/.test(environment.userAgent);
  const isIpadAsMac = environment.platform === "MacIntel" && environment.maxTouchPoints > 1;
  return isIosDevice || isIpadAsMac;
}
