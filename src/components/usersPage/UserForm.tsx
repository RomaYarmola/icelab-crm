"use client";

import { useActionState, useState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/constants/constants";
import { isLocationBound, ROLE_LABELS, USER_ROLES, type UserRole } from "@/server/permissions";
import { type FormState, INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import GeneratePasswordField from "../shared/customizedInput/GeneratePasswordField";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import Text from "../shared/texts/Text";

export interface UserFormDefaults {
  email: string;
  fullName: string;
  role: UserRole;
  locationId: string;
  phone: string;
}

interface UserFormProps {
  /** `create`: новий користувач (e-mail і пароль), `edit`: зміна імені, ролі, локації й телефону. */
  mode: "create" | "edit";
  /** Для `edit`: чий це профіль (приховане поле `id`). */
  userId?: string;
  locations: { id: string; name: string }[];
  defaults: UserFormDefaults;
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
}

const ROLE_OPTIONS = USER_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

/**
 * Форма користувача для власника: створення і зміна профілю. Локація з'являється лише для ролей, які
 * працюють у своїй локації (старший локації, виробництво, водій); решта бачить усі локації.
 */
export default function UserForm({
  mode,
  userId,
  locations,
  defaults,
  action,
  submitLabel,
}: UserFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  // Після помилки сервер повертає введене, і поля показують його, а не початкові значення.
  const values = { ...defaults, ...state.values };
  const [role, setRole] = useState<string>(defaults.role);
  const needsLocation = isLocationBound(role as UserRole);

  return (
    <Form action={formAction}>
      {userId ? <input type="hidden" name="id" value={userId} /> : null}

      {mode === "create" ? (
        <CustomizedInput
          name="email"
          type="email"
          label="E-mail"
          autoComplete="off"
          defaultValue={values.email}
          required
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          <Text variant="label">E-mail</Text>
          <Text variant="muted">{defaults.email || "Не вказано"}</Text>
        </div>
      )}

      <CustomizedInput
        name="fullName"
        label="Ім'я"
        autoComplete="off"
        defaultValue={values.fullName}
        required
      />

      <CustomizedSelect
        name="role"
        label="Роль"
        options={ROLE_OPTIONS}
        defaultValue={values.role}
        onChange={(event) => setRole(event.target.value)}
      />

      {needsLocation ? (
        <CustomizedSelect
          name="locationId"
          label="Локація"
          options={[
            { value: "", label: "Оберіть локацію" },
            ...locations.map((location) => ({ value: location.id, label: location.name })),
          ]}
          defaultValue={values.locationId}
          hint="Ця роль працює лише зі своєю локацією."
          required
        />
      ) : null}

      <CustomizedInput
        name="phone"
        type="tel"
        label="Телефон"
        autoComplete="off"
        defaultValue={values.phone}
        hint="Необов'язково."
      />

      {mode === "create" ? (
        <GeneratePasswordField
          name="password"
          label="Пароль"
          hint={`Необов'язково, від ${MIN_PASSWORD_LENGTH} символів. Без пароля вхід лише через Google. Згенерований пароль скопіюйте й передайте користувачу до збереження: потім його не буде видно.`}
        />
      ) : null}

      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        {submitLabel}
      </MainButton>
    </Form>
  );
}
