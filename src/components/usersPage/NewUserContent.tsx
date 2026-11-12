import type { FormState } from "@/utils/formState";
import BackLink from "../shared/links/BackLink";
import SectionTitle from "../shared/titles/SectionTitle";
import UserForm from "./UserForm";

interface NewUserContentProps {
  locations: { id: string; name: string }[];
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
}

/** Екран «Новий користувач» (лише власник). */
export default function NewUserContent({ locations, action }: NewUserContentProps) {
  return (
    <div className="flex max-w-md flex-col gap-6">
      <BackLink href="/more/users">Користувачі</BackLink>
      <SectionTitle>Новий користувач</SectionTitle>
      <UserForm
        mode="create"
        locations={locations}
        defaults={{ email: "", fullName: "", role: "manager", locationId: "", phone: "" }}
        action={action}
        submitLabel="Створити користувача"
      />
    </div>
  );
}
