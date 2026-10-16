// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Onshape has no per-document release endpoint, so releases are rebuilt by
 * grouping `GET /revisions/d/{did}` rows on releaseId.
 */

import { normalizeConfiguration } from "./status";

export type ReleaseRevisionLike = {
  partNumber: string;
  revision: string;
  /** 0 = Part Studio (a part), 1 = Assembly, 2 = Drawing. */
  elementType: number;
  documentId: string;
  versionId: string;
  elementId: string;
  /** Part Studio releases: the released part, which the export needs. */
  partId?: string | null;
  releaseId?: string | null;
  releaseName?: string | null;
  releaseCreatedDate?: string | null;
  createdAt?: string | null;
  configuration?: string | null;
  isObsolete?: boolean | null;
};

export type PanelReleaseItem = {
  partNumber: string;
  revision: string;
  elementType: number;
  documentId: string;
  versionId: string;
  elementId: string;
  partId: string | null;
  configuration: string | null;
  obsolete: boolean;
  /** "missing" until resolveReleaseStates fills it. */
  state: "in-carbon" | "missing";
  itemId: string | null;
};

export type PanelRelease = {
  /** Onshape releaseId, or a synthetic key when the API omitted one. */
  releaseId: string;
  releaseName: string | null;
  createdAt: string | null;
  items: PanelReleaseItem[];
  state: "pushed" | "partial" | "not-pushed";
};

const MODEL_ELEMENT_TYPES = new Set([0, 1]);

export function isModelReleaseItem(
  item: Pick<PanelReleaseItem, "elementType">
) {
  return MODEL_ELEMENT_TYPES.has(item.elementType);
}

export function releaseKeyFor(revision: ReleaseRevisionLike): string {
  return (
    revision.releaseId ?? `rev:${revision.partNumber}:${revision.revision}`
  );
}

/**
 * Key of a released assembly's BOM read. A release can hold two configurations
 * of one assembly element, each with its own BOM; the default one keys by the
 * element id alone.
 */
export function releaseBomKey(item: {
  elementId: string;
  configuration?: string | null;
}): string {
  const configuration = normalizeConfiguration(item.configuration);
  return configuration ? `${item.elementId}:${configuration}` : item.elementId;
}

/** Assemblies, then parts, then drawings. */
function itemSortWeight(elementType: number): number {
  if (elementType === 1) return 0;
  if (elementType === 0) return 1;
  return 2;
}

