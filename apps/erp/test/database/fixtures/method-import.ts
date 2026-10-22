// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { importMethods } from "../../../app/modules/shared/shared.service";
import type { MethodRowsAdded } from "../../../app/modules/shared/types";
import { connectLocalTestDatabase } from "./local-database";
import { localServiceRoleClient } from "./local-supabase";

const USER = "system";

export type MethodImportFixture = Awaited<
  ReturnType<typeof methodImportFixture>
>;

/**
 * A scratch company for the method import. Items, all revision 0:
 * - `ASSY` and `TWIN`: Make parts, each with the Draft v1 the item interceptor
 *   makes and nothing on it.
 * - `COMP-1`, `COMP-2`: bought parts in EA; `COMP-2` has a default storage
 *   unit at the plant.
 * - `MAT-YD`: a material stocked in yards.
 * - `SUB`: a Make to Order sub-assembly (its own Draft v1).
 * - `CONS`: a consumable. `TOOL-1`: a tool. `SVC`: a service.
 * Processes `Machining` (Process), `Bench Assembly` (Assembly) and `Final Check`
 * (Inspection), work center `Mill`.
 */
export async function methodImportFixture() {
  const db = await connectLocalTestDatabase();
  const client = localServiceRoleClient();
  const prefix = `mimp-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const locationId = `${prefix}-plant`;
  const storageUnitId = `${prefix}-bin`;
  const itemId = (readableId: string) => `${prefix}-${readableId}`;

  const items = [
    ["ASSY", "Part", "Make", "Make to Order", "EA"],
    ["TWIN", "Part", "Make", "Make to Order", "EA"],
    ["COMP-1", "Part", "Buy", "Purchase to Order", "EA"],
    ["COMP-2", "Part", "Buy", "Pull from Inventory", "EA"],
    ["MAT-YD", "Material", "Buy", "Pull from Inventory", "YD"],
    ["SUB", "Part", "Make", "Make to Order", "EA"],
    ["CONS", "Consumable", "Buy", "Pull from Inventory", "EA"],
    ["TOOL-1", "Tool", "Buy", "Pull from Inventory", "EA"],
    ["SVC", "Service", "Buy", "Purchase to Order", "EA"]
  ] as const;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: USER })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    await trx
      .insertInto("companySettings")
      .values({ id: companyId })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .insertInto("unitOfMeasure")
      .values([
        { code: "EA", name: "Each", companyId, createdBy: USER },
        { code: "YD", name: "Yard", companyId, createdBy: USER }
      ])
      .execute();
    await trx
      .insertInto("location")
      .values({
        id: locationId,
        name: "Plant",
        addressLine1: "1 Test Way",
        city: "Testville",
        postalCode: "00000",
        timezone: "America/New_York",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("storageUnit")
      .values({
        id: storageUnitId,
        name: "Bin",
        locationId,
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("process")
      .values([
        {
          id: `${prefix}-machining`,
          name: "Machining",
          defaultStandardFactor: "Minutes/Piece",
          processType: "Process",
          companyId,
          createdBy: USER
        },
        {
          id: `${prefix}-bench-assembly`,
          name: "Bench Assembly",
          defaultStandardFactor: "Minutes/Piece",
          processType: "Assembly",
          companyId,
          createdBy: USER
        },
        {
          id: `${prefix}-final-check`,
          name: "Final Check",
          defaultStandardFactor: "Minutes/Piece",
          processType: "Inspection",
          companyId,
          createdBy: USER
        }
      ])
      .execute();
    await trx
      .insertInto("workCenter")
      .values({
        id: `${prefix}-mill`,
        name: "Mill",
        locationId,
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("item")
      .values(
        items.map(
          ([readableId, type, replenishmentSystem, method, unit]) => ({
            id: itemId(readableId),
            readableId,
            name: readableId,
            type,
            replenishmentSystem,
            defaultMethodType: method,
            itemTrackingType:
              type === "Service" ? ("Non-Inventory" as const) : "Inventory",
            unitOfMeasureCode: unit,
            companyId,
            createdBy: USER
          })
        )
      )
      .execute();
    await trx
      .insertInto("pickMethod")
      .values({
        itemId: itemId("COMP-2"),
        locationId,
        defaultStorageUnitId: storageUnitId,
        companyId,
        createdBy: USER
      })
      .onConflict((oc) =>
        oc.columns(["itemId", "locationId"]).doUpdateSet({
          defaultStorageUnitId: storageUnitId
        })
      )
      .execute();
  });

  const methodOf = async (readableId: string) =>
    (
      await db
        .selectFrom("makeMethod")
        .select("id")
        .where("itemId", "=", itemId(readableId))
        .where("companyId", "=", companyId)
        .orderBy("version", "desc")
        .executeTakeFirstOrThrow()
    ).id;

  return {
    db,
    client,
    companyId,
    locationId,
    storageUnitId,
    itemId,
    processId: (name: "machining" | "bench-assembly" | "final-check") => `${prefix}-${name}`,
    workCenterId: `${prefix}-mill`,
    methodOf,
    /** The system actor, as the service functions the editors and MCP call see it. */
    ctx: client
      ? createServiceContext({
          actor: { type: "system", onBehalfOf: USER },
          company: { id: companyId, groupId },
          caller: client,
          system: () => client,
          pg: () => db,
          kv: () => {
            throw new Error("No operation here reads the cache");
          }
        })
      : null,
    async run(
      table: "bom" | "operations" | "partWithMethod",
      mappedRecords: Record<string, string>[],
      on = db
    ) {
      const summary = {
        inserted: 0,
        updated: 0,
        errors: [] as Array<{ row: number; reason: string }>,
        skipped: [] as Array<{ row: number; reason: string }>,
        added: undefined as MethodRowsAdded | undefined
      };
      await importMethods(on, {
        table,
        mappedRecords,
        companyId,
        userId: USER,
        summary
      });
      return summary;
    },
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  };
}
