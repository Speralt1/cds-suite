"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Empty } from "../shared";
import { ProfilePage } from "./profile-page";
import { isValidProfileId } from "@/lib/finance/profile-route";

export function ProfileRoute() {
  const id = useSearchParams().get("id");

  if (!isValidProfileId(id)) {
    return (
      <Empty>
        No se indicó una ficha válida.{" "}
        <Link href="/finanzas/diezmos" className="underline">
          Volver a diezmos
        </Link>
      </Empty>
    );
  }

  return <ProfilePage id={id} />;
}
