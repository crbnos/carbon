// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import type { DraftCandidate } from "@carbon/ee/onshape";
import {
  DRAFT_MARKER_ENTITY_TYPE,
  loadReusableDrafts,
  pairOwnedCopiedLines
} from "@carbon/ee/onshape";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { copyMakeMethod, upsertMakeMethodVersion } from "~/modules/items";
import { getDatabaseClient } from "~/services/database.server";

type Client = SupabaseClient<Database>;

const logger = getLogger("erp", "onshape", "draft-method");

/**
 * The Draft make method a push should write into, for an item whose current
 * method is released.
 *
 * Carbon never edits a live method in place: a change is a new Draft version
 * that supersedes the Active one when it is released (the `Version` change
 * type does exactly this).
 *
 * Creating a Draft changes nothing live. The new version sits beside the
 * Active one until a person releases it.
 *
 * A Draft is reused only when this integration made it from the current
 * Active method (`pickReusableDraft`): a second push finds the Draft the first
 * one made. Any other Draft — a person's, a change notice's, one copied from
 * an older version, one whose copy failed — is left alone and a new version
 * is created beside it. The marker row that makes a Draft reusable is written
 * only once its copy and line ownership are complete; a failure before that
 * deletes the new Draft, so a half-built one is never released by mistake.
 */
export async function ensureDraftMakeMethod(
  client: Client,
  args: {
    itemId: string;
    activeMethodId: string;
    companyId: string;
    userId: string;
    /**
     * The reusable Draft when the caller already loaded it for many items
     * (`loadReusableDrafts`); null when it found none. Omitted, it is read.
     */
    reusableDraft?: DraftCandidate | null;
  }
): Promise<
  | { ok: true; id: string; created: boolean; version: number | null }
  | { ok: false; error: string }
> {
  const { itemId, activeMethodId, companyId, userId } = args;
  const serviceRole = getCarbonServiceRole();

  let existing = args.reusableDraft;
  if (existing === undefined) {
    try {
      const reusable = await loadReusableDrafts(
        client,
        serviceRole,
        companyId,
        new Map([[itemId, activeMethodId]])
      );
      existing = reusable.get(itemId) ?? null;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "could not read Drafts"
      };
    }
  }
  if (existing) {
    return {
      ok: true,
      id: existing.id,
      created: false,
      version: existing.version
    };
  }

  // Numbered off every version, not off the Active one: parallel authoring of
  // the same item otherwise collides on makeMethod (itemId, version).
  const highest = await client
    .from("makeMethod")
    .select("version")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (highest.error) {
    return { ok: false, error: highest.error.message };
  }
  const version = (highest.data?.version ?? 0) + 1;

  const draft = await upsertMakeMethodVersion(client, {
    copyFromId: activeMethodId,
    // Deliberately no `activeVersionId`: that flips a version to Active, and
    // this push must leave what is live exactly as it found it.
    version,
    companyId,
    createdBy: userId
  });
  if (draft.error || !draft.data?.id) {
    return {
      ok: false,
      error: draft.error?.message ?? "could not create a draft version"
    };
  }
  const draftId = draft.data.id;

  // The new version is an empty shell — `upsertMakeMethodVersion` copies the
  // method's own columns, not its BOM or routing. Without this the draft would
  // release as an assembly stripped of every line nobody pushed.
  const copied = await copyMakeMethod(client, getDatabaseClient(), {
    sourceId: activeMethodId,
    targetId: draftId,
    companyId,
    userId,
    billOfMaterial: true,
    billOfProcess: true,
    parameters: true,
    tools: true,
    steps: true,
    workInstructions: true
  });
  const failure = copied.error
    ? `its method could not be copied (${copied.error.message})`
    : await carryLineOwnership(client, {
        sourceMethodId: activeMethodId,
        targetMethodId: draftId,
        companyId,
        userId
      });
  const marked = failure
    ? null
    : await client.from("externalIntegrationMapping").insert({
        entityType: DRAFT_MARKER_ENTITY_TYPE,
        entityId: draftId,
        integration: ONSHAPE_V2_INTEGRATION_ID,
        // Unique per Draft; the source is in metadata, so two Drafts made
        // from one Active method never collide on the externalId index.
        externalId: draftId,
        metadata: { sourceMethodId: activeMethodId, itemId } as Json,
        lastSyncedAt: datetime.timestamp(),
        companyId,
        createdBy: userId
      });
  const problem =
    failure ??
    (marked?.error
      ? `it could not be marked as Onshape's (${marked.error.message})`
      : null);
  if (!problem) {
    return { ok: true, id: draftId, created: true, version };
  }

  // A half-built Draft must not survive: released, it would ship the assembly
  // without whatever failed to copy. The panel user lacks parts_delete, so the
  // service role removes it; its lines and mappings cascade or are cleared.
  const discarded = await discardDraft(serviceRole, {
    draftId,
    companyId
  });
  return {
    ok: false,
    error: discarded
      ? `a draft version was created but ${problem}, so it was removed; push again`
      : `a draft version was created but ${problem}, and it could not be removed — delete version ${version} before pushing again`
  };
}

