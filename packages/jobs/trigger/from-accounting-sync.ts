/**
 * Task to sync entities from accounting providers to Carbon
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
import { logger, task } from "@trigger.dev/sdk";
import z from "zod";

const PayloadSchema = AccountingSyncSchema.extend({
  syncDirection: AccountingSyncSchema.shape.syncDirection.exclude([
    "to-accounting",
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
      { externalId: entity.entityId }
    );

    if (!customer && customer) {
      logger.info(`Customer ${entity.entityId} found, updating...`);

      const id = customer.externalId[provider.id].id;

      const remote = await provider.contacts.get(id);

      return {
        id: entity.entityId,
        message: "Updated successfully",
      };
    }

    logger.info(`Customer ${entity.entityId} not found, creating...`);

    // If not found, fetch from provider and create a new customer
    const remote = await provider.contacts.get(entity.entityId);

    if (!remote.isCustomer) {
      return {
        id: entity.entityId,
        message: "Skipped: Contact is not a customer",
      };
    }

    logger.info(`Inserting customer with contact id: ${remote.id}`, remote);

    try {
    } catch (error) {
      logger.error(
        `Failed to create customer for contact id: ${remote.id} ${error.message}`
      );

      return {
        id: entity.entityId,
        message: `Failed to create customer: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }

    return {
      id: entity.entityId,
      message: "Created successfully",
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

    return {
      id: entity.entityId,
      message: "Deleted successfully",
    };
  },
  async vendor({ client, entity, payload, provider }) {},
};

export const fromAccountsSyncTask = task({
  id: "from-accounting-sync",
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
