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

/**
 * What the panel shows per line of the current assembly's BOM. Same vocabulary
 * as {@link PanelPartStatus}: `linked` is the mapping join, `matched` is the
 * part-number join, `missing` is neither.
 *
 * A BOM line's mapping is keyed by the line's *source* part studio
 * (`itemSource`), not by the assembly element being viewed — that is the key an
 * assembly push writes for each child. A line whose BOM row carries no
 * `itemSource` can only ever reach `matched`; there is no part to key on.
 */
export type PanelAssemblyLineStatus = {
  index: string;
  level: number;
  partNumber: string | null;
  name: string | null;
  quantity: number;
  purchased: boolean;
  state: "linked" | "matched" | "missing";
  itemId: string | null;
  lastSyncedAt: string | null;
};

export type PanelAssemblyLineInput = {
  index: string;
  level: number;
  partNumber: string | null;
  name: string | null;
  quantity: number;
  purchased: boolean;
  itemSource: {
    documentId?: string;
    elementId?: string;
    partId?: string;
  } | null;
};

/**
 * The mapping key for a BOM line, or null when the row names no usable source.
 *
 * A part row names a part studio and a partId, and keys like any pushed part.
 * A sub-assembly row names an assembly element and no partId, so it keys the
 * way a pushed assembly does — which is what makes one key work from both the
 * parent's BOM and the sub-assembly's own panel.
 */
export function externalIdForBomLine(
  itemSource: PanelAssemblyLineInput["itemSource"]
): string | null {
  if (!itemSource?.documentId || !itemSource.elementId) return null;
  return itemSource.partId
    ? externalIdForPart(
        itemSource.documentId,
        itemSource.elementId,
        itemSource.partId
      )
    : externalIdForAssembly(itemSource.documentId, itemSource.elementId);
}

export function buildAssemblyLineStatuses({
  lines,
  mappings,
  items
}: {
  lines: PanelAssemblyLineInput[];
  mappings: PanelMappingRow[];
  items: PanelItemRow[];
}): PanelAssemblyLineStatus[] {
  const mappingByExternalId = new Map(
    mappings.filter((m) => m.externalId).map((m) => [m.externalId as string, m])
  );
  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemByReadableId = new Map(items.map((i) => [i.readableId, i]));

  return lines.map(({ itemSource, ...line }) => {
    const externalId = externalIdForBomLine(itemSource);
    const mapping = externalId
      ? mappingByExternalId.get(externalId)
      : undefined;
    // A mapping whose item is gone is not a link: entityId is polymorphic and
    // carries no foreign key, so rows outlive the items they point at.
    const linkedItem = mapping ? itemById.get(mapping.entityId) : undefined;
    if (mapping && linkedItem) {
      return {
        ...line,
        state: "linked" as const,
        itemId: linkedItem.id,
        lastSyncedAt: mapping.lastSyncedAt
      };
    }

    const matched = line.partNumber
      ? itemByReadableId.get(line.partNumber)
      : undefined;
    return {
      ...line,
      state: matched ? ("matched" as const) : ("missing" as const),
      itemId: matched?.id ?? null,
      lastSyncedAt: null
    };
  });
}
