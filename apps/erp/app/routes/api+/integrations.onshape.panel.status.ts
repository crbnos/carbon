import { requirePermissions } from "@carbon/auth/auth.server";
import type { PanelAssemblyLineInput, PanelItemRow } from "@carbon/ee";
import {
  buildAssemblyLineStatuses,
  buildPartStatuses,
  externalIdForAssembly,
  externalIdForBomLine,
  metadataProperty,
  parseBomTree
} from "@carbon/ee";
import type { OnshapeDocument } from "@carbon/ee/onshape";
import {
  getOnshapeClient,
  ONSHAPE_V2_INTEGRATION_ID,
  OnshapeWVMType,
  onshapeFailure,
  selectInBatches
} from "@carbon/ee/onshape";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/**
 * Carbon status for the current Onshape element.
 *
 * Part Studio: the part list joined to mappings/items (one live call, cached).
 * Assembly: the indented BOM joined to items by part number (one live call,
 * cached) plus the assembly's own mapping. Everything else is Carbon's DB.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts"
  });

  const url = new URL(request.url);
  const documentId = url.searchParams.get("documentId");
  const wv = url.searchParams.get("wv");
  const wvId = url.searchParams.get("wvId");
  const elementId = url.searchParams.get("elementId");

  if (
    !documentId ||
    !wvId ||
    !elementId ||
    (wv !== "w" && wv !== "v" && wv !== "m")
  ) {
    return data({ error: "Missing Onshape context" }, { status: 400 });
  }

  const onshape = await getOnshapeClient(
    client,
    companyId,
    userId,
    ONSHAPE_V2_INTEGRATION_ID
  );
  if (onshape.error || !onshape.client) {
    return data(
      { error: "Onshape is not connected for this company" },
      { status: 422 }
    );
  }

  const wvm =
    wv === "w"
      ? OnshapeWVMType.WORKSPACE
      : wv === "v"
        ? OnshapeWVMType.VERSION
        : OnshapeWVMType.MICROVERSION;
  const document: OnshapeDocument = { documentId, wvm, wvmId: wvId };

  let kind: "partstudio" | "assembly" | "other";
  try {
    const elements = await onshape.client.getElementsIn(document);
    const element = elements.find((e) => e.id === elementId);
    kind =
      element?.elementType === "ASSEMBLY"
        ? "assembly"
        : element?.elementType === "PARTSTUDIO"
          ? "partstudio"
          : "other";
  } catch (error) {
    const failure = onshapeFailure(error);
    return data(failure.body, { status: failure.status });
  }

  if (kind === "other") {
    return data({ kind }, { headers: { "Cache-Control": "no-store" } });
  }

  if (kind === "assembly") {
    let bom: unknown;
    try {
      bom = await onshape.client.getBillOfMaterialsIn(document, elementId);
    } catch (error) {
      const failure = onshapeFailure(error, "bom");
      return data(failure.body, { status: failure.status });
    }

    const { root: bomRoot, lines } = parseBomTree(bom);
    // The BOM omits the assembly's own row; its identity lives in element
    // metadata (one cached call).
    let rootPartNumber = bomRoot?.partNumber ?? null;
    let rootName = bomRoot?.name ?? null;
    // Kept non-fatal — the BOM itself read fine — but no longer silent. A null
    // part number used to mean either "Onshape has none" or "we never managed
    // to ask", and the panel answered both by telling the user to fix their
    // Onshape data.
    let rootIdentityUnavailable = false;
    try {
      const metadata = await onshape.client.getElementMetadata(
        document,
        elementId
      );
      rootPartNumber =
        metadataProperty(metadata, "Part number") ?? rootPartNumber;
      rootName = metadataProperty(metadata, "Name") ?? rootName;
    } catch {
      rootIdentityUnavailable = true;
    }
    const flat: PanelAssemblyLineInput[] = [];
    const walk = (nodes: ReturnType<typeof parseBomTree>["lines"]) => {
      for (const node of nodes) {
        flat.push({
          index: node.index,
          level: node.level,
          partNumber: node.partNumber,
          name: node.name,
          quantity: node.quantity,
          purchased: node.purchased,
          itemSource: node.itemSource
        });
        walk(node.children);
      }
    };
    walk(lines);

    const partNumbers = [
      ...new Set(
        [rootPartNumber, ...flat.map((l) => l.partNumber)].filter(
          (n): n is string => !!n
        )
      )
    ];
    // A child's mapping is keyed by the part studio it came from, not by this
    // assembly element, so the lookup is over the lines' own source keys.
    const lineExternalIds = [
      ...new Set(
        flat
          .map((line) => externalIdForBomLine(line.itemSource))
          .filter((id): id is string => !!id)
      )
    ];

    const [rootMapping, lineMappings, items] = await Promise.all([
      client
        .from("externalIntegrationMapping")
        .select("entityId, externalId, lastSyncedAt")
        .eq("companyId", companyId)
        .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
        .eq("entityType", "item")
        .eq("externalId", externalIdForAssembly(documentId, elementId))
        .maybeSingle(),
      selectInBatches(lineExternalIds, (batch) =>
        client
          .from("externalIntegrationMapping")
          .select("entityId, externalId, lastSyncedAt")
          .eq("companyId", companyId)
          .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
          .eq("entityType", "item")
          .in("externalId", batch)
      ),
      selectInBatches(partNumbers, (batch) =>
        client
          .from("item")
          .select("id, readableId, revision, name")
          .eq("companyId", companyId)
          .in("readableId", batch)
      )
    ]);

    /*
     * Every read is checked, not just the mappings. `selectInBatches` returns
     * `{ data: [], error }` on a failure, which is indistinguishable from "no
     * rows" — so an unchecked item read rendered every line "Not in Carbon",
     * and the user's reasonable next step was to push parts that already exist.
     */
    if (lineMappings.error || rootMapping.error || items.error) {
      return data(
        {
          error:
            "Carbon couldn't read its items for this assembly. Press Refresh to try again."
        },
        { status: 500 }
      );
    }

    // entityId is polymorphic and unconstrained, so a mapping can outlive its
    // item. Load the mapped items to tell a live link from a stale row.
    const assemblyItems = (items.data ?? []) as PanelItemRow[];
    const mappedItemIds = [
      ...new Set(
        [
          ...(lineMappings.data ?? []),
          ...(rootMapping.data ? [rootMapping.data] : [])
        ]
          .map((m) => m.entityId)
          .filter((id) => !assemblyItems.some((i) => i.id === id))
      )
    ];
    const mappedResult = await selectInBatches(mappedItemIds, (batch) =>
      client
        .from("item")
        .select("id, readableId, revision, name")
        .eq("companyId", companyId)
        .in("id", batch)
    );
    if (mappedResult.error) {
      return data(
        {
          error:
            "Carbon couldn't read its items for this assembly. Press Refresh to try again."
        },
        { status: 500 }
      );
    }
    const mappedItems = mappedResult.data as PanelItemRow[];
    const allItems = [...assemblyItems, ...mappedItems];

    const itemByReadableId = new Map(
      assemblyItems.map((i) => [i.readableId, i])
    );
    const rootItem = rootPartNumber
      ? itemByReadableId.get(rootPartNumber)
      : undefined;
    const rootLinkedItem = rootMapping.data
      ? allItems.find((i) => i.id === rootMapping.data?.entityId)
      : undefined;

    return data(
      {
        kind,
        assembly: {
          root: {
            partNumber: rootPartNumber,
            name: rootName,
            identityUnavailable: rootIdentityUnavailable,
            state: rootLinkedItem
              ? ("linked" as const)
              : rootItem
                ? ("matched" as const)
                : ("missing" as const),
            itemId: rootLinkedItem?.id ?? rootItem?.id ?? null,
            lastSyncedAt: rootLinkedItem
              ? (rootMapping.data?.lastSyncedAt ?? null)
              : null
          },
          lines: buildAssemblyLineStatuses({
            lines: flat,
            mappings: lineMappings.data ?? [],
            items: allItems
          })
        }
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  let parts: Awaited<ReturnType<typeof onshape.client.getPartsInElement>>;
  try {
    parts = await onshape.client.getPartsInElement(document, elementId);
  } catch (error) {
    const failure = onshapeFailure(error);
    return data(failure.body, { status: failure.status });
  }

  const [mappings, matches] = await Promise.all([
    client
      .from("externalIntegrationMapping")
      .select("entityId, externalId, lastSyncedAt")
      .eq("companyId", companyId)
      .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
      .eq("entityType", "item")
      .like("externalId", `${documentId}:${elementId}:%`),
    (async () => {
      const partNumbers = parts
        .map((p) => p.partNumber)
        .filter((n): n is string => !!n);
      return selectInBatches(partNumbers, (batch) =>
        client
          .from("item")
          .select("id, readableId, revision, name")
          .eq("companyId", companyId)
          .in("readableId", batch)
      );
    })()
  ]);

  // As on the assembly path: a failed batch read looks like "no rows".
  if (mappings.error || matches.error) {
    return data(
      {
        error:
          "Carbon couldn't read its items for these parts. Press Refresh to try again."
      },
      { status: 500 }
    );
  }

  const mappedItemIds = (mappings.data ?? [])
    .map((m) => m.entityId)
    .filter((id) => !(matches.data ?? []).some((i) => i.id === id));
  const mappedResult = await selectInBatches(mappedItemIds, (batch) =>
    client
      .from("item")
      .select("id, readableId, revision, name")
      .eq("companyId", companyId)
      .in("id", batch)
  );
  if (mappedResult.error) {
    return data(
      {
        error:
          "Carbon couldn't read its items for these parts. Press Refresh to try again."
      },
      { status: 500 }
    );
  }
  const mappedItems = mappedResult.data as PanelItemRow[];

  const statuses = buildPartStatuses({
    documentId,
    elementId,
    parts,
    mappings: mappings.data ?? [],
    items: [...((matches.data ?? []) as PanelItemRow[]), ...mappedItems]
  });

  return data(
    { kind, parts: statuses },
    { headers: { "Cache-Control": "no-store" } }
  );
}
