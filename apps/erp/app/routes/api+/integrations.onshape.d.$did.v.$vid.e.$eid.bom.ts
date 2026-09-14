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

  // The client sends the human-meaningful parameter MAP; the encoded string is built here
  // through Onshape's own encoder (parameter ids are generated and values need encoding
  // beyond URL-encoding, so it is never hand-assembled). An absent, empty, or
  // unparseable map means "default configuration" — byte-identical to the request Carbon
  // sent before this feature existed.
  //
  // Note the asymmetry with the configuration DETECTION route, and it is deliberate:
  // detection failing is silent, but encoding failing is a visible error. If the user
  // picked a configuration and Carbon cannot honor it, returning the default
  // configuration's BOM would be a silently wrong import — the exact bug this exists to fix.
  let configuration: string | undefined;
  const rawConfiguration = new URL(request.url).searchParams.get(
    "configuration"
  );
  if (rawConfiguration) {
    try {
      const parameterMap = JSON.parse(rawConfiguration) as Record<
        string,
        string | number | boolean
      >;
      const parameters = Object.entries(parameterMap).map(
        ([parameterId, parameterValue]) => ({
          parameterId,
          parameterValue: String(parameterValue)
        })
      );
      if (parameters.length > 0) {
        const encoded = await onshapeClient.encodeConfiguration(
          did,
          eid,
          parameters,
          vid
        );
        configuration = encoded.encodedId;
      }
    } catch (error) {
      logger.error("Failed to encode Onshape configuration for BOM", { error });
      return {
        data: [],
        error: "Failed to encode the selected configuration"
      };
    }
  }

  try {
    const response = await onshapeClient.getBillOfMaterials(did, vid, eid, {
      configuration
    });
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
