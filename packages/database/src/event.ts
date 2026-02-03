import type { Kysely } from "kysely";
import { z } from "zod";
import type { KyselyDatabase } from "./client.ts";

export const OperationSchema = z.enum([
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE"
]);

const HandlerTypeSchema = z.enum(["WEBHOOK", "WORKFLOW", "SYNC"]);

export const EventSchema = z.discriminatedUnion("operation", [
  z.object({
    table: z.string(),
    operation: z.enum(["UPDATE"]),
    recordId: z.string(),
    new: z.record(z.any()),
    old: z.record(z.any()),
    timestamp: z.string()
  }),
  z.object({
    table: z.string(),
    operation: z.enum(["INSERT"]),
    recordId: z.string(),
    new: z.record(z.any()),
    old: z.null(),
    timestamp: z.string()
  }),
  z.object({
    table: z.string(),
    operation: z.enum(["DELETE", "TRUNCATE"]),
    recordId: z.string(),
    new: z.null(),
    old: z.record(z.any()),
    timestamp: z.string()
  })
]);

export const QueueMessageSchema = z.object({
  subscriptionId: z.string(),
  triggerType: z.enum(["ROW", "STATEMENT"]),
  handlerType: HandlerTypeSchema,
  handlerConfig: z.record(z.any()),
  companyId: z.string(),
  event: EventSchema
});

export type EventSystemEvent = z.infer<typeof EventSchema>;
export type HandlerType = z.infer<typeof HandlerTypeSchema>;
export type QueueMessage = z.infer<typeof QueueMessageSchema>;

// The Main Subscription Schema
export const CreateSubscriptionSchema = z.object({
  name: z.string().min(1, "Name is required"),
  // The table name in your database
  table: z.custom<keyof Pick<KyselyDatabase, keyof KyselyDatabase>>(
    (val) => typeof val === "string",
    {
      message: "Table name must be a string"
    }
  ),
  // The company this subscription belongs to
  companyId: z.string().min(1, "Company ID is required"),
  // Must provide at least one operation (e.g. ['INSERT'])
  operations: z
    .array(OperationSchema)
    .min(1, "At least one operation is required"),
  // The type determines how Trigger.dev processes it
  type: HandlerTypeSchema,
  // Configuration specific to the handler (URL for webhooks, WorkflowID for workflows)
  // We allow any object here since it's stored as JSONB
  config: z.record(z.any()).default({}),
  // Database-level filtering (e.g. { status: "paid" })
  filter: z.record(z.any()).default({}),
  // Optimization: specific batch size for PGMQ
  batchSize: z.number().int().positive().default(50),
  // Defaults to true
  active: z.boolean().default(true)
});

export type CreateSubscriptionParams = z.input<typeof CreateSubscriptionSchema>;

export async function createEventSystemSubscription(
  client: Kysely<KyselyDatabase>,
  input: CreateSubscriptionParams
) {
  // 1. Runtime Validation
  // This throws a clear ZodError if inputs are wrong (e.g. missing 'table' or invalid 'type')
  const params = CreateSubscriptionSchema.parse(input);

  // 2. Database Insert
  // Note: We cast arrays/objects to ensure Postgres driver handles them correctly
  const result = await client
    .insertInto("eventSystemSubscription")
    .values({
      name: params.name,
      table: params.table,
      companyId: params.companyId,
      operations: params.operations,
      filter: params.filter,
      handlerType: params.type,
      config: params.config,
      batchSize: params.batchSize,
      active: params.active
    })
    .onConflict((oc) =>
      oc.constraint("unique_subscription_name_per_company").doUpdateSet({
        operations: params.operations,
        filter: params.filter,
        handlerType: params.type,
        config: params.config,
        batchSize: params.batchSize,
        active: params.active
      })
    )
    .returning(["id", "name", "handlerType", "table"])
    .executeTakeFirst();

  return result;
}

export async function deleteEventSystemSubscription(
  client: Kysely<KyselyDatabase>,
  subscriptionId: string
) {
  await client
    .deleteFrom("eventSystemSubscription")
    .where("id", "=", subscriptionId)
    .execute();
}

export async function deleteEventSystemSubscriptionsByName(
  client: Kysely<KyselyDatabase>,
  companyId: string,
  name: string
) {
  await client
    .deleteFrom("eventSystemSubscription")
    .where("companyId", "=", companyId)
    .where("name", "=", name)
    .execute();
}
