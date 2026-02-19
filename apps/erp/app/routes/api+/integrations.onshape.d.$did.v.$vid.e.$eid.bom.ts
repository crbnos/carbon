import { requirePermissions } from "@carbon/auth/auth.server";
import { getOnshapeClient } from "@carbon/ee/onshape";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { getReadableIdWithRevision } from "~/utils/string";

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
          if (header.name === "Material") {
            // Handle special case for Material field which might have a displayName
            rowData[header.name] =
              row.headerIdToValue[header.id]?.displayName || "";
          } else {
            // For other fields, just use the value directly
            rowData[header.name] = row.headerIdToValue[header.id] || "";
          }
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

      const flattenedDataWithMetadata = flattenedData.map((row) => {
        const item = itemsMap?.get(
          getReadableIdWithRevision(
            // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
            row["Part number"] || row["Name"],
            // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
            row["Revision"]
          )
        );
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
            row["Purchasing Level"] === "Purchased" ? "Pick" : "Make";
        }

        return {
          // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
          index: row["Item"],
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
          level: row["Item"].toString().split(".").length,
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
    console.error(error);
    return {
      data: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
