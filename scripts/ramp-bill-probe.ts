// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Report what Ramp stored for ONE pushed bill, next to what Carbon would code it
 * with — to tell "Carbon sent the wrong ids" from "Ramp did not keep them".
 *
 * Written for push-only installs, where the seat-holder (Rillet) owns both the
 * chart of accounts and the accounting vendors, and a bill arrived in Ramp with
 * neither its GL categories nor its Accounting Merchant selected.
 *
 * Prints, in order:
 * 1. Carbon's side — the draft-bill mapping (when it was pushed), and for every
 *    account on the posted journal the seat-holder's id Carbon codes with.
 * 2. `GET /bills/drafts/{id}` — the vendor and each line's stored
 *    `accounting_field_selections`. A line with no GL selection here means Ramp
 *    did not keep (or never got) the coding.
 * 3. `GET /vendors/{id}` — the Ramp vendor's `accounting_vendor_remote_id`, the
 *    link that fills the bill's Accounting Merchant.
 * 4. `GET /accounting/accounts` — whether Ramp knows each seat-holder account id
 *    at all (a miss means the ids differ between Carbon's mapping and Ramp).
 *
 * Read-only. Every Ramp call is a GET; nothing in Carbon is written.
 *
 * Usage:
 *   pnpm exec tsx scripts/ramp-bill-probe.ts <companyId> <purchaseInvoiceId>
 */

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getRampIntegration } from "@carbon/ee/ramp.server";

const [companyId, purchaseInvoiceId] = process.argv.slice(2);

if (!companyId || !purchaseInvoiceId) {
  console.error(
    "usage: ramp-bill-probe.ts <companyId> <purchaseInvoiceId>"
  );
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
  const { client } = integration;

  console.log("=== Carbon ===");
  const invoice = await serviceRole
    .from("purchaseInvoice")
    .select("invoiceId, supplierId, postingDate")
    .eq("companyId", companyId)
    .eq("id", purchaseInvoiceId)
    .single();
  console.log(JSON.stringify(invoice.data ?? invoice.error, null, 2));

  const mappings = await serviceRole
    .from("externalIntegrationMapping")
    .select("entityType, entityId, integration, externalId, metadata, createdAt")
    .eq("companyId", companyId)
    .in("entityId", [purchaseInvoiceId, invoice.data?.supplierId ?? ""]);
  console.log(JSON.stringify(mappings.data ?? mappings.error, null, 2));

  const draftId = mappings.data?.find(
    (m) => m.entityType === "bill" && m.integration === "ramp"
  )?.externalId;
  const rampVendorId = mappings.data?.find(
    (m) => m.entityType === "vendor" && m.integration === "ramp"
  )?.externalId;

  const lines = await serviceRole
    .from("journalLine")
    .select("accountId, journal!inner(sourceType, status)")
    .eq("companyId", companyId)
    .eq("documentType", "Invoice")
    .eq("documentId", purchaseInvoiceId)
    .eq("journal.sourceType", "Purchase Invoice")
    .eq("journal.status", "Posted");
  const accountIds = [
    ...new Set((lines.data ?? []).map((line) => line.accountId).filter(Boolean))
  ] as string[];
  const accountMappings = await serviceRole
    .from("externalIntegrationMapping")
    .select("entityId, integration, externalId, metadata")
    .eq("companyId", companyId)
    .eq("entityType", "account")
    .in("entityId", accountIds);
  console.log("\naccount mappings for the posted journal:");
  console.log(JSON.stringify(accountMappings.data ?? accountMappings.error, null, 2));

  console.log("\n=== Ramp ===");
  if (draftId) {
    await attempt(`GET /bills/drafts/${draftId}`, () =>
      client.request("GET", `/developer/v1/bills/drafts/${draftId}`)
    );
  } else {
    console.log("\nno ramp bill mapping — the invoice was never pushed");
  }

  if (rampVendorId) {
    await attempt(`GET /vendors/${rampVendorId}`, () =>
      client.request("GET", `/developer/v1/vendors/${rampVendorId}`)
    );
  }

  const wanted = new Set(
    (accountMappings.data ?? [])
      .filter((m) => m.integration !== "ramp")
      .map((m) => m.externalId)
  );
  const known = await attempt("GET /accounting/accounts (matches only)", async () => {
    const found: unknown[] = [];
    let path: string | null = "/developer/v1/accounting/accounts?page_size=100";
    while (path) {
      const page: { data?: Array<Record<string, unknown>>; page?: { next?: string | null } } =
        await client.request("GET", path);
      for (const account of page.data ?? []) {
        if (wanted.has(String(account.id)) || wanted.has(String(account.remote_id)) || wanted.has(String(account.external_id))) {
          found.push(account);
        }
      }
      const next = page.page?.next;
      path = next ? `${new URL(next).pathname}${new URL(next).search}` : null;
    }
    return found;
  });
  if (known) {
    console.log(
      `\n${(known as unknown[]).length} of ${wanted.size} seat-holder account ids are known to Ramp`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
