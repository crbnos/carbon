// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * What SCIM changes about a person's access in a company: membership, employee
 * type and the grants that type gives. Only this company's slice of the global
 * `userPermission` row ever moves.
 */

import type { KyselyDatabase } from "@carbon/database/client";
import { type Kysely, sql, type Transaction } from "kysely";
import {
  pickEmployeeType,
  replaceCompanyGrants,
  typeGrantsFor
} from "./mapping";
import {
  type Ctx,
  clearPermissionCaches,
  type Db,
  hasMappedGroup,
  labelAsScim,
  type ScimConnectionRow,
  ScimRefusal
} from "./shared.server";

const WRITE_BATCH = 500;

/** The claim keys each employee type grants in this company. */
async function readTypeGrants(
  db: Db,
  companyId: string,
  employeeTypeIds: string[]
): Promise<Map<string, string[]>> {
  const grants = new Map<string, string[]>(
    employeeTypeIds.map((id) => [id, []])
  );
  if (employeeTypeIds.length === 0) return grants;

  const rows = await db
    .selectFrom("employeeTypePermission as p")
    .innerJoin("employeeType as t", "t.id", "p.employeeTypeId")
    .select([
      "p.employeeTypeId",
      "p.module",
      "p.view",
      "p.create",
      "p.update",
      "p.delete"
    ])
    .where("t.companyId", "=", companyId)
    .where("p.employeeTypeId", "in", employeeTypeIds)
    .execute();

  for (const id of employeeTypeIds) {
    grants.set(
      id,
      typeGrantsFor(
        rows.filter((row) => row.employeeTypeId === id),
        companyId
      )
    );
  }
  return grants;
}

/** Rewrite this company's slice of each person's `userPermission` row. */
async function writeCompanyGrants(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  grantsByUser: Map<string, string[]>
): Promise<void> {
  const userIds = [...grantsByUser.keys()];
  if (userIds.length === 0) return;

  // Serialize on the user rows before the read-merge-write, as acceptInvite
  // does: the userPermission lock holds nothing while that row is absent.
  await trx
    .selectFrom("user")
    .select("id")
    .where("id", "in", userIds)
    .forNoKeyUpdate()
    .execute();

  const current = await trx
    .selectFrom("userPermission")
    .select(["id", "permissions"])
    .where("id", "in", userIds)
    .forUpdate()
    .execute();
  const currentById = new Map(
    current.map((row) => [
      row.id,
      (row.permissions ?? {}) as Record<string, string[]>
    ])
  );

  const rows = userIds.map((id) => ({
    id,
    permissions: JSON.stringify(
      replaceCompanyGrants(
        currentById.get(id) ?? {},
        grantsByUser.get(id) ?? [],
        companyId
      )
    )
  }));

  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const batch = rows.slice(i, i + WRITE_BATCH);
    await sql`
      INSERT INTO "userPermission" ("id", "permissions")
      VALUES ${sql.join(batch.map((row) => sql`(${row.id}, ${row.permissions}::jsonb)`))}
      ON CONFLICT ("id") DO UPDATE SET "permissions" = EXCLUDED."permissions"
    `.execute(trx);
  }
}

/**
 * The person's membership and employee row in this company. Refuses a
 * customer or supplier contact: SCIM provisions employees only.
 */
