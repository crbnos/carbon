import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import type z from "zod";
import type { ExternalIntegrationMapping } from "./external-mapping";
import { createMappingService } from "./external-mapping";
import type {
  ProviderChartAccountSchema,
  UpsertAccountMappingSchema
} from "./models";

/**
 * Account-mapping service: thin wrappers over
 * ExternalIntegrationMappingService with entityType = "account", linking
 * Carbon GL accounts to the provider's chart of accounts.
 *
 * The Carbon side of a mapping is always account.id — never the account
 * number. account.number is only ever compared against the provider-side
 * code in matchAccountsByCode (external-code matching is the documented
 * legitimate use of numbers).
 */

export const ACCOUNT_MAPPING_ENTITY_TYPE = "account";

export type ProviderChartAccount = z.infer<typeof ProviderChartAccountSchema>;
export type UpsertAccountMappingInput = z.infer<
  typeof UpsertAccountMappingSchema
>;

type Db = Kysely<KyselyDatabase> | KyselyTx;

/**
 * An account mapping row joined with the Carbon account for display.
 * accountNumber/accountName are null when the mapped account no longer
 * exists (or has no number).
 */
export interface AccountMapping {
  id: string;
  accountId: string;
  accountNumber: string | null;
  accountName: string | null;
  externalId: string | null;
  externalCode: string | null;
  externalName: string | null;
  lastSyncedAt: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * A Carbon account referenced by an accountDefault column that has no mapping
 * for the integration yet. Automated (synced) postings always run through an
 * accountDefault account, so this is the complete set that needs mapping —
 * accounts seen only on historical/manual journal lines are intentionally
 * excluded (they never sync).
 */
export interface UnmappedPostingAccount {
  id: string;
  number: string | null;
  name: string;
}

/**
 * A leaf Carbon account offered for mapping in the full chart-of-accounts
 * view — every postable account, not just the accountDefault (required) set,
 * so a user can map an arbitrary account (e.g. an Expense account charged on a
 * PO G/L-account line) before or after it blocks a sync. class/accountType are
 * carried for grouping the list in the UI.
 */
export interface MappableChartAccount {
  id: string;
  number: string | null;
  name: string;
  class: string | null;
  accountType: string | null;
}

/**
 * A proposed (not written) match between a Carbon account and a provider
 * account. The UI confirms proposals and calls upsertAccountMapping.
 */
export interface AccountMatchProposal {
  accountId: string;
  accountNumber: string;
  accountName: string;
  externalId: string;
  externalCode: string;
  externalName: string | null;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function getCompanyGroupId(
  db: Db,
  companyId: string
): Promise<string | null> {
  const company = await db
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirst();

  return company?.companyGroupId ?? null;
}

/**
 * Compile-time totality guard for collectAccountDefaultAccountIds: every
 * column of the generated accountDefault Row type except the two
 * non-account columns must match the /Account(Id)?$/ suffix the collector
 * relies on. A future default-account column named differently fails
 * typecheck here instead of silently escaping the required mapping set.
 * (Spec Appendix: .ai/specs/2026-08-02-accounting-sync-engine-v3.md.)
 */
type AccountDefaultRow = Database["public"]["Tables"]["accountDefault"]["Row"];
type AccountDefaultNonAccountColumns = "companyId" | "updatedBy";
type AccountDefaultAccountColumns = Exclude<
  keyof AccountDefaultRow,
  AccountDefaultNonAccountColumns
>;
type AssertAccountSuffix<T extends `${string}Account` | `${string}AccountId`> =
  T;
// biome-ignore lint/correctness/noUnusedVariables: compile-time assertion
type _accountDefaultColumnsAllMatchCollectorPattern =
  AssertAccountSuffix<AccountDefaultAccountColumns>;

/**
 * Every account reference on the accountDefault row lives in a column
 * ending in "Account" (or "AccountId" for the deferred-tax pair), and since
 * the chart-of-accounts reset every one of them stores an account.id FK.
 * Collects the distinct non-empty ids; robust to future column additions.
 */
export function collectAccountDefaultAccountIds(
  row: Record<string, unknown> | null | undefined
): string[] {
  if (!row) return [];

  const ids = new Set<string>();
  for (const [column, value] of Object.entries(row)) {
    if (!/Account(Id)?$/.test(column)) continue;
    if (typeof value === "string" && value.length > 0) ids.add(value);
  }

  return [...ids];
}

/**
 * Shape the display-only provider fields into mapping metadata. Returns
 * undefined when neither field is provided so the mapping stores null.
 */
export function buildAccountMappingMetadata(args: {
  externalCode?: string;
  externalName?: string;
}): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  if (args.externalCode) metadata.externalCode = args.externalCode;
  if (args.externalName) metadata.externalName = args.externalName;

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * Safely read the display fields back out of stored mapping metadata.
 */
export function getAccountMappingDisplayMetadata(metadata: unknown): {
  externalCode: string | null;
  externalName: string | null;
} {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return { externalCode: null, externalName: null };
  }

