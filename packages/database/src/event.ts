import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const OperationSchema = z.enum([
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE"
]);

const HandlerTypeSchema = z.enum([
  "WEBHOOK",
  "WORKFLOW",
  "SYNC",
  "SEARCH",
  "AUDIT"
]);

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
  actorId: z.string().nullish(), // Captured from auth.uid() at trigger time
  event: EventSchema
});

export type EventSystemEvent = z.infer<typeof EventSchema>;
export type HandlerType = z.infer<typeof HandlerTypeSchema>;
export type QueueMessage = z.infer<typeof QueueMessageSchema>;
export type Operation = z.infer<typeof OperationSchema>;

// The Main Subscription Schema
export const CreateSubscriptionSchema = z.object({
  name: z.string().min(1, "Name is required"),
  // The table name in your database
  table: z.string().min(1, "Table name is required"),
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
  // Defaults to true
  active: z.boolean().default(true)
});

export type CreateSubscriptionParams = z.input<typeof CreateSubscriptionSchema>;

// Return type for subscription creation
export type SubscriptionResult = {
  id: string;
  name: string;
  handlerType: string;
  table: string;
};

// Type for Supabase client with our custom RPC functions
// These RPC functions are defined in the migration
type EventSystemRpcClient = {
  rpc(
    fn: "create_event_system_subscription",
    params: {
      p_name: string;
      p_table: string;
      p_company_id: string;
      p_operations: string[];
      p_handler_type: string;
      p_config?: Record<string, any>;
      p_filter?: Record<string, any>;
      p_active?: boolean;
    }
  ): Promise<{ data: SubscriptionResult[] | null; error: any }>;
  rpc(
    fn: "delete_event_system_subscription",
    params: { p_subscription_id: string }
  ): Promise<{ data: any; error: any }>;
  rpc(
    fn: "delete_event_system_subscriptions_by_name",
    params: { p_company_id: string; p_name: string }
  ): Promise<{ data: any; error: any }>;
};

/**
 * Creates or updates an event system subscription using RPC.
 *
 * @param client - Supabase client (e.g., from getCarbonServiceRole())
 * @param input - Subscription parameters
 * @returns The created/updated subscription
 * @throws Error if the RPC call fails
 *
 * @example
 * ```ts
 * const client = getCarbonServiceRole();
 * const subscription = await createEventSystemSubscription(client, {
 *   name: "my-webhook",
 *   table: "customer",
 *   companyId: "company-123",
 *   operations: ["INSERT", "UPDATE"],
 *   type: "WEBHOOK",
 *   config: { url: "https://example.com/webhook" },
 * });
 * ```
 */
export async function createEventSystemSubscription(
  client: SupabaseClient | EventSystemRpcClient,
  input: CreateSubscriptionParams
): Promise<SubscriptionResult | undefined> {
  // 1. Runtime Validation
  const params = CreateSubscriptionSchema.parse(input);

  // 2. Call RPC function
  const { data, error } = await (client as EventSystemRpcClient).rpc(
    "create_event_system_subscription",
    {
      p_name: params.name,
      p_table: params.table,
      p_company_id: params.companyId,
      p_operations: params.operations,
      p_handler_type: params.type,
      p_config: params.config,
      p_filter: params.filter,
      p_active: params.active
    }
  );

  if (error) {
    throw new Error(`Failed to create subscription: ${error.message}`);
  }

  return data?.[0];
}

/**
 * Deletes an event system subscription by ID.
 *
 * @param client - Supabase client
 * @param subscriptionId - The ID of the subscription to delete
 * @throws Error if the RPC call fails
 */
export async function deleteEventSystemSubscription(
  client: SupabaseClient | EventSystemRpcClient,
  subscriptionId: string
): Promise<void> {
  const { error } = await (client as EventSystemRpcClient).rpc(
    "delete_event_system_subscription",
    {
      p_subscription_id: subscriptionId
    }
  );

  if (error) {
    throw new Error(`Failed to delete subscription: ${error.message}`);
  }
}

/**
 * Deletes all event system subscriptions with a given name for a company.
 *
 * @param client - Supabase client
 * @param companyId - The company ID
 * @param name - The subscription name to delete
 * @throws Error if the RPC call fails
 */
export async function deleteEventSystemSubscriptionsByName(
  client: SupabaseClient | EventSystemRpcClient,
  companyId: string,
  name: string
): Promise<void> {
  const { error } = await (client as EventSystemRpcClient).rpc(
    "delete_event_system_subscriptions_by_name",
    {
      p_company_id: companyId,
      p_name: name
    }
  );

  if (error) {
    throw new Error(`Failed to delete subscriptions: ${error.message}`);
  }
}
