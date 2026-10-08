"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Plus, Inbox, Users } from "lucide-react";
import { useAccessModel } from "@/lib/access/model";
import { MembersProvider } from "@/lib/members/use-members";
import { ModuleSubnav, type ModuleSubnavItem } from "@/components/layout/module-subnav";
import { ModuleNotices } from "@/components/members/status";
import "@/components/members/members.css";

const ITEMS: ModuleSubnavItem[] = [
  // "Inicio" como en la preview: con "Consolidación" la tercera pestaña no cabía a 375–390 px.
  { href: "/integrantes/consolidacion", label: "Inicio", icon: LayoutDashboard },
  { href: "/integrantes/consolidacion/atencion", label: "Atención", icon: Inbox },
  {
    href: "/integrantes/consolidacion/personas",
    label: "Personas",
    icon: Users,
    // La ficha y el registro pertenecen a Personas (como en la preview).
    matchPaths: ["/integrantes/consolidacion/persona", "/integrantes/consolidacion/nueva"],
  },
];

export default function MembersLayout({ children }: { children: React.ReactNode }) {
  const access = useAccessModel();
  const canManage = access.can("members.consolidation.manage");
  const onNewPerson = (usePathname() ?? "").replace(/\/+$/, "").endsWith("/consolidacion/nueva");
  return (
    <div className="cds-members">
      <div className="mem-module-head">
        <h1 className="text-xl font-semibold">Integrantes</h1>
        {canManage && !onNewPerson && (
          <Link href="/integrantes/consolidacion/nueva" className="button-primary mem-new-person">
            <Plus size={16} aria-hidden="true" /> Registrar persona
          </Link>
        )}
      </div>
      <ModuleSubnav label="Integrantes" items={ITEMS} />
      <MembersProvider>
        <ModuleNotices />
        <div className="mt-6">{children}</div>
      </MembersProvider>
    </div>
  );
}
