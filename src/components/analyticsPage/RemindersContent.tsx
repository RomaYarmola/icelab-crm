import Link from "next/link";
import type { ReminderView } from "@/server/reminders";
import { formatDate } from "@/utils/formatDate";
import type { FormAction } from "../clientsPage/clientActions";
import Card from "../shared/cards/Card";
import EmptyState from "../shared/emptyState/EmptyState";
import Text from "../shared/texts/Text";
import DismissForm from "./DismissForm";
import { ThresholdForm } from "./InactiveForms";

interface RemindersContentProps {
  reminders: ReminderView[];
  boxDays: number;
  /** Форма порога боксів (лише власник). */
  boxDaysAction: FormAction | null;
  returnDays: number;
  /** Форма порога посилок на пошті (лише власник). */
  returnDaysAction: FormAction | null;
  dismissAction: FormAction;
}

const linkFor = (reminder: ReminderView): { href: string; label: string } | null => {
  if (reminder.kind === "payment_unmatched") {
    return { href: "/payments?tab=queue", label: "Відкрити чергу" };
  }
  if (reminder.kind === "box_return_waiting") {
    return { href: "/boxes/returns", label: "Посилки на пошті" };
  }
  if (!reminder.clientId) return null;
  return {
    href: `/clients/${reminder.clientId}${reminder.kind === "box_overdue" ? "?tab=boxes" : ""}`,
    label: reminder.kind === "box_overdue" ? "Бокси клієнта" : "Картка клієнта",
  };
};

/**
 * «Нагадування» (D209): мої ранкові нагадування. Зникають самі, коли клієнт замовив, бокс повернули
 * чи чергу платежів розібрали; або натисніть «Відкласти».
 */
export default function RemindersContent({
  reminders,
  boxDays,
  boxDaysAction,
  returnDays,
  returnDaysAction,
  dismissAction,
}: RemindersContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <Text variant="muted">
        Нагадування складаються щоранку о 09:00 і зникають самі, коли клієнт замовив, бокс повернули
        чи забрали з пошти, а платежі розібрали.
      </Text>
      {boxDaysAction ? (
        <ThresholdForm
          days={boxDays}
          action={boxDaysAction}
          summary="Поріг для боксів"
          label="Нагадувати про бокс у клієнта через, днів"
          hint="За замовчуванням 14 днів."
        />
      ) : null}
      {returnDaysAction ? (
        <ThresholdForm
          days={returnDays}
          action={returnDaysAction}
          summary="Поріг для посилок на пошті"
          label="Нагадувати, коли посилка чекає, днів"
          hint="За замовчуванням 3 дні."
        />
      ) : null}
      {reminders.length === 0 ? (
        <EmptyState title="Нагадувань немає" description="Усе під контролем." />
      ) : (
        <ul className="flex flex-col gap-3">
          {reminders.map((reminder) => {
            const link = linkFor(reminder);
            return (
              <Card as="li" key={reminder.id} className="flex flex-col gap-2">
                <Text className="font-semibold">{reminder.text}</Text>
                <Text variant="muted">{formatDate(reminder.dueAt)}</Text>
                {link ? (
                  <Link href={link.href} className="text-body font-semibold text-navy underline">
                    {link.label}
                  </Link>
                ) : null}
                <DismissForm reminderId={reminder.id} action={dismissAction} />
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
