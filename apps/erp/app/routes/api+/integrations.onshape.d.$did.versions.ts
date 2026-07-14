import { requirePermissions } from "@carbon/auth/auth.server";
import { getOnshapeClient } from "@carbon/ee/onshape";
import { getLogger } from "@carbon/logger";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";

const logger = getLogger("erp", "integrations-onshape-d-did-versions");

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

  const result = await getOnshapeClient(client, companyId, userId);

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
      const response = await onshapeClient.getVersions(did, limit, offset);

      if (!response || response.length === 0) {
        break;
      }

      allDocuments.push(...response);

      if (response.length < limit) {
        break;
      }

      offset += limit;
    }

    return {
      data: allDocuments,
      error: null
    };
  } catch (error) {
    logger.error(error);
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get versions from Onshape"
    };
  }
}
