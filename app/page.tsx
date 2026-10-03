"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-provider";
import { SessionLoading } from "@/components/ui/session-loading";
import { markLandingIntent } from "@/lib/access/landing-intent";

export default function Home() {
  const { user, loading, initializationError } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (user && !initializationError) {
      // La URL sigue siendo /finanzas; RouteGuard resuelve el módulo inicial.
      markLandingIntent();
      router.replace("/finanzas");
    } else router.replace("/login");
  }, [user, loading, initializationError, router]);
  return <SessionLoading />;
}
