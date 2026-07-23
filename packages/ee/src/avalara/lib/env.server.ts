import {
  AVALARA_ACCOUNT_ID,
  AVALARA_CLIENT_ID,
  AVALARA_CLIENT_SECRET,
  AVALARA_LICENSE_KEY
} from "@carbon/auth";
import { AvalaraHttp } from "./client";
import type { Avalara } from "./types";

/**
 * Shared construction of the env-level Avalara HTTP core. Both the consumer
 * seam (`service.server.ts`) and the lifecycle hooks (`hooks.server.ts`) build
 * an `AvalaraHttp` from the same four env vars — keeping that in one place so a
 * change to credential handling (a new header, the `|| undefined` fallback)
 * cannot drift between call sites.
 *
 * Server-only: pulls in `@carbon/auth` env + the server-only `client.ts`. Never
 * import from `config.tsx` (browser-bundled).
 */

/** Whether env-level Avalara credentials are present (AvaTax Basic auth). */
export function isAvalaraConfigured(): boolean {
  return !!AVALARA_ACCOUNT_ID && !!AVALARA_LICENSE_KEY;
}

/** Build the env-credentialed `AvalaraHttp` core for the given environment. */
export function buildAvalaraHttp(
  environment: Avalara.Environment
): AvalaraHttp {
  return new AvalaraHttp({
    environment,
    accountId: AVALARA_ACCOUNT_ID!,
    licenseKey: AVALARA_LICENSE_KEY!,
    clientId: AVALARA_CLIENT_ID || undefined,
    clientSecret: AVALARA_CLIENT_SECRET || undefined
  });
}
