import { z } from "zod";
import { zfd } from "zod-form-data";

export const workflowValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  description: zfd.text(z.string().optional())
});

export const workflowDefinitionSaveValidator = z.object({
  versionId: z.string().min(1, { message: "Version is required" }),
  nodes: z.string().min(1),
  edges: z.string().min(1),
  formatVersion: zfd.numeric(z.number().int())
});

/** Layout only. The one payload a published version accepts — see `$id.positions.tsx`. */
export const workflowNodePositionsValidator = z.object({
  versionId: z.string().min(1, { message: "Version is required" }),
  positions: z.string().min(1)
});

export const workflowTestRunValidator = z.object({
  /** The version the run is recorded against. The canvas can be a step ahead of it
   * — autosave is a second behind — but it is what a reader can open afterwards. */
  versionId: z.string().min(1),
  nodes: z.string().min(1),
  edges: z.string().min(1),
  formatVersion: zfd.numeric(z.number().int()),
  triggerNodeId: z.string().min(1, { message: "Trigger is required" }),
  /** Absent for a schedule trigger, which listens for no catalog event. */
  eventId: zfd.text(z.string().optional()),
  /** JSON: `{}` for a schedule trigger, `{ recordId }` for a record event,
   * `{ outputs: { <name>: <id> } }` for a moment. */
  triggerInput: z.string().min(1),
  /** The watched column's prior value, for a `.changed` event. Optional. */
  previousValue: z.string().optional()
});

/** Parsed out of `triggerInput` after the form validator passes. */
export const workflowTestRunInputSchema = z.union([
  z.object({ recordId: z.string().min(1) }),
  z.object({ outputs: z.record(z.string(), z.string().min(1)) }),
  z.object({})
]);

/** Shape of `workflow.canvasState` as stored. Parsed on read — an older or
 * hand-edited blob falls back to fit-view rather than a broken viewport. */
export const workflowCanvasStateSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
  panOnScroll: z.boolean()
});

export type WorkflowCanvasState = z.infer<typeof workflowCanvasStateSchema>;

export const workflowCanvasStateValidator = z.object({
  x: zfd.numeric(z.number()),
  y: zfd.numeric(z.number()),
  zoom: zfd.numeric(z.number().positive()),
  panOnScroll: zfd.checkbox()
});

export const workflowPublishValidator = z.object({
  versionId: z.string().min(1, { message: "Version is required" })
});

export const workflowVersionValidator = z.object({
  copyFromVersionId: z.string().min(1, { message: "Version is required" })
});
