import { z } from "zod";

/**
 * What fired a workflow run. Lives here because it is the one wire contract
 * shared by the matcher (`@carbon/jobs`), the `carbon/workflow-run.queued`
 * event type (`@carbon/lib`) and the phase-4 engine — all of which already
 * depend on this package.
 */
export const runTriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("record"),
    table: z.string(),
    recordId: z.string(),
    operation: z.enum(["INSERT", "UPDATE", "DELETE"]),
    record: z.record(z.unknown()).nullable(),
    before: z.record(z.unknown()).nullable(),
    after: z.record(z.unknown()).nullable()
  }),
  z.object({
    kind: z.literal("moment"),
    moment: z.string(),
    outputs: z.record(z.object({ id: z.string() }).passthrough())
  })
]);

export type RunTrigger = z.infer<typeof runTriggerSchema>;
