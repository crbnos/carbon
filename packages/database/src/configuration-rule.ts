import { transform } from "sucrase";

// Node/browser re-export of the configuration-rule runner the edge runtime uses, so the rule
// editor and get-method run rules in the same QuickJS sandbox. Its npm dependencies are pinned
// in both this package.json and supabase/functions/deno.json — keep the versions identical.
export * from "../supabase/functions/shared/configuration-rule.ts";

/**
 * A stored rule is the TypeScript body of `configure(params)`. Wrap it and strip the
 * types — the one transpile both the rule editor and get-method run, so a preview and
 * a job see the same JavaScript. Throws on a syntax error.
 */
export function transpileRule(code: string): string {
  return transform(`function configure(params: Params) {\n${code}\n}`, {
    transforms: ["typescript"]
  }).code;
}
