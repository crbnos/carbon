import { requirePermissions } from "@carbon/auth/auth.server";
import type { OnshapeConfigurationParameter } from "@carbon/ee/onshape";
import { getOnshapeClient } from "@carbon/ee/onshape";
import { getLogger } from "@carbon/logger";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";

const logger = getLogger(
  "erp",
  "integrations-onshape-d-did-v-vid-e-eid-configuration"
);

export const shouldRevalidate: ShouldRevalidateFunction = () => {
  return false;
};

// Configuration parameter definitions for one element. An element with no configurations
// returns an empty list, and so does EVERY failure path — the picker treats "no
// parameters" as "render the panel exactly as it did before this feature existed", which
// is always safe because Carbon's pre-existing behavior IS the default configuration.
// Never surface an error here: a detection failure must not block a working BOM import.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const empty: {
    data: { parameters: OnshapeConfigurationParameter[] };
    error: null;
  } = {
    data: { parameters: [] },
    error: null
  };

  const { did, vid, eid } = params;
  if (!did || !vid || !eid) {
    return empty;
  }

  const result = await getOnshapeClient(client, companyId, userId);
  if (result.error || !result.client) {
    logger.error("Failed to get Onshape client for element configuration", {
      error: result.error
    });
    return empty;
  }

  try {
    const parameters = await result.client.getElementConfiguration(
      did,
      vid,
      eid
    );
    return { data: { parameters }, error: null };
  } catch (error) {
    logger.error("Failed to get element configuration from Onshape", { error });
    return empty;
  }
}
