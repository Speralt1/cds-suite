"use client";

// AccessGate: decide qué se renderiza según el perfil simulado y la ruta, y es
// el ÚNICO lugar con useRouter (ejecuta los redirects y los navRequest del
// provider). Nunca renderiza una ruta prohibida: mientras redirige muestra el
// skeleton. El HTML estático siempre es el skeleton (ready = false).

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { guardRoute, normalizePath, withProfile } from "@/lib/suite-preview/routes";
import { useSuite } from "./provider";
import { GateSkeleton, InactiveScreen, NoModulesScreen } from "./screens";

export function AccessGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = normalizePath(usePathname() ?? "/preview");
  const { ready, profile, profileId, setNotice, navRequest } = useSuite();
  const decision = ready ? guardRoute(profile, pathname) : null;
  const redirectTo = decision?.type === "redirect" ? decision.to : null;
  const redirectNotice = decision?.type === "redirect" ? decision.notice : null;
  const lastTo = useRef<string | null>(null);

  useEffect(() => {
    if (!redirectTo) {
      lastTo.current = null;
      return;
    }
    if (lastTo.current === redirectTo) return; // anti doble efecto (StrictMode) y anti loop
    lastTo.current = redirectTo;
    setNotice({ text: redirectNotice ?? "", forPath: normalizePath(redirectTo) });
    router.replace(withProfile(redirectTo, profileId));
  }, [redirectTo, redirectNotice, profileId, router, setNotice]);

  const lastNav = useRef(0);
  useEffect(() => {
    if (!navRequest || navRequest.id === lastNav.current) return;
    lastNav.current = navRequest.id;
    router.replace(navRequest.href);
  }, [navRequest, router]);

  if (!decision) return <GateSkeleton />;
  switch (decision.type) {
    case "public":
    case "login":
    case "allow":
      return <>{children}</>;
    case "inactive":
      return <InactiveScreen />;
    case "no-modules":
      return <NoModulesScreen />;
    case "redirect":
      return <GateSkeleton />;
  }
}
