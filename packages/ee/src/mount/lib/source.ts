// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type {
  MountPublishSource,
  PublishableCustomer,
  PublishablePart,
  PublishableSupplier
} from "./publish";
import { MOUNT_INTEGRATION_ID } from "./service";
import type { MountEntityType } from "./types";

export function createMountPublishSource(
  db: Kysely<KyselyDatabase>,
  companyId: string
): MountPublishSource {
  async function listStaleParts(
    limit: number,
    deferIds: string[]
  ): Promise<PublishablePart[]> {
    const rows = await db
      .selectFrom("item")
      .leftJoin("externalIntegrationMapping as m", (join) =>
        join
          .onRef("m.entityId", "=", "item.id")
          .on("m.entityType", "=", "item")
          .on("m.integration", "=", MOUNT_INTEGRATION_ID)
          .on("m.companyId", "=", companyId)
      )
      .select("item.id")
      .select("item.readableId")
      .select("item.name")
      .where("item.companyId", "=", companyId)
      .where("item.type", "=", "Part")
      // One Mount part per part number, fed by the revision the `parts` view
      // surfaces (released before draft, then newest). An unreleased revision
      // minted by a change notice never overwrites the released one in Mount.
      .where("item.id", "in", (eb) =>
        eb
          .selectFrom("parts")
          .select("parts.id")
          .where("parts.companyId", "=", companyId)
      )
      .where((eb) =>
        eb.or([
          eb("m.externalId", "is", null),
          eb("m.lastSyncedAt", "is", null),
          eb("m.lastSyncedAt", "<", eb.ref("item.updatedAt"))
        ])
      )
      .$if(deferIds.length > 0, (qb) =>
        qb.orderBy((eb) =>
          eb.case().when("item.id", "in", deferIds).then(1).else(0).end()
        )
      )
      .orderBy("item.updatedAt", "asc")
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      readableId: row.readableId,
      name: row.name
    }));
  }

  async function listStaleCustomers(
    limit: number,
    deferIds: string[]
  ): Promise<PublishableCustomer[]> {
    const rows = await db
      .selectFrom("customer")
      .leftJoin("externalIntegrationMapping as m", (join) =>
        join
          .onRef("m.entityId", "=", "customer.id")
          .on("m.entityType", "=", "customer")
          .on("m.integration", "=", MOUNT_INTEGRATION_ID)
          .on("m.companyId", "=", companyId)
      )
      // taxId and vatNumber moved off customer/supplier into these tables in
      // migration 20260430000001_tax-status; the `customers` view joins them
      // back the same way.
      .leftJoin("customerTax as tax", (join) =>
        join
          .onRef("tax.customerId", "=", "customer.id")
          .on("tax.companyId", "=", companyId)
      )
      .select("customer.id")
      .select("customer.readableId")
      .select("customer.name")
      .select("tax.taxId")
      .select("tax.vatNumber")
      .select("customer.website")
      .where("customer.companyId", "=", companyId)
      .where((eb) =>
        eb.or([
          eb("m.externalId", "is", null),
          eb("m.lastSyncedAt", "is", null),
          eb("m.lastSyncedAt", "<", eb.ref("customer.updatedAt")),
          // Org number and VAT live on the tax row, which has its own
          // updatedAt; an edit there leaves the parent row untouched.
          eb("m.lastSyncedAt", "<", eb.ref("tax.updatedAt"))
        ])
      )
      .$if(deferIds.length > 0, (qb) =>
        qb.orderBy((eb) =>
          eb.case().when("customer.id", "in", deferIds).then(1).else(0).end()
        )
      )
      .orderBy("customer.updatedAt", "asc")
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      readableId: row.readableId,
      name: row.name,
      taxId: row.taxId,
      vatNumber: row.vatNumber,
      website: row.website
    }));
  }

  async function listStaleSuppliers(
    limit: number,
    deferIds: string[]
  ): Promise<PublishableSupplier[]> {
    const rows = await db
      .selectFrom("supplier")
      .leftJoin("externalIntegrationMapping as m", (join) =>
        join
          .onRef("m.entityId", "=", "supplier.id")
          .on("m.entityType", "=", "supplier")
          .on("m.integration", "=", MOUNT_INTEGRATION_ID)
          .on("m.companyId", "=", companyId)
      )
      .leftJoin("supplierTax as tax", (join) =>
        join
          .onRef("tax.supplierId", "=", "supplier.id")
          .on("tax.companyId", "=", companyId)
      )
      .select("supplier.id")
      .select("supplier.readableId")
      .select("supplier.name")
      .select("tax.taxId")
      .select("tax.vatNumber")
      .select("supplier.website")
      .where("supplier.companyId", "=", companyId)
      .where((eb) =>
        eb.or([
          eb("m.externalId", "is", null),
          eb("m.lastSyncedAt", "is", null),
          eb("m.lastSyncedAt", "<", eb.ref("supplier.updatedAt")),
          // Org number and VAT live on the tax row, which has its own
          // updatedAt; an edit there leaves the parent row untouched.
          eb("m.lastSyncedAt", "<", eb.ref("tax.updatedAt"))
        ])
      )
      .$if(deferIds.length > 0, (qb) =>
        qb.orderBy((eb) =>
          eb.case().when("supplier.id", "in", deferIds).then(1).else(0).end()
        )
      )
      .orderBy("supplier.updatedAt", "asc")
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      readableId: row.readableId,
      name: row.name,
      taxId: row.taxId,
      vatNumber: row.vatNumber,
      website: row.website
    }));
  }

  return {
    async listStale(
      entityType: MountEntityType,
      limit: number,
      deferIds: string[] = []
    ) {
      if (entityType === "item") return await listStaleParts(limit, deferIds);
      if (entityType === "customer")
        return await listStaleCustomers(limit, deferIds);
      return await listStaleSuppliers(limit, deferIds);
    }
  };
}
