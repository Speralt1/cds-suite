// Tipos de scripts/build-shared.mjs (para los tests en TypeScript).
export declare const SHARED_SRC_DIR: string;
export declare const SHARED_OUT_DIR: string;
export declare const SHARED_FILES: readonly string[];
export declare function generatedHeader(name: string): string;
export declare function compileShared(name: string, source: string): string;
export declare function buildSharedOutputs(): Map<string, string>;
export declare function checkSharedOutputs(): string[];
