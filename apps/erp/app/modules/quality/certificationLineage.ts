/**
 * Pure pieces of the certification lineage resolver (`getCertificationLineage`
 * in quality.service.ts): walking tracked-entity lineage back to the lots that
 * were received, and de-duplicating the resulting certificate rows. No I/O —
 * the service injects the one query the walk needs.
 */

/** One backwards lineage edge: `id` is an entity `sourceEntityId` came from. */
export type LineageEdge = {
  sourceEntityId: string;
  id: string;
  attributes: Record<string, unknown> | null;
};

export type CertificationLineageRow = {
  kind: "Material" | "Special Process" | "Functional Test" | "Other";
  name: string;
  specification: string | null;
  supplierId: string | null;
  supplierName: string | null;
  certificateId: string | null;
  certificateNumber: string | null;
  documentId: string | null;
  receiptLineId: string | null;
  jobOperationId: string | null;
  trackedEntityIds: string[];
  missing: boolean;
};

// Written by post-receipt / update_receipt_line_batch_tracking on every
// entity a receipt creates.
const RECEIPT_LINE_ATTRIBUTE = "Receipt Line";

function receiptLineOf(
  attributes: Record<string, unknown> | null
): string | null {
  const value = attributes?.[RECEIPT_LINE_ATTRIBUTE];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function addRoot(
  roots: Map<string, string[]>,
  receiptLineId: string,
  entityId: string
) {
  const ids = roots.get(receiptLineId);
  if (!ids) {
    roots.set(receiptLineId, [entityId]);
  } else if (!ids.includes(entityId)) {
    ids.push(entityId);
  }
}

/**
 * Breadth-first walk from the start entities back through their lineage until
 * each branch reaches an entity that was received (carries a `Receipt Line`
 * attribute). A received entity is a root: the walk does not continue past it.
 * A visited set makes cycles terminate; `maxDepth` caps the number of hops.
 *
 * Returns receiptLineId → the received (root) entity ids on that line.
 */
export async function findReceivedRoots(
  start: { id: string; attributes: Record<string, unknown> | null }[],
  fetchAncestors: (ids: string[]) => Promise<LineageEdge[]>,
  maxDepth = 12
): Promise<Map<string, string[]>> {
  const roots = new Map<string, string[]>();
  const visited = new Set<string>();
  let frontier: string[] = [];

  for (const entity of start) {
    if (visited.has(entity.id)) continue;
    visited.add(entity.id);
    const receiptLineId = receiptLineOf(entity.attributes);
    if (receiptLineId) {
      addRoot(roots, receiptLineId, entity.id);
    } else {
      frontier.push(entity.id);
    }
  }

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const edges = await fetchAncestors(frontier);
    const next: string[] = [];
    for (const edge of edges) {
      if (visited.has(edge.id)) continue;
      visited.add(edge.id);
      const receiptLineId = receiptLineOf(edge.attributes);
      if (receiptLineId) {
        addRoot(roots, receiptLineId, edge.id);
      } else {
        next.push(edge.id);
      }
    }
    frontier = next;
  }

  return roots;
}

/**
 * One row per certificate; rows without a certificate (`missing`) collapse per
 * receipt line, else per job operation, else per name. Merged rows keep the
 * first row's fields and the union of their tracked entity ids.
 */
export function dedupeLineageRows(
  rows: CertificationLineageRow[]
): CertificationLineageRow[] {
  const byKey = new Map<string, CertificationLineageRow>();

  for (const row of rows) {
    const key =
      row.certificateId ??
      `missing:${row.receiptLineId ?? row.jobOperationId ?? row.name}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row, trackedEntityIds: [...row.trackedEntityIds] });
      continue;
    }
    for (const id of row.trackedEntityIds) {
      if (!existing.trackedEntityIds.includes(id)) {
        existing.trackedEntityIds.push(id);
      }
    }
  }

  return [...byKey.values()];
}
