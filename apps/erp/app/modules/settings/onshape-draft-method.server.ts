import type { Database, Json } from "@carbon/database";
import { correlateCopiedLines } from "@carbon/ee";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import type { SupabaseClient } from "@supabase/supabase-js";
import { copyMakeMethod, upsertMakeMethodVersion } from "~/modules/items";

type Client = SupabaseClient<Database>;

/**
 * The Draft make method a push should write into, for an item whose current
 * method is released.
 *
 * Carbon never edits a live method in place: a change is a new Draft version
 * that supersedes the Active one when it is released (the `Version` change
 * type does exactly this). The panel used to refuse instead — "make method is
 * released" — which dead-ended anyone updating a released assembly's BOM and
 * made a whole-tree push of any shipped product a wall of errors, since most
 * of its sub-assemblies are released.
 *
 * Creating a Draft changes nothing live. The new version sits beside the
 * Active one until a person releases it, so the cutover is still Carbon's
 * decision and the push is still only authoring.
 *
 * Idempotent by construction: a second push finds the Draft the first one made
 * and writes into it, because `activeMakeMethods` always prefers the Active
 * row and would otherwise hand back the released method every time — spawning
 * a new version per push.
 */
export async function ensureDraftMakeMethod(
  client: Client,
  args: {
    itemId: string;
    activeMethodId: string;
    companyId: string;
    userId: string;
  }
): Promise<
  | { ok: true; id: string; created: boolean; version: number | null }
  | { ok: false; error: string }
> {
  const { itemId, activeMethodId, companyId, userId } = args;

  const existing = await client
    .from("makeMethod")
    .select("id, version")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    return { ok: false, error: existing.error.message };
  }
  if (existing.data?.id) {
    return {
      ok: true,
      id: existing.data.id,
      created: false,
      version: existing.data.version ?? null
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
  const copied = await copyMakeMethod(client, {
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
  if (copied.error) {
    return {
      ok: false,
      error: `draft version created but its method could not be copied (${copied.error.message})`
    };
  }

  const carried = await carryLineOwnership(client, {
    sourceMethodId: activeMethodId,
    targetMethodId: draftId,
    companyId,
    userId
  });
  if (carried) return { ok: false, error: carried };

  return { ok: true, id: draftId, created: true, version };
}

/**
 * Re-point this integration's line mappings at the copied lines.
 *
 * Ownership is what stops a push replacing a line somebody added by hand, and
 * it lives in `externalIntegrationMapping` keyed on the line id. The copy has
 * new ids, so without this every Onshape-owned line in the draft reads as
 * manual and the next push inserts a duplicate beside each — the compounding
 * the apply's own comments warn about.
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
  if ((mappings.data ?? []).length === 0) return null; // nothing pushed here yet

  const [sourceLines, targetLines] = await Promise.all([
    client
      .from("methodMaterial")
      .select("id, itemId, order")
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
  const paired = correlateCopiedLines(
    (sourceLines.data ?? []).filter((line) => owned.has(line.id)),
    targetLines.data ?? []
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
    return `draft version created but ${inserts.length} of its lines are not linked to Onshape (${written.error.message}); a later push would duplicate them`;
  }
  return null;
}
