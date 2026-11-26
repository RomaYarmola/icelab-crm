import type { Metadata } from "next";
import ProfileContent from "@/components/profilePage/ProfileContent";
import { ALL_LOCATIONS_LABEL } from "@/constants/constants";
import { requireUser } from "@/server/auth";
import { roleLabelOf } from "@/server/permissions";

export const metadata: Metadata = { title: "Профіль" };

/** «Ще»: профіль, зміна власного пароля, для власника перехід до користувачів. */
export default async function MorePage() {
  const user = await requireUser();

  return (
    <ProfileContent
      fullName={user.fullName}
      email={user.email}
      roleLabel={roleLabelOf(user)}
      locationLabel={user.locationName ?? ALL_LOCATIONS_LABEL}
    />
  );
}
