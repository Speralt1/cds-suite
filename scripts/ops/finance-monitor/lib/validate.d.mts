// Tipos de scripts/ops/finance-monitor/lib/validate.mjs (para los tests en TypeScript).
export declare function isYmd(v: unknown): boolean;
export declare function isIso(v: unknown): boolean;
export declare function validateOptions(opts: unknown): string[];
export declare function validateSnapshot(raw: unknown, opts?: { allowEmpty?: boolean }): { snapshot: unknown; problems: string[] };
