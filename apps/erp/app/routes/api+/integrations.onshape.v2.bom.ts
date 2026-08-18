import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  buildElementExternalId,
  buildOnshapeBomTree,
  getOnshapeClient,
  getOnshapeV2Settings,
  type OnshapeBomRow,
  parseOnshapeBom,
  readItemIdsForElements,
  resolveBomRow
} from "@carbon/ee/onshape";
import { getLogger } from "@carbon/logger";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";

const logger = getLogger("erp", "integrations-onshape-v2-bom");

export const shouldRevalidate: ShouldRevalidateFunction = () => false;

export type OnshapeBomPreviewRow = {
  item: string;
  indentLevel: number;
  partNumber: string;
  revision: string;
  name: string;
  quantity: number;
  externalId: string;
  /** The Carbon item this row already maps to, if any. */
  itemId: string | null;
  readableIdWithRevision: string | null;
  /**
   * What the import would do.
   *  update           - this exact revision is linked already
   *  create-revision  - the part is linked, but not at THIS revision
   *  create           - Carbon has never seen this CAD part
   *  ambiguous        - two items claim it at the same revision; needs a human
   */
  action: "update" | "create-revision" | "create" | "ambiguous";
  /** Existing Carbon revisions of this part, when the row's own is missing. */
  siblings: string[];
};

/**
 * Preview an Onshape BOM against Carbon, resolved BY MAPPING.
 *
 * The point of the preview is that it answers "what will this do" before
 * anything is written — the legacy panel showed a row list with no indication
 * of which rows were about to create items.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts"
  });

  const url = new URL(request.url);
  const documentId = url.searchParams.get("did");
  const versionId = url.searchParams.get("vid");
  const elementId = url.searchParams.get("eid");

  if (!documentId || !versionId || !elementId) {
    return { data: null, error: "Document, version and element are required" };
  }

  const settings = await getOnshapeV2Settings(client, companyId);
  if (!settings.isV2) {
    return { data: null, error: "Onshape v2 is not enabled for this company" };
  }

  const serviceRole = getCarbonServiceRole();
  const connection = await getOnshapeClient(serviceRole, companyId, userId);
  if (!connection.client) {
    return {
      data: null,
      error: connection.error ?? "Onshape is not connected"
    };
  }

  try {
    const response = await connection.client.getBillOfMaterials(
      documentId,
      versionId,
      elementId
    );

    const parsed = parseOnshapeBom(response);

    if (parsed.rows.length === 0) {
      return {
        data: null,
        error:
          "That assembly has no bill of materials rows Carbon can read. It may be empty, or its parts may have no part numbers assigned in Onshape."
      };
    }

    // One query for the whole tree, top level included.
    const allRows: OnshapeBomRow[] = parsed.topLevel
      ? [parsed.topLevel, ...parsed.rows]
      : parsed.rows;

    const mappings = await readItemIdsForElements(client, {
      companyId,
      refs: allRows.map((row) => ({
        documentId: row.documentId,
        elementId: row.elementId,
        partId: row.partId
      }))
    });

    // Resolve the mapped item ids to readable ids in one more query, so the
    // preview can name what it is about to update rather than showing an id.
    const mappedItemIds = Array.from(
      new Set(Array.from(mappings.values()).flat())
    );
    const readableById = new Map<string, string>();
    // The RAW revision column, not readableIdWithRevision: that generated
    // column collapses '0'/''/NULL, so it cannot distinguish a numeric
    // revision "0" from an unrevised item.
    const revisionById = new Map<string, string | null>();
    if (mappedItemIds.length > 0) {
      const items = await client
        .from("item")
        .select("id, readableIdWithRevision, revision")
        .in("id", mappedItemIds)
        .eq("companyId", companyId);

      if (items.error) {
        logger.error("Failed to read mapped items", { error: items.error });
        return { data: null, error: "Could not read the linked Carbon items" };
      }

      for (const item of items.data ?? []) {
        if (item.readableIdWithRevision) {
          readableById.set(item.id, item.readableIdWithRevision);
        }
        revisionById.set(item.id, item.revision);
      }
    }

    const toPreview = (row: OnshapeBomRow): OnshapeBomPreviewRow => {
      const externalId = buildElementExternalId({
        documentId: row.documentId,
        elementId: row.elementId,
        partId: row.partId
      });
      const claimants = mappings.get(externalId) ?? [];

      // The element mapping narrows to the part FAMILY; the row's own revision
      // picks the member. Resolving on the mapping alone wires the wrong
      // revision into the BOM — observed live, a row naming revision A
      // resolving to the item at revision C.
      const resolution = resolveBomRow(
        row.revision,
        claimants.map((id) => ({
          itemId: id,
          revision: revisionById.get(id) ?? null
        }))
      );

      const itemId = resolution.kind === "matched" ? resolution.itemId : null;

      const action: OnshapeBomPreviewRow["action"] =
        resolution.kind === "matched"
          ? "update"
          : resolution.kind === "revision-missing"
            ? "create-revision"
            : resolution.kind === "ambiguous"
              ? "ambiguous"
              : "create";

      const siblings =
        resolution.kind === "revision-missing"
          ? resolution.siblingItemIds.map((id) => readableById.get(id) ?? id)
          : resolution.kind === "ambiguous"
            ? resolution.itemIds.map((id) => readableById.get(id) ?? id)
            : [];

      return {
        item: row.item,
        indentLevel: row.indentLevel,
        partNumber: row.partNumber,
        revision: row.revision,
        name: row.name,
        quantity: row.quantity,
        externalId,
        itemId,
        readableIdWithRevision: itemId
          ? (readableById.get(itemId) ?? null)
          : null,
        action,
        siblings
      };
    };

    const rows = parsed.rows.map(toPreview);
    const topLevel = parsed.topLevel ? toPreview(parsed.topLevel) : null;

    return {
      data: {
        topLevel,
        rows,
        tree: buildOnshapeBomTree(parsed.rows).length,
        skipped: parsed.skipped,
        summary: {
          total: rows.length,
          create: rows.filter((r) => r.action === "create").length,
          createRevision: rows.filter((r) => r.action === "create-revision")
            .length,
          update: rows.filter((r) => r.action === "update").length,
          ambiguous: rows.filter((r) => r.action === "ambiguous").length
        }
      },
      error: null
    };
  } catch (error) {
    logger.error("Failed to preview Onshape BOM", { error });
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to read the bill of materials from Onshape"
    };
  }
}
