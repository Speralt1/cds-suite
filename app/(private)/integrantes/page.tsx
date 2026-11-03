"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SessionLoading } from "@/components/ui/session-loading";
import { useAccessModel } from "@/lib/access/model";

// /integrantes no tiene contenido propio: lleva a la primera sub-área permitida
// (Consolidación; Ve por los tuyos si la persona no tiene members.consolidation.read).
export default function MembersPage() {
  const router = useRouter();
  const canConsolidation = useAccessModel().can("members.consolidation.read");
  useEffect(() => {
    router.replace(canConsolidation ? "/integrantes/consolidacion" : "/integrantes/ve-por-los-tuyos");
  }, [router, canConsolidation]);
  return <SessionLoading />;
}
