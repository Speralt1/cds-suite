"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-provider";
import { SessionLoading } from "@/components/ui/session-loading";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, initializationError } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || initializationError)) router.replace("/login");
  }, [user, loading, initializationError, router]);

  if (loading || !user || initializationError) return <SessionLoading />;
  return children;
}
