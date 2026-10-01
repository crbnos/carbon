// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PanelAssemblyLineInput, PanelItemRow } from "@carbon/ee";
import {
  buildAssemblyLineStatuses,
  buildPartStatuses,
  externalIdForAssembly,
  externalIdForBomLine,
  metadataProperty,
  missingBomColumnsMessage,
  normalizeConfiguration,
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
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/** Carbon status for the current Onshape element: its parts or its BOM. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requireOnshapePanelPermissions(
    request,
    {
      view: "parts"
    }
  );

  const url = new URL(request.url);
  const documentId = url.searchParams.get("documentId");
  const wv = url.searchParams.get("wv");
  const wvId = url.searchParams.get("wvId");
  const elementId = url.searchParams.get("elementId");
  // Part of every identity key and Onshape read: a configured part's part
  // number depends on it.
  const configuration = normalizeConfiguration(
    url.searchParams.get("configuration")
  );

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
      bom = await onshape.client.getBillOfMaterialsIn(
        document,
        elementId,
        configuration
      );
    } catch (error) {
      const failure = onshapeFailure(error, "bom");
      return data(failure.body, { status: failure.status });
    }

    const { root: bomRoot, lines, missingColumns } = parseBomTree(bom);
    // Without its required columns every line would read "Not in Carbon".
    if (missingColumns.length > 0) {
      return data(
        { error: missingBomColumnsMessage(missingColumns) },
        { status: 422 }
      );
    }
    // The BOM omits the assembly's own row; its identity is in element metadata.
    let rootPartNumber = bomRoot?.partNumber ?? null;
    let rootName = bomRoot?.name ?? null;
    // Non-fatal: the BOM itself read fine.
    let rootIdentityUnavailable = false;
    try {
      const metadata = await onshape.client.getElementMetadata(
        document,
        elementId,
        configuration
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
        .eq(
          "externalId",
          externalIdForAssembly(documentId, elementId, configuration)
        )
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

    // selectInBatches returns empty data on failure, so check every error.
    if (lineMappings.error || rootMapping.error || items.error) {
      return data(
        {
          error: "Carbon couldn't read its items for this assembly. Try again."
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
          error: "Carbon couldn't read its items for this assembly. Try again."
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
    parts = await onshape.client.getPartsInElement(
      document,
      elementId,
      configuration
    );
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

  if (mappings.error || matches.error) {
    return data(
      {
        error: "Carbon couldn't read its items for these parts. Try again."
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
        error: "Carbon couldn't read its items for these parts. Try again."
      },
      { status: 500 }
    );
  }
  const mappedItems = mappedResult.data as PanelItemRow[];

  const statuses = buildPartStatuses({
    documentId,
    elementId,
    configuration,
    parts,
    mappings: mappings.data ?? [],
    items: [...((matches.data ?? []) as PanelItemRow[]), ...mappedItems]
  });

  return data(
    { kind, parts: statuses },
    { headers: { "Cache-Control": "no-store" } }
  );
}
