"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-provider";
import { SessionLoading } from "@/components/ui/session-loading";

export default function Home() {
  const { user, loading, initializationError } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading)
      router.replace(user && !initializationError ? "/dashboard" : "/login");
  }, [user, loading, initializationError, router]);
  return <SessionLoading />;
}
