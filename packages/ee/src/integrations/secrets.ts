import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Integration secret handling (NIST 800-171 3.13.16 / SC-28).
 *
 * Third-party credentials are encrypted at rest in Supabase Vault; only the
 * non-secret configuration stays in the plaintext `companyIntegration.metadata`
 * column. This module is the ONE place that declares which metadata keys are
 * secret, plus the read/write helpers that move them in and out of the vault.
 *
 * The vault schema is not exposed to PostgREST, so all vault access goes through
 * the SECURITY DEFINER RPCs added in the vault migration — always with a
 * service-role client. A user (anon/authenticated) client cannot decrypt a
 * secret.
 */

/**
 * The ONLY declaration of which `metadata` keys hold secrets, per integration
 * id. Dot-paths into the metadata object. Anything not listed here stays in the
 * plaintext column (tenantId/realmId/sync config/etc.). A field mis-classified
 * as non-secret leaks — keep this map exhaustive and reviewed.
 */
export const SECRET_KEYS: Record<string, string[]> = {
  linear: ["apiKey"],
  slack: ["access_token"],
  jira: ["credentials.accessToken", "credentials.refreshToken"],
  onshape: ["credentials.accessToken", "credentials.refreshToken"],
  xero: ["credentials.accessToken", "credentials.refreshToken"],
  quickbooks: ["credentials.accessToken", "credentials.refreshToken"],
  rillet: ["credentials.apiKey", "credentials.providerMetadata.webhookToken"],
  "paperless-parts": ["apiKey", "secretKey"],
  resend: ["apiKey"],
  // email carries a secret in EITHER variant: Resend `apiKey` or SMTP `password`
  // (top-level). splitSecrets omits whichever is absent for the active provider.
  email: ["apiKey", "password"]
};

/** Thrown when a secret is expected in the vault but cannot be read (fail-closed). */
export class IntegrationSecretUnavailableError extends Error {
  constructor(companyId: string, integrationId: string) {
    super(
      `Integration secret unavailable for ${integrationId} (company ${companyId})`
    );
    this.name = "IntegrationSecretUnavailableError";
  }
}

type Json = Record<string, unknown>;

/** Read a dot-path (`a.b.c`) from a nested object; undefined if any hop is missing. */
export function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Json)[part];
  }
  return cur;
}

/** Set a dot-path on a nested object, creating intermediate objects. Mutates `obj`. */
export function setPath(obj: Json, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Json = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (typeof cur[part] !== "object" || cur[part] === null) {
      cur[part] = {};
    }
    cur = cur[part] as Json;
  }
  cur[parts[parts.length - 1]!] = value;
}

/** Delete a dot-path leaf from a nested object. Mutates `obj`. Empty parents are left as-is. */
export function deletePath(obj: Json, path: string): void {
  const parts = path.split(".");
  let cur: Json = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (typeof cur[part] !== "object" || cur[part] === null) return;
    cur = cur[part] as Json;
  }
  delete cur[parts[parts.length - 1]!];
}

/**
 * Split a metadata object into the non-secret `config` (a deep copy with every
 * SECRET_KEYS path removed) and a flat `secrets` bag (`{ [path]: value }`,
 * omitting paths whose value is undefined). Unknown integration ids have no
 * secret keys, so `config` is a pass-through and `secrets` is empty.
 */
export function splitSecrets(
  integrationId: string,
  metadata: unknown
): { config: Json; secrets: Record<string, unknown> } {
  const config: Json =
    typeof metadata === "object" && metadata !== null
      ? (structuredClone(metadata) as Json)
      : {};
  const secrets: Record<string, unknown> = {};
  for (const path of SECRET_KEYS[integrationId] ?? []) {
    const value = getPath(config, path);
    // Anti-overwrite (D4a): an empty/absent value is "unchanged, don't write" —
    // never persist it, so saving a form whose masked secret field was left
    // untouched (submitted as "" or omitted) cannot clobber the vaulted secret.
    if (value !== undefined && value !== "") {
      secrets[path] = value;
    }
    // Always strip the path from config so the plaintext column never keeps a
    // secret, even the empty placeholder.
    deletePath(config, path);
  }
  return { config, secrets };
}

/**
 * Persist an integration's secrets to the vault and write the stripped
 * (non-secret) config to `companyIntegration.metadata`. Replaces any direct
 * `metadata` write on a secret-bearing path. Requires a SERVICE-ROLE client.
 * Returns the stripped config that was written to the column.
 */
export async function persistIntegrationSecrets(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  integrationId: string,
  metadata: unknown
): Promise<Json> {
  const { config, secrets } = splitSecrets(integrationId, metadata);

  if (Object.keys(secrets).length > 0) {
    const { error } = await serviceClient.rpc("upsert_integration_secret", {
      p_company_id: companyId,
      p_integration_id: integrationId,
      p_secret: secrets as never
    });
    if (error)
      throw new IntegrationSecretUnavailableError(companyId, integrationId);
  }

  const { error: updateError } = await serviceClient
    .from("companyIntegration")
    .update({ metadata: config as never })
    .eq("companyId", companyId)
    .eq("id", integrationId);
  if (updateError) throw updateError;

  return config;
}

/**
 * Merge an integration's vaulted secrets back into a copy of its metadata so
 * callers read the same shape as before (e.g. `metadata.credentials.accessToken`).
 * Requires a SERVICE-ROLE client.
 *
 * - integration has no secret keys          -> return metadata as-is (nothing to do).
 * - `secretRef` set + vault returns the bag  -> merged metadata.
 * - `secretRef` set + vault returns null      -> throw (fail-closed, D8).
 * - secret-bearing integration + no `secretRef` -> throw (fail-closed): the
 *   plaintext has been scrubbed, so a missing vault pointer is a broken state,
 *   never "return the secret-free metadata as if complete". (The transitional
 *   plaintext fallback was removed with the backfill-and-scrub migration.)
 *
 * Pass `secretRef` from the row when you have it to skip the extra lookup.
 */
export async function resolveIntegrationSecrets(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  integrationId: string,
  metadata: unknown,
  secretRef?: string | null
): Promise<Json> {
  const base: Json =
    typeof metadata === "object" && metadata !== null
      ? (structuredClone(metadata) as Json)
      : {};

  // Integrations that store no secrets have nothing to resolve.
  if ((SECRET_KEYS[integrationId] ?? []).length === 0) return base;

  let ref = secretRef;
  if (ref === undefined) {
    const { data } = await serviceClient
      .from("companyIntegration")
      .select("secretRef")
      .eq("companyId", companyId)
      .eq("id", integrationId)
      .maybeSingle();
    ref = data?.secretRef ?? null;
  }

  // Fail closed: a secret-bearing integration must carry a vault pointer.
  if (!ref) {
    throw new IntegrationSecretUnavailableError(companyId, integrationId);
  }

  const { data: bag, error } = await serviceClient.rpc(
    "get_integration_secret",
    {
      p_company_id: companyId,
      p_integration_id: integrationId
    }
  );
  if (error || bag === null || typeof bag !== "object") {
    throw new IntegrationSecretUnavailableError(companyId, integrationId);
  }

  for (const [path, value] of Object.entries(bag as Record<string, unknown>)) {
    setPath(base, path, value);
  }
  return base;
}
