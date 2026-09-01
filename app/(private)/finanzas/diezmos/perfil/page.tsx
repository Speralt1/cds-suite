import { Suspense } from "react";
import { Loading } from "@/components/finance/shared";
import { ProfileRoute } from "@/components/finance/tithes/profile-route";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ProfileRoute />
    </Suspense>
  );
}
