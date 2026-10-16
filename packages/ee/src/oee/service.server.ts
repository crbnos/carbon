// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { endSensorMachineTime } from "@carbon/database/machine-time";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EntitlementError, requireEntitlement } from "../entitlements.server";
import { integrations } from "../index";
import { resolveIntegrationSecrets } from "../integrations/secrets";
import { companyHasFeature } from "../plan.server";
import { machineTimeRefusal } from "./assignable";
import { createOeeProvider, isOeeProviderId } from "./registry";
import type { OeeProvider } from "./types";

/**
 * OEE provider server functions. The authoring writes embed
 * `requireEntitlement("INTEGRATIONS")`; `getOeeProvider` is the runtime path
 * and degrades through `companyHasFeature` instead of throwing.
 */

const logger = getLogger("ee", "oee");

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

    return { data: createOeeProvider(integrationId, metadata), error: null };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Posts the Machine events that sensor time ended (machine and overhead cost
 * to WIP), as an operator's press posts the events it ends. Call it after the
 * transaction that ended them commits. A failure is logged, never thrown: the
 * operation-finish and job-completion catch-ups post what is still unposted.
 */
export async function postEndedMachineEvents(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; userId: string; productionEventIds: string[] }
) {
  if (args.productionEventIds.length === 0) return;
  const functions = serverFns.system({
    db,
    companyId: args.companyId,
    userId: args.userId
  });
  for (const productionEventId of args.productionEventIds) {
    const posted = await functions.invoke("post-production-event", {
      productionEventId
    });
    // `success: false` is an event with nothing to post yet (no duration):
    // the catch-ups take it once it has one.
    if (posted.error) {
      logger.error("Failed to post a Machine event", {
        companyId: args.companyId,
        productionEventId,
        error: posted.error.message
      });
    }
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
    // Only an active OEE integration maps devices: a row for any other
    // integration would hold the work center's one device slot, and nothing
    // would ever sync it.
    if (!isOeeProviderId(args.integration)) {
      return {
        data: null,
        error: `${args.integration} is not an OEE provider`
      };
    }
    let endedEventIds: string[] = [];
    const result = await db.transaction().execute(async (trx) => {
      const integration = await trx
        .selectFrom("companyIntegration")
        .select("active")
        .where("id", "=", args.integration)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!integration?.active) {
        return { data: null, error: "Integration is not active" };
      }

      // Kysely skips RLS, and the id comes from the form: the work center
      // must be this company's (the composite FK refuses it too).
      const workCenter = await trx
        .selectFrom("workCenter")
        .select("id")
        .where("id", "=", args.workCenterId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!workCenter) return { data: null, error: "Work center not found" };

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
        .innerJoin("workCenter", (join) =>
          join
            .onRef("workCenter.id", "=", "workCenterDevice.workCenterId")
            .onRef("workCenter.companyId", "=", "workCenterDevice.companyId")
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
          error: `${taken.workCenterName} already has ${taken.deviceName} from ${
            integrations.find((entry) => entry.id === taken.integration)
              ?.name ?? taken.integration
          }`
        };
      }

      // A remap starts fresh: a new mapping time and no applied state. The
      // time the device opened on its old work center ends now; no later
      // sync of the old mapping will close it.
      if (current) {
        ({ endedEventIds } = await endSensorMachineTime(trx, {
          workCenterId: current.workCenterId,
          companyId: args.companyId,
          userId: args.userId,
          at: datetime.timestamp()
        }));
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
    await postEndedMachineEvents(db, {
      companyId: args.companyId,
      userId: args.userId,
      productionEventIds: endedEventIds
    });
    return result;
  } catch (error) {
    return fail(error);
  }
}

export async function deleteWorkCenterDevice(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    integration: string;
    externalDeviceId: string;
  }
): Promise<Result<null>> {
  await requireEntitlement(client, args.companyId, "INTEGRATIONS");
  try {
    const endedEventIds = await db.transaction().execute(async (trx) => {
      const device = await trx
        .selectFrom("workCenterDevice")
        .select(["id", "workCenterId"])
        .where("integration", "=", args.integration)
        .where("externalDeviceId", "=", args.externalDeviceId)
        .where("companyId", "=", args.companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!device) return [];

      // Nothing syncs this work center after the delete, so the time its
      // sensor opened ends now instead of staying open forever.
      const ended = await endSensorMachineTime(trx, {
        workCenterId: device.workCenterId,
        companyId: args.companyId,
        userId: args.userId,
        at: datetime.timestamp()
      });
      await trx
        .deleteFrom("workCenterDevice")
        .where("id", "=", device.id)
        .where("companyId", "=", args.companyId)
        .execute();
      return ended.endedEventIds;
    });
    await postEndedMachineEvents(db, {
      companyId: args.companyId,
      userId: args.userId,
      productionEventIds: endedEventIds
    });
    return { data: null, error: null };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Assign unattributed time to an operation: insert a Machine event for its
 * interval and delete the row, then post the event. The event is the record;
 * the row was only a question waiting for an answer.
 */
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
    const result = await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom("unattributedMachineTime")
        .select(["workCenterId", "startTime", "endTime"])
        .where("id", "=", args.unattributedMachineTimeId)
        .where("companyId", "=", args.companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!row) return { data: null, error: "Machine time not found" };
      if (!row.endTime) {
        return { data: null, error: "The machine is still running" };
      }

      // Checked under row locks, in this transaction: a job closed between
      // the route's check and this insert must still refuse the time.
      const operation = await trx
        .selectFrom("jobOperation")
        .innerJoin("job", (join) =>
          join
            .onRef("job.id", "=", "jobOperation.jobId")
            .onRef("job.companyId", "=", "jobOperation.companyId")
        )
        .select(["jobOperation.status", "job.status as jobStatus"])
        .where("jobOperation.id", "=", args.jobOperationId)
        .where("jobOperation.companyId", "=", args.companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!operation) return { data: null, error: "Operation not found" };
      const refusal = machineTimeRefusal(operation.status, operation.jobStatus);
      if (refusal === "Locked") {
        return {
          data: null,
          error: "Cannot modify a locked job. Reopen it first."
        };
      }
      if (refusal) return { data: null, error: `The operation is ${refusal}` };

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

      await trx
        .deleteFrom("unattributedMachineTime")
        .where("id", "=", args.unattributedMachineTimeId)
        .where("companyId", "=", args.companyId)
        .execute();

      return { data: { productionEventId: event.id }, error: null };
    });
    if (result.data) {
      await postEndedMachineEvents(db, {
        companyId: args.companyId,
        userId: args.userId,
        productionEventIds: [result.data.productionEventId]
      });
    }
    return result;
  } catch (error) {
    return fail(error);
  }
}

/** Dismiss unattributed time: it was not job time, so the row is deleted. */
export async function dismissUnattributedMachineTime(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    unattributedMachineTimeId: string;
  }
): Promise<Result<null>> {
  await requireEntitlement(client, args.companyId, "INTEGRATIONS");
  try {
    // A running row is still the sync's to close: deleting it would let the
    // next sync open the same time again.
    const deleted = await db
      .deleteFrom("unattributedMachineTime")
      .where("id", "=", args.unattributedMachineTimeId)
      .where("companyId", "=", args.companyId)
      .where("endTime", "is not", null)
      .returning("id")
      .executeTakeFirst();
    if (!deleted) {
      return {
        data: null,
        error: "Machine time not found, or the machine is still running"
      };
    }
    return { data: null, error: null };
  } catch (error) {
    return fail(error);
  }
}
