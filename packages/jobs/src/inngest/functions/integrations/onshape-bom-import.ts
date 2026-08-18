// Onshape v2 BOM import.
//
// Replaces the legacy path, which ran inside the `sync` Deno edge function and
// was synchronously awaited by the request. That single choice is upstream of
// most of what is wrong with it: the edge runtime only mounts
// `supabase/functions/`, so it cannot reuse `createRevision` or `get-method`
// (which is why the revision-preference sort exists in three hand-written
// copies); it cannot retry; it cannot report progress; and a failure part-way
// leaves the item tree half-written with nothing to resume from.
//
// Here the write is an Inngest job: retries, per-step isolation, and room for
// the asset pull to run in the same execution.
//
// What it does NOT do, deliberately:
//   * it never matches on part numbers — every row resolves through the
//     element mapping and then by revision;
//   * it never deletes-and-rebuilds a material list — see reconcile.ts;
//   * it never creates a revision of an existing part. A row naming a revision
//     Carbon does not have is REPORTED, not minted: auto-advancing revisions
//     from a BOM import is a policy decision that has not been made, and doing
//     it silently is exactly the class of behaviour this rebuild exists to end.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  buildElementExternalId,
  buildOnshapeBomTree,
  getOnshapeClient,
  getOnshapeV2Settings,
  type OnshapeBomNode,
  parseOnshapeBom,
  readItemIdsForElements,
  reconcileMethodMaterials,
  resolveBomRow,
  writeElementMapping
} from "@carbon/ee/onshape";
import { z } from "zod";
import { inngest } from "../../client";
import { withRateLimitRetry } from "./onshape-backfill";
import {
  groupAssetTargetsByElement,
  pullOnshapeAssetsForElement
} from "./onshape-v2-assets";

const PayloadSchema = z.object({
  companyId: z.string(),
  userId: z.string(),
  makeMethodId: z.string(),
  documentId: z.string(),
  versionId: z.string(),
  elementId: z.string()
});

type Payload = z.infer<typeof PayloadSchema>;

export type OnshapeBomImportOutcome = {
  imported: number;
  created: number;
  updated: number;
  removed: number;
  assetsAttached: number;
  assetsSkipped: number;
  /** Rows Onshape sent that could not be read at all. */
  unreadableRows: number;
  /** Rows the import refused, each with why. */
  skipped: Array<{ partNumber: string; revision: string; reason: string }>;
};

type Carbon = ReturnType<typeof getCarbonServiceRole>;

/**
 * The make method a BOM may be written into.
 *
 * Draft only, and never one owned by an open change notice. The legacy writer
 * resolves a method itself and lands in a change notice's staged BOM often
 * enough that release then ships whatever the import left — the CO draft is
 * numbered max+1, so an "newest Draft" lookup finds it.
 */
