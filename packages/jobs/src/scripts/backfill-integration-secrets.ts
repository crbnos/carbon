/**
 * Backfill: move existing plaintext integration secrets in
 * `companyIntegration.metadata` into Supabase Vault (NIST 800-171 3.13.16).
 *
 * Sets `secretRef` on each row that carries a secret. Does NOT strip the
 * plaintext from the column — the transitional read-fallback keeps providers
 * working until the separate scrub migration runs (plan Task 10). Idempotent:
 * re-running upserts the same vault name in place.
 *
 * Lives in @carbon/jobs (not @carbon/database) because it imports @carbon/ee's
 * single SECRET_KEYS map, and database cannot depend on ee (that edge is a
 * cycle). Run as a deploy step:
 *   pnpm --filter @carbon/jobs exec tsx src/scripts/backfill-integration-secrets.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "@carbon/database";
// Import the pure secrets module directly (not the @carbon/ee barrel, which
// transitively pulls React UI config and cannot load in a plain node script).
import { SECRET_KEYS, splitSecrets } from "@carbon/ee/integrations/secrets";
import { createClient } from "@supabase/supabase-js";

// Dependency-free .env loader (jobs has no dotenv; .env.local is symlinked here).
function loadEnv(file: string) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), file), "utf8").split(
      "\n"
    )) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m?.[1] && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // file absent — rely on the ambient environment
  }
}
loadEnv(".env.local");
loadEnv(".env");

const admin = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/** Heuristic: does this metadata look like it holds a secret we might have missed? */
function looksSecret(metadata: unknown): boolean {
  return /("?(apiKey|api_key|access_token|accessToken|refreshToken|secretKey|password|webhookToken|token|secret)"?\s*:)/i.test(
    JSON.stringify(metadata ?? {})
  );
}

async function backfill() {
  const { data: rows, error } = await admin
    .from("companyIntegration")
    .select("id, companyId, metadata, secretRef");
  if (error) throw error;

  let vaulted = 0;
  let empty = 0;
  let warned = 0;

  for (const row of rows ?? []) {
    const { secrets } = splitSecrets(row.id, row.metadata);

    // STOP signal: a secret-looking integration not covered by the map is NOT
    // vaulted — surface it loudly rather than silently leaving plaintext.
    if (!(row.id in SECRET_KEYS) && looksSecret(row.metadata)) {
      warned++;
      console.warn(
        `[WARN] "${row.id}" (company ${row.companyId}) has secret-looking metadata but is NOT in SECRET_KEYS — left in plaintext. Add it to the map before scrubbing.`
      );
      continue;
    }

    if (Object.keys(secrets).length === 0) {
      empty++;
      continue;
    }

    const { error: upErr } = await admin.rpc("upsert_integration_secret", {
      p_company_id: row.companyId,
      p_integration_id: row.id,
      p_secret: secrets as never
    });
    if (upErr) {
      console.error(
        `[ERROR] vault upsert failed for ${row.companyId}/${row.id}:`,
        upErr.message
      );
      continue;
    }
    vaulted++;
    console.log(
      `vaulted ${row.id} (${row.companyId}): ${Object.keys(secrets).join(", ")}`
    );
  }

  console.log(
    `\nBackfill complete: ${vaulted} vaulted, ${empty} without secrets, ${warned} unmapped-but-secret-looking (see warnings).`
  );
  if (warned > 0) {
    console.error(
      "\nOne or more integrations look secret-bearing but are not in SECRET_KEYS. Do NOT run the scrub migration until they are mapped."
    );
    process.exit(2);
  }
}

backfill()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
