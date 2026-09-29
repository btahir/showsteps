import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Type-check TypeScript source in memory, as if it lived in packages/core/test/, so that
 * `@playwright/test` resolves from this package's node_modules. Returns readable diagnostics.
 */
export function typeCheck(source: string, fileName = "generated.spec.ts"): string[] {
  const virtual = join(HERE, "__virtual__", fileName);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: ["node"],
    typeRoots: [join(HERE, "../../../node_modules/@types")],
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  };
  const host = ts.createCompilerHost(options);
  const realRead = host.readFile.bind(host);
  const realExists = host.fileExists.bind(host);
  host.readFile = (f) => (f === virtual ? source : realRead(f));
  host.fileExists = (f) => f === virtual || realExists(f);
  const realGet = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, onError, shouldCreate) =>
    f === virtual ? ts.createSourceFile(f, source, lang) : realGet(f, lang, onError, shouldCreate);
  const program = ts.createProgram([virtual], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => `${d.file?.fileName.split("/").pop() ?? ""}:${d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
}
