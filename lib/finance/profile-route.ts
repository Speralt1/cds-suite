export function isValidProfileId(id: string | null): id is string {
  return (
    !!id && id.length <= 128 && id !== "." && id !== ".." && !id.includes("/")
  );
}

export function profileHref(id: string) {
  return `/finanzas/diezmos/perfil?id=${encodeURIComponent(id)}`;
}
