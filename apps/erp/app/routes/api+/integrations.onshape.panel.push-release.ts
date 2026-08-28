import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { PanelReleaseItem } from "@carbon/ee";
import {
  groupRevisionsIntoReleases,
  isModelReleaseItem,
  parseBomTree
} from "@carbon/ee";
import { getOnshapeClient, OnshapeWVMType } from "@carbon/ee/onshape";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  createRevision,
  getItem,
  insertChangeNotice,
  updateDefaultRevision,
  upsertPart
} from "~/modules/items";

export const config = {
  runtime: "nodejs"
};

const payloadSchema = z.object({
  documentId: z.string().min(1),
  releaseId: z.string().min(1)
});

type PushSummary = {
  releaseName: string | null;
  revisionsCreated: number;
  itemsCreated: number;
  reused: number;
  linesWritten: number;
  methodsTouched: number;
  defaultsUpdated: number;
  changeNotice: string | null;
  alreadyPushed: boolean;
  skipped: string[];
  errors: string[];
};

type ItemRow = {
  id: string;
  readableId: string;
  revision: string;
  defaultMethodType: string | null;
  unitOfMeasureCode: string | null;
};

/**
 * Push one Onshape release into Carbon.
 *
 * Per released part/assembly: ensure a Carbon item exists AT the released
 * revision letter — `createRevision` from the existing item (active, and made
 * the default so consumers cut over), or a fresh item when the part number was
 * never in Carbon. Released assemblies then get their BOM (read at the
 * released version) applied to the new revision's Draft make method — the
 * revision copy's Onshape-origin lines are replaced, manual lines survive.
 * One Draft change notice records the affected items; asset exports
 * (models + thumbnails, released drawings as PDF) run as background jobs.
 * Re-pushing the same release re-applies BOMs and assets but creates nothing
 * twice (idempotent on the release's part number + letter pairs).
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
    update: "parts"
  });

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid push payload" }, { status: 400 });
  }
  const { documentId, releaseId } = parsed.data;

  const onshape = await getOnshapeClient(client, companyId, userId);
  if (onshape.error || !onshape.client) {
    return data(
      { error: "Onshape is not connected for this company" },
      { status: 422 }
    );
  }

  let revisions: Awaited<
    ReturnType<typeof onshape.client.getDocumentRevisions>
  >;
  try {
    revisions = await onshape.client.getDocumentRevisions(documentId);
  } catch (error) {
    return data(
      {
        error: error instanceof Error ? error.message : "Onshape request failed"
      },
      { status: 502 }
    );
  }

  const release = groupRevisionsIntoReleases(revisions.items ?? []).find(
    (candidate) => candidate.releaseId === releaseId
  );
  if (!release) {
    return data(
      { error: "Release not found in this document" },
      { status: 404 }
    );
  }

  const modelItems = release.items.filter(isModelReleaseItem);
  const drawingItems = release.items.filter((item) => item.elementType === 2);
  if (modelItems.length === 0) {
    return data(
      { error: "The release contains no parts or assemblies" },
      { status: 422 }
    );
  }

  const summary: PushSummary = {
    releaseName: release.releaseName,
    revisionsCreated: 0,
    itemsCreated: 0,
    reused: 0,
    linesWritten: 0,
    methodsTouched: 0,
    defaultsUpdated: 0,
    changeNotice: null,
    alreadyPushed: false,
    skipped: [],
    errors: []
  };

  // ---- Carbon rows for every involved part number (all revisions) ---------
  const partNumbers = [...new Set(modelItems.map((item) => item.partNumber))];
  const existing = await client
    .from("item")
    .select("id, readableId, revision, defaultMethodType, unitOfMeasureCode")
    .eq("companyId", companyId)
    .in("readableId", partNumbers);
  if (existing.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  const byReadable = new Map<string, ItemRow[]>();
  for (const row of (existing.data ?? []) as ItemRow[]) {
    const list = byReadable.get(row.readableId) ?? [];
    list.push(row);
    byReadable.set(row.readableId, list);
  }
  const letterRowFor = (partNumber: string, revision: string) =>
    (byReadable.get(partNumber) ?? []).find((row) => row.revision === revision);

  // ---- Pass 1: ensure an item at every released revision letter -----------
  type CreatedEntry = {
    partNumber: string;
    revision: string;
    itemId: string;
    baseItemId: string | null;
  };
  const created: CreatedEntry[] = [];
  const revisionItemByPartNumber = new Map<string, ItemRow>();

  for (const item of modelItems) {
    const existingLetter = letterRowFor(item.partNumber, item.revision);
    if (existingLetter) {
      summary.reused += 1;
      revisionItemByPartNumber.set(item.partNumber, existingLetter);
      continue;
    }

    const bases = byReadable.get(item.partNumber) ?? [];
    let row: ItemRow | null = null;
    if (bases.length > 0) {
      const base = bases[0] as ItemRow;
      const full = await getItem(client, base.id);
      if (full.error || !full.data) {
        summary.errors.push(`${item.partNumber}: failed to read the base item`);
        continue;
      }
      const inserted = await createRevision(client, {
        item: full.data,
        revision: item.revision,
        createdBy: userId,
        active: true
      });
      if (inserted.error || !inserted.data) {
        summary.errors.push(
          `${item.partNumber}: ${
            inserted.error?.message ?? "failed to create the revision"
          }`
        );
        continue;
      }
      row = {
        id: inserted.data.id,
        readableId: item.partNumber,
        revision: item.revision,
        defaultMethodType: full.data.defaultMethodType ?? "Make to Order",
        unitOfMeasureCode: full.data.unitOfMeasureCode ?? "EA"
      };
      created.push({
        partNumber: item.partNumber,
        revision: item.revision,
        itemId: row.id,
        baseItemId: base.id
      });
      summary.revisionsCreated += 1;
    } else {
      // Never in Carbon: create the item directly at the released letter.
      // Released items are designed in-house: Make. The item name is refined
      // by later element pushes; the release list only carries part numbers.
      const insertedItem = await upsertPart(client, {
        id: item.partNumber,
        name: item.partNumber,
        revision: item.revision,
        replenishmentSystem: "Make",
        defaultMethodType: "Make to Order",
        itemTrackingType: "Inventory",
        unitOfMeasureCode: "EA",
        companyId,
        createdBy: userId
        // biome-ignore lint/suspicious/noExplicitAny: partValidator carries many optional form-only fields
      } as any);
      if (insertedItem.error || !insertedItem.data) {
        summary.errors.push(
          `${item.partNumber}: ${
            insertedItem.error?.message ?? "failed to create the item"
          }`
        );
        continue;
      }
      row = {
        id: insertedItem.data.id as string,
        readableId: item.partNumber,
        revision: item.revision,
        defaultMethodType: "Make to Order",
        unitOfMeasureCode: "EA"
      };
      created.push({
        partNumber: item.partNumber,
        revision: item.revision,
        itemId: row.id,
        baseItemId: null
      });
      summary.itemsCreated += 1;
    }

    revisionItemByPartNumber.set(item.partNumber, row);
    const list = byReadable.get(item.partNumber) ?? [];
    list.push(row);
    byReadable.set(item.partNumber, list);
  }

  summary.alreadyPushed = created.length === 0;

  // ---- Pass 2: BOMs for released assemblies -------------------------------
  const serviceRole = getCarbonServiceRole();

  const activeMakeMethodFor = async (itemId: string) => {
    const method = await client
      .from("activeMakeMethods")
      .select("id, status, version")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .maybeSingle();
    return method.data as {
      id: string;
      status: string;
      version: number;
    } | null;
  };

  for (const item of modelItems.filter(
    (candidate) => candidate.elementType === 1
  )) {
    const target = revisionItemByPartNumber.get(item.partNumber);
    if (!target) continue; // creation failed above; error already recorded
    const label = `${item.partNumber} Rev ${item.revision}`;

    const method = await activeMakeMethodFor(target.id);
    if (!method) {
      summary.errors.push(`${label}: no make method found`);
      continue;
    }
    if (method.status === "Active") {
      summary.errors.push(
        `${label}: make method is released in Carbon; refusing to rewrite it`
      );
      continue;
    }

    let bom: unknown;
    try {
      bom = await onshape.client.getBillOfMaterialsIn(
        {
          documentId,
          wvm: OnshapeWVMType.VERSION,
          wvmId: item.versionId
        },
        item.elementId
      );
    } catch (error) {
      summary.errors.push(
        `${label}: ${
          error instanceof Error ? error.message : "Onshape BOM request failed"
        }`
      );
      continue;
    }
    const { lines } = parseBomTree(bom);

    // BOM children that aren't release items can still exist in Carbon (e.g.
    // purchased hardware created by an element push) — fetch the unknowns in
    // one query so they're reused instead of re-minted.
    const unknownChildren = [
      ...new Set(
        lines
          .map((child) => child.partNumber)
          .filter((pn): pn is string => !!pn && !byReadable.has(pn))
      )
    ];
    if (unknownChildren.length > 0) {
      const rows = await client
        .from("item")
        .select(
          "id, readableId, revision, defaultMethodType, unitOfMeasureCode"
        )
        .eq("companyId", companyId)
        .in("readableId", unknownChildren);
      for (const row of (rows.data ?? []) as ItemRow[]) {
        const list = byReadable.get(row.readableId) ?? [];
        list.push(row);
        byReadable.set(row.readableId, list);
      }
    }

    // The revision copy carried the base method's lines over. Drop the copies
    // of lines a panel push wrote to the BASE method (found through the base
    // method's mapping rows, matched here by item + order + quantity) so they
    // don't duplicate the released BOM below; manual lines stay.
    const createdEntry = created.find(
      (candidate) =>
        candidate.partNumber === item.partNumber &&
        candidate.revision === item.revision
    );
    if (createdEntry?.baseItemId) {
      const baseMethod = await activeMakeMethodFor(createdEntry.baseItemId);
      if (baseMethod) {
        const baseMapped = await serviceRole
          .from("externalIntegrationMapping")
          .select("entityId")
          .eq("companyId", companyId)
          .eq("integration", "onshape")
          .eq("entityType", "methodMaterial")
          .eq("metadata->>makeMethodId", baseMethod.id);
        const baseLineIds = (baseMapped.data ?? []).map(
          (mapping) => mapping.entityId
        );
        if (baseLineIds.length > 0) {
          const baseLines = await client
            .from("methodMaterial")
            .select("itemId, order, quantity")
            .in("id", baseLineIds);
          const copiedKeys = new Set(
            (baseLines.data ?? []).map(
              (line) => `${line.itemId}:${line.order}:${line.quantity}`
            )
          );
          if (copiedKeys.size > 0) {
            const newLines = await client
              .from("methodMaterial")
              .select("id, itemId, order, quantity")
              .eq("makeMethodId", method.id);
            const toDelete = (newLines.data ?? [])
              .filter((line) =>
                copiedKeys.has(`${line.itemId}:${line.order}:${line.quantity}`)
              )
              .map((line) => line.id);
            if (toDelete.length > 0) {
              await client.from("methodMaterial").delete().in("id", toDelete);
            }
          }
        }
      }
    }

    // Replace lines a previous release push wrote to this method.
    const mapped = await serviceRole
      .from("externalIntegrationMapping")
      .select("id, entityId")
      .eq("companyId", companyId)
      .eq("integration", "onshape")
      .eq("entityType", "methodMaterial")
      .eq("metadata->>makeMethodId", method.id);
    if ((mapped.data ?? []).length > 0) {
      await client
        .from("methodMaterial")
        .delete()
        .in(
          "id",
          (mapped.data ?? []).map((mapping) => mapping.entityId)
        );
      await serviceRole
        .from("externalIntegrationMapping")
        .delete()
        .in(
          "id",
          (mapped.data ?? []).map((mapping) => mapping.id)
        );
    }

    summary.methodsTouched += 1;

    // Level-1 lines only: deeper levels belong to the released subassemblies'
    // own methods, which this release populates through their own entries.
    let order = 0;
    for (const child of lines) {
      if (!child.partNumber) {
        summary.skipped.push(
          `${label} → ${child.name ?? child.index}: no part number in Onshape`
        );
        continue;
      }
      let childItem: ItemRow | undefined =
        revisionItemByPartNumber.get(child.partNumber) ??
        (byReadable.get(child.partNumber) ?? [])[0];
      if (!childItem) {
        // A BOM child that was neither released nor ever pushed: create it at
        // the BOM's revision so the line has a target.
        const createdChild = await upsertPart(client, {
          id: child.partNumber,
          name: child.name ?? child.partNumber,
          description: child.description ?? undefined,
          revision: child.revision ?? "0",
          replenishmentSystem: child.purchased ? "Buy" : "Make",
          defaultMethodType: child.purchased
            ? "Pull from Inventory"
            : "Make to Order",
          itemTrackingType: "Inventory",
          unitOfMeasureCode: "EA",
          companyId,
          createdBy: userId
          // biome-ignore lint/suspicious/noExplicitAny: partValidator carries many optional form-only fields
        } as any);
        if (createdChild.error || !createdChild.data) {
          summary.errors.push(
            `${label} → ${child.partNumber}: ${
              createdChild.error?.message ?? "failed to create the item"
            }`
          );
          continue;
        }
        childItem = {
          id: createdChild.data.id as string,
          readableId: child.partNumber,
          revision: child.revision ?? "0",
          defaultMethodType: child.purchased
            ? "Pull from Inventory"
            : "Make to Order",
          unitOfMeasureCode: "EA"
        };
        byReadable.set(child.partNumber, [childItem]);
        summary.itemsCreated += 1;
      }

      const childMade = child.children.length > 0;
      const childMethod = childMade
        ? await activeMakeMethodFor(childItem.id)
        : null;

      const inserted = await client
        .from("methodMaterial")
        .insert({
          itemId: childItem.id,
          quantity: child.quantity,
          makeMethodId: method.id,
          materialMakeMethodId: childMethod?.id ?? null,
          methodType:
            (childItem.defaultMethodType as "Make to Order" | null) ??
            (child.purchased ? "Pull from Inventory" : "Make to Order"),
          order,
          itemType: "Part",
          unitOfMeasureCode: childItem.unitOfMeasureCode ?? "EA",
          companyId,
          createdBy: userId
          // biome-ignore lint/suspicious/noExplicitAny: enum unions narrowed above
        } as any)
        .select("id")
        .single();
      if (inserted.error || !inserted.data) {
        summary.errors.push(
          `${label} → ${child.partNumber}: ${
            inserted.error?.message ?? "line insert failed"
          }`
        );
        continue;
      }
      order += 1;
      summary.linesWritten += 1;

      await client.from("externalIntegrationMapping").insert({
        entityType: "methodMaterial",
        entityId: inserted.data.id,
        integration: "onshape",
        metadata: {
          makeMethodId: method.id,
          documentId,
          elementId: item.elementId,
          partNumber: child.partNumber,
          index: child.index,
          releaseId: release.releaseId
        },
        lastSyncedAt: new Date().toISOString(),
        companyId,
        createdBy: userId
      });
    }
  }

  // ---- Pass 3: release mappings + default revisions -----------------------
  for (const item of modelItems) {
    const row = revisionItemByPartNumber.get(item.partNumber);
    if (!row) continue;
    const externalId = `release:${release.releaseId}:${item.partNumber}`;
    await serviceRole
      .from("externalIntegrationMapping")
      .delete()
      .eq("companyId", companyId)
      .eq("integration", "onshape")
      .eq("entityType", "item")
      .or(`entityId.eq.${row.id},externalId.eq.${externalId}`);
    await client.from("externalIntegrationMapping").insert({
      entityType: "item",
      entityId: row.id,
      integration: "onshape",
      externalId,
      metadata: {
        kind: "release",
        releaseId: release.releaseId,
        releaseName: release.releaseName,
        documentId,
        elementId: item.elementId,
        wv: "v",
        wvId: item.versionId,
        partNumber: item.partNumber,
        revision: item.revision,
        pushedBy: userId,
        pushedAt: new Date().toISOString()
      },
      lastSyncedAt: new Date().toISOString(),
      companyId,
      createdBy: userId
    });
  }

  // New revisions become the default their consumers resolve to (§ the
  // product's own Make Default semantics: methodMaterial lines of sibling
  // revisions are repointed here).
  for (const entry of created) {
    if (!entry.baseItemId) continue; // brand-new item: it is the only revision
    const updated = await updateDefaultRevision(client, {
      id: entry.itemId,
      updatedBy: userId
    });
    if (updated.error) {
      summary.errors.push(
        `${entry.partNumber}: failed to make Rev ${entry.revision} the default`
      );
    } else {
      summary.defaultsUpdated += 1;
    }
  }

  // ---- Pass 4: one Draft change notice for what this push created ---------
  if (created.length > 0) {
    const changeNotice = await insertChangeNotice(client, {
      companyId,
      createdBy: userId,
      name: `Onshape release ${release.releaseName ?? release.releaseId}`,
      openDate: new Date().toISOString().slice(0, 10)
    });
    if (changeNotice.error || !changeNotice.data) {
      summary.errors.push(
        `Change notice: ${changeNotice.error?.message ?? "failed to create"}`
      );
    } else {
      summary.changeNotice = changeNotice.data.changeNoticeId;
      let sortOrder = 0;
      for (const entry of created) {
        const draftMethod = await activeMakeMethodFor(entry.itemId);
        const baseMethod = entry.baseItemId
          ? await activeMakeMethodFor(entry.baseItemId)
          : null;
        const affected = await client.from("changeOrderAffectedItem").insert({
          changeOrderId: changeNotice.data.id,
          itemId: entry.baseItemId ?? entry.itemId,
          changeType: entry.baseItemId ? "Revision" : "New Part",
          sortOrder,
          draftMakeMethodId:
            draftMethod?.status === "Draft" ? draftMethod.id : null,
          baseMakeMethodId: baseMethod?.id ?? null,
          newItemId: entry.baseItemId ? entry.itemId : null,
          companyId,
          createdBy: userId
          // biome-ignore lint/suspicious/noExplicitAny: enum unions narrowed above
        } as any);
        if (affected.error) {
          summary.errors.push(
            `Change notice item ${entry.partNumber}: ${affected.error.message}`
          );
        }
        sortOrder += 1;
      }
    }
  }

  // ---- Pass 5: asset exports at the released versions ---------------------
  const assetTargets: Array<{
    item: PanelReleaseItem;
    itemId: string;
    kind: "partstudio" | "assembly" | "drawing";
  }> = [];
  for (const item of modelItems) {
    const row = revisionItemByPartNumber.get(item.partNumber);
    if (!row) continue;
    assetTargets.push({
      item,
      itemId: row.id,
      kind: item.elementType === 1 ? "assembly" : "partstudio"
    });
  }
  for (const drawing of drawingItems) {
    // v1 drawing match: the released drawing shares its part number with a
    // model item in the same release. Anything else is skipped with a note.
    const target = revisionItemByPartNumber.get(drawing.partNumber);
    if (!target) {
      summary.skipped.push(
        `${drawing.partNumber}: drawing has no matching model item in this release`
      );
      continue;
    }
    assetTargets.push({ item: drawing, itemId: target.id, kind: "drawing" });
  }
  for (const target of assetTargets) {
    await trigger("onshape-panel-sync", {
      companyId,
      userId,
      itemId: target.itemId,
      documentId,
      wvm: "v",
      wvmId: target.item.versionId,
      elementId: target.item.elementId,
      elementKind: target.kind,
      assetBaseName: `${target.item.partNumber}-${target.item.revision}`
    });
  }

  return data({ summary }, { headers: { "Cache-Control": "no-store" } });
}
