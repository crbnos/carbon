// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { fetchAllFromTable } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { STRIPE_BYPASS_COMPANY_IDS, STRIPE_BYPASS_USER_IDS } from "@carbon/env";
import { chunkArray, isInternalEmail } from "@carbon/utils";
import type { Kysely } from "kysely";
import { getJobDatabaseClient } from "../../../db";
import {
  canSetReplicationRole,
  getCompanyTableCatalog
} from "../tasks/company-backup";
import {
  type CompanyCandidate,
  selectInactiveCompanies
} from "./inactive-companies";
import {
  purgeCompany,
  removeCompanyFiles,
  removeCompanySecrets
} from "./purge-company";

// What the weekly cleanup and the manual purge share: which companies are
// inactive, the check that one still is, and the delete itself.

type Logger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
};

export const splitIds = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

export type GroupOwner = {
  id: string;
  email: string;
  firstName: string | null;
};

/** The owner of each company group, for protection and for the warning email. */
export async function getGroupOwners(
  groupIds: string[]
): Promise<Map<string, GroupOwner>> {
  const serviceRole = getCarbonServiceRole();
  const ownerIds = new Map<string, string>();
  for (const ids of chunkArray([...new Set(groupIds)], 200)) {
    const { data, error } = await serviceRole
      .from("companyGroup")
      .select("id, ownerId")
      .in("id", ids);
    if (error)
      throw new Error(`Failed to load company groups: ${error.message}`);
    for (const group of data) {
      if (group.ownerId) ownerIds.set(group.id, group.ownerId);
    }
  }

  const users = new Map<string, GroupOwner>();
  for (const ids of chunkArray([...new Set(ownerIds.values())], 200)) {
    const { data, error } = await serviceRole
      .from("user")
      .select("id, email, firstName")
      .in("id", ids);
    if (error) throw new Error(`Failed to load group owners: ${error.message}`);
    for (const user of data) users.set(user.id, user);
  }

  const owners = new Map<string, GroupOwner>();
  for (const [groupId, ownerId] of ownerIds) {
    const owner = users.get(ownerId);
    if (owner) owners.set(groupId, owner);
  }
  return owners;
}

/**
 * Every inactive company, oldest first: no plan row anywhere in its group, older
 * than a week, not a bypass company, and not in a group owned by a Carbon or
 * bypass user (those have plan access with no row). `deletable` leaves out the
 * ones with no group owner: nobody can be told, so they are never deleted.
 * Null when a read failed; the caller does nothing rather than act on part of
 * the picture.
 */
export async function loadInactiveCompanies(logger: Logger): Promise<{
  now: number;
  candidates: number;
  inactive: CompanyCandidate[];
  deletable: CompanyCandidate[];
} | null> {
  const serviceRole = getCarbonServiceRole();
  // Paged: PostgREST caps a plain select at 1000 rows, and a plan row cut
  // off there would make a paying company look planless.
  const [companies, plans] = await Promise.all([
    fetchAllFromTable<CompanyCandidate>(
      serviceRole,
      "company",
      "id, name, createdAt, companyGroupId"
    ),
    fetchAllFromTable<{ id: string }>(serviceRole, "companyPlan", "id")
  ]);
  if (companies.error || plans.error) {
    logger.error("Failed to load companies for cleanup", {
      error: companies.error ?? plans.error
    });
    return null;
  }

  const selection = {
    companies: companies.data,
    planCompanyIds: new Set(plans.data.map((plan) => plan.id)),
    protectedCompanyIds: new Set(splitIds(STRIPE_BYPASS_COMPANY_IDS)),
    now: Date.now(),
    limit: Number.POSITIVE_INFINITY
  };
  // Owners are looked up only for the candidates' groups: a group owned by
  // a Carbon or bypass user has plan access without a plan row.
  const candidates = selectInactiveCompanies({
    ...selection,
    protectedGroupIds: new Set()
  });
  let owners: Map<string, GroupOwner>;
  try {
    owners = await getGroupOwners(
      candidates.flatMap((c) => (c.companyGroupId ? [c.companyGroupId] : []))
    );
  } catch (error) {
    logger.error("Failed to load company group owners", { error });
    return null;
  }
  const bypassUsers = new Set(splitIds(STRIPE_BYPASS_USER_IDS));
  const protectedGroupIds = new Set(
    [...owners]
      .filter(
        ([, owner]) => bypassUsers.has(owner.id) || isInternalEmail(owner.email)
      )
      .map(([groupId]) => groupId)
  );
  const inactive = selectInactiveCompanies({ ...selection, protectedGroupIds });
  return {
    now: selection.now,
    candidates: candidates.length,
    inactive,
    deletable: inactive.filter(
      (c) => c.companyGroupId !== null && owners.has(c.companyGroupId)
    )
  };
}

