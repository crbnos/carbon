// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { OnshapeElementPart } from "../lib/client";
import { compareRevisions } from "./revision";

/**
 * `linked`: a mapping row holds the part's key. `matched`: an item's readableId
 * equals the part number. `released`: a release push made a revision of it.
 */
export type PanelPartStatus = {
  partId: string;
  name: string;
  partNumber: string | null;
  revision: string | null;
  microversionId: string | null;
  state: "linked" | "matched" | "missing" | "released";
  item: {
    id: string;
    readableId: string;
    revision: string;
    name: string;
  } | null;
  lastSyncedAt: string | null;
};

/**
 * One partId's configured variants can carry different part numbers, so a
 * non-default configuration is part of identity. "default" and empty are null;
 * launch parameters may arrive URL-encoded.
 */
export function normalizeConfiguration(
  configuration: string | null | undefined
): string | null {
  if (typeof configuration !== "string") return null;
  let value = configuration.trim();
  try {
    value = decodeURIComponent(value).trim();
  } catch {
    // Not URL-encoded (a stray "%"): use it as it came.
  }
  if (value === "" || value.toLowerCase() === "default") return null;
  return value;
}

function withConfiguration(key: string, configuration?: string | null) {
  const normalized = normalizeConfiguration(configuration);
  return normalized ? `${key}:${normalized}` : key;
}

export function externalIdForAssembly(
  documentId: string,
  elementId: string,
  configuration?: string | null
) {
  return withConfiguration(
    `${documentId}:${elementId}:assembly`,
    configuration
  );
}

export function externalIdForPart(
  documentId: string,
  elementId: string,
  partId: string,
  configuration?: string | null
) {
  return withConfiguration(
    `${documentId}:${elementId}:${partId}`,
    configuration
  );
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

export type ReleasedRevision = { itemId: string; revision: string };

/** Per part number, the newest revision among items with a `release:` link. */
export function releasedRevisionsByPartNumber(
  items: Array<{ id: string; readableId: string; revision: string | null }>,
  releasedItemIds: ReadonlySet<string>
): Map<string, ReleasedRevision> {
  const byPartNumber = new Map<string, ReleasedRevision>();
  for (const item of items) {
    if (!releasedItemIds.has(item.id)) continue;
    const current = byPartNumber.get(item.readableId);
    if (!current || compareRevisions(item.revision, current.revision) > 0) {
      byPartNumber.set(item.readableId, {
        itemId: item.id,
        revision: item.revision ?? "0"
      });
    }
  }
  return byPartNumber;
}

export function buildPartStatuses({
  documentId,
  elementId,
  configuration = null,
  parts,
  mappings,
  items,
  released = new Map()
}: {
  documentId: string;
  elementId: string;
  /** The Part Studio configuration the parts were read in. */
  configuration?: string | null;
  parts: OnshapeElementPart[];
  mappings: PanelMappingRow[];
  items: PanelItemRow[];
  /** `releasedRevisionsByPartNumber` over the parts' items. */
  released?: ReadonlyMap<string, ReleasedRevision>;
}): PanelPartStatus[] {
  const mappingByExternalId = new Map(
    mappings.filter((m) => m.externalId).map((m) => [m.externalId as string, m])
  );
  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemByReadableId = new Map(items.map((i) => [i.readableId, i]));

  return parts
    .filter((part) => !part.isHidden)
    .map((part) => {
      const releasedRevision = part.partNumber
        ? released.get(part.partNumber)
        : undefined;
      const releasedItem = releasedRevision
        ? itemById.get(releasedRevision.itemId)
        : undefined;
      if (releasedItem) {
        return {
          partId: part.partId,
          name: part.name,
          partNumber: part.partNumber ?? null,
          revision: part.revision ?? null,
          microversionId: part.microversionId ?? null,
          state: "released" as const,
          item: releasedItem,
          lastSyncedAt: null
        };
      }
      const mapping = mappingByExternalId.get(
        externalIdForPart(documentId, elementId, part.partId, configuration)
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
 * States as {@link PanelPartStatus}. A line is keyed by its `itemSource`, as an
 * assembly push writes it; a line without one can only reach `matched`.
 */
export type PanelAssemblyLineStatus = {
  index: string;
  level: number;
  partNumber: string | null;
  name: string | null;
  quantity: number;
  state: "linked" | "matched" | "missing" | "released";
  itemId: string | null;
  /** `released` only: the newest released revision. */
  releasedRevision?: string;
  lastSyncedAt: string | null;
};

export type PanelAssemblyLineInput = {
  index: string;
  level: number;
  partNumber: string | null;
  name: string | null;
  quantity: number;
  itemSource: {
    documentId?: string;
    elementId?: string;
    partId?: string;
    configuration?: string;
  } | null;
};

/**
 * A sub-assembly row has no partId and keys like a pushed assembly, so one key
 * works from the parent's BOM and from the sub-assembly's own panel.
 */
export function externalIdForBomLine(
  itemSource: PanelAssemblyLineInput["itemSource"]
): string | null {
  if (!itemSource?.documentId || !itemSource.elementId) return null;
  return itemSource.partId
    ? externalIdForPart(
        itemSource.documentId,
        itemSource.elementId,
        itemSource.partId,
        itemSource.configuration
      )
    : externalIdForAssembly(
        itemSource.documentId,
        itemSource.elementId,
        itemSource.configuration
      );
}

export function buildAssemblyLineStatuses({
  lines,
  mappings,
  items,
  released = new Map()
}: {
  lines: PanelAssemblyLineInput[];
  mappings: PanelMappingRow[];
  items: PanelItemRow[];
  released?: ReadonlyMap<string, ReleasedRevision>;
}): PanelAssemblyLineStatus[] {
  const mappingByExternalId = new Map(
    mappings.filter((m) => m.externalId).map((m) => [m.externalId as string, m])
  );
  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemByReadableId = new Map(items.map((i) => [i.readableId, i]));

  return lines.map(({ itemSource, ...line }) => {
    const releasedRevision = line.partNumber
      ? released.get(line.partNumber)
      : undefined;
    if (releasedRevision && itemById.has(releasedRevision.itemId)) {
      return {
        ...line,
        state: "released" as const,
        itemId: releasedRevision.itemId,
        releasedRevision: releasedRevision.revision,
        lastSyncedAt: null
      };
    }
    const externalId = externalIdForBomLine(itemSource);
    const mapping = externalId
      ? mappingByExternalId.get(externalId)
      : undefined;
    // entityId has no foreign key, so a mapping can outlive its item.
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
