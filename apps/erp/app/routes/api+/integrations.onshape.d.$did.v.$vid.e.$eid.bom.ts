import { requirePermissions } from "@carbon/auth/auth.server";
import { getOnshapeClient } from "@carbon/ee/onshape";
import { getLogger } from "@carbon/logger";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { getReadableIdWithRevision } from "~/utils/string";

const logger = getLogger("erp", "integrations-onshape-d-did-v-vid-e-eid-bom");

export const shouldRevalidate: ShouldRevalidateFunction = () => {
  return false;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const { did } = params;
  if (!did) {
    return {
      data: [],
      error: "Document ID is required"
    };
  }

  const { vid } = params;
  if (!vid) {
    return {
      data: [],
      error: "Version ID is required"
    };
  }

  const { eid } = params;
  if (!eid) {
    return {
      data: [],
      error: "Element ID is required"
    };
  }

  const result = await getOnshapeClient(client, companyId, userId);

  if (result.error) {
    return {
      data: [],
      error: result.error
    };
  }

  const onshapeClient = result.client;

  try {
    const response = await onshapeClient.getBillOfMaterials(did, vid, eid);
    if (
      "headers" in response &&
      Array.isArray(response.headers) &&
      "rows" in response &&
      Array.isArray(response.rows)
    ) {
      // Transform the BOM data into a structured array of objects
      const headers = response.headers;
      const rows = response.rows;

      // Create an array of objects where each object represents a row with properties named after headers
      const flattenedData = rows.map((row) => {
        const rowData: Record<string, any> = {};

        // Map each header to its corresponding value in the row
        headers.forEach((header) => {
          const value = row.headerIdToValue[header.id];
          // Some columns (e.g. Material) come back as an object carrying a
          // displayName rather than a plain string — unwrap those so the
          // flattened value is usable downstream (Revision, State, etc.).
          rowData[header.name] =
            value && typeof value === "object"
              ? value.displayName || ""
              : value || "";
        });

        return rowData;
      });

      const uniquePartNumbers = new Set(
        flattenedData.map((row) =>
          getReadableIdWithRevision(
            // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
            row["Part number"] || row["Name"],
            // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
            row["Revision"]
          )
        )
      );

      let itemsMap: Map<
        string,
        {
          itemId: string;
          defaultMethodType: string;
          replenishmentSystem: string;
        }
      > | null = null;

      if (uniquePartNumbers.size) {
        const items = await client
          .from("item")
          .select(
            "id, readableId, readableIdWithRevision, defaultMethodType, replenishmentSystem"
          )
          .in("readableIdWithRevision", Array.from(uniquePartNumbers))
          .eq("companyId", companyId);

        itemsMap = new Map(
          items.data?.map((item) => [
            item.readableIdWithRevision,
            {
              itemId: item.id,
              defaultMethodType: item.defaultMethodType,
              replenishmentSystem: item.replenishmentSystem
            }
          ])
        );
      }

      // Onshape only stamps revisions on RELEASED versions, so rows from an
      // unreleased version/workspace carry an empty Revision and can only
      // exact-match a revision-0 item. Fall back to the LATEST existing
      // revision of the same readableId so re-syncing an unreleased version
      // updates the items the company already uses instead of silently
      // creating a parallel revision-less item tree.
      let latestRevisionByReadableId: Map<
        string,
        {
          itemId: string;
          defaultMethodType: string;
          replenishmentSystem: string;
        }
      > | null = null;

      const bareReadableIds = Array.from(
        new Set(
          flattenedData
            .filter((row) => {
              // biome-ignore lint/complexity/useLiteralKeys: consistency with surrounding code
              const partNumber = row["Part number"] || row["Name"];
              return (
                // biome-ignore lint/complexity/useLiteralKeys: consistency with surrounding code
                !row["Revision"] &&
                partNumber &&
                !itemsMap?.has(getReadableIdWithRevision(partNumber, ""))
              );
            })
            // biome-ignore lint/complexity/useLiteralKeys: consistency with surrounding code
            .map((row) => row["Part number"] || row["Name"])
        )
      );

      if (bareReadableIds.length) {
        const revisionItems = await client
          .from("item")
          .select(
            "id, readableId, revision, createdAt, defaultMethodType, replenishmentSystem"
          )
          .in("readableId", bareReadableIds)
          .eq("companyId", companyId);

        const isInitialRevision = (r: string | null) => !r || r === "0";
        latestRevisionByReadableId = new Map();
        for (const readableId of bareReadableIds) {
          const candidates = (revisionItems.data ?? [])
            .filter((item) => item.readableId === readableId)
            .sort((a, b) => {
              // Named revisions beat the initial one; newest wins the tie —
              // same preference as the latest_items CTE in the list views.
              const aInitial = isInitialRevision(a.revision) ? 1 : 0;
              const bInitial = isInitialRevision(b.revision) ? 1 : 0;
              if (aInitial !== bInitial) return aInitial - bInitial;
              return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
            });
          const best = candidates[0];
          if (best) {
            latestRevisionByReadableId.set(readableId, {
              itemId: best.id,
              defaultMethodType: best.defaultMethodType,
              replenishmentSystem: best.replenishmentSystem
            });
          }
        }
      }

      const flattenedDataWithMetadata = flattenedData.map((row) => {
        // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
        const partNumber = row["Part number"] || row["Name"];
        const item =
          itemsMap?.get(
            getReadableIdWithRevision(
              partNumber,
              // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
              row["Revision"]
            )
          ) ??
          // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
          (!row["Revision"]
            ? latestRevisionByReadableId?.get(partNumber)
            : undefined);
        let replenishmentSystem = item?.replenishmentSystem;
        let defaultMethodType = item?.defaultMethodType;

        if (!replenishmentSystem) {
          if (row["Purchasing Level"] === "Purchased") {
            replenishmentSystem = "Buy";
          } else {
            replenishmentSystem = "Make";
          }
        }

        if (!defaultMethodType) {
          defaultMethodType =
            row["Purchasing Level"] === "Purchased"
              ? "Pull from Inventory"
              : "Make to Order";
        }

        return {
          // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
          index: row["Item"] ?? "",
          readableId: row["Part number"],
          // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
          revision: row["Revision"],
          readableIdWithRevision: getReadableIdWithRevision(
            row["Part number"],
            // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
            row["Revision"]
          ),
          // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
          name: row["Name"] || row["Description"] || row["Part number"] || "",
          id: item?.itemId ?? undefined,
          replenishmentSystem,
          defaultMethodType,
          // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
          quantity: row["Quantity"],
          // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
          level: row["Item"]?.toString().split(".").length ?? 1,
          data: row
        };
      });

      return {
        data: {
          rows: flattenedDataWithMetadata
        },
        error: null
      };
    }
    return {
      data: [],
      error: "No BOM data found"
    };
  } catch (error) {
    logger.error(error);
    return {
      data: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
