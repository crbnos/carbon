// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EntitlementError, requireEntitlement } from "../entitlements.server";
import { resolveIntegrationSecrets } from "../integrations/secrets";
import { companyHasFeature } from "../plan.server";
import { OEE_PROVIDERS } from "./registry";
import type { OeeProvider } from "./types";

/**
 * OEE provider server functions. The authoring writes embed
 * `requireEntitlement("INTEGRATIONS")`; `getOeeProvider` is the runtime path
 * and degrades through `companyHasFeature` instead of throwing.
 */

type Result<T> = { data: T; error: null } | { data: null; error: string };

const fail = (error: unknown): { data: null; error: string } => {
  if (error instanceof EntitlementError) throw error;
  return {
    data: null,
    error: error instanceof Error ? error.message : String(error)
  };
};

export async function getOeeProvider(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  integrationId: string
): Promise<Result<{ provider: OeeProvider; minimumStateSeconds: number }>> {
  try {
    const entitled = await companyHasFeature(serviceClient, companyId, {
      feature: "INTEGRATIONS"
    });
    if (!entitled) return { data: null, error: "Not entitled" };

    const integration = await serviceClient
      .from("companyIntegration")
      .select("metadata, secretRef, active")
      .eq("companyId", companyId)
      .eq("id", integrationId)
      .maybeSingle();
    if (integration.error) return fail(integration.error.message);
    if (!integration.data?.active) {
      return { data: null, error: "Integration is not active" };
    }

    const metadata = (await resolveIntegrationSecrets(
      serviceClient,
      companyId,
      integrationId,
      integration.data.metadata,
      integration.data.secretRef
    )) as Record<string, unknown>;

    const factory = OEE_PROVIDERS[integrationId];
    if (!factory) {
      return { data: null, error: `${integrationId} is not an OEE provider` };
    }
    const apiKey = typeof metadata.apiKey === "string" ? metadata.apiKey : "";
    if (!apiKey) return { data: null, error: "No API key" };

    const minimum = Number(metadata.minimumStateSeconds);
    return {
      data: {
        provider: factory({
          apiKey,
          environment: String(metadata.environment ?? "production")
        }),
        minimumStateSeconds:
          Number.isFinite(minimum) && minimum >= 0 ? minimum : 60
      },
      error: null
    };
  } catch (error) {
    return fail(error);
  }
}

export async function upsertWorkCenterDevice(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    integration: string;
    externalDeviceId: string;
    externalSiteId: string | null;
    siteTimezone: string | null;
    deviceName: string;
    workCenterId: string;
  }
): Promise<Result<{ id: string }>> {
  await requireEntitlement(client, args.companyId, "INTEGRATIONS");
  try {
    return await db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom("workCenterDevice")
        .select(["id", "workCenterId"])
        .where("integration", "=", args.integration)
        .where("externalDeviceId", "=", args.externalDeviceId)
        .where("companyId", "=", args.companyId)
        .forUpdate()
        .executeTakeFirst();
      if (current?.workCenterId === args.workCenterId) {
        return { data: { id: current.id }, error: null };
      }

      const taken = await trx
        .selectFrom("workCenterDevice")
        .innerJoin(
          "workCenter",
          "workCenter.id",
          "workCenterDevice.workCenterId"
        )
        .select([
          "workCenterDevice.deviceName",
          "workCenterDevice.integration",
          "workCenter.name as workCenterName"
        ])
        .where("workCenterDevice.workCenterId", "=", args.workCenterId)
        .where("workCenterDevice.companyId", "=", args.companyId)
        .executeTakeFirst();
      if (taken) {
        return {
          data: null,
          error: `${taken.workCenterName} already has ${taken.deviceName} from ${taken.integration}`
        };
      }

      // A remap starts fresh: a new mapping time and no applied state.
      if (current) {
        await trx
          .deleteFrom("workCenterDevice")
          .where("id", "=", current.id)
          .where("companyId", "=", args.companyId)
          .execute();
      }

      const inserted = await trx
        .insertInto("workCenterDevice")
        .values({
          companyId: args.companyId,
          workCenterId: args.workCenterId,
          integration: args.integration,
          externalDeviceId: args.externalDeviceId,
          externalSiteId: args.externalSiteId,
          siteTimezone: args.siteTimezone,
          deviceName: args.deviceName,
          createdBy: args.userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { data: { id: inserted.id }, error: null };
    });
  } catch (error) {
    return fail(error);
  }
}