/**
 * Whether a company is still inactive, read in the purge's own transaction: it
 * exists and is not bypassed, no company in its group has a plan, and the group
 * has an owner who is not internal or a bypass user. Returns that owner's id, or
 * null when the company must be kept. The list it came from was built minutes
 * (or retries) earlier.
 */
export async function inactiveCompanyOwner(
  trx: Kysely<KyselyDatabase>,
  companyId: string
): Promise<string | null> {
  if (splitIds(STRIPE_BYPASS_COMPANY_IDS).includes(companyId)) return null;
  const company = await trx
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (!company) return null;

  const groupId = company.companyGroupId;
  const paying = await trx
    .selectFrom("companyPlan")
    .select("id")
    .where((eb) =>
      groupId === null
        ? eb("id", "=", companyId)
        : eb(
            "id",
            "in",
            eb
              .selectFrom("company")
              .select("company.id")
              .where("company.companyGroupId", "=", groupId)
          )
    )
    .limit(1)
    .executeTakeFirst();
  if (paying) return null;

  if (groupId === null) return null;
  const owner = await trx
    .selectFrom("companyGroup")
    .innerJoin("user", "user.id", "companyGroup.ownerId")
    .select(["user.id", "user.email"])
    .where("companyGroup.id", "=", groupId)
    .executeTakeFirst();
  if (
    !owner ||
    splitIds(STRIPE_BYPASS_USER_IDS).includes(owner.id) ||
    isInternalEmail(owner.email)
  ) {
    return null;
  }
  return owner.id;
}

type CleanupTarget = Pick<CompanyCandidate, "id" | "name" | "companyGroupId">;

/**
 * Delete each company with everything it owns: its storage bucket and legacy
 * files first, then its rows and Vault secrets in one transaction, then its
 * search index and audit log tables. `stillDue` is asked before the files go and
 * again inside the transaction, so a plan bought since the list was built stops
 * the delete. A company that cannot be deleted is logged and skipped; the table
 * catalog is read once for the whole list.
 */
export async function deleteCompanies(
  companies: CleanupTarget[],
  stillDue: (
    trx: Kysely<KyselyDatabase>,
    companyId: string
  ) => Promise<boolean>,
  logger: Logger
): Promise<{ id: string; deleted: boolean }[]> {
  const serviceRole = getCarbonServiceRole();
  const db = getJobDatabaseClient();
  const replica = await canSetReplicationRole(db);
  const catalog = await getCompanyTableCatalog(db);
  const results: { id: string; deleted: boolean }[] = [];

  for (const company of companies) {
    try {
      // Asked before the files go (they cannot be brought back) and again in
      // the transaction, which is what the delete itself rests on.
      if (!(await stillDue(db, company.id))) {
        logger.info("Company no longer due for deletion; kept", company);
        results.push({ id: company.id, deleted: false });
        continue;
      }
      // Outside the transaction: see `removeCompanyFiles`.
      const failures = await removeCompanyFiles(serviceRole, company.id);
      if (failures.length > 0) {
        for (const failure of failures) {
          logger.error("Failed to remove company {failurePart}", {
            failurePart: failure.part,
            ...company,
            error: failure.error
          });
        }
        results.push({ id: company.id, deleted: false });
        continue;
      }
      const purged = await db.transaction().execute(async (trx) => {
        if (!(await stillDue(trx, company.id))) return false;
        await purgeCompany(trx, catalog, company.id, { replica });
        await removeCompanySecrets(trx, company.id);
        return true;
      });
      if (!purged) {
        logger.info("Company no longer due for deletion; kept", company);
        results.push({ id: company.id, deleted: false });
        continue;
      }
    } catch (error) {
      logger.error("Failed to delete company", { ...company, replica, error });
      results.push({ id: company.id, deleted: false });
      continue;
    }

    // Per-company tables, named after the company and so outside the catalog.
    for (const fn of [
      "drop_company_search_index",
      "drop_audit_log_table"
    ] as const) {
      const { error } = await serviceRole.rpc(fn, { p_company_id: company.id });
      if (error) {
        logger.error("Failed to run {fn} for a deleted company", {
          fn,
          ...company,
          error
        });
      }
    }
    logger.info("Deleted company", company);
    results.push({ id: company.id, deleted: true });
  }
  return results;
}
