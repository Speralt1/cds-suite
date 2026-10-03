"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SessionLoading } from "@/components/ui/session-loading";
import { markLandingIntent } from "@/lib/access/landing-intent";

// The dashboard has no operational use (§B): it is a landing. The URL stays
// /finanzas and RouteGuard resolves the user's home module once (18a §F).
export default function DashboardPage() {
  const router = useRouter();
  useEffect(() => {
    markLandingIntent();
    router.replace("/finanzas");
  }, [router]);
  return <SessionLoading />;
}