  const { externalCode, externalName } = metadata as Record<string, unknown>;
  return {
    externalCode: typeof externalCode === "string" ? externalCode : null,
    externalName: typeof externalName === "string" ? externalName : null
  };
}

/**
 * Propose matches where Carbon account.number equals the provider account
 * code exactly (no trimming, no case folding). Ambiguous candidates are
 * skipped: duplicate Carbon numbers, duplicate provider codes, accounts
 * already mapped, and provider accounts already used by a mapping.
 */
export function proposeAccountMatchesByCode(args: {
  accounts: Array<{ id: string; number: string | null; name: string }>;
  providerAccounts: ProviderChartAccount[];
  mappedAccountIds?: Iterable<string>;
  mappedExternalIds?: Iterable<string>;
}): AccountMatchProposal[] {
  const mappedAccountIds = new Set(args.mappedAccountIds ?? []);
  const mappedExternalIds = new Set(args.mappedExternalIds ?? []);

  const providerByCode = new Map<string, ProviderChartAccount>();
  const ambiguousCodes = new Set<string>();
  for (const providerAccount of args.providerAccounts) {
    const code = providerAccount.code;
    if (!code) continue;
    if (providerByCode.has(code)) {
      ambiguousCodes.add(code);
      continue;
    }
    providerByCode.set(code, providerAccount);
  }

  const numberCounts = new Map<string, number>();
  for (const account of args.accounts) {
    if (!account.number) continue;
    numberCounts.set(
      account.number,
      (numberCounts.get(account.number) ?? 0) + 1
    );
  }

  const proposals: AccountMatchProposal[] = [];
  for (const account of args.accounts) {
    if (!account.number) continue;
    if (mappedAccountIds.has(account.id)) continue;
    if ((numberCounts.get(account.number) ?? 0) > 1) continue;
    if (ambiguousCodes.has(account.number)) continue;

    const providerAccount = providerByCode.get(account.number);
    if (!providerAccount) continue;
    if (mappedExternalIds.has(providerAccount.id)) continue;

    proposals.push({
      accountId: account.id,
      accountNumber: account.number,
      accountName: account.name,
      externalId: providerAccount.id,
      externalCode: providerAccount.code ?? account.number,
      externalName: providerAccount.name ?? null
    });
  }

  return proposals;
}

/**
 * Get all account mappings for an integration, joined with the Carbon
 * account (id, number, name) for display, ordered by account number.
 */
export async function getAccountMappings(
  db: Db,
  args: { companyId: string; integration: string }
): Promise<{ data: AccountMapping[] | null; error: string | null }> {
  try {
    const rows = await db
      .selectFrom("externalIntegrationMapping as m")
      .leftJoin("account as a", "a.id", "m.entityId")
      .select([
        "m.id",
        "m.entityId as accountId",
        "m.externalId",
        "m.metadata",
        "m.lastSyncedAt",
        "a.number as accountNumber",
        "a.name as accountName"
      ])
      .where("m.entityType", "=", ACCOUNT_MAPPING_ENTITY_TYPE)
      .where("m.integration", "=", args.integration)
      .where("m.companyId", "=", args.companyId)
      .orderBy("accountNumber", "asc")
      .execute();

    const data = rows.map((row) => {
      const display = getAccountMappingDisplayMetadata(row.metadata);
      return {
        id: row.id,
        accountId: row.accountId,
        accountNumber: row.accountNumber ?? null,
        accountName: row.accountName ?? null,
        externalId: row.externalId ?? null,
        externalCode: display.externalCode,
        externalName: display.externalName,
        lastSyncedAt: (row.lastSyncedAt as string | null) ?? null,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null
      };
    });

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}

/**
 * Carbon account.id → provider account CODE from the account-mapping rows
 * (entityType "account"). Providers that address accounts by code (Xero
 * `AccountCode`, Rillet `account_code`) resolve through the mapping's stored
 * `externalCode`; mappings without a code count as unmapped and are omitted.
 * Shared by the Xero bill/invoice syncers (mirrors the journal syncer's
 * `getAccountCodesById` and Rillet's `loadRilletAccountCodesById`).
 */
export async function loadAccountCodesById(
  db: Db,
  args: { companyId: string; integration: string }
): Promise<Map<string, string>> {
  const mappings = await getAccountMappings(db, {
    companyId: args.companyId,
    integration: args.integration
  });

  if (mappings.error) {
    throw new Error(`Failed to load account mappings: ${mappings.error}`);
  }

  const codesById = new Map<string, string>();
  for (const mapping of mappings.data ?? []) {
    if (mapping.externalCode) {
      codesById.set(mapping.accountId, mapping.externalCode);
    }
  }
  return codesById;
}

/**
 * Upsert an account mapping (Carbon account.id → provider account id).
 * externalCode/externalName go into the mapping metadata for display.
 * Consolidation is a legitimate many-to-one: several Carbon detail
 * accounts may map to a single provider account, so duplicate external
 * ids are allowed.
 */
export async function upsertAccountMapping(
  db: Db,
  args: UpsertAccountMappingInput
): Promise<{ data: ExternalIntegrationMapping | null; error: string | null }> {
  try {
    const mappingService = createMappingService(db, args.companyId);

    await mappingService.link(
      ACCOUNT_MAPPING_ENTITY_TYPE,
      args.accountId,
      args.integration,
      args.externalId,
      {
        metadata: buildAccountMappingMetadata(args),
        createdBy: args.userId,
        allowDuplicateExternalId: true
      }
    );

    const data = await mappingService.getByEntity(
      ACCOUNT_MAPPING_ENTITY_TYPE,
      args.accountId,
      args.integration
    );

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}

/**
 * The Carbon account ids referenced by the company's accountDefault row —
 * the complete set of accounts automated postings run through, and the only
 * accounts the mapping tab manages. Loads the row and collects every
 * *Account / *AccountId FK on it.
 */
export async function loadAccountDefaultAccountIds(
  db: Db,
  companyId: string
): Promise<string[]> {
  const row = await db
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "=", companyId)
    .executeTakeFirst();

  return collectAccountDefaultAccountIds(row ? { ...row } : null);
}

/**
 * Carbon accounts that automated postings hit but that have no mapping yet:
 * the accounts referenced by accountDefault columns, minus already-mapped
 * ids, minus group headers. accountDefault is the whole mappable set —
 * every synced transaction posts through one of these accounts — so accounts
 * seen only on historical/manual journal lines are intentionally excluded.
 */
export async function getUnmappedPostingAccounts(
  db: Db,
  args: { companyId: string; integration: string }
): Promise<{ data: UnmappedPostingAccount[] | null; error: string | null }> {
  try {
    const accountDefaultIds = await loadAccountDefaultAccountIds(
      db,
      args.companyId
    );
    if (accountDefaultIds.length === 0) {
      return { data: [], error: null };
    }

    const mappedRows = await db
      .selectFrom("externalIntegrationMapping")
      .select("entityId")
      .where("entityType", "=", ACCOUNT_MAPPING_ENTITY_TYPE)
      .where("integration", "=", args.integration)
      .where("companyId", "=", args.companyId)
      .execute();
    const mapped = new Set(mappedRows.map((row) => row.entityId));

    const unmappedIds = accountDefaultIds.filter((id) => !mapped.has(id));
    if (unmappedIds.length === 0) {
      return { data: [], error: null };
    }

    const companyGroupId = await getCompanyGroupId(db, args.companyId);
    if (!companyGroupId) {
      return {
        data: null,
        error: `No company group found for company ${args.companyId}`
      };
    }

    const accounts = await db
      .selectFrom("account")
      .select(["id", "number", "name"])
      .where("companyGroupId", "=", companyGroupId)
      .where("isGroup", "=", false)
      .where("id", "in", unmappedIds)
      .orderBy("number", "asc")
      .execute();

    return { data: accounts, error: null };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}

/**
 * Every postable (leaf) Carbon account in the company's chart of accounts —
 * the full mappable set for the account-mapping UI's "All accounts" view.
 * Unlike getUnmappedPostingAccounts this is NOT scoped to accountDefault: any
 * account a transaction can hit (e.g. an Expense account on a PO G/L-account
 * line) must be mappable. Group headers are excluded.
 */
export async function getFullChartMappableAccounts(
  db: Db,
  args: { companyId: string }
): Promise<{ data: MappableChartAccount[] | null; error: string | null }> {
  try {
    const companyGroupId = await getCompanyGroupId(db, args.companyId);
    if (!companyGroupId) {
      return {
        data: null,
        error: `No company group found for company ${args.companyId}`
      };
    }

    const accounts = await db
      .selectFrom("account")
      .select(["id", "number", "name", "class", "accountType"])
      .where("companyGroupId", "=", companyGroupId)
      .where("isGroup", "=", false)
      .where("active", "=", true)
      .orderBy("number", "asc")
      .execute();

    return {
      data: accounts.map((account) => ({
        id: account.id,
        number: account.number ?? null,
        name: account.name,
        class: (account.class as string | null) ?? null,
        accountType: (account.accountType as string | null) ?? null
      })),
      error: null
    };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}

/**
 * Propose (not write) exact matches between Carbon account numbers and the
 * provider's chart-of-accounts codes across the FULL chart of accounts — every
 * active, non-group, numbered account without an existing mapping (widened from
 * the accountDefault-only set so an arbitrary account can be matched too). The
 * proposer already excludes already-mapped Carbon ids and already-used external
 * ids; the UI confirms each proposal and calls upsertAccountMapping.
 */
export async function matchAccountsByCode(
  db: Db,
  args: {
    companyId: string;
    integration: string;
    providerAccounts: ProviderChartAccount[];
  }
): Promise<{ data: AccountMatchProposal[] | null; error: string | null }> {
  try {
    const companyGroupId = await getCompanyGroupId(db, args.companyId);
    if (!companyGroupId) {
      return {
        data: null,
        error: `No company group found for company ${args.companyId}`
      };
    }

    // The full chart of accounts is matchable by code, not just the
    // accountDefault set — so an arbitrary account can be proposed a match too.
    const accounts = await db
      .selectFrom("account")
      .select(["id", "number", "name"])
      .where("companyGroupId", "=", companyGroupId)
      .where("isGroup", "=", false)
      .where("active", "=", true)
      .where("number", "is not", null)
      .execute();

    const mappings = await db
      .selectFrom("externalIntegrationMapping")
      .select(["entityId", "externalId"])
      .where("entityType", "=", ACCOUNT_MAPPING_ENTITY_TYPE)
      .where("integration", "=", args.integration)
      .where("companyId", "=", args.companyId)
      .execute();

    const data = proposeAccountMatchesByCode({
      accounts,
      providerAccounts: args.providerAccounts,
      mappedAccountIds: mappings.map((mapping) => mapping.entityId),
      mappedExternalIds: mappings
        .map((mapping) => mapping.externalId)
        .filter((externalId): externalId is string => externalId !== null)
    });

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}
