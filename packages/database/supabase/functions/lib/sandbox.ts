import { transpile } from "https://deno.land/x/ts_transpiler@v0.0.2/mod.ts";
import { runConfigurationRule } from "../shared/configuration-rule.ts";

/**
 * A stored configuration rule is the TypeScript body of `configure(params)`. It is
 * transpiled here and run in QuickJS (shared/configuration-rule.ts), never in this
 * function's own engine.
 */
export async function importTypeScript(code: string): Promise<{
  configure: <T>(params: unknown) => Promise<T | null>;
}> {
  const javascript = await transpile(
    `function configure(params: Params) {\n${code}\n}`
  );
  return {
    configure: async <T>(params: unknown) =>
      (await runConfigurationRule(javascript, params)) as T | null
  };
}
