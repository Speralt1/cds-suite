// Tipos de scripts/ops/finance-monitor/run.mjs (para los tests en TypeScript).
export declare function parseArgs(argv: string[]): Record<string, string> & { help?: boolean };
export declare function main(argv: string[]): { code: 0 | 1 | 2; output: string };
