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
  isInitialRevisionLabel,
  type OnshapeBomNode,
  parseOnshapeBom,
  readElementMappingsForItems,
  readItemIdsForElements,
  reconcileMethodMaterials,
  resolveBomRow,
  revisionsMatch,
  writeElementMapping
} from "@carbon/ee/onshape";
import { trigger } from "@carbon/lib/trigger";
import { NotificationEvent } from "@carbon/notifications";
import { RetryAfterError } from "inngest";
import { z } from "zod";
import { inngest } from "../../client";
import { withRateLimitRetry } from "./onshape-backfill";
import type { OnshapeBomImportOutcome } from "./onshape-bom-outcome";
import {
  countNeedingAttention,
  summarizeOutcomeForUser
} from "./onshape-bom-outcome";
import {
  groupAssetTargetsByElement,
  isTransientExportError,
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

type AdoptResult =
  | { kind: "adopted"; itemId: string }
  | { kind: "refused"; reason: string; protectedItemIds: string[] };

/**
 * Claim an existing Carbon part for this Onshape element, or refuse to.
 *
 * Reached whenever the number is already taken by an item the element mapping
 * does not know about: a part a human made, or the wreckage of an attempt that
 * died between the item insert and its mapping write.
 *
 * The refusal is the important half. `writeElementMapping` deletes by entityId
 * alone, so adopting an item that already belongs to a DIFFERENT Onshape
 * element would destroy that link and silently re-point the item here — a
 * part-number string match deciding an identity join, which is the one thing
 * this pipeline does not do. The import route already refuses exactly this for
 * the target item.
 */
async function adoptExistingItem(args: {
  carbon: Carbon;
  payload: Payload;
  row: {
    partNumber: string;
    revision: string;
    documentId: string;
    elementId: string;
    partId: string | null;
  };
  externalId: string;
  candidateItemIds: string[];
}): Promise<AdoptResult> {
  const { carbon, payload, row, externalId, candidateItemIds } = args;

  if (candidateItemIds.length > 1) {
    return {
      kind: "refused",
      reason:
        "Several Carbon parts share this number and revision, so which one this Onshape part means is ambiguous.",
      protectedItemIds: candidateItemIds
    };
  }

  const itemId = candidateItemIds[0];
  if (!itemId) {
    return {
      kind: "refused",
      reason: "No item to adopt",
      protectedItemIds: []
    };
  }

  const existingLinks = await readElementMappingsForItems(carbon, {
    companyId: payload.companyId,
    itemIds: [itemId]
  });
  const existingRef = existingLinks.get(itemId)?.ref;
  const existingExternalId = existingRef
    ? buildElementExternalId(existingRef)
    : null;
  if (existingExternalId && existingExternalId !== externalId) {
    return {
      kind: "refused",
      reason:
        "A Carbon part with this number and revision is already linked to a different Onshape element. Unlink it before importing this one.",
      protectedItemIds: [itemId]
    };
  }

  // An item minted by a half-finished attempt has no `part` row, and the parts
  // view's inner join hides it — so repair before linking.
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
    itemId,
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

  return { kind: "adopted", itemId };
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
    // One import at a time per COMPANY. Per-make-method was too narrow: the
    // walk recurses into child methods, so two imports of different assemblies
    // that share a subassembly both reconcile that child's material list, each
    // against a list the other is changing — and `methodMaterial` has no unique
    // constraint on (makeMethodId, itemId) to catch the duplicate.
    //
    // It also serializes `getOnshapeClient`'s read-modify-write token refresh,
    // which two concurrent imports for one company would otherwise race.
    concurrency: { key: "event.data.companyId", limit: 1 }
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
        adopted: 0,
        updated: 0,
        removed: 0,
        assetsAttached: 0,
        assetsSkipped: 0,
        unreadableRows: 0,
        protectedLines: 0,
        skipped: [],
        warnings: []
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
      // An unreadable top-level row counts as UNRELEASED, not as absent: a
      // released assembly always has a part number (Onshape requires one to
      // release), so refusing on null cannot block a released import — while
      // an assembly with no part number assigned is exactly the shape this
      // setting exists for.
      if (!settings.allowUnreleasedSync && !parsed.topLevel?.revision) {
        throw new Error(
          "This Onshape version has never been released and the company only syncs released versions."
        );
      }

      // Which rows are ASSEMBLIES as far as this BOM is concerned. Derived from
      // the tree rather than from "the next row is deeper", because the tree
      // drops a row whose indent jumps by more than one — a row whose only
      // apparent child was dropped as an orphan is a leaf, and minting it as
      // something to manufacture would leave an empty make method behind.
      const bomTree = buildOnshapeBomTree(parsed.rows);
      const rowIdsWithChildren = new Set<string>();
      const collectParents = (nodes: OnshapeBomNode[]) => {
        for (const node of nodes) {
          if (node.children.length === 0) continue;
          rowIdsWithChildren.add(node.row.rowId);
          collectParents(node.children);
        }
      };
      collectParents(bomTree);

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
      // Components of rows the import REFUSED, keyed by the REFUSED ROW.
      // Their existing material lines must survive: "skipped" has to mean
      // untouched, not deleted.
      //
      // Keyed per row, not per tree, because protection is scoped to the
      // method the refused row sits in. One flat set protects the component
      // EVERYWHERE, so a part refused under assembly A also survives under
      // assembly B — where Onshape really did drop it — and the line stays
      // forever while `removed` under-reports.
      const protectedByRow = new Map<string, string[]>();

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
        configuration: string | null;
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
        if (!versionId) {
          // Silently dropping this leaves an item whose model never arrives
          // and no record of why — the same invisible gap the outcome
          // notification exists to close.
          outcome.assetsSkipped++;
          outcome.skipped.push({
            partNumber: row.partNumber,
            revision: row.revision,
            reason:
              "This component is referenced from a workspace rather than a version, so there is no fixed snapshot to export its model from."
          });
          return;
        }

        assetRows.push({
          itemId,
          documentId: row.documentId,
          versionId,
          elementId: row.elementId,
          partId: row.partId,
          // The instance's own configuration. Without it Onshape exports the
          // element's default, which for a configured part is a different
          // shape from the one this BOM line names.
          configuration: row.configuration,
          // Stable across runs: the model filename is the attach idempotency
          // key, so anything varying would mint a new modelUpload every import.
          // An Onshape revision of "0" is NOT a named revision — Carbon
          // collapses '0'/''/NULL into the same initial revision, and
          // releaseKey does the same, so treating it as named would produce
          // "PRT-100.0" here and "PRT-100" everywhere else.
          assetBaseName: isInitialRevisionLabel(row.revision)
            ? row.partNumber
            : `${row.partNumber}.${row.revision}`
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
          protectedByRow.set(row.rowId, resolution.itemIds);
          outcome.skipped.push({
            partNumber: row.partNumber,
            revision: row.revision,
            reason: "Two Carbon items claim this Onshape part at this revision"
          });
          continue;
        }

        if (resolution.kind === "revision-missing") {
          protectedByRow.set(row.rowId, resolution.siblingItemIds);
          outcome.skipped.push({
            partNumber: row.partNumber,
            revision: row.revision,
            reason:
              "Carbon has this part but not at this revision. New revisions arrive through release import."
          });
          continue;
        }

        // Unmapped, but the NUMBER may still be taken. Two cases the
        // item_unique constraint cannot catch on its own:
        //
        //  - An existing item at revision '' or NULL. `item_unique` is on the
        //    RAW revision column and Postgres treats NULL as distinct, so
        //    inserting '0' raises no conflict — while readableIdWithRevision
        //    collapses '0', '' and NULL to the bare number, leaving two rows
        //    indistinguishable everywhere a human looks.
        //  - An existing item at a DIFFERENT revision. No conflict either, so a
        //    second member of the revision family appears with no lineage. The
        //    spec refuses this case in v1; nothing was refusing it.
        //
        // So resolve the family by number here, with the SAME revision
        // semantics resolveBomRow uses, rather than relying on a constraint.
        const siblings = await carbon
          .from("item")
          .select("id, revision")
          .eq("readableId", row.partNumber)
          .eq("type", "Part")
          .eq("companyId", payload.companyId);
        if (siblings.error) {
          throw new Error(
            `Could not check for existing parts numbered ${row.partNumber}: ${siblings.error.message}`
          );
        }

        const siblingRows = siblings.data ?? [];
        if (siblingRows.length > 0) {
          const sameRevision = siblingRows.filter(
            (sibling: { id: string; revision: string | null }) =>
              revisionsMatch(sibling.revision, row.revision)
          );

          if (sameRevision.length > 0) {
            const claimed = await adoptExistingItem({
              carbon,
              payload,
              row,
              externalId,
              candidateItemIds: sameRevision.map(
                (sibling: { id: string }) => sibling.id
              )
            });
            if (claimed.kind === "adopted") {
              mappings.set(externalId, [
                ...(mappings.get(externalId) ?? []),
                claimed.itemId
              ]);
              revisionById.set(claimed.itemId, row.revision || "0");
              itemIdByRow.set(row.rowId, claimed.itemId);
              rememberAssetRow(row, claimed.itemId);
              outcome.adopted++;
              continue;
            }
            protectedByRow.set(row.rowId, claimed.protectedItemIds);
            outcome.skipped.push({
              partNumber: row.partNumber,
              revision: row.revision,
              reason: claimed.reason
            });
            continue;
          }

          // The number exists at other revisions only. Minting here would add
          // a family member with no revision lineage.
          protectedByRow.set(
            row.rowId,
            siblingRows.map((sibling: { id: string }) => sibling.id)
          );
          outcome.skipped.push({
            partNumber: row.partNumber,
            revision: row.revision,
            reason:
              "Carbon has this part number at other revisions but not this one, and it is not linked to Onshape. Link the right revision first."
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
            // or make a LEAF part, so those take Carbon's own defaults rather
            // than a guess derived from a column that may not exist.
            //
            // A row with children is different in kind, and not a guess at all:
            // this import is about to give it a make method and fill it with
            // materials. Minting it as Buy / Pull from Inventory contradicts
            // the tree being written in the same transaction — MRP would plan
            // a purchase order for a subassembly Carbon knows how to build,
            // and because `methodMaterial.methodType` is denormalized from
            // this column, the PARENT's line would read Pull from Inventory
            // and never explode. The nested BOM would exist and never plan.
            ...(rowIdsWithChildren.has(row.rowId)
              ? {
                  replenishmentSystem: "Make" as const,
                  defaultMethodType: "Make to Order" as const
                }
              : {
                  replenishmentSystem: "Buy" as const,
                  defaultMethodType: "Pull from Inventory" as const
                }),
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
            // Lost a race: something inserted this number between the family
            // probe above and this insert. Same resolution as the probe's, so
            // a retry after a partial mint is self-healing rather than
            // permanently poisoned — the half-made item has no `part` row (the
            // parts view's inner join hides it) and no mapping (so every future
            // import re-mints and re-fails).
            const conflicting = await carbon
              .from("item")
              .select("id, revision")
              .eq("readableId", row.partNumber)
              .eq("type", "Part")
              .eq("companyId", payload.companyId);
            if (conflicting.error) {
              throw new Error(
                `Could not identify the item already using ${row.partNumber}: ${conflicting.error.message}`
              );
            }
            const candidates = (conflicting.data ?? []).filter(
              (candidate: { id: string; revision: string | null }) =>
                revisionsMatch(candidate.revision, row.revision)
            );
            if (candidates.length > 0) {
              const claimed = await adoptExistingItem({
                carbon,
                payload,
                row,
                externalId,
                candidateItemIds: candidates.map(
                  (candidate: { id: string }) => candidate.id
                )
              });
              if (claimed.kind === "adopted") {
                mappings.set(externalId, [
                  ...(mappings.get(externalId) ?? []),
                  claimed.itemId
                ]);
                revisionById.set(claimed.itemId, row.revision || "0");
                itemIdByRow.set(row.rowId, claimed.itemId);
                rememberAssetRow(row, claimed.itemId);
                outcome.adopted++;
                continue;
              }
              protectedByRow.set(row.rowId, claimed.protectedItemIds);
              outcome.skipped.push({
                partNumber: row.partNumber,
                revision: row.revision,
                reason: claimed.reason
              });
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
      const tree = bomTree;

      // Keyed by ITEM, not by row: Onshape's indented rowId is per instance
      // PATH, so one subassembly used in two places is two rows and would
      // otherwise warn about the same part twice.
      const warnedBuyItemIds = new Set<string>();

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

        // Only the refusals among THIS method's own children protect a line
        // in THIS method.
        const protectedHere = children.flatMap(
          (child) => protectedByRow.get(child.row.rowId) ?? []
        );

        const counts = await reconcileOne(carbon, {
          companyId: payload.companyId,
          userId: payload.userId,
          makeMethodId,
          desired,
          protectedItemIds: protectedHere,
          // If the parser could not read every row, a Carbon line whose row
          // vanished is INDISTINGUISHABLE from one Onshape genuinely dropped.
          // Deleting on that basis destroys a line — with its routing link,
          // scrap and step children — on the strength of a row we admit we
          // could not read. Add rather than converge, and say so.
          allowRemoval: outcome.unreadableRows === 0
        });

        outcome.updated += counts.updated;
        outcome.removed += counts.removed;
        outcome.protectedLines += counts.protectedCount;
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
            .select("id, item(revisionStatus, replenishmentSystem)")
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
            replenishmentSystem?: string;
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

          // An EXISTING item this BOM gives children to, but which Carbon still
          // calls Buy. A newly minted subassembly is created as Make, so this
          // only ever fires for an item that was already here — and
          // replenishment is a Carbon decision Onshape says nothing about, so it
          // is reported rather than overwritten. Left silent it is invisible and
          // expensive: MRP plans a purchase order for something Carbon now has a
          // method for, and the parent's line stays Pull from Inventory so the
          // sub-tree never explodes.
          //
          // AFTER the two guards above, because a subassembly whose children
          // were refused did not in fact get a bill of materials, and warning
          // about one it does not have sends the reader to change a setting that
          // would not have helped.
          if (childItem?.replenishmentSystem === "Buy") {
            warnedBuyItemIds.add(childItemId);
          }

          // Point the PARENT's line at the method the children are about to be
          // written into. `get_method_tree` resolves a line's sub-method as
          // COALESCE(materialMakeMethodId, <fallback>), and the fallback only
          // fires for `Pull from Inventory` — so a `Make to Order` line with a
          // null column terminates the recursion and the whole sub-BOM vanishes
          // from the BoM explorer, the BOM API, the CSV export and cost
          // roll-up, while still sitting in the database. Verified live: minting
          // a subassembly as Make (which MRP needs) is what exposed this.
          //
          // The app's own writer resolves this from `activeMakeMethods`; the
          // import uses the method it actually reconciled into instead, which
          // is the same row for a freshly minted item and the RIGHT row for an
          // adopted one whose Active method is not the draft being imported to.
          const linked = await carbon
            .from("methodMaterial")
            .update({ materialMakeMethodId: childMethod.data.id })
            .eq("makeMethodId", makeMethodId)
            .eq("itemId", childItemId)
            .eq("companyId", payload.companyId);
          if (linked.error) {
            throw new Error(
              `Could not link ${child.row.partNumber} to its sub-method: ${linked.error.message}`
            );
          }

          await reconcileNode(childMethod.data.id, child.children);
        }
      };

      await reconcileNode(method.id, tree);

      // The item being imported INTO is not one of `parsed.rows`, so the child
      // loop above never sees it — yet it is the one this import definitely just
      // gave a bill of materials to, and it fails in exactly the same way.
      const targetItem = await carbon
        .from("item")
        .select("replenishmentSystem")
        .eq("id", method.itemId)
        .eq("companyId", payload.companyId)
        .maybeSingle();
      if (targetItem.data?.replenishmentSystem === "Buy") {
        warnedBuyItemIds.add(method.itemId);
      }

      if (warnedBuyItemIds.size > 0) {
        const warned = await carbon
          .from("item")
          .select("id, readableIdWithRevision")
          .in("id", Array.from(warnedBuyItemIds))
          .eq("companyId", payload.companyId);
        if (warned.error) {
          throw new Error(
            `Could not read the items to warn about: ${warned.error.message}`
          );
        }
        for (const item of warned.data ?? []) {
          outcome.warnings.push(
            `${item.readableIdWithRevision} now has a bill of materials but is still set to Buy in Carbon, so it will be purchased rather than made. Change its replenishment to Make if that is wrong.`
          );
        }
      }

      // The TOP-LEVEL item's own model. It is not one of `parsed.rows` —
      // Onshape returns the queried assembly separately from its components,
      // which is what stops it appearing as its own child — so without this the
      // one item the user is actually looking at is the only item in the tree
      // that never gets geometry.
      if (parsed.topLevel) {
        rememberAssetRow(
          {
            ...parsed.topLevel,
            // The queried assembly IS this element at this version, whatever
            // its row says about where it was instanced from.
            wvmType: "v",
            wvmId: payload.versionId,
            documentId: payload.documentId,
            elementId: payload.elementId,
            partId: null
          },
          method.itemId
        );
      }
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

          // The optimise chain is the caller's responsibility — the attach
          // helper says so, and both legacy callers do it. It relocates the
          // raw out of ephemeral staging into the durable bucket, and it is
          // what renders a thumbnail from the GLB, which is the ONLY
          // thumbnail a per-body item can get.
          for (const ok of pulled.attached) {
            try {
              await trigger("model-optimize", {
                companyId: payload.companyId,
                modelUploadId: ok.modelUploadId,
                userId: payload.userId
              });
            } catch (error) {
              console.error(
                `[ONSHAPE BOM IMPORT] could not queue optimisation for ${ok.modelUploadId}`,
                error
              );
            }
          }

          for (const skip of pulled.skipped) {
            outcome.skipped.push({
              partNumber: skip.itemId,
              revision: "",
              reason: `Model not attached: ${skip.reason}`
            });
          }
        } catch (error) {
          // A TRANSIENT failure is not an outcome to report — it is a reason
          // to run again. withRateLimitRetry has already turned a 429 into a
          // RetryAfterError by this point; catching it here would spend the
          // job's ten retries on nothing and leave every remaining row of the
          // assembly permanently modelless.
          if (error instanceof RetryAfterError) throw error;
          if (isTransientExportError(error)) throw error;

          // The BOM is already written and correct; report a PERMANENT asset
          // failure rather than throwing the whole import away over geometry.
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

      return outcome;
    });

    // Tell the person who started it what the import actually did.
    //
    // Without this the whole outcome dies in the job log: the panel toasts
    // "Import started" and nothing ever reports back, so a refused row is
    // indistinguishable from a row that imported cleanly — the user sees a BOM
    // that is quietly short a line and no reason why.
    //
    // Only when something needs attention. A clean import is already visible:
    // the BOM the user is looking at changes.
    const attentionCount = countNeedingAttention(result);
    const needsAttention = attentionCount > 0;

    if (needsAttention && payload.userId && payload.userId !== "system") {
      await step.run("notify-outcome", async () => {
        try {
          await trigger("notify", {
            event: NotificationEvent.IntegrationSync,
            companyId: payload.companyId,
            // The provider id, per this event's contract — the in-app row
            // links to `path.to.integration(id)`.
            documentId: "onshape",
            title: `Onshape import finished with ${attentionCount} item(s) needing attention`,
            body: summarizeOutcomeForUser(result),
            recipient: { type: "user", userId: payload.userId }
          });
        } catch (error) {
          // The BOM is already written. A notification failure must not undo
          // it, and a retry would re-run the whole import.
          console.error(
            `[ONSHAPE BOM IMPORT] ${payload.companyId}: could not notify ${payload.userId}`,
            error
          );
        }
        return null;
      });
    }

    // `result` carries its own `skipped` array of refused rows; the run-level
    // flag is separate, so name it distinctly rather than letting the spread
    // silently overwrite one with the other.
    return { pipelineSkipped: false as const, ...result };
  }
);
