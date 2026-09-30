/**
 * Report what Ramp says about its accounting connection, and what the stored
 * install claims.
 *
 * Written for the push-only verification (Task 10): the whole mode rests on
 * "Carbon never claims Ramp's accounting seat", and the only trustworthy witness
 * to that is Ramp itself. Reading Carbon's own metadata proves only what Carbon
 * intended.
 *
 * It also answers the standing OPEN QUESTION empirically — whether a token
 * granted WITHOUT `accounting:write` may call
 * `GET /developer/v1/accounting/all-connections`. Run it against a push-only
 * install and read the `all-connections` line: a 403 answers "no".
 *
 * Read-only. Every call is a GET.
 *
 * Usage:
 *   pnpm exec tsx scripts/ramp-connection-probe.ts <companyId>
 */

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getRampIntegration } from "@carbon/ee/ramp.server";

const companyId = process.argv[2];

if (!companyId) {
  console.error("usage: ramp-connection-probe.ts <companyId>");
  process.exit(1);
}

async function attempt<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  try {
    const result = await fn();
    console.log(`\n[ok] ${label}`);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    // A refusal is a RESULT here, not a failure of the probe — "push-only cannot
    // read this" is exactly what we are trying to find out.
    console.log(`\n[refused] ${label}`);
    console.log(`  ${(error as Error).message}`);
    return undefined;
  }
}

async function main() {
  const serviceRole = getCarbonServiceRole();
  const integration = await getRampIntegration(serviceRole, companyId);

  if (!integration) {
    console.log(`No active Ramp integration for company ${companyId}`);
    return;
  }

  const { client, metadata } = integration;

  console.log("=== what Carbon stored ===");
  console.log(
    JSON.stringify(
      {
        syncMode: metadata.syncMode ?? "(unset — resolves to provider)",
        connectionId: metadata.connectionId ?? null,
        accountingConnectionProvider:
          metadata.accountingConnectionProvider ?? null,
        webhookId: metadata.webhookId ?? null,
        cardLiabilityAccountId: metadata.cardLiabilityAccountId ?? null,
        grantedScopes: metadata.grantedScopes ?? null,
        hasAccountingWrite: Array.isArray(metadata.grantedScopes)
          ? metadata.grantedScopes.includes("accounting:write")
          : "(not recorded)"
      },
      null,
      2
    )
  );

  console.log("\n=== what Ramp says ===");
  // `all-connections` is the only connection READ the client has (there is no
  // GET /accounting/connection wrapper — only POST and DELETE).
  await attempt("GET /accounting/all-connections", () =>
    client.getAccountingConnections()
  );
  await attempt("GET /business (liveness)", () => client.getBusiness());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
