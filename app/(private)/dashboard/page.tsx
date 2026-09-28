"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SessionLoading } from "@/components/ui/session-loading";

// The dashboard has no operational use (§B); every role lands on /finanzas.
export default function DashboardPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/finanzas");
  }, [router]);
  return <SessionLoading />;
}
