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

export const workflowPublishValidator = z.object({
  versionId: z.string().min(1, { message: "Version is required" })
});

export const workflowToggleValidator = z.object({
  active: zfd.checkbox()
});

export const workflowVersionValidator = z.object({
  copyFromVersionId: z.string().min(1, { message: "Version is required" })
});
