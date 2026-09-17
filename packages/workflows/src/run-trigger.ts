import { z } from "zod";

/** What fired a workflow run — the wire contract shared by the matcher, event type and engine. */
export const runTriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("record"),
    table: z.string(),
    recordId: z.string(),
    operation: z.enum(["INSERT", "UPDATE", "DELETE"]),
    record: z.record(z.string(), z.unknown()).nullable(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable()
  }),
  z.object({
    kind: z.literal("moment"),
    moment: z.string(),
    outputs: z.record(z.string(), z.object({ id: z.string() }).passthrough())
  }),
  z.object({
    kind: z.literal("schedule"),
    /** The claimed nextRunAt, ISO 8601 in UTC. */
    dueAt: z.string()
  })
]);

export type RunTrigger = z.infer<typeof runTriggerSchema>;