async function discardDraft(
  serviceRole: Client,
  args: { draftId: string; companyId: string }
): Promise<boolean> {
  const { draftId, companyId } = args;
  const mappings = await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("companyId", companyId)
    .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
    .eq("entityType", "methodMaterial")
    .eq("metadata->>makeMethodId", draftId);
  const removed = await serviceRole
    .from("makeMethod")
    .delete()
    .eq("id", draftId)
    .eq("companyId", companyId);
  const error = mappings.error ?? removed.error;
  if (error) {
    logger.error("Failed to discard a half-built Onshape Draft", {
      companyId,
      draftId,
      error
    });
    return false;
  }
  return true;
}

/**
 * Re-point this integration's line mappings at the copied lines.
 *
 * Ownership is what stops a push replacing a line somebody added by hand, and
 * it lives in `externalIntegrationMapping` keyed on the line id. The copy has
 * new ids, so without this every Onshape-owned line in the draft reads as
 * manual and the next push inserts a duplicate beside each.
 *
 * Returns an error message, or null when the ownership carried across.
 */
async function carryLineOwnership(
  client: Client,
  args: {
    sourceMethodId: string;
    targetMethodId: string;
    companyId: string;
    userId: string;
  }
): Promise<string | null> {
  const { sourceMethodId, targetMethodId, companyId, userId } = args;

  const mappings = await client
    .from("externalIntegrationMapping")
    .select("entityId, externalId, metadata, lastSyncedAt")
    .eq("companyId", companyId)
    .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
    .eq("entityType", "methodMaterial")
    .eq("metadata->>makeMethodId", sourceMethodId);
  if (mappings.error) return mappings.error.message;
  if ((mappings.data ?? []).length === 0) return null;

  const [sourceLines, targetLines] = await Promise.all([
    client
      .from("methodMaterial")
      .select("id, itemId, order, quantity")
      .eq("makeMethodId", sourceMethodId)
      .eq("companyId", companyId),
    client
      .from("methodMaterial")
      .select("id, itemId, order")
      .eq("makeMethodId", targetMethodId)
      .eq("companyId", companyId)
  ]);
  if (sourceLines.error) return sourceLines.error.message;
  if (targetLines.error) return targetLines.error.message;

  const owned = new Set((mappings.data ?? []).map((row) => row.entityId));
  const paired = pairOwnedCopiedLines(
    sourceLines.data ?? [],
    targetLines.data ?? [],
    owned
  );

  const inserts = [];
  for (const mapping of mappings.data ?? []) {
    const targetLineId = paired.get(mapping.entityId);
    // Unpaired means the copy has no counterpart; leaving it unmapped makes
    // the line manual, which preserves it. Duplicating is the worse failure.
    if (!targetLineId) continue;
    const metadata = {
      ...((mapping.metadata as Record<string, unknown> | null) ?? {}),
      makeMethodId: targetMethodId
    };
    inserts.push({
      entityType: "methodMaterial",
      entityId: targetLineId,
      integration: ONSHAPE_V2_INTEGRATION_ID,
      externalId: mapping.externalId,
      metadata: metadata as Json,
      lastSyncedAt: mapping.lastSyncedAt,
      companyId,
      createdBy: userId
    });
  }
  if (inserts.length === 0) return null;

  const written = await client
    .from("externalIntegrationMapping")
    .insert(inserts);
  if (written.error) {
    return `${inserts.length} of its lines could not be linked to Onshape (${written.error.message})`;
  }
  return null;
}
