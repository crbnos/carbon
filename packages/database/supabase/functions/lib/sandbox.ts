// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { transpile } from "https://deno.land/x/ts_transpiler@v0.0.2/mod.ts";
import { runConfigurationRule } from "../shared/configuration-rule.ts";
import { getFunctionLogger } from "./logging.ts";

const logger = getFunctionLogger("configuration-rule");

/**
 * A stored configuration rule is the TypeScript body of `configure(params)`. It is
 * transpiled here and run in QuickJS (shared/configuration-rule.ts), never in this
 * function's own engine.
 *
 * A rule that does not compile, throws, or exceeds a sandbox limit yields null, so one
 * broken rule never fails the whole method: a field keeps its default, and a bill of
 * materials or process keeps all of its lines.
 */
export async function importTypeScript(code: string): Promise<{
  configure: <T>(params: unknown) => Promise<T | null>;
}> {
  let javascript: string | null = null;
  try {
    javascript = await transpile(
      `function configure(params: Params) {\n${code}\n}`
    );
  } catch (error) {
    logger.error("configuration rule does not compile", {
      error: String(error)
    });
  }

  return {
    configure: async <T>(params: unknown) => {
      if (javascript === null) return null;
      try {
        return (await runConfigurationRule(javascript, params)) as T | null;
      } catch (error) {
        logger.error("configuration rule failed", { error: String(error) });
        return null;
      }
    }
  };
}
