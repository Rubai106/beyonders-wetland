// Test-only ESM loader. Resolve the bundler's extensionless relative TypeScript imports,
// then transpile .ts files with the project's pinned TypeScript compiler. This keeps the
// regression suite runnable on Node 18+ without relying on Node 22's experimental type stripping.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const parentPath = fileURLToPath(context.parentURL);
      const candidate = path.resolve(path.dirname(parentPath), specifier);
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        if (existsSync(candidate + ext)) {
          return { url: pathToFileURL(candidate + ext).href, shortCircuit: true };
        }
      }
    }
    throw err;
  }
}

export async function load(url, context, next) {
  if (url.endsWith(".ts") || url.endsWith(".tsx")) {
    const filename = fileURLToPath(url);
    const source = readFileSync(filename, "utf8");
    const result = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        sourceMap: false,
      },
    });
    return {
      format: "module",
      source: result.outputText,
      shortCircuit: true,
    };
  }
  return next(url, context);
}
