import type { ClientFormOptions } from "@/server/client-options";
import BackLink from "../shared/links/BackLink";
import SectionTitle from "../shared/titles/SectionTitle";
import type { NewClientActions } from "./clientActions";
import ClientForm, { EMPTY_CLIENT_DEFAULTS } from "./ClientForm";

interface NewClientContentProps {
  options: ClientFormOptions;
  actions: NewClientActions;
  /** Менеджер за замовчуванням: той, хто створює (якщо він у списку менеджерів). */
  defaultManagerId: string;
}

/** Екран «Новий клієнт»: область, назва, телефон. Код видається сам. */
export default function NewClientContent({
  options,
  actions,
  defaultManagerId,
}: NewClientContentProps) {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <BackLink href="/clients">Клієнти</BackLink>
      <SectionTitle>Новий клієнт</SectionTitle>
      <ClientForm
        mode="create"
        options={options}
        defaults={{
          ...EMPTY_CLIENT_DEFAULTS,
          // «Активний» першим у списку статусів (так їх впорядковує `getClientFormOptions`).
          statusId: options.statuses[0]?.id ?? "",
          managerId: defaultManagerId,
        }}
        action={actions.create}
        previewCode={actions.previewCode}
        findSimilar={actions.findSimilar}
        submitLabel="Створити клієнта"
      />
    </div>
  );
}
