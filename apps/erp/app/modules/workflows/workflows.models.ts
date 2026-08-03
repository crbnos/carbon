import { z } from "zod";
import { zfd } from "zod-form-data";

export const workflowValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  description: zfd.text(z.string().optional())
});

export const workflowDefinitionSaveValidator = z.object({
  versionId: z.string().min(1, { message: "Version is required" }),
  nodes: z.string().min(1),
  edges: z.string().min(1),
  formatVersion: zfd.numeric(z.number().int())
});

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

export const workflowToggleValidator = z.object({
  active: zfd.checkbox()
});

export const workflowVersionValidator = z.object({
  copyFromVersionId: z.string().min(1, { message: "Version is required" })
});
