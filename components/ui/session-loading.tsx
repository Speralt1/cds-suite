import { LoaderCircle } from "lucide-react";

export function SessionLoading() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-canvas px-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-sm text-muted">
        <LoaderCircle
          className="size-5 animate-spin text-primary motion-reduce:animate-none"
          aria-hidden="true"
        />
        Verificando tu sesión…
      </div>
    </div>
  );
}
