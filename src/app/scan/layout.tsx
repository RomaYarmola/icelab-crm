/**
 * Оболонка сканера боксів (B9, D112). Поза розділами застосунку й без даних користувача: її HTML
 * однаковий для всіх, тому service worker може зберегти її, і сканер відкривається без мережі.
 */
export default function ScanLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-10">
      {children}
    </main>
  );
}
