// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * `/Groups`. A group change reconciles the employee types of the people whose
 * groups changed (`reconcileEmployeeTypes`).
 */

import type { KyselyDatabase } from "@carbon/database/client";
import { sql, type Transaction } from "kysely";
import { reconcileEmployeeTypes } from "./access.server";
import {
  applyGroupPatch,
  parsePaging,
  parseScimFilter,
  readGroupResource,
  type ScimGroupState,
  scimError,
  scimJson,
  scimListResponse,
  toScimGroup
} from "./protocol";
import {
  type Ctx,
  idsMatchingWithoutCase,
  isUniqueViolation,
  readListPage,
  SYSTEM_USER_ID
} from "./shared.server";

const GROUP_COLUMNS = "id, displayName, externalId, createdAt, updatedAt";

type GroupMember = { value: string; display: string };

function groupNotFound(): Response {
  return scimError(404, "Group not found.");
}

function duplicateGroup(): Response {
  return scimError(409, "A group with this displayName exists.", "uniqueness");
}

function excludesMembers(url: URL): boolean {
  const excluded = url.searchParams.get("excludedAttributes") ?? "";
  return excluded
    .split(",")
    .some((name) => name.trim().toLowerCase() === "members");
}

async function readGroup(ctx: Ctx, id: string) {
  const result = await ctx.serviceRole
    .from("scimGroup")
    .select(GROUP_COLUMNS)
    .eq("id", id)
    .eq("companyId", ctx.companyId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function readGroupMembers(
  ctx: Ctx,
  groupIds: string[]
): Promise<Map<string, GroupMember[]>> {
  const members = new Map<string, GroupMember[]>(
    groupIds.map((id) => [id, []])
  );
  if (groupIds.length === 0) return members;
  const rows = await ctx.db
    .selectFrom("scimGroupMember as m")
    .innerJoin("scimUser as u", (join) =>
      join
        .onRef("u.id", "=", "m.scimUserId")
        .onRef("u.companyId", "=", "m.companyId")
    )
    .select(["m.groupId", "m.scimUserId", "u.userName"])
    .where("m.companyId", "=", ctx.companyId)
    .where("m.groupId", "in", groupIds)
    .orderBy("u.userName")
    .execute();
  for (const row of rows) {
    members
      .get(row.groupId)
      ?.push({ value: row.scimUserId, display: row.userName });
  }
  return members;
}

export async function listGroups(ctx: Ctx, url: URL): Promise<Response> {
  const filter = parseScimFilter(url.searchParams.get("filter"));
  if (!filter.ok) return scimError(400, filter.detail, filter.scimType);
  const { startIndex, count } = parsePaging(url);

  // A factory, not one builder: supabase-js builders are mutable, and an
  // out-of-range page needs a second (count-only) read with the same filters.
  const newQuery = (head: boolean) =>
    ctx.serviceRole
      .from("scimGroup")
      .select(GROUP_COLUMNS, { count: "exact", head })
      .eq("companyId", ctx.companyId);
  const filters: Array<(q: ReturnType<typeof newQuery>) => typeof q> = [];
  const filtered = (head: boolean) =>
    filters.reduce((q, apply) => apply(q), newQuery(head));

  for (const { attribute, value } of filter.value) {
    switch (attribute.toLowerCase()) {
      case "displayname": {
        const ids = await idsMatchingWithoutCase(
          ctx,
          "scimGroup",
          "displayName",
          value
        );
        if (ids.length === 0) {
          return scimJson(
            scimListResponse([], { totalResults: 0, startIndex })
          );
        }
        filters.push((q) => q.in("id", ids));
        break;
      }
      case "externalid":
        filters.push((q) => q.eq("externalId", value));
        break;
      case "id":
        filters.push((q) => q.eq("id", value));
        break;
      default:
        return scimError(
          400,
          `Carbon cannot filter Groups by "${attribute}".`,
          "invalidFilter"
        );
    }
  }

  const { rows, totalResults } = await readListPage(count, {
    rows: () =>
      filtered(false)
        .order("createdAt")
        .order("id")
        .range(startIndex - 1, startIndex - 2 + count),
    total: () => filtered(true)
  });
  const members = excludesMembers(url)
    ? null
    : await readGroupMembers(
        ctx,
        rows.map((row) => row.id)
      );
  return scimJson(
    scimListResponse(
      rows.map((row) =>
        toScimGroup(row, members?.get(row.id) ?? null, ctx.baseUrl)
      ),
      { totalResults, startIndex }
    )
  );
}

export async function getGroup(
  ctx: Ctx,
  id: string,
  url: URL
): Promise<Response> {
  const row = await readGroup(ctx, id);
  if (!row) return groupNotFound();
  const members = excludesMembers(url)
    ? null
    : ((await readGroupMembers(ctx, [row.id])).get(row.id) ?? []);
  return scimJson(toScimGroup(row, members, ctx.baseUrl));
}

/** Keep only the member ids that name a person of this company. */
async function knownMembers(ctx: Ctx, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await ctx.db
    .selectFrom("scimUser")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("id", "in", ids)
    .execute();
  return new Set(rows.map((row) => row.id));
}

/** Write a group's name and members; answer the people whose groups changed. */
async function writeGroupRows(
  trx: Transaction<KyselyDatabase>,
  ctx: Ctx,
  groupId: string,
  state: ScimGroupState,
  wanted: Set<string>
): Promise<string[]> {
  await trx
    .updateTable("scimGroup")
    .set({
      displayName: state.displayName,
      externalId: state.externalId,
      updatedBy: SYSTEM_USER_ID,
      updatedAt: sql`now()`
    })
    .where("id", "=", groupId)
    .where("companyId", "=", ctx.companyId)
    .execute();

  const current = await trx
    .selectFrom("scimGroupMember")
    .select("scimUserId")
    .where("groupId", "=", groupId)
    .where("companyId", "=", ctx.companyId)
    .execute();
  const have = new Set(current.map((row) => row.scimUserId));

  const removed = [...have].filter((id) => !wanted.has(id));
  const added = [...wanted].filter((id) => !have.has(id));

  if (removed.length > 0) {
    await trx
      .deleteFrom("scimGroupMember")
      .where("groupId", "=", groupId)
      .where("companyId", "=", ctx.companyId)
      .where("scimUserId", "in", removed)
      .execute();
  }
  if (added.length > 0) {
    await trx
      .insertInto("scimGroupMember")
      .values(
        added.map((scimUserId) => ({
          groupId,
          scimUserId,
          companyId: ctx.companyId
        }))
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  return [...removed, ...added];
}

export async function createGroup(ctx: Ctx, body: unknown): Promise<Response> {
  const parsed = readGroupResource(body);
  if (!parsed.ok) return scimError(400, parsed.detail, parsed.scimType);

  // The group and its members commit together: a group left without its
  // members would answer the IdP's retry with 409 and never be filled.
  const wanted = await knownMembers(ctx, parsed.value.memberIds);
  let groupId: string;
  let changed: string[];
  try {
    ({ groupId, changed } = await ctx.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto("scimGroup")
        .values({
          companyId: ctx.companyId,
          connectionId: ctx.connection.id,
          displayName: parsed.value.displayName,
          externalId: parsed.value.externalId,
          createdBy: SYSTEM_USER_ID
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return {
        groupId: inserted.id,
        changed: await writeGroupRows(
          trx,
          ctx,
          inserted.id,
          parsed.value,
          wanted
        )
      };
    }));
  } catch (err) {
    if (isUniqueViolation(err)) return duplicateGroup();
    throw err;
  }

  await reconcileEmployeeTypes(ctx.db, {
    connection: ctx.connection,
    scimUserIds: changed
  });

  const row = await readGroup(ctx, groupId);
  if (!row)
    throw new Error("The provisioned SCIM group could not be read back");
  const members = (await readGroupMembers(ctx, [groupId])).get(groupId) ?? [];
  return scimJson(toScimGroup(row, members, ctx.baseUrl), 201, {
    Location: `${ctx.baseUrl}/Groups/${groupId}`
  });
}

async function memberIdsOf(ctx: Ctx, groupId: string): Promise<string[]> {
  const members = await ctx.db
    .selectFrom("scimGroupMember")
    .select("scimUserId")
    .where("groupId", "=", groupId)
    .where("companyId", "=", ctx.companyId)
    .execute();
  return members.map((member) => member.scimUserId);
}

/** Save the group and reconcile its changed members; a refusal, or null. */
async function saveGroup(
  ctx: Ctx,
  groupId: string,
  state: ScimGroupState
): Promise<Response | null> {
  const wanted = await knownMembers(ctx, state.memberIds);
  try {
    const changed = await ctx.db
      .transaction()
      .execute((trx) => writeGroupRows(trx, ctx, groupId, state, wanted));
    await reconcileEmployeeTypes(ctx.db, {
      connection: ctx.connection,
      scimUserIds: changed
    });
    return null;
  } catch (err) {
    if (isUniqueViolation(err)) return duplicateGroup();
    throw err;
  }
}

export async function replaceGroup(
  ctx: Ctx,
  id: string,
  body: unknown
): Promise<Response> {
  const row = await readGroup(ctx, id);
  if (!row) return groupNotFound();
  const parsed = readGroupResource(body);
  if (!parsed.ok) return scimError(400, parsed.detail, parsed.scimType);

  const refusal = await saveGroup(ctx, row.id, parsed.value);
  if (refusal) return refusal;
  return getGroup(ctx, row.id, new URL(`${ctx.baseUrl}/Groups/${row.id}`));
}

export async function patchGroup(
  ctx: Ctx,
  id: string,
  body: unknown
): Promise<Response> {
  const row = await readGroup(ctx, id);
  if (!row) return groupNotFound();
  const patched = applyGroupPatch(
    {
      displayName: row.displayName,
      externalId: row.externalId,
      memberIds: await memberIdsOf(ctx, row.id)
    },
    body
  );
  if (!patched.ok) return scimError(400, patched.detail, patched.scimType);

  const refusal = await saveGroup(ctx, row.id, patched.value);
  if (refusal) return refusal;
  return new Response(null, { status: 204 });
}

export async function deleteGroup(ctx: Ctx, id: string): Promise<Response> {
  const row = await readGroup(ctx, id);
  if (!row) return groupNotFound();
  const memberIds = await memberIdsOf(ctx, row.id);
  const deleted = await ctx.db
    .deleteFrom("scimGroup")
    .where("id", "=", row.id)
    .where("companyId", "=", ctx.companyId)
    .returning("employeeTypeId")
    .executeTakeFirst();
  await reconcileEmployeeTypes(ctx.db, {
    connection: ctx.connection,
    scimUserIds: memberIds,
    mappingRemoved: Boolean(deleted?.employeeTypeId)
  });
  return new Response(null, { status: 204 });
}
