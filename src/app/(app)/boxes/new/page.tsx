import type { Metadata } from "next";
import { createBoxesAction, markPrintedAction } from "@/app/(app)/boxes/actions";
import GenerateBoxesForm from "@/components/boxesPage/GenerateBoxesForm";
import LabelsPdfForm from "@/components/boxesPage/LabelsPdfForm";
import BackLink from "@/components/shared/links/BackLink";
import Disclosure from "@/components/shared/disclosure/Disclosure";
import Text from "@/components/shared/texts/Text";
import { getDb } from "@/db/client";
import { listBoxTypeOptions } from "@/server/boxes";
import { listActiveLocations } from "@/server/locations";
import { requirePageUser } from "@/server/page-access";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Згенерувати бокси" };

/** Створення партії боксів і PDF з наклейками. Власник й старший локації (D105, D111). */
export default async function NewBoxesPage() {
  const user = await requirePageUser("boxes");
  if (user.role !== "owner" && user.role !== "location_lead") redirect("/boxes");
  const db = getDb();
  const [types, locations] = await Promise.all([listBoxTypeOptions(db), listActiveLocations(db)]);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <BackLink href="/boxes">Бокси</BackLink>
      <GenerateBoxesForm
        types={types}
        locations={user.role === "owner" ? locations : null}
        createAction={createBoxesAction}
        markPrintedAction={markPrintedAction}
      />
      <Disclosure summary="Пробний аркуш для налаштування друку">
        <div className="flex flex-col gap-4">
          <Text variant="muted">
            Надрукуйте пробний аркуш на тому ж папері з наклейками. Якщо рамки не збігаються з
            наклейками, вкажіть зсув у міліметрах і надрукуйте ще раз.
          </Text>
          <LabelsPdfForm test label="Пробний аркуш" />
        </div>
      </Disclosure>
    </div>
  );
}
