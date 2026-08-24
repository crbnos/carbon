import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getOnshapeClient,
  isOnshapeIntegrationId,
  ONSHAPE_LEGACY_INTEGRATION_ID
} from "@carbon/ee/onshape";
import { getLogger } from "@carbon/logger";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";

const logger = getLogger("erp", "integrations-onshape-documents");

export const shouldRevalidate: ShouldRevalidateFunction = () => {
  return false;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  // Shared between the two Onshape records: the legacy BOM sync picker
  // (OnshapeSync) and the v2 unreleased picker both list documents, and the two
  // records hold different grants against potentially different Onshape
  // tenants. The caller says which; the default keeps every existing legacy
  // caller unchanged.
  const requested = new URL(request.url).searchParams.get("integration");
  const integrationId =
    requested && isOnshapeIntegrationId(requested)
      ? requested
      : ONSHAPE_LEGACY_INTEGRATION_ID;

  const result = await getOnshapeClient(
    client,
    companyId,
    userId,
    integrationId
  );

  if (result.error) {
    return {
      data: [],
      error: result.error
    };
  }

  const onshapeClient = result.client;

  try {
    let limit = 20;
    let offset = 0;
    let allDocuments: Array<{ id: string; name: string }> = [];

    while (true) {
      // @ts-expect-error TS18047 - TODO: fix type
      const response = await onshapeClient.getDocuments(limit, offset);

      if (!response.items || response.items.length === 0) {
        break;
      }

      allDocuments.push(...response.items);

      if (response.items.length < limit) {
        break;
      }

      offset += limit;
    }

    return {
      data: { items: allDocuments },
      error: null
    };
  } catch (error) {
    logger.error("Error", { error: error });
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get documents from Onshape"
    };
  }
}
