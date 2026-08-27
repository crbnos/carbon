import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { OnshapeBomNode } from "@carbon/ee";
import {
  externalIdForAssembly,
  externalIdForPart,
  metadataProperty,
  parseBomTree
} from "@carbon/ee";
import type { OnshapeDocument } from "@carbon/ee/onshape";
import { getOnshapeClient, OnshapeWVMType } from "@carbon/ee/onshape";
import { trigger } from "@carbon/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { upsertPart } from "~/modules/items";

export const config = {
  runtime: "nodejs"
};

const payloadSchema = z.object({
  documentId: z.string().min(1),
  wv: z.enum(["w", "v"]),
  wvId: z.string().min(1),
  elementId: z.string().min(1)
});

type PushSummary = {
  assemblyItemId: string | null;
  itemsCreated: number;
  itemsReused: number;
  linesWritten: number;
  methodsTouched: number;
  skipped: string[];
  errors: string[];
};

/**
 * Push an Onshape assembly into Carbon: ensure every BOM item exists, then
 * apply the BOM tree to the make methods — replacing only the lines a
 * previous push wrote (tracked by methodMaterial mapping rows) so manual
 * lines survive, and refusing released (Active) methods rather than touching
 * them. Exactly one live Onshape call (the BOM, usually cached); the assembly
 * model export is queued as the same background job part pushes use.
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
  const { documentId, wv, wvId, elementId } = parsed.data;

  const onshape = await getOnshapeClient(client, companyId, userId);
  if (onshape.error || !onshape.client) {
    return data(
      { error: "Onshape is not connected for this company" },
      { status: 422 }
    );
  }

  const document: OnshapeDocument = {
    documentId,
    wvm: wv === "w" ? OnshapeWVMType.WORKSPACE : OnshapeWVMType.VERSION,
    wvmId: wvId
  };

  let bom: unknown;
  try {
    bom = await onshape.client.getBillOfMaterialsIn(document, elementId);
  } catch (error) {
    return data(
      {
        error: error instanceof Error ? error.message : "Onshape request failed"
      },
      { status: 502 }
    );
  }

  const { root: bomRoot, lines } = parseBomTree(bom);
  let rootPartNumber = bomRoot?.partNumber ?? null;
  let rootName = bomRoot?.name ?? null;
  let rootDescription = bomRoot?.description ?? null;
  const rootRevision = bomRoot?.revision ?? null;
  try {
    const metadata = await onshape.client.getElementMetadata(
      document,
      elementId
    );
    rootPartNumber =
      metadataProperty(metadata, "Part number") ?? rootPartNumber;
    rootName = metadataProperty(metadata, "Name") ?? rootName;
    rootDescription =
      metadataProperty(metadata, "Description") ?? rootDescription;
  } catch {
    // fall through to the 422 below when identity is missing
  }
  if (!rootPartNumber) {
    return data(
      { error: "Set a part number on the assembly in Onshape first" },
      { status: 422 }
    );
  }

  const summary: PushSummary = {
    assemblyItemId: null,
    itemsCreated: 0,
    itemsReused: 0,
    linesWritten: 0,
    methodsTouched: 0,
    skipped: [],
    errors: []
  };

  // ---- Ensure items -------------------------------------------------------
  const allNodes: OnshapeBomNode[] = [];
  const collect = (nodes: OnshapeBomNode[]) => {
    for (const node of nodes) {
      allNodes.push(node);
      collect(node.children);
    }
  };
  collect(lines);

  const partNumbers = [
    ...new Set(
      [rootPartNumber, ...allNodes.map((n) => n.partNumber)].filter(
        (n): n is string => !!n
      )
    )
  ];

  const existing = await client
    .from("item")
    .select("id, readableId, unitOfMeasureCode, defaultMethodType")
    .eq("companyId", companyId)
    .in("readableId", partNumbers);
  type ItemRow = {
    id: string;
    readableId: string;
    unitOfMeasureCode: string | null;
    defaultMethodType: string | null;
  };
  const itemByReadableId = new Map(
    ((existing.data ?? []) as ItemRow[]).map((i) => [i.readableId, i])
  );

  const madePartNumbers = new Set<string>([rootPartNumber]);
  for (const node of allNodes) {
    if (node.partNumber && node.children.length > 0) {
      madePartNumbers.add(node.partNumber);
    }
  }

  const ensureItem = async (
    partNumber: string,
    node: Pick<
      OnshapeBomNode,
      "name" | "description" | "revision" | "purchased"
    >
  ): Promise<ItemRow | null> => {
    const found = itemByReadableId.get(partNumber);
    if (found) {
      summary.itemsReused += 1;
      return found;
    }
    const made = madePartNumbers.has(partNumber) || !node.purchased;
    const created = await upsertPart(client, {
      id: partNumber,
      name: node.name ?? partNumber,
      description: node.description ?? undefined,
      revision: node.revision ?? "0",
      replenishmentSystem: made ? "Make" : "Buy",
      defaultMethodType: made ? "Make to Order" : "Pull from Inventory",
      itemTrackingType: "Inventory",
      unitOfMeasureCode: "EA",
      companyId,
      createdBy: userId
      // biome-ignore lint/suspicious/noExplicitAny: partValidator carries many optional form-only fields
    } as any);
    if (created.error || !created.data) {
      summary.errors.push(
        `${partNumber}: ${created.error?.message ?? "failed to create"}`
      );
      return null;
    }
    const row: ItemRow = {
      id: created.data.id as string,
      readableId: partNumber,
      unitOfMeasureCode: "EA",
      defaultMethodType: made ? "Make to Order" : "Pull from Inventory"
    };
    itemByReadableId.set(partNumber, row);
    summary.itemsCreated += 1;
    return row;
  };

  const rootItem = await ensureItem(rootPartNumber, {
    name: rootName,
    description: rootDescription,
    revision: rootRevision,
    purchased: false
  });
  if (!rootItem) {
    return data(
      { error: summary.errors.join("; ") || "Failed to create the assembly" },
      { status: 500 }
    );
  }
  summary.assemblyItemId = rootItem.id;

  for (const node of allNodes) {
    if (!node.partNumber) {
      summary.skipped.push(
        `${node.name ?? node.index}: no part number in Onshape`
      );
      continue;
    }
    await ensureItem(node.partNumber, node);
  }

  // ---- Apply BOM lines to make methods -----------------------------------
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

  const applyLines = async (
    parentItemId: string,
    parentLabel: string,
    children: OnshapeBomNode[]
  ): Promise<void> => {
    const method = await activeMakeMethodFor(parentItemId);
    if (!method) {
      summary.errors.push(`${parentLabel}: no make method found`);
      return;
    }
    if (method.status === "Active") {
      summary.errors.push(
        `${parentLabel}: make method is released; pushing to released methods lands with releases`
      );
      return;
    }

    // Lines a previous push wrote to this method — replace them; leave
    // everything else (manual lines) untouched.
    const mapped = await serviceRole
      .from("externalIntegrationMapping")
      .select("id, entityId")
      .eq("companyId", companyId)
      .eq("integration", "onshape")
      .eq("entityType", "methodMaterial")
      .eq("metadata->>makeMethodId", method.id);
    const mappedLineIds = (mapped.data ?? []).map((m) => m.entityId);
    if (mappedLineIds.length > 0) {
      await client.from("methodMaterial").delete().in("id", mappedLineIds);
      await serviceRole
        .from("externalIntegrationMapping")
        .delete()
        .in(
          "id",
          (mapped.data ?? []).map((m) => m.id)
        );
    }

    summary.methodsTouched += 1;

    let order = 0;
    for (const child of children) {
      if (!child.partNumber) continue;
      const childItem = itemByReadableId.get(child.partNumber);
      if (!childItem) continue;

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
          `${parentLabel} → ${child.partNumber}: ${inserted.error?.message ?? "line insert failed"}`
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
          elementId,
          partNumber: child.partNumber,
          index: child.index
        },
        lastSyncedAt: new Date().toISOString(),
        companyId,
        createdBy: userId
      });

      if (childMade) {
        await applyLines(childItem.id, child.partNumber, child.children);
      }
    }
  };

  await applyLines(rootItem.id, rootPartNumber, lines);

  // ---- Assembly item mapping + child part links --------------------------
  const assemblyExternalId = externalIdForAssembly(documentId, elementId);
  await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("companyId", companyId)
    .eq("integration", "onshape")
    .eq("entityType", "item")
    .or(`entityId.eq.${rootItem.id},externalId.eq.${assemblyExternalId}`);
  await client.from("externalIntegrationMapping").insert({
    entityType: "item",
    entityId: rootItem.id,
    integration: "onshape",
    externalId: assemblyExternalId,
    metadata: {
      documentId,
      elementId,
      wv,
      wvId,
      kind: "assembly",
      partNumber: rootPartNumber,
      name: rootName,
      pushedBy: userId,
      pushedAt: new Date().toISOString()
    },
    lastSyncedAt: new Date().toISOString(),
    companyId,
    createdBy: userId
  });

  // Link child parts to their source part studios when the BOM names them,
  // without clobbering a link an explicit part push already made.
  await linkChildParts(client, serviceRole, {
    companyId,
    userId,
    nodes: allNodes,
    itemByReadableId
  });

  await trigger("onshape-panel-sync", {
    companyId,
    userId,
    itemId: rootItem.id,
    documentId,
    wvm: wv,
    wvmId: wvId,
    elementId,
    elementKind: "assembly",
    assetBaseName: rootPartNumber
  });

  return data({ summary }, { headers: { "Cache-Control": "no-store" } });
}

async function linkChildParts(
  client: SupabaseClient<Database>,
  serviceRole: SupabaseClient<Database>,
  input: {
    companyId: string;
    userId: string;
    nodes: OnshapeBomNode[];
    itemByReadableId: Map<string, { id: string; readableId: string }>;
  }
) {
  const seen = new Set<string>();
  for (const node of input.nodes) {
    const source = node.itemSource;
    if (
      !node.partNumber ||
      !source?.documentId ||
      !source.elementId ||
      !source.partId
    ) {
      continue;
    }
    const item = input.itemByReadableId.get(node.partNumber);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);

    const externalId = externalIdForPart(
      source.documentId,
      source.elementId,
      source.partId
    );
    const existing = await serviceRole
      .from("externalIntegrationMapping")
      .select("id")
      .eq("companyId", input.companyId)
      .eq("integration", "onshape")
      .eq("entityType", "item")
      .or(`entityId.eq.${item.id},externalId.eq.${externalId}`)
      .limit(1)
      .maybeSingle();
    if (existing.data) continue;

    await client.from("externalIntegrationMapping").insert({
      entityType: "item",
      entityId: item.id,
      integration: "onshape",
      externalId,
      metadata: {
        documentId: source.documentId,
        elementId: source.elementId,
        partId: source.partId,
        partNumber: node.partNumber,
        viaAssemblyPush: true,
        pushedBy: input.userId,
        pushedAt: new Date().toISOString()
      },
      lastSyncedAt: new Date().toISOString(),
      companyId: input.companyId,
      createdBy: input.userId
    });
  }
}
