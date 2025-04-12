import { requirePermissions } from "@carbon/auth/auth.server";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { Onshape as OnshapeConfig } from "~/integrations/onshape/config";
import { OnshapeClient } from "~/integrations/onshape/lib/client";
import { getIntegration } from "~/modules/settings/settings.service";

export const shouldRevalidate: ShouldRevalidateFunction = () => {
  return false;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { did } = params;
  if (!did) {
    return json({
      data: [],
      error: "Document ID is required",
    });
  }

  const { vid } = params;
  if (!vid) {
    return json({
      data: [],
      error: "Version ID is required",
    });
  }

  const { eid } = params;
  if (!eid) {
    return json({
      data: [],
      error: "Element ID is required",
    });
  }

  const integration = await getIntegration(client, "onshape", companyId);

  if (integration.error || !integration.data) {
    return json({
      data: [],
      error: integration.error,
    });
  }

  const integrationMetadata = OnshapeConfig.schema.safeParse(
    integration?.data?.metadata
  );

  if (!integrationMetadata.success) {
    return json({
      data: [],
      error: integrationMetadata.error,
    });
  }

  const onshapeClient = new OnshapeClient({
    baseUrl: integrationMetadata.data.baseUrl,
    accessKey: integrationMetadata.data.accessKey,
    secretKey: integrationMetadata.data.secretKey,
  });

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
        flattenedData.map((row) => row["Part number"])
      );

      let itemsMap: Map<string, string> | null = null;

      if (uniquePartNumbers.size) {
        const items = await client
          .from("item")
          .select("id, readableId")
          .in("readableId", Array.from(uniquePartNumbers));

        itemsMap = new Map(
          items.data?.map((item) => [item.readableId, item.id])
        );
      }

      const result = flattenedData.map((row) => {
        return {
          ...row,
          readableId: row["Part number"],
          itemId: itemsMap?.get(row["Part number"]) ?? undefined,
          replenishmentSystem:
            row["Purchasing Level"] === "Purchased" ? "Buy" : "Make", // TODO: this is not a standard field
          quantity: row["Quantity"],
        };
      });

      // Return the transformed data instead of the raw response
      return json({
        data: result,
        error: null,
      });
    }
    return json({
      data: [],
      error: "No BOM data found",
    });
  } catch (error) {
    console.error(error);
    return json({
      data: [],
      error: error,
    });
  }
}
