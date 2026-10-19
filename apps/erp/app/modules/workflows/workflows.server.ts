// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import type { Json } from "@carbon/database";
import { CURRENT_DEFINITION_FORMAT_VERSION } from "@carbon/ee/workflows";
import { z } from "zod";
import { createNode, TRIGGER_POSITION } from "./ui/Builder/graph";
import * as service from "./workflows.service";

/**
 * Create a workflow, with a first version holding only its trigger.
 *
 * @remarks
 * Needs a plan that includes workflows. The creator becomes its owner, so it
 * runs with the creator's permissions. Version 1 is seeded with one trigger
 * node, so the builder's canvas is never empty. The workflow is a draft:
 * nothing fires until a version is published.
 */
export const createWorkflow = defineServiceFn({
  input: z.object({
    name: z.string().trim().min(1),
    description: z.string().optional()
  }),
  permission: { create: "workflows" },

  async run(ctx, { name, description }) {
    const gated = await service.refuseUnlessWorkflowsEnabled(ctx);
    if (gated) return gated;
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const created = await service.insertWorkflow(client, {
      name,
      description,
      companyId,
      createdBy: userId
    });
    if (created.error || !created.data) {
      return ctx.error("internal", "Failed to create workflow", created.error);
    }

    const version = await service.insertWorkflowVersion(client, {
      workflowId: created.data.id,
      companyId,
      versionNumber: 1,
      nodes: [createNode("trigger", TRIGGER_POSITION)] as unknown as Json,
      edges: [] as unknown as Json,
      formatVersion: CURRENT_DEFINITION_FORMAT_VERSION,
      createdBy: userId
    });
    if (version.error) {
      return ctx.error(
        "internal",
        "Failed to create the first workflow version",
        version.error
      );
    }

    return { id: created.data.id };
  }
});

/**
 * Delete a workflow, with its versions and run history.
 *
 * @remarks
 * Needs a plan that includes workflows. The cascade takes the workflow's
 * trigger rows; the company's event subscriptions are then reconciled, so a
 * table no workflow watches any more stops queueing events. A failed
 * reconcile is logged and does not fail the delete: the next publish or
 * unpublish reconciles it.
 */
export const deleteWorkflow = defineServiceFn({
  input: z.object({ id: z.string().min(1) }),
  permission: { delete: "workflows" },

  async run(ctx, { id }) {
    const gated = await service.refuseUnlessWorkflowsEnabled(ctx);
    if (gated) return gated;

    const deleted = await service.deleteWorkflow(
      ctx.asCaller.supabase,
      id,
      ctx.company.id
    );
    if (deleted.error) {
      return ctx.error("internal", "Failed to delete workflow", deleted.error);
    }

    await service.syncAfterWorkflowDelete(ctx.asSystem.pg, ctx.company.id, id);
    return { id };
  }
});
