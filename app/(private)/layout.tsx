import { AccessProvider } from "@/lib/auth/access-provider";
import { AuthGuard } from "@/components/layout/auth-guard";
import { AppShell } from "@/components/layout/app-shell";

export default function PrivateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <AccessProvider>
        <AppShell>{children}</AppShell>
      </AccessProvider>
    </AuthGuard>
  );
}
