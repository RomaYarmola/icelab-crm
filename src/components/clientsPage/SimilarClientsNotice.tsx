import type { SimilarClient } from "@/server/clients";
import MainLink from "../shared/links/MainLink";

const REASON_LABELS: Record<SimilarClient["reason"], string> = {
  phone: "той самий телефон",
  name: "схожа назва",
};

/**
 * Підказка «Схожі клієнти» (D48): показується під полями назви й телефону, збереження не блокує.
 * Посилання відкриваються в новій вкладці, щоб не втратити введене.
 */
export default function SimilarClientsNotice({ clients }: { clients: SimilarClient[] }) {
  if (clients.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-2 rounded-field bg-status-in-production px-4 py-3 text-body text-status-in-production-text"
    >
      <p className="font-bold">Схожі клієнти</p>
      <ul className="flex flex-col gap-1">
        {clients.map((client) => (
          <li key={client.id}>
            <MainLink href={`/clients/${client.id}`} isExternal>
              {client.code} · {client.name}
            </MainLink>{" "}
            <span>({REASON_LABELS[client.reason]})</span>
          </li>
        ))}
      </ul>
      <p>Якщо це інший клієнт, просто збережіть: нічого не заблоковано.</p>
    </div>
  );
}
