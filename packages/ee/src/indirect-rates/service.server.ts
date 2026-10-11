// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Server-only indirect rates AUTHORING and readers (Government Contracting 5b).
//
// The commercial LOCK: every authoring function and every run calls
// `requireEntitlement(..., "GOVERNMENT_CONTRACTING")` before it touches the
// database, so the gate sits on the commercial side of the license boundary.
// The readers read community tables and need no entitlement check.
//
// Reached only through `@carbon/ee/indirect-rates.server` (`./server.ts`).
// Plan: .ai/plans/2026-10-09-government-contracting-phase-5b.md (Task 7, B2, B12)

import type { Database } from "@carbon/database";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { requireEntitlement } from "../entitlements.server";
import type {
  burdenSettingsValidator,
  contractRateCeilingValidator,
  IndirectRateType,
  indirectPoolAccountValidator,
  indirectPoolValidator
} from "./models";

type Client = SupabaseClient<Database>;

const FEATURE = "GOVERNMENT_CONTRACTING" as const;

export const INDIRECT_POOL_IN_USE =
  "This pool has rates or burden. Deactivate it instead.";
export const INDIRECT_POOL_BASE_PROJECT_ACCOUNT =
  "Project accounts hold mixed cost. The base comes from the project ledger.";
export const INDIRECT_RATE_ACTUAL_REFUSED =
  "Actual rates come from the rate run. Enter a Provisional, Target or Final rate.";

/** A refusal in the `{ data, error }` shape the callers already read. */
function refuse(message: string) {
  return { data: null, error: { message } };
}

// -----------------------------------------------------------------------------
// Pools
// -----------------------------------------------------------------------------

