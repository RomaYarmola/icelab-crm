"use client";

import { useActionState, useState } from "react";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import Text from "../shared/texts/Text";
import type { FormAction } from "./clientActions";

interface AssignRegionFormProps {
  clientId: string;
  regions: { prefix: string; name: string }[];
  action: FormAction;
}

/**
 * Клієнт без області («21») отримує область: код стає «літери + номер», старий код записується в
 * примітку (відповідь Романа А1.4). Показується лише клієнтам із цифровим кодом.
 */
export default function AssignRegionForm({ clientId, regions, action }: AssignRegionFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const [region, setRegion] = useState(regions[0]?.prefix ?? "");

  return (
    <Disclosure summary="Додати область до коду">
      <Form action={formAction}>
        <input type="hidden" name="id" value={clientId} />
        <Text variant="muted">
          Код клієнта з самих цифр. Коли він зробить перше замовлення, додайте область: код стане
          «літери + номер», а старий запишеться в примітку.
        </Text>
        <CustomizedSelect
          name="regionPrefix"
          label="Область"
          options={regions.map((item) => ({
            value: item.prefix,
            label: `${item.prefix} · ${item.name}`,
          }))}
          value={region}
          onChange={(event) => setRegion(event.target.value)}
        />
        <FormMessage state={state} />
        <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
          Змінити код
        </MainButton>
      </Form>
    </Disclosure>
  );
}