export async function readEmployeeMembership(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  userId: string
): Promise<{
  isMember: boolean;
  employee: { employeeTypeId: string; active: boolean } | undefined;
}> {
  const membership = await trx
    .selectFrom("userToCompany")
    .select("role")
    .where("userId", "=", userId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (membership && membership.role !== "employee") {
    throw new ScimRefusal(
      409,
      "This person is a customer or supplier contact in this company.",
      "uniqueness"
    );
  }
  const employee = await trx
    .selectFrom("employee")
    .select(["employeeTypeId", "active"])
    .where("id", "=", userId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  return { isMember: Boolean(membership), employee };
}

/**
 * Make the person an employee of this company with `employeeTypeId`. An
 * inactive person gets the employee row only; an active one also gets the
 * membership and the type's grants.
 */
export async function joinCompany(
  trx: Transaction<KyselyDatabase>,
  ctx: Ctx,
  {
    userId,
    employeeTypeId,
    active
  }: {
    userId: string;
    employeeTypeId: string;
    active: boolean;
  }
): Promise<void> {
  await trx
    .insertInto("employee")
    .values({ id: userId, companyId: ctx.companyId, employeeTypeId, active })
    .onConflict((oc) =>
      oc.columns(["id", "companyId"]).doUpdateSet({ employeeTypeId, active })
    )
    .execute();

  await trx
    .insertInto("employeeJob")
    .values({
      id: userId,
      companyId: ctx.companyId,
      locationId: ctx.connection.defaultLocationId
    })
    .onConflict((oc) => oc.columns(["id", "companyId"]).doNothing())
    .execute();

  if (!active) return;

  await trx
    .insertInto("userToCompany")
    .values({ userId, companyId: ctx.companyId, role: "employee" })
    .onConflict((oc) => oc.columns(["userId", "companyId"]).doNothing())
    .execute();

  const grants = await readTypeGrants(trx, ctx.companyId, [employeeTypeId]);
  await writeCompanyGrants(
    trx,
    ctx.companyId,
    new Map([[userId, grants.get(employeeTypeId) ?? []]])
  );
}

/**
 * Write the IdP's name to the person. `user` is global, so only for a person
 * no other company also sees.
 */
export async function writeName(
  db: Db,
  companyId: string,
  userId: string,
  name: { givenName: string | null; familyName: string | null }
): Promise<void> {
  if (!name.givenName && !name.familyName) return;
  const otherCompany = await db
    .selectFrom("userToCompany")
    .select("companyId")
    .where("userId", "=", userId)
    .where("companyId", "!=", companyId)
    .limit(1)
    .executeTakeFirst();
  if (otherCompany) return;

  await db
    .updateTable("user")
    .set({
      firstName: name.givenName ?? "",
      lastName: name.familyName ?? ""
    })
    .where("id", "=", userId)
    .where("active", "=", true)
    .execute();
}

/** The employee type a person's mapped groups give, or null with no mapping. */
export async function mappedTypeFor(
  db: Db,
  ctx: Ctx,
  scimUserId: string
): Promise<string | null> {
  if (!(await hasMappedGroup(db, ctx.companyId))) return null;
  const groups = await db
    .selectFrom("scimGroupMember as m")
    .innerJoin("scimGroup as g", (join) =>
      join
        .onRef("g.id", "=", "m.groupId")
        .onRef("g.companyId", "=", "m.companyId")
    )
    .select(["g.employeeTypeId", "g.priority", "g.displayName"])
    .where("m.companyId", "=", ctx.companyId)
    .where("m.scimUserId", "=", scimUserId)
    .execute();
  return pickEmployeeType(groups, ctx.connection.defaultEmployeeTypeId);
}

/**
 * Bring each active provisioned person's employee type in line with their
 * mapped groups: the first mapped group by `compareGroupPrecedence`, else the
 * connection's default type. A person whose type changes gets this company's
 * grants rewritten from it. With no mapped group at all, SCIM never changes a
 * type, so admins keep control until they map one.
 *
 * `scimUserIds` limits the pass to the people a group change touched; omit it
 * to reconcile everyone. `mappingRemoved` says those people belonged to a
 * mapped group that was just deleted or unmapped: when it was the last one,
 * they still hold its type and grants, so they move to the default.
 */
export async function reconcileEmployeeTypes(
  db: Kysely<KyselyDatabase>,
  {
    connection,
    scimUserIds,
    mappingRemoved = false
  }: {
    connection: ScimConnectionRow;
    scimUserIds?: string[];
    mappingRemoved?: boolean;
  }
): Promise<{ changed: number }> {
  const { companyId } = connection;
  if (scimUserIds && scimUserIds.length === 0) return { changed: 0 };
  if (!mappingRemoved && !(await hasMappedGroup(db, companyId))) {
    return { changed: 0 };
  }

  let peopleQuery = db
    .selectFrom("scimUser")
    .select(["id", "userId"])
    .where("companyId", "=", companyId)
    .where("active", "=", true);
  if (scimUserIds) peopleQuery = peopleQuery.where("id", "in", scimUserIds);
  const people = await peopleQuery.execute();
  if (people.length === 0) return { changed: 0 };

  const memberships = await db
    .selectFrom("scimGroupMember as m")
    .innerJoin("scimGroup as g", (join) =>
      join
        .onRef("g.id", "=", "m.groupId")
        .onRef("g.companyId", "=", "m.companyId")
    )
    .select(["m.scimUserId", "g.employeeTypeId", "g.priority", "g.displayName"])
    .where("m.companyId", "=", companyId)
    .where(
      "m.scimUserId",
      "in",
      people.map((person) => person.id)
    )
    .execute();

  const desired = new Map<string, string>(
    people.map((person) => [
      person.userId,
      pickEmployeeType(
        memberships.filter((m) => m.scimUserId === person.id),
        connection.defaultEmployeeTypeId
      )
    ])
  );

  const employees = await db
    .selectFrom("employee")
    .select(["id", "employeeTypeId"])
    .where("companyId", "=", companyId)
    .where("active", "=", true)
    .where("id", "in", [...desired.keys()])
    .execute();

  const changes = employees
    .filter((employee) => desired.get(employee.id) !== employee.employeeTypeId)
    .map((employee) => ({
      userId: employee.id,
      to: desired.get(employee.id) as string
    }));
  if (changes.length === 0) return { changed: 0 };

  const applied = await db.transaction().execute(async (trx) => {
    await labelAsScim(trx);
    const typeIds = [...new Set(changes.map((change) => change.to))];
    const grants = await readTypeGrants(trx, companyId, typeIds);

    // Only this company's types: a mapping to a deleted or foreign type would
    // otherwise land through employee's single-column FK.
    const ownTypes = await trx
      .selectFrom("employeeType")
      .select("id")
      .where("companyId", "=", companyId)
      .where("id", "in", typeIds)
      .execute();
    const owned = new Set(ownTypes.map((type) => type.id));

    for (const typeId of typeIds) {
      if (!owned.has(typeId)) continue;
      await trx
        .updateTable("employee")
        .set({ employeeTypeId: typeId })
        .where("companyId", "=", companyId)
        .where(
          "id",
          "in",
          changes
            .filter((change) => change.to === typeId)
            .map((change) => change.userId)
        )
        .execute();
    }

    const applied = changes.filter((change) => owned.has(change.to));
    await writeCompanyGrants(
      trx,
      companyId,
      new Map(
        applied.map((change) => [change.userId, grants.get(change.to) ?? []])
      )
    );
    return applied;
  });

  await clearPermissionCaches(applied.map((change) => change.userId));
  return { changed: applied.length };
}
