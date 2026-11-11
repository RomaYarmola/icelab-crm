import type { Metadata } from "next";
import { signOutAction } from "@/app/login/actions";
import Card from "@/components/shared/cards/Card";
import MoreMenu from "@/components/shared/navigation/MoreMenu";
import { ALL_LOCATIONS_LABEL } from "@/constants/constants";
import { ROLE_LABELS } from "@/server/permissions";
import { requireUser } from "@/server/auth";
import { extraNavItemsFor } from "@/utils/navigation";

export const metadata: Metadata = { title: "Ще" };

export default async function MorePage() {
  const user = await requireUser();

  return (
    <Card className="max-w-xs p-2">
      <MoreMenu
        fullName={user.fullName}
        email={user.email}
        roleLabel={ROLE_LABELS[user.role]}
        locationLabel={user.locationName ?? ALL_LOCATIONS_LABEL}
        extraItems={extraNavItemsFor(user.role)}
        signOutAction={signOutAction}
      />
    </Card>
  );
}