export async function upsertIndirectPool(
  client: Client,
  input: z.infer<typeof indirectPoolValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId, id, ...fields } = input;
  await requireEntitlement(client, companyId, FEATURE);

  const values = {
    name: fields.name,
    poolType: fields.poolType,
    sequence: fields.sequence,
    baseType: fields.baseType,
    appliedAccountId: fields.appliedAccountId || null,
    appliesToProjects: fields.appliesToProjects,
    offsetAbsorbedOverhead: fields.offsetAbsorbedOverhead,
    active: fields.active
  };

  if (id) {
    return client
      .from("indirectPool")
      .update({
        ...values,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  return client
    .from("indirectPool")
    .insert({ ...values, companyId, createdBy: userId })
    .select("id")
    .single();
}

export async function deleteIndirectPool(
  client: Client,
  { id, companyId }: { id: string; companyId: string }
) {
  await requireEntitlement(client, companyId, FEATURE);

  const [rates, burden] = await Promise.all([
    client
      .from("indirectRate")
      .select("id", { count: "exact", head: true })
      .eq("indirectPoolId", id)
      .eq("companyId", companyId),
    client
      .from("projectLedger")
      .select("id", { count: "exact", head: true })
      .eq("indirectPoolId", id)
      .eq("companyId", companyId)
  ]);
  if (rates.error) return refuse(rates.error.message);
  if (burden.error) return refuse(burden.error.message);
  if ((rates.count ?? 0) > 0 || (burden.count ?? 0) > 0) {
    return refuse(INDIRECT_POOL_IN_USE);
  }

  return client
    .from("indirectPool")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// -----------------------------------------------------------------------------
// Pool accounts
// -----------------------------------------------------------------------------

export async function upsertIndirectPoolAccount(
  client: Client,
  input: z.infer<typeof indirectPoolAccountValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId, id, ...fields } = input;
  await requireEntitlement(client, companyId, FEATURE);

  // B2: the project accounts mix every project's labor and material, so a
  // pool base takes project cost from the project ledger instead.
  if (fields.role === "Base") {
    const defaults = await client
      .from("accountDefault")
      .select("projectExpenseAccount, projectWorkInProgressAccount")
      .eq("companyId", companyId)
      .maybeSingle();
    if (defaults.error) return refuse(defaults.error.message);
    const projectAccounts = [
      defaults.data?.projectExpenseAccount,
      defaults.data?.projectWorkInProgressAccount
    ].filter(Boolean);
    if (projectAccounts.includes(fields.accountId)) {
      return refuse(INDIRECT_POOL_BASE_PROJECT_ACCOUNT);
    }
  }

  const values = {
    indirectPoolId: fields.indirectPoolId,
    accountId: fields.accountId,
    dimensionId: fields.dimensionId || null,
    dimensionValueId: fields.dimensionValueId || null,
    role: fields.role
  };

  if (id) {
    return client
      .from("indirectPoolAccount")
      .update({
        ...values,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  return client
    .from("indirectPoolAccount")
    .insert({ ...values, companyId, createdBy: userId })
    .select("id")
    .single();
}

export async function deleteIndirectPoolAccount(
  client: Client,
  { id, companyId }: { id: string; companyId: string }
) {
  await requireEntitlement(client, companyId, FEATURE);
  return client
    .from("indirectPoolAccount")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// -----------------------------------------------------------------------------
// Rates
// -----------------------------------------------------------------------------

export type IndirectRateEntry = {
  companyId: string;
  userId: string;
  indirectPoolId: string;
  fiscalYear: number;
  fromPeriod: number;
  rateType: IndirectRateType;
  rate: number;
};

/** B12: a rate "from period N" is one row per period N to 12, period rate = YTD rate. */
export function indirectRateRows(entry: IndirectRateEntry) {
  const timestamp = datetime.timestamp();
  const rows = [];
  for (
    let periodNumber = entry.fromPeriod;
    periodNumber <= 12;
    periodNumber++
  ) {
    rows.push({
      companyId: entry.companyId,
      indirectPoolId: entry.indirectPoolId,
      fiscalYear: entry.fiscalYear,
      periodNumber,
      rateType: entry.rateType,
      periodRate: entry.rate,
      ytdRate: entry.rate,
      createdBy: entry.userId,
      updatedBy: entry.userId,
      updatedAt: timestamp
    });
  }
  return rows;
}

export async function setIndirectRate(
  client: Client,
  entry: IndirectRateEntry
) {
  await requireEntitlement(client, entry.companyId, FEATURE);
  if (entry.rateType === "Actual") return refuse(INDIRECT_RATE_ACTUAL_REFUSED);

  return client
    .from("indirectRate")
    .upsert(indirectRateRows(entry), {
      onConflict: "indirectPoolId,fiscalYear,periodNumber,rateType,companyId"
    })
    .select("id");
}

// -----------------------------------------------------------------------------
// Contract rate ceilings
// -----------------------------------------------------------------------------

export async function upsertContractRateCeiling(
  client: Client,
  input: z.infer<typeof contractRateCeilingValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId, id, ...fields } = input;
  await requireEntitlement(client, companyId, FEATURE);

  if (id) {
    return client
      .from("customerContractRateCeiling")
      .update({
        ...fields,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  return client
    .from("customerContractRateCeiling")
    .insert({ ...fields, companyId, createdBy: userId })
    .select("id")
    .single();
}

export async function deleteContractRateCeiling(
  client: Client,
  { id, companyId }: { id: string; companyId: string }
) {
  await requireEntitlement(client, companyId, FEATURE);
  return client
    .from("customerContractRateCeiling")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// -----------------------------------------------------------------------------
// Burden settings (B9)
// -----------------------------------------------------------------------------

export async function updateBurdenSettings(
  client: Client,
  input: z.infer<typeof burdenSettingsValidator> & {
    companyId: string;
    userId: string;
  }
) {
  // `companySettings` has no audit columns, so `userId` is not written.
  await requireEntitlement(client, input.companyId, FEATURE);
  return client
    .from("companySettings")
    .update({
      burdenRateType: input.burdenRateType,
      postAppliedBurden: input.postAppliedBurden
    })
    .eq("id", input.companyId)
    .select("id")
    .single();
}

// -----------------------------------------------------------------------------
// Readers (community tables, no entitlement check)
// -----------------------------------------------------------------------------

export async function getIndirectPools(client: Client, companyId: string) {
  return client
    .from("indirectPool")
    .select("*")
    .eq("companyId", companyId)
    .order("sequence");
}

export async function getIndirectPool(
  client: Client,
  id: string,
  companyId: string
) {
  const [pool, accounts] = await Promise.all([
    client
      .from("indirectPool")
      .select("*")
      .eq("id", id)
      .eq("companyId", companyId)
      .single(),
    client
      .from("indirectPoolAccount")
      .select("*, account(number, name), dimension(name)")
      .eq("indirectPoolId", id)
      .eq("companyId", companyId)
      .order("role")
  ]);
  if (pool.error) return { data: null, error: pool.error };
  if (accounts.error) return { data: null, error: accounts.error };
  return { data: { ...pool.data, accounts: accounts.data }, error: null };
}

export async function getIndirectRates(
  client: Client,
  { companyId, fiscalYear }: { companyId: string; fiscalYear: number }
) {
  return client
    .from("indirectRate")
    .select("*")
    .eq("companyId", companyId)
    .eq("fiscalYear", fiscalYear)
    .order("indirectPoolId")
    .order("periodNumber")
    .order("rateType");
}

export async function getIndirectRateRuns(client: Client, companyId: string) {
  return client
    .from("indirectRateRun")
    .select("*, accountingPeriod(startDate)")
    .eq("companyId", companyId)
    .order("fiscalYear", { ascending: false })
    .order("periodNumber", { ascending: false });
}

export async function getIndirectExpenseStatement(
  client: Client,
  {
    companyId,
    fiscalYear,
    periodNumber
  }: { companyId: string; fiscalYear: number; periodNumber: number }
) {
  // The statement has two foreign keys to `indirectPool`, so the pool names
  // come from one pool read rather than an ambiguous embed.
  const [lines, pools] = await Promise.all([
    client
      .from("indirectExpenseStatement")
      .select("*, account(number, name)")
      .eq("companyId", companyId)
      .eq("fiscalYear", fiscalYear)
      .eq("periodNumber", periodNumber)
      .order("indirectPoolId")
      .order("lineType"),
    client.from("indirectPool").select("id, name").eq("companyId", companyId)
  ]);
  if (lines.error) return { data: null, error: lines.error };
  if (pools.error) return { data: null, error: pools.error };
  const poolName = new Map(pools.data.map((p) => [p.id, p.name]));
  return {
    data: lines.data.map((line) => ({
      ...line,
      poolName: poolName.get(line.indirectPoolId) ?? null,
      sourcePoolName: line.sourcePoolId
        ? (poolName.get(line.sourcePoolId) ?? null)
        : null
    })),
    error: null
  };
}

export async function getContractRateCeilings(
  client: Client,
  {
    companyId,
    customerContractLineId
  }: { companyId: string; customerContractLineId: string }
) {
  return client
    .from("customerContractRateCeiling")
    .select("*, indirectPool(name, sequence)")
    .eq("companyId", companyId)
    .eq("customerContractLineId", customerContractLineId);
}

export async function getBurdenSettings(client: Client, companyId: string) {
  return client
    .from("companySettings")
    .select("burdenRateType, postAppliedBurden")
    .eq("id", companyId)
    .single();
}
