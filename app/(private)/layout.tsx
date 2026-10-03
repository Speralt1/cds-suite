import { AccessProvider } from "@/lib/auth/access-provider";
import { AuthGuard } from "@/components/layout/auth-guard";
import { AppShell } from "@/components/layout/app-shell";
import { NoticeProvider } from "@/components/layout/notice";
import { RouteGuard } from "@/components/layout/route-guard";

export default function PrivateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <AccessProvider>
        <NoticeProvider>
          <AppShell>
            <RouteGuard>{children}</RouteGuard>
          </AppShell>
        </NoticeProvider>
      </AccessProvider>
    </AuthGuard>
  );
}
