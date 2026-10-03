import { SettingsGuard } from "@/components/settings/settings-guard";
import { SettingsNav } from "@/components/settings/settings-nav";
import { SettingsSectionProvider } from "@/components/settings/settings-ui";

// Mismo patrón de módulo que Calendario y Reportes: h1 del módulo, subnav y,
// dentro de cada sección, su h2 con descripción y acción.
export default function ConfigurationLayout({ children }: { children: React.ReactNode }) {
  return (
    <SettingsGuard>
      <h1 className="mb-3 text-xl font-semibold">Configuración</h1>
      <SettingsNav />
      <div className="mt-6">
        <SettingsSectionProvider>{children}</SettingsSectionProvider>
      </div>
    </SettingsGuard>
  );
}
