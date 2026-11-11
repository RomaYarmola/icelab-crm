import ButtonLink from "@/components/shared/buttons/ButtonLink";
import EmptyState from "@/components/shared/emptyState/EmptyState";
import Logo from "@/components/shared/logo/Logo";

/** Сторінку не знайдено. Одна фраза і одна дія (вимога ТЗ). */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo className="w-28" />
      <EmptyState
        className="w-full max-w-sm"
        title="Сторінку не знайдено"
        description="Такої адреси немає або її перенесли."
        action={
          <ButtonLink href="/" fullWidth>
            На головну
          </ButtonLink>
        }
      />
    </main>
  );
}
