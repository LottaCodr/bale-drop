/**
 * Syntax gate for the Deno Edge Functions.
 *
 * `npm run typecheck:edge` needs Deno, which CI and most contributors do not
 * have installed. These functions hold the Paystack secret, so a typo in one of
 * them should still fail the build: this parses every function with the
 * TypeScript compiler and reports syntax diagnostics (it does not resolve the
 * `https://esm.sh/...` imports, which is Deno's job).
 *
 * Usage: node scripts/check-edge-syntax.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = new URL("../supabase/functions/", import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
let failures = 0;

for (const file of files.sort()) {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const diagnostics = sourceFile.parseDiagnostics ?? [];
  const name = relative(ROOT, file);
  if (diagnostics.length === 0) {
    console.log(`  ok   ${name}`);
    continue;
  }
  failures += 1;
  console.log(`  FAIL ${name}`);
  for (const diagnostic of diagnostics.slice(0, 8)) {
    const { line, character } = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0) ?? { line: 0, character: 0 };
    console.log(`       ${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
}

console.log(`\n${files.length} edge function files, ${failures} with syntax errors`);
process.exit(failures === 0 ? 0 : 1);
