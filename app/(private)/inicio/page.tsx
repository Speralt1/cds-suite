"use client";

// /inicio (link de la marca): lleva al módulo inicial resuelto. RouteGuard ya
// redirige antes de montar esta página; esto es la segunda barrera si se
// renderiza sin guardia.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAccessModel } from "@/lib/access/model";
import { NoModulesScreen } from "@/components/layout/no-modules";
import { SessionLoading } from "@/components/ui/session-loading";

export default function HomeRedirectPage() {
  const router = useRouter();
  const { home } = useAccessModel();
  const href = home.kind === "module" ? home.href : null;
  const done = useRef(false);
  useEffect(() => {
    if (!href || done.current) return;
    done.current = true;
    router.replace(href);
  }, [href, router]);
  if (home.kind === "no-modules") return <NoModulesScreen />;
  return <SessionLoading />;
}
