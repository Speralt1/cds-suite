"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SessionLoading } from "@/components/ui/session-loading";

// /integrantes no tiene contenido propio en V1: lleva a Consolidación.
export default function MembersPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/integrantes/consolidacion");
  }, [router]);
  return <SessionLoading />;
}