async function assertWritableMethod(
  carbon: Carbon,
  methodId: string,
  companyId: string
) {
  const method = await carbon
    .from("makeMethod")
    .select(
      "id, itemId, status, changeOrderId, companyId, item(revisionStatus)"
    )
    .eq("id", methodId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (method.error || !method.data) {
    throw new Error("Make method not found");
  }
  if (method.data.status !== "Draft") {
    throw new Error(
      `Onshape can only write into a Draft method; this one is ${method.data.status}. Create a new version first.`
    );
  }
  if (method.data.changeOrderId) {
    throw new Error(
      "This method belongs to an open change notice. Import into the item's own draft instead, so a release cannot ship what the import left."
    );
  }

  // The PLM revision lock. Every in-app BOM mutation goes through
  // checkRevisionLock, which refuses when the owning item is at revisionStatus
  // 'Production' under the default plmReleaseControl 'enforce'. This job cannot
  // call it — packages/jobs must not import ~/modules — so the rule is
  // replicated, deliberately, the same way onshape-release-import duplicates
  // CHANGE_NOTICE_OPEN_STATUSES.
  //
  // Without it there is a real escape hatch: creating a new method version is
  // NOT lock-gated, so a user refused at the UI can mint a Draft on a
  // Production item and have Onshape write the BOM the UI would not let them
  // touch a single line of.
  const owningItem = method.data.item as { revisionStatus?: string } | null;
  if (owningItem?.revisionStatus === "Production") {
    const settings = await carbon
      .from("companySettings")
      .select("plmReleaseControl")
      .eq("id", companyId)
      .maybeSingle();

    const releaseControl = settings.data?.plmReleaseControl ?? "enforce";

    if (releaseControl === "enforce") {
      throw new Error(
        "This item's revision is in Production and the company enforces release control. Raise a change notice instead of importing over a released revision."
      );
    }
  }

  return method.data;
}

/** Reconcile one method's materials against the children Onshape reports. */
async function reconcileOne(
  carbon: Carbon,
  args: {
    companyId: string;
    userId: string;
    makeMethodId: string;
    desired: Array<{ itemId: string; quantity: number; order: number }>;
    /** Components the import refused; their lines must survive untouched. */
    protectedItemIds: string[];
    /** False when the BOM was only partially readable — never delete then. */
    allowRemoval: boolean;
  }
) {
  const existing = await carbon
    .from("methodMaterial")
    .select("id, itemId, quantity, order")
    .eq("makeMethodId", args.makeMethodId)
    .eq("companyId", args.companyId);

  if (existing.error) {
    throw new Error(
      `Failed to read existing materials: ${existing.error.message}`
    );
  }

  const plan = reconcileMethodMaterials(
    (existing.data ?? []).map(
      (row: {
        id: string;
        itemId: string;
        quantity: number | null;
        order: number | null;
      }) => ({
        id: row.id,
        itemId: row.itemId,
        quantity: Number(row.quantity ?? 0),
        order: Number(row.order ?? 0)
      })
    ),
    args.desired,
    { protectedItemIds: args.protectedItemIds }
  );

  // Only the two columns Onshape owns are written. Everything else on a
  // surviving row — methodOperationId, scrapQuantity, kit, sourcingType,
  // storageUnitIds, tags, and its methodMaterialStep children — is untouched
  // because it is never named here.
  for (const change of plan.update) {
    const updated = await carbon
      .from("methodMaterial")
      .update({
        quantity: change.quantity,
        order: change.order,
        updatedBy: args.userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", change.id)
      .eq("companyId", args.companyId);
    if (updated.error) {
      throw new Error(`Failed to update material: ${updated.error.message}`);
    }
  }

  if (plan.insert.length > 0) {
    // methodMaterial.unitOfMeasureCode is NOT NULL, and the right value is the
    // component's own unit — not a constant. Onshape's BOM does carry a "Unit
    // of measure" column, but it describes the CAD quantity rather than
    // Carbon's stocking unit, so the item is the authority here.
    const components = await carbon
      .from("item")
      .select("id, unitOfMeasureCode, type, defaultMethodType")
      .in(
        "id",
        plan.insert.map((line) => line.itemId)
      )
      .eq("companyId", args.companyId);

    if (components.error) {
      throw new Error(
        `Failed to read component units: ${components.error.message}`
      );
    }

    const componentById = new Map(
      (components.data ?? []).map(
        (item: {
          id: string;
          unitOfMeasureCode: string | null;
          type: string | null;
          defaultMethodType: string | null;
        }) => [item.id, item]
      )
    );

    const inserted = await carbon.from("methodMaterial").insert(
      plan.insert.map((line) => ({
        makeMethodId: args.makeMethodId,
        itemId: line.itemId,
        quantity: line.quantity,
        order: line.order,
        unitOfMeasureCode:
          componentById.get(line.itemId)?.unitOfMeasureCode ?? "EA",
        // Denormalized from the component so the BOM renders and sources
        // correctly. Omitting them lets the column defaults ("Part" /
        // "Make to Order") disagree with the item they describe — a purchased
        // component would read as something to manufacture.
        itemType: componentById.get(line.itemId)?.type ?? undefined,
        methodType:
          (componentById.get(line.itemId)?.defaultMethodType as
            | "Make to Order"
            | "Purchase to Order"
            | "Pull from Inventory"
            | undefined) ?? undefined,
        companyId: args.companyId,
        createdBy: args.userId
      }))
    );
    if (inserted.error) {
      throw new Error(`Failed to add materials: ${inserted.error.message}`);
    }
  }

  if (plan.remove.length > 0 && args.allowRemoval) {
    const removed = await carbon
      .from("methodMaterial")
      .delete()
      .in(
        "id",
        plan.remove.map((row) => row.id)
      )
      .eq("companyId", args.companyId);
    if (removed.error) {
      throw new Error(`Failed to remove materials: ${removed.error.message}`);
    }
  }

  return {
    inserted: plan.insert.length,
    updated: plan.update.length,
    removed: args.allowRemoval ? plan.remove.length : 0,
    keptBecauseUnreadable: args.allowRemoval ? 0 : plan.remove.length,
    protectedCount: plan.protected.length
  };
}

export const onshapeBomImportFunction = inngest.createFunction(
  {
    id: "onshape-bom-import",
    // Every 429 reschedule consumes one retry, and an import can make many
    // export calls — the backfill sets 10 for exactly this reason.
    retries: 10,
    // One import at a time per make method: two concurrent runs would each
    // reconcile against a list the other is changing.
    concurrency: { key: "event.data.makeMethodId", limit: 1 }
  },
  { event: "carbon/onshape-bom-import" },
  async ({ event, step }) => {
    const payload: Payload = PayloadSchema.parse(event.data);
    const carbon = getCarbonServiceRole();

    // Re-read the gate every execution, so turning the pipeline back to legacy
    // also kills an in-flight retry.
    const settings = await getOnshapeV2Settings(carbon, payload.companyId);
    if (settings.readFailed) {
      // A transient database error must not masquerade as "this company is on
      // legacy" — that would turn a real import into a silent no-op run.
      throw new Error(
        "Could not read the Onshape integration settings; retrying."
      );
    }
    if (!settings.isV2) {
      return { pipelineSkipped: true as const, reason: "pipeline-not-v2" };
    }

    const result = await step.run("import-bom", async () => {
      const method = await assertWritableMethod(
        carbon,
        payload.makeMethodId,
        payload.companyId
      );

      const connection = await getOnshapeClient(
        carbon,
        payload.companyId,
        payload.userId
      );
      if (!connection.client) {
        throw new Error(connection.error ?? "Onshape is not connected");
      }

      const parsed = parseOnshapeBom(
        await connection.client.getBillOfMaterials(
          payload.documentId,
          payload.versionId,
          payload.elementId
        )
      );

      const outcome: OnshapeBomImportOutcome = {
        imported: 0,
        created: 0,
        updated: 0,
        removed: 0,
        assetsAttached: 0,
        assetsSkipped: 0,
        unreadableRows: 0,
        skipped: []
      };

      outcome.unreadableRows = parsed.skipped + parsed.orphaned;

      if (parsed.rows.length === 0) {
        return outcome;
      }

      // Defense in depth for the route's gate — on the ASSEMBLY, not its rows.
      //
      // A child row's Revision cell is that COMPONENT's revision. Standard
      // content, a purchased part, or anything not covered by the assembly's
      // release legitimately has none while the assembly itself is released at
      // a named revision. Testing the children aborts a perfectly ordinary
      // released import, and since the route has already answered "Import
      // started", that failure is invisible.
      //
      // The queried assembly's own row IS the version's released-ness, which is
      // why includeTopLevelAssemblyRow is requested at all.
      if (
        !settings.allowUnreleasedSync &&
        parsed.topLevel &&
        !parsed.topLevel.revision
      ) {
        throw new Error(
          "This Onshape version has never been released and the company only syncs released versions."
        );
      }

      // Resolve the whole tree in one query, then by revision per row.
      const mappings = await readItemIdsForElements(carbon, {
        companyId: payload.companyId,
        refs: parsed.rows.map((row) => ({
          documentId: row.documentId,
          elementId: row.elementId,
          partId: row.partId
        }))
      });

      const candidateIds = Array.from(
        new Set(Array.from(mappings.values()).flat())
      );
      const revisionById = new Map<string, string | null>();
      // Chunked: PostgREST builds .in() into the URL, and a large assembly with
      // several revisions per part produces enough ids to exceed the request
      // line — which fails as a malformed request, not as "too many ids".
      const ID_CHUNK = 200;
      for (let i = 0; i < candidateIds.length; i += ID_CHUNK) {
        const items = await carbon
          .from("item")
          .select("id, revision")
          .in("id", candidateIds.slice(i, i + ID_CHUNK))
          .eq("companyId", payload.companyId);
        if (items.error) {
          throw new Error(
            `Failed to read mapped items: ${items.error.message}`
          );
        }
        for (const item of items.data ?? []) {
          revisionById.set(item.id, item.revision);
        }
      }

      // itemId per BOM row, minting only genuinely-unknown parts.
      const itemIdByRow = new Map<string, string>();
      // Components of rows the import REFUSED. Their existing material lines
      // must survive: "skipped" has to mean untouched, not deleted.
      const protectedItemIds = new Set<string>();

      // Rows whose geometry should be pulled, captured as they RESOLVE. The
      // itemId comes from resolveBomRow, never from the element mapping alone —
      // an element-level attach is revision-agnostic and would put revision A's
      // geometry on the item at revision C.
      const assetRows: Array<{
        itemId: string;
        documentId: string;
        versionId: string;
        elementId: string;
        partId: string | null;
        assetBaseName: string;
      }> = [];

      const rememberAssetRow = (
        row: (typeof parsed.rows)[number],
        itemId: string
      ) => {
        // A row from a LINKED document carries its own version; exporting it at
        // the parent's version 404s or exports the wrong geometry. Only a
        // version reference is usable — a workspace or microversion has no
        // stable snapshot to attach.
        const wvmType = row.wvmType ?? "v";
        const versionId =
          wvmType === "v" ? (row.wvmId ?? payload.versionId) : null;
        if (!versionId) return;

        assetRows.push({
          itemId,
          documentId: row.documentId,
          versionId,
          elementId: row.elementId,
          partId: row.partId,
          // Stable across runs: the model filename is the attach idempotency
          // key, so anything varying would mint a new modelUpload every import.
          assetBaseName: row.revision
            ? `${row.partNumber}.${row.revision}`
            : row.partNumber
        });
      };

      for (const row of parsed.rows) {
        const externalId = buildElementExternalId({
          documentId: row.documentId,
          elementId: row.elementId,
          partId: row.partId
        });
        const claimants = mappings.get(externalId) ?? [];
        // Drop claimants whose item row did not come back. entityId has no FK
        // to item, so deleting a Carbon item leaves its mapping behind forever;
        // `?? null` would then read that dead id as "revision null", which
        // revisionsMatch treats as the INITIAL revision — so an unreleased row
        // would match a deleted item and the insert would violate
        // methodMaterial_itemId_fkey.
        const liveClaimants = claimants.filter((id) => revisionById.has(id));
        const resolution = resolveBomRow(
          row.revision,
          liveClaimants.map((id) => ({
            itemId: id,
            revision: revisionById.get(id) ?? null
          }))
        );

        if (resolution.kind === "matched") {
          itemIdByRow.set(row.rowId, resolution.itemId);
          rememberAssetRow(row, resolution.itemId);
          continue;
        }

        if (resolution.kind === "ambiguous") {
          for (const id of resolution.itemIds) protectedItemIds.add(id);
          outcome.skipped.push({
            partNumber: row.partNumber,
            revision: row.revision,
            reason: "Two Carbon items claim this Onshape part at this revision"
          });
          continue;
        }

        if (resolution.kind === "revision-missing") {
          for (const id of resolution.siblingItemIds) protectedItemIds.add(id);
          outcome.skipped.push({
            partNumber: row.partNumber,
            revision: row.revision,
            reason:
              "Carbon has this part but not at this revision. New revisions arrive through release import."
          });
          continue;
        }

        // Genuinely unknown: mint it, then link it, so the next import
        // resolves it by id rather than rediscovering it.
        const created = await carbon
          .from("item")
          .insert({
            readableId: row.partNumber,
            revision: row.revision || "0",
            name: row.name,
            description: row.description || null,
            type: "Part",
            // Onshape's BOM says nothing reliable about how Carbon should buy
            // or make a part, so these take Carbon's own defaults rather than
            // a guess derived from a column that may not exist.
            replenishmentSystem: "Buy",
            defaultMethodType: "Pull from Inventory",
            itemTrackingType: "Inventory",
            unitOfMeasureCode: "EA",
            active: true,
            companyId: payload.companyId,
            createdBy: payload.userId
          })
          .select("id")
          .single();

        if (created.error || !created.data) {
          if (created.error?.code === "23505") {
            // The number is taken by an item that is not linked to Onshape.
            // Find it so its existing material line is PROTECTED: the import
            // is refusing this row, and a refusal must not delete the line it
            // refused to touch.
            // Match item_unique exactly: (readableId, revision, companyId,
            // type). Omitting `type` matches a Material AND a Part sharing the
            // number — legal in Carbon — and maybeSingle then errors, leaving
            // NOTHING protected while the user is told the row was skipped.
            const conflicting = await carbon
              .from("item")
              .select("id")
              .eq("readableId", row.partNumber)
              .eq("revision", row.revision || "0")
              .eq("companyId", payload.companyId)
              .eq("type", "Part")
              .maybeSingle();
            if (conflicting.error) {
              throw new Error(
                `Could not identify the item already using ${row.partNumber}: ${conflicting.error.message}`
              );
            }
            if (conflicting.data?.id) {
              protectedItemIds.add(conflicting.data.id);

              // ADOPT it rather than refusing forever. This branch is reached
              // not only when a human made the part, but whenever a previous
              // attempt died between the item insert and its mapping write:
              // the retry re-runs from the top, the insert 23505s, and without
              // adoption that part number is poisoned permanently — the item
              // has no `part` row (so the parts view's inner join hides it) and
              // no mapping (so every future import re-mints and re-fails).
              const partRepair = await carbon.from("part").upsert({
                id: row.partNumber,
                companyId: payload.companyId,
                createdBy: payload.userId
              });
              if (partRepair.error) {
                throw new Error(
                  `Could not repair the part row for ${row.partNumber}: ${partRepair.error.message}`
                );
              }

              await writeElementMapping(carbon, {
                companyId: payload.companyId,
                itemId: conflicting.data.id,
                ref: {
                  documentId: row.documentId,
                  elementId: row.elementId,
                  partId: row.partId
                },
                metadata: {
                  versionId: payload.versionId,
                  partNumber: row.partNumber,
                  fromUnreleasedVersion: !row.revision,
                  lastSyncedAt: new Date().toISOString()
                },
                createdBy: payload.userId
              });

              mappings.set(externalId, [
                ...(mappings.get(externalId) ?? []),
                conflicting.data.id
              ]);
              revisionById.set(conflicting.data.id, row.revision || "0");
              itemIdByRow.set(row.rowId, conflicting.data.id);
              rememberAssetRow(row, conflicting.data.id);
              outcome.created++;
              continue;
            }
          }

          outcome.skipped.push({
            partNumber: row.partNumber,
            revision: row.revision,
            reason:
              created.error?.code === "23505"
                ? "A Carbon part already uses this number and revision but is not linked to Onshape. Link it first."
                : (created.error?.message ?? "Could not create the part")
          });
          continue;
        }

        // Unchecked, an item exists with no `part` row: the detail RPCs join
        // on it, so the item cannot be opened or listed, and no later import
        // repairs it. The step retry re-runs this upsert harmlessly.
        const partRow = await carbon.from("part").upsert({
          id: row.partNumber,
          companyId: payload.companyId,
          createdBy: payload.userId
        });
        if (partRow.error) {
          throw new Error(
            `Created item ${row.partNumber} but failed to write its part row: ${partRow.error.message}`
          );
        }

        await writeElementMapping(carbon, {
          companyId: payload.companyId,
          itemId: created.data.id,
          ref: {
            documentId: row.documentId,
            elementId: row.elementId,
            partId: row.partId
          },
          metadata: {
            versionId: payload.versionId,
            partNumber: row.partNumber,
            fromUnreleasedVersion: !row.revision,
            lastSyncedAt: new Date().toISOString()
          },
          createdBy: payload.userId
        });

        itemIdByRow.set(row.rowId, created.data.id);
        rememberAssetRow(row, created.data.id);

        // Feed the mint back into the in-memory index. Onshape emits an
        // INDENTED BOM, so a part used under two subassemblies appears twice;
        // without this the second occurrence still sees no mapping, tries to
        // mint again, hits item_unique, and is skipped — so the part lands in
        // one parent's BOM and silently not the other's.
        mappings.set(externalId, [
          ...(mappings.get(externalId) ?? []),
          created.data.id
        ]);
        revisionById.set(created.data.id, row.revision || "0");

        outcome.created++;
      }

      // One read for the whole walk rather than one per node.
      const companySettings = await carbon
        .from("companySettings")
        .select("plmReleaseControl")
        .eq("id", payload.companyId)
        .maybeSingle();
      const releaseControl =
        companySettings.data?.plmReleaseControl ?? "enforce";

      // Walk the tree, reconciling each level into the method that owns it.
      const tree = buildOnshapeBomTree(parsed.rows);

      const reconcileNode = async (
        makeMethodId: string,
        children: OnshapeBomNode[]
      ) => {
        const desired = children
          .map((child, index) => {
            const itemId = itemIdByRow.get(child.row.rowId);
            return itemId
              ? { itemId, quantity: child.row.quantity, order: index + 1 }
              : null;
          })
          .filter((line): line is NonNullable<typeof line> => line !== null);

        const counts = await reconcileOne(carbon, {
          companyId: payload.companyId,
          userId: payload.userId,
          makeMethodId,
          desired,
          protectedItemIds: Array.from(protectedItemIds),
          // If the parser could not read every row, a Carbon line whose row
          // vanished is INDISTINGUISHABLE from one Onshape genuinely dropped.
          // Deleting on that basis destroys a line — with its routing link,
          // scrap and step children — on the strength of a row we admit we
          // could not read. Add rather than converge, and say so.
          allowRemoval: outcome.unreadableRows === 0
        });

        outcome.updated += counts.updated;
        outcome.removed += counts.removed;
        if (counts.keptBecauseUnreadable > 0) {
          outcome.skipped.push({
            partNumber: makeMethodId,
            revision: "",
            reason: `${counts.keptBecauseUnreadable} existing line(s) left alone because ${outcome.unreadableRows} Onshape row(s) could not be read.`
          });
        }
        outcome.imported += desired.length;

        // Recurse into subassemblies that resolved to a Carbon item AND have
        // children of their own. A childless row is a leaf regardless of how
        // Carbon classifies the item — the legacy writer resolves a child
        // method whenever the item is Make, which empties a hand-built BOM on
        // a part Onshape reports as a leaf.
        for (const child of children) {
          if (child.children.length === 0) continue;
          const childItemId = itemIdByRow.get(child.row.rowId);
          if (!childItemId) continue;

          const childMethod = await carbon
            .from("makeMethod")
            .select("id, item(revisionStatus)")
            .eq("itemId", childItemId)
            .eq("companyId", payload.companyId)
            .eq("status", "Draft")
            .is("changeOrderId", null)
            .order("version", { ascending: false })
            .limit(1)
            .maybeSingle();

          // The PLM lock applies at EVERY level, not just the root. Creating a
          // method version is not lock-gated, so a Draft method can exist on a
          // Production subassembly — and writing it here would be the same
          // escape hatch the root check closes, one level down.
          const childItem = childMethod.data?.item as {
            revisionStatus?: string;
          } | null;
          if (
            childItem?.revisionStatus === "Production" &&
            releaseControl === "enforce"
          ) {
            outcome.skipped.push({
              partNumber: child.row.partNumber,
              revision: child.row.revision,
              reason:
                "This subassembly's revision is in Production and the company enforces release control; its children were not imported."
            });
            continue;
          }

          if (childMethod.error || !childMethod.data) {
            outcome.skipped.push({
              partNumber: child.row.partNumber,
              revision: child.row.revision,
              reason:
                "No writable draft method for this subassembly; its children were not imported."
            });
            continue;
          }

          await reconcileNode(childMethod.data.id, child.children);
        }
      };

      await reconcileNode(method.id, tree);

      // Assets last: the BOM is the thing the user asked for, and a rate limit
      // or an oversized export must not cost them the import. Grouped by
      // element so seven bodies in one Part Studio cost one client and one
      // thumbnail fetch rather than seven of each.
      if (settings.attachAssetsOnRelease) {
        for (const group of groupAssetTargetsByElement(assetRows)) {
          try {
            const pulled = await withRateLimitRetry(
              () =>
                pullOnshapeAssetsForElement(carbon, connection.client, {
                  companyId: payload.companyId,
                  userId: payload.userId,
                  documentId: group.documentId,
                  versionId: group.versionId,
                  elementId: group.elementId,
                  targets: group.targets
                }),
              `assets for element ${group.elementId}`
            );
            outcome.assetsAttached += pulled.attached.length;
            outcome.assetsSkipped += pulled.skipped.length;
            for (const skip of pulled.skipped) {
              outcome.skipped.push({
                partNumber: skip.itemId,
                revision: "",
                reason: `Model not attached: ${skip.reason}`
              });
            }
          } catch (error) {
            // The BOM is already written and correct; report the asset failure
            // rather than throwing the whole import away over geometry.
            outcome.assetsSkipped += group.targets.length;
            outcome.skipped.push({
              partNumber: group.elementId,
              revision: "",
              reason: `Models not attached: ${
                error instanceof Error ? error.message : "export failed"
              }`
            });
          }
        }
      }

      return outcome;
    });

    // `result` carries its own `skipped` array of refused rows; the run-level
    // flag is separate, so name it distinctly rather than letting the spread
    // silently overwrite one with the other.
    return { pipelineSkipped: false as const, ...result };
  }
);
