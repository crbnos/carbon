/**
 * Task to sync entities to accounting providers from Carbon
 */
import { getCarbonServiceRole } from "@carbon/auth";
import {
  AccountingEntity,
  AccountingSyncSchema,
  EntityMap,
  getAccountingIntegration,
  getEntityWithExternalId,
  getProviderIntegration,
  SyncFn,
} from "@carbon/ee/accounting";
import { task } from "@trigger.dev/sdk";
import z from "zod";

const PayloadSchema = AccountingSyncSchema.extend({
  syncDirection: AccountingSyncSchema.shape.syncDirection.exclude([
    "from-accounting",
  ]),
});

type Payload = z.infer<typeof PayloadSchema>;

const UPSERT_MAP: Record<keyof EntityMap, SyncFn> = {
  async customer({ client, entity, payload, provider }) {
    const customer = await getEntityWithExternalId(
      client,
      "customer",
      payload.companyId,
      provider.id,
      { id: entity.entityId }
    );

    // const data = {
    //   ...entity.data,
    //   id: customer ? customer.data.externalId[provider.id].id : undefined,
    // };

    // await provider.contacts.upsert(data);

    return {
      id: entity.entityId,
      message: "Upserted successfully",
    };
  },
  async vendor({ client, entity, payload, provider }) {},
};

const DELETE_MAP: Record<keyof EntityMap, SyncFn> = {
  async customer({ client, entity, payload, provider }) {
    const customer = await getEntityWithExternalId(
      client,
      "customer",
      payload.companyId,
      provider.id,
      { id: entity.entityId }
    );

    // if (customer.error || !customer.data) {
    //   throw new Error(`Customer ${entity.entityId} not found`);
    // }

    // const externalId = customer.data.externalId[provider.id];

    // await provider.contacts.delete(externalId.id);

    return {
      id: entity.entityId,
      message: "Deleted successfully",
    };
  },
  async vendor({ client, entity, payload, provider }) {},
};

export const toAccountsSyncTask = task({
  id: "to-accounting-sync",
  run: async (input: Payload) => {
    const payload = PayloadSchema.parse(input);

    const client = getCarbonServiceRole();

    const integration = await getAccountingIntegration(
      client,
      payload.companyId,
      payload.provider
    );

    const provider = getProviderIntegration(
      client,
      payload.companyId,
      integration.id,
      integration.config
    );

    const results = {
      success: [] as any[],
      failed: [] as { entity: AccountingEntity; error: string }[],
    };

    for (const entity of payload.entities) {
      try {
        const isUpsert =
          entity.operation === "create" ||
          entity.operation === "update" ||
          entity.operation === "sync";

        const handler = isUpsert
          ? UPSERT_MAP[entity.entityType]
          : DELETE_MAP[entity.entityType];

        const result = await handler({
          client,
          entity,
          provider,
          payload: { syncDirection: payload.syncDirection, ...payload },
        });

        results.success.push(result);
      } catch (error) {
        console.error(
          `Failed to process ${entity.entityType} ${entity.entityId}:`,
          error
        );

        results.failed.push({
          entity,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  },
});
