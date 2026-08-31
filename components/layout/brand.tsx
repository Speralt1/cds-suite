import Image from "next/image";

// After adding public/logo-cds.png, pass logoSrc="/logo-cds.png" here.
export function Brand({ logoSrc }: { logoSrc?: string }) {
  return (
    <div className="flex items-center gap-3">
      {logoSrc ? (
        <Image
          src={logoSrc}
          alt="Casa de Salvación"
          width={44}
          height={44}
          className="rounded-xl object-contain"
        />
      ) : (
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-semibold tracking-tight text-white"
          aria-hidden="true"
        >
          CDS
        </span>
      )}
      <div>
        <p className="text-sm font-semibold tracking-tight text-ink">
          CDS Administración
        </p>
        <p className="mt-0.5 text-xs text-muted">Casa de Salvación</p>
      </div>
    </div>
  );
}
