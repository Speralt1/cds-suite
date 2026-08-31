import { Suspense } from "react";
import { TithesPage } from "@/components/finance/tithes/tithes-page";
import { Loading } from "@/components/finance/shared";
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <TithesPage />
    </Suspense>
  );
}
