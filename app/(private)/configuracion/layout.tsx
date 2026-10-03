import { SettingsGuard } from "@/components/settings/settings-guard";
import { SettingsNav } from "@/components/settings/settings-nav";

export default function ConfigurationLayout({ children }: { children: React.ReactNode }) {
  return (
    <SettingsGuard>
      <SettingsNav />
      <div className="mt-7">{children}</div>
    </SettingsGuard>
  );
}