export function groupRevisionsIntoReleases(
  revisions: ReleaseRevisionLike[]
): PanelRelease[] {
  const byRelease = new Map<string, PanelRelease>();

  for (const revision of revisions) {
    const key = releaseKeyFor(revision);
    let release = byRelease.get(key);
    if (!release) {
      release = {
        releaseId: key,
        releaseName: revision.releaseName ?? null,
        createdAt: null,
        items: [],
        state: "not-pushed"
      };
      byRelease.set(key, release);
    }
    if (!release.releaseName && revision.releaseName) {
      release.releaseName = revision.releaseName;
    }
    const stamp = revision.releaseCreatedDate ?? revision.createdAt ?? null;
    if (stamp && (!release.createdAt || stamp > release.createdAt)) {
      release.createdAt = stamp;
    }
    release.items.push({
      partNumber: revision.partNumber,
      revision: revision.revision,
      elementType: revision.elementType,
      documentId: revision.documentId,
      versionId: revision.versionId,
      elementId: revision.elementId,
      partId: revision.partId ?? null,
      configuration: revision.configuration ?? null,
      obsolete: revision.isObsolete ?? false,
      state: "missing",
      itemId: null
    });
  }

  const releases = [...byRelease.values()];
  for (const release of releases) {
    release.items.sort((a, b) => {
      const weight =
        itemSortWeight(a.elementType) - itemSortWeight(b.elementType);
      if (weight !== 0) return weight;
      return a.partNumber.localeCompare(b.partNumber);
    });
  }
  // Newest first; releases without a date sink to the end.
  releases.sort((a, b) => {
    if (!a.createdAt && !b.createdAt) return 0;
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return releases;
}

export type ReleaseCarbonItemRow = {
  id: string;
  readableId: string;
  revision: string;
};

/**
 * A model item is in Carbon when an item has its part number and release
 * letter; a drawing when its PDF name is in `attachedDrawings`. Release state
 * counts every item, so a running drawing export reads partial.
 */
export function resolveReleaseStates(
  releases: PanelRelease[],
  carbonItems: ReleaseCarbonItemRow[],
  attachedDrawings: ReadonlySet<string> = new Set()
): PanelRelease[] {
  const byKey = new Map(
    carbonItems.map((row) => [`${row.readableId}\u0000${row.revision}`, row])
  );
  return releases.map((release) => {
    let inCarbonCount = 0;
    const items = release.items.map((item) => {
      if (isModelReleaseItem(item)) {
        const match = byKey.get(`${item.partNumber}\u0000${item.revision}`);
        if (match) inCarbonCount += 1;
        return {
          ...item,
          state: match ? ("in-carbon" as const) : ("missing" as const),
          itemId: match?.id ?? null
        };
      }
      // A drawing attaches to a model item and has no item of its own.
      const attached = attachedDrawings.has(releaseDrawingFileName(item));
      if (attached) inCarbonCount += 1;
      return {
        ...item,
        state: attached ? ("in-carbon" as const) : ("missing" as const),
        itemId: null
      };
    });
    const count = release.items.length;
    return {
      ...release,
      items,
      state:
        count > 0 && inCarbonCount === count
          ? ("pushed" as const)
          : inCarbonCount > 0
            ? ("partial" as const)
            : ("not-pushed" as const)
    };
  });
}

/** Pushed drawing PDF name; the Releases tab reads drawings back by it. */
export function releaseDrawingFileName(
  item: Pick<PanelReleaseItem, "partNumber" | "revision">
) {
  return `${item.partNumber}-${item.revision}.pdf`;
}

export type ReleaseExportSelection =
  | { ok: true; partId?: string; configuration?: string }
  | { ok: false; reason: string };

/**
 * The export job refuses a Part Studio export without exactly one `partId`.
 * A non-default configuration is sent as Onshape returned it.
 */
export function releaseExportSelection(item: {
  elementType: number;
  partId?: string | null;
  configuration?: string | null;
}): ReleaseExportSelection {
  const configuration = normalizeConfiguration(item.configuration)
    ? item.configuration?.trim()
    : undefined;
  if (item.elementType !== 0) {
    return { ok: true, ...(configuration ? { configuration } : {}) };
  }
  const partId = item.partId?.trim();
  if (!partId || /[,\s]/.test(partId)) {
    return {
      ok: false,
      reason:
        "Onshape didn't name the released part, so its model was not exported"
    };
  }
  return { ok: true, partId, ...(configuration ? { configuration } : {}) };
}

export type ReleasePackageItemLike = {
  id: string;
  parentId: string | null;
  elementType: number;
  elementId: string | null;
  partNumber: string | null;
  revision: string | null;
};

/**
 * Per drawing element, the first model the release package lists under it.
 * Part numbers cannot tie the two: a drawing's may differ from its model's.
 */
export function drawingModels(
  items: ReleasePackageItemLike[]
): Map<string, { partNumber: string; revision: string | null }> {
  const out = new Map<
    string,
    { partNumber: string; revision: string | null }
  >();
  for (const drawing of items) {
    if (drawing.elementType !== 2 || !drawing.elementId) continue;
    const model = items.find(
      (item) =>
        item.parentId === drawing.id &&
        isModelReleaseItem(item) &&
        !!item.partNumber
    );
    if (model?.partNumber && !out.has(drawing.elementId)) {
      out.set(drawing.elementId, {
        partNumber: model.partNumber,
        revision: model.revision
      });
    }
  }
  return out;
}
