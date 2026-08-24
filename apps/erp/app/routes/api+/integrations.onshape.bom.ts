import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  buildElementExternalId,
  buildOnshapeBomTree,
  getOnshapeClient,
  getOnshapeSettings,
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

const logger = getLogger("erp", "integrations-onshape-bom");

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

  const serviceRole = getCarbonServiceRole();
  // The gate is company CONFIGURATION, not user data. Reading it with the
  // user's client silently requires settings_view on top of the parts
  // permission this route declares.
  const settings = await getOnshapeSettings(serviceRole, companyId);
  // A failed READ is not an opt-out. Wording a transient error as a
  // configuration state sends the user to change a setting that was
  // never wrong — and re-saving it re-registers the release webhook.
  if (settings.readFailed) {
    return {
      data: null,
      error: "Could not read the Onshape settings just now. Try again."
    };
  }
  if (!settings.active) {
    return {
      data: null,
      error: "Onshape is not connected for this company"
    };
  }

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

    // Refuse an unreleased version here rather than after the user has read a
    // whole diff. DERIVED from the assembly's own row, never from a query
    // parameter the caller supplies — a caller wanting to bypass a
    // client-asserted flag would simply omit it.
    // An unreadable top-level row counts as UNRELEASED, not as absent: a
    // released assembly always has a part number (Onshape requires one to
    // release), so refusing on null cannot block a released import — while
    // an assembly with no part number assigned is exactly the shape this
    // refusal exists for.
    if (!parsed.topLevel?.revision) {
      return {
        data: null,
        error:
          "That Onshape version has never been released. Release it in Onshape first."
      };
    }

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
      // Drop claimants whose item row did not come back — the same liveness
      // filter the import job applies. Without it a mapping left behind by a
      // deleted item reads as `revision: null`, which matches Carbon's INITIAL
      // revision, so the preview would promise an update against an item that
      // no longer exists while the import goes on to mint a new one.
      const resolution = resolveBomRow(
        row.revision,
        claimants
          .filter((id) => revisionById.has(id))
          .map((id) => ({
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
        orphaned: parsed.orphaned,
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
