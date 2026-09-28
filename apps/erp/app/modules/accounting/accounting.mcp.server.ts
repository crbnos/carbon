import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { requireToolPermission } from "~/modules/shared/tool-permission.server";
import { getDatabaseClient } from "~/services/database.server";
import { toToolResult, validationFailure } from "~/utils/command-result";
import {
  fixedAssetDisposalValidator,
  fixedAssetRegisterValidator
} from "./accounting.models";
import {
  createDepreciationRun as createDepreciationRunCommand,
  disposeFixedAsset as disposeFixedAssetCommand,
  postDepreciationRun as postDepreciationRunCommand,
  registerFixedAsset as registerFixedAssetCommand
} from "./accounting.server";

// MCP/API tools for the fixed-asset postings. Each wraps the command its ERP
// route calls (`accounting.server.ts`), so the tool and the screen run the same
// derivation and the same Kysely transaction. Server-only: never re-exported by
// the `~/modules/accounting` barrel; `registry.server.ts` spreads these exports
// into the `accounting` namespace and `scripts/generate-mcp.ts` publishes them.
//
// The postings write through Kysely (no RLS), so each of those tools re-applies
// its route's `requirePermissions({ update: "accounting" })` through
// `requireToolPermission` first. `createDepreciationRun` writes through the
// caller's client only, so RLS bounds it like the route.

const ACCOUNTING_UPDATE = { update: "accounting" } as const;

/**
 * Register a Draft fixed asset (Draft → Active), as the Register action on the
 * asset does. `fixedAssetId` is the asset's id (not its FA… readable id). With
 * accounting enabled this posts the acquisition journal (Dr asset / Cr retained
 * earnings, plus the opening accumulated depreciation when registered
 * mid-life); otherwise it only flips the status. Refused unless the asset is
 * Draft.
 */
export async function registerFixedAsset(
  client: SupabaseClient<Database>,
  companyId: string,
  companyGroupId: string,
  userId: string,
  args: z.infer<typeof fixedAssetRegisterValidator> & { fixedAssetId: string }
) {
  await requireToolPermission(
    companyId,
    userId,
    ACCOUNTING_UPDATE,
    "register fixed assets"
  );
  const parsed = fixedAssetRegisterValidator.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }
  return toToolResult(
    await registerFixedAssetCommand(client, getDatabaseClient(), {
      fixedAssetId: args.fixedAssetId,
      registration: parsed.data,
      companyId,
      companyGroupId,
      userId
    })
  );
}

/**
 * Scrap an Active or Fully Depreciated fixed asset (→ Disposed), as the Dispose
 * action on the asset does: posts the disposal journal (clears accumulated
 * depreciation, books the net book value as a loss, removes the asset at cost)
 * and records the disposal. `fixedAssetId` is the asset's id. Selling an asset
 * goes through a sales order and invoice instead.
 */
export async function disposeFixedAsset(
  client: SupabaseClient<Database>,
  companyId: string,
  companyGroupId: string,
  userId: string,
  args: z.infer<typeof fixedAssetDisposalValidator> & { fixedAssetId: string }
) {
  await requireToolPermission(
    companyId,
    userId,
    ACCOUNTING_UPDATE,
    "dispose of fixed assets"
  );
  const parsed = fixedAssetDisposalValidator.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }
  return toToolResult(
    await disposeFixedAssetCommand(client, getDatabaseClient(), {
      fixedAssetId: args.fixedAssetId,
      disposalDate: parsed.data.disposalDate,
      companyId,
      companyGroupId,
      userId
    })
  );
}

/**
 * Post a Draft depreciation run (→ Posted), as the Post action on the run
 * does: one depreciation journal per line on the run's period end, each asset's
 * accumulated depreciation advanced (Fully Depreciated at residual value), and
 * the deferred-tax entry when tax depreciation is enabled.
 */
export async function postDepreciationRun(
  client: SupabaseClient<Database>,
  companyId: string,
  companyGroupId: string,
  userId: string,
  args: { depreciationRunId: string }
) {
  await requireToolPermission(
    companyId,
    userId,
    ACCOUNTING_UPDATE,
    "post depreciation runs"
  );
  return toToolResult(
    await postDepreciationRunCommand(client, getDatabaseClient(), {
      depreciationRunId: args.depreciationRunId,
      companyId,
      companyGroupId,
      userId
    })
  );
}

/**
 * Create the next period's Draft depreciation run, as New Run on the
 * depreciation runs screen does: the month after the latest run, refused when
 * a run already exists for it, with one line per Active asset computed from
 * the last posted run and the period's usage logs. Post it with
 * `accounting_postDepreciationRun`.
 */
export async function createDepreciationRun(
  client: SupabaseClient<Database>,
  companyId: string,
  companyGroupId: string,
  userId: string
) {
  return toToolResult(
    await createDepreciationRunCommand(client, {
      companyId,
      companyGroupId,
      userId
    })
  );
}
