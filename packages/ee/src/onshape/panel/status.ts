import type { OnshapeElementPart } from "../lib/client";

/**
 * What the panel shows per part of the current element: whether Carbon already
 * has it, and through which relationship.
 *
 * - `linked`: an `externalIntegrationMapping` row points at this exact part
 *   (documentId:elementId:partId). The strong join; survives renames.
 * - `matched`: no mapping, but an item's readableId equals the Onshape part
 *   number. The candidate join; a push adopts it and writes the mapping.
 * - `missing`: Carbon has nothing for it.
 */
export type PanelPartStatus = {
  partId: string;
  name: string;
  partNumber: string | null;
  revision: string | null;
  microversionId: string | null;
  state: "linked" | "matched" | "missing";
  item: {
    id: string;
    readableId: string;
    revision: string;
    name: string;
  } | null;
  lastSyncedAt: string | null;
};

/** Mapping key for an assembly element pushed as a whole. */
export function externalIdForAssembly(documentId: string, elementId: string) {
  return `${documentId}:${elementId}:assembly`;
}

/** The one mapping key every panel write uses. */
export function externalIdForPart(
  documentId: string,
  elementId: string,
  partId: string
) {
  return `${documentId}:${elementId}:${partId}`;
}

export type PanelMappingRow = {
  entityId: string;
  externalId: string | null;
  lastSyncedAt: string | null;
};

export type PanelItemRow = {
  id: string;
  readableId: string;
  revision: string;
  name: string;
};

export function buildPartStatuses({
  documentId,
  elementId,
  parts,
  mappings,
  items
}: {
  documentId: string;
  elementId: string;
  parts: OnshapeElementPart[];
  mappings: PanelMappingRow[];
  items: PanelItemRow[];
}): PanelPartStatus[] {
  const mappingByExternalId = new Map(
    mappings.filter((m) => m.externalId).map((m) => [m.externalId as string, m])
  );
  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemByReadableId = new Map(items.map((i) => [i.readableId, i]));

  return parts
    .filter((part) => !part.isHidden)
    .map((part) => {
      const mapping = mappingByExternalId.get(
        externalIdForPart(documentId, elementId, part.partId)
      );
      const linkedItem = mapping ? itemById.get(mapping.entityId) : undefined;
      if (mapping && linkedItem) {
        return {
          partId: part.partId,
          name: part.name,
          partNumber: part.partNumber ?? null,
          revision: part.revision ?? null,
          microversionId: part.microversionId ?? null,
          state: "linked" as const,
          item: linkedItem,
          lastSyncedAt: mapping.lastSyncedAt
        };
      }

      const matched = part.partNumber
        ? itemByReadableId.get(part.partNumber)
        : undefined;
      return {
        partId: part.partId,
        name: part.name,
        partNumber: part.partNumber ?? null,
        revision: part.revision ?? null,
        microversionId: part.microversionId ?? null,
        state: matched ? ("matched" as const) : ("missing" as const),
        item: matched ?? null,
        lastSyncedAt: null
      };
    });
}