export async function deleteWorkCenterDevice(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; integration: string; externalDeviceId: string }
): Promise<Result<null>> {
  await requireEntitlement(client, args.companyId, "INTEGRATIONS");
  try {
    await db
      .deleteFrom("workCenterDevice")
      .where("integration", "=", args.integration)
      .where("externalDeviceId", "=", args.externalDeviceId)
      .where("companyId", "=", args.companyId)
      .execute();
    return { data: null, error: null } as Result<null>;
  } catch (error) {
    return fail(error);
  }
}

export async function assignUnattributedMachineTime(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    unattributedMachineTimeId: string;
    jobOperationId: string;
  }
): Promise<Result<{ productionEventId: string }>> {
  await requireEntitlement(client, args.companyId, "INTEGRATIONS");
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom("unattributedMachineTime")
        .select(["workCenterId", "startTime", "endTime", "status"])
        .where("id", "=", args.unattributedMachineTimeId)
        .where("companyId", "=", args.companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!row) return { data: null, error: "Machine time not found" };
      if (row.status !== "Open") {
        return {
          data: null,
          error: `This machine time is already ${row.status}`
        };
      }
      if (!row.endTime) {
        return { data: null, error: "The machine is still running" };
      }

      const operation = await trx
        .selectFrom("jobOperation")
        .select(["status"])
        .where("id", "=", args.jobOperationId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!operation) return { data: null, error: "Operation not found" };
      if (operation.status === "Done" || operation.status === "Canceled") {
        return { data: null, error: `The operation is ${operation.status}` };
      }

      const event = await trx
        .insertInto("productionEvent")
        .values({
          type: "Machine",
          jobOperationId: args.jobOperationId,
          workCenterId: row.workCenterId,
          startTime: row.startTime,
          endTime: row.endTime,
          employeeId: null,
          companyId: args.companyId,
          createdBy: args.userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const now = datetime.timestamp();
      await trx
        .updateTable("unattributedMachineTime")
        .set({
          status: "Assigned",
          productionEventId: event.id,
          resolvedBy: args.userId,
          resolvedAt: now,
          updatedBy: args.userId,
          updatedAt: now
        })
        .where("id", "=", args.unattributedMachineTimeId)
        .where("companyId", "=", args.companyId)
        .execute();

      return { data: { productionEventId: event.id }, error: null };
    });
  } catch (error) {
    return fail(error);
  }
}

export async function dismissUnattributedMachineTime(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    unattributedMachineTimeId: string;
    dismissReason: string;
  }
): Promise<Result<null>> {
  await requireEntitlement(client, args.companyId, "INTEGRATIONS");
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom("unattributedMachineTime")
        .select(["status", "endTime"])
        .where("id", "=", args.unattributedMachineTimeId)
        .where("companyId", "=", args.companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!row) return { data: null, error: "Machine time not found" };
      if (row.status !== "Open") {
        return {
          data: null,
          error: `This machine time is already ${row.status}`
        };
      }
      // A running row is still the sync's to close: dismissing it would let
      // the next sync open the same time again.
      if (!row.endTime) {
        return { data: null, error: "The machine is still running" };
      }

      const now = datetime.timestamp();
      await trx
        .updateTable("unattributedMachineTime")
        .set({
          status: "Dismissed",
          dismissReason: args.dismissReason,
          resolvedBy: args.userId,
          resolvedAt: now,
          updatedBy: args.userId,
          updatedAt: now
        })
        .where("id", "=", args.unattributedMachineTimeId)
        .where("companyId", "=", args.companyId)
        .execute();
      return { data: null, error: null } as Result<null>;
    });
  } catch (error) {
    return fail(error);
  }
}
