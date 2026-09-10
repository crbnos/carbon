/**
 * Loads the real zod validators out of `apps/erp/app/modules/{mod}/{mod}.models.ts`
 * so the manifest generator can convert them with native `z.toJSONSchema` instead of
 * regex-parsing validator source text.
 *
 * ## Why a Vite SSR server and not a plain `import()`
 *
 * Measured on this repo (2026-09-05) — a bare dynamic `import()` of the models files
 * fails for 14 of 15 modules, and each transport fails differently:
 *
 * - **ESM `import()`** — dies on `Named export 'textToTiptap' not found` for
 *   `@carbon/utils` (ESM named-export analysis through the workspace package's
 *   `export *` chain) and on `Unknown file extension ".css"` (a UI dep reached
 *   transitively).
 * - **CJS `require()`** — clears both of those, then dies on
 *   `Top-level await is currently not supported with the "cjs" output format`
 *   (`@carbon/react`'s CodeBlock). CJS is also the wrong target for zod v4, whose
 *   CJS build is both larger and — critically — would be a SECOND zod instance.
 *
 * Vite's SSR loader handles all of it natively (TS, the `~` alias, CSS, ESM +
 * top-level await), which is unsurprising: it is the same resolution the app itself
 * runs under.
 *
 * ## The single-zod-instance invariant (load-bearing)
 *
 * `z.toJSONSchema` dispatches on zod's internal class identity, so a validator built
 * by a DIFFERENT copy of zod converts wrong or throws. `ssr.external: ["zod",
 * "zod-form-data"]` keeps those two out of Vite's transform pipeline, so the loaded
 * models resolve the exact same ESM zod singleton this process imported. Do not
 * remove that external, and do not switch the loader to CJS.
 *
 * Verified: 15/15 modules load, 406 validators found, 406/406 convert, 0 throws.
 */

import * as fs from "fs";
import * as path from "path";
import type { z } from "zod";

const ROOT = path.resolve(__dirname, "../..");
const ERP_ROOT = path.join(ROOT, "apps/erp");
const MODULES_DIR = path.join(ERP_ROOT, "app/modules");
const LINGUI_STUB = path.join(__dirname, "stubs/lingui-macro.mjs");

/**
 * `@carbon/env` validates required vars at MODULE LOAD (see
 * `.claude/rules/environment-configuration.md`), and the models files reach it
 * transitively. This is a build-time codegen script with no runtime behavior, so
 * placeholders are set for any var that is not already present — never overriding a
 * real one, so running under a populated `.env.local` is unaffected.
 */
const ENV_PLACEHOLDERS: Record<string, string> = {
  INNGEST_SIGNING_KEY: "placeholder",
  INNGEST_EVENT_KEY: "placeholder",
  INNGEST_DEV: "1",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "placeholder",
  SUPABASE_DB_URL: "postgres://placeholder",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "placeholder",
  VERCEL_URL: "localhost",
  POSTHOG_API_HOST: "http://localhost",
  POSTHOG_PROJECT_PUBLIC_KEY: "placeholder",
  RESEND_API_KEY: "re_placeholder",
};

function applyEnvPlaceholders(): void {
  for (const [key, value] of Object.entries(ENV_PLACEHOLDERS)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

/** Absolute path to a module's models file (`.models.ts`, else the `.ee` variant). */
export function modelsPathFor(mod: string): string | null {
  for (const name of [`${mod}.models.ts`, `${mod}.ee.models.ts`]) {
    const candidate = path.join(MODULES_DIR, mod, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Everything a module's models file exports, plus the failure reason when it didn't load. */
export interface LoadedModule {
  /** Exported name → value, for every export (validators AND const arrays). */
  exports: Record<string, unknown>;
  /** Present only when the module failed to load; `exports` is then empty. */
  error?: string;
}

export interface ValidatorLoader {
  /** Load one module's models file. Never throws — failures come back as `error`. */
  load(mod: string): Promise<LoadedModule>;
  /** Shut the Vite server down. Always call this, or the process will not exit. */
  close(): Promise<void>;
}

/**
 * Boot a Vite SSR server configured to resolve the ERP app's module graph.
 * `vite` is imported lazily so importing this file stays cheap for callers that
 * never load validators.
 */
export async function createValidatorLoader(): Promise<ValidatorLoader> {
  applyEnvPlaceholders();

  const { createServer } = await import("vite");
  const server = await createServer({
    root: ERP_ROOT,
    // The app's own vite.config.ts pulls plugins (React Router, lingui) that are
    // irrelevant here and slow to boot; resolve is configured explicitly instead.
    configFile: false,
    logLevel: "silent",
    resolve: {
      alias: {
        "~": path.join(ERP_ROOT, "app"),
        "@lingui/react/macro": LINGUI_STUB,
        "@lingui/core/macro": LINGUI_STUB,
        "@lingui/macro": LINGUI_STUB,
      },
    },
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true },
    // See the single-zod-instance note in the file header — load-bearing.
    ssr: { external: ["zod", "zod-form-data"] },
  });

  return {
    async load(mod: string): Promise<LoadedModule> {
      const entry = modelsPathFor(mod);
      if (!entry) return { exports: {}, error: `no models file for "${mod}"` };
      try {
        const loaded = await server.ssrLoadModule(entry);
        return { exports: loaded as Record<string, unknown> };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exports: {}, error: message.split("\n")[0] };
      }
    },
    async close() {
      await server.close();
    },
  };
}

/** True when `value` is a zod schema built by THIS process's zod (see header). */
export function isZodSchema(value: unknown): value is z.ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    "_zod" in (value as Record<string, unknown>)
  );
}
