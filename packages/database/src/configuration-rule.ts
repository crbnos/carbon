// Node/browser re-export of the configuration-rule runner the edge runtime uses, so the rule
// editor and get-method run rules in the same QuickJS sandbox. Its npm dependencies are pinned
// in both this package.json and supabase/functions/deno.json — keep the versions identical.
export * from "../supabase/functions/shared/configuration-rule.ts";
