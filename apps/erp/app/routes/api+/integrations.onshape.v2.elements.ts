import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getOnshapeClient,
  getOnshapeV2Settings,
  ONSHAPE_V2_INTEGRATION_ID,
  OnshapeElementType,
  OnshapeWVMType
} from "@carbon/ee/onshape";
import { getLogger } from "@carbon/logger";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";

const logger = getLogger("erp", "integrations-onshape-v2-elements");

export const shouldRevalidate: ShouldRevalidateFunction = () => false;

/**
 * Onshape's stock "Part number" property. Company metadata schemas can add
 * their own properties but do not renumber this one, so the id is a safer
 * match than the name, which is localised.
 */
const PART_NUMBER_PROPERTY_ID = "57f3fb8efa3416c06701d60f";

/** Metadata is one request per element, so the fan-out is bounded. */
const MAX_ELEMENTS = 50;

export type OnshapeV2Element = {
  id: string;
  name: string;
  /** The element's Onshape part number, or null when it has none. */
  partNumber: string | null;
};

export type OnshapeV2ElementsResult = {
  elements: OnshapeV2Element[];
  /** More assemblies exist than are listed here. */
  truncated: boolean;
  /**
   * At least one part number could not be read from Onshape, so a row showing
   * none may in fact have one. Distinct from `truncated`: the LIST is complete,
   * the labels are not.
   */
  partNumbersIncomplete: boolean;
};

function readPartNumber(metadata: {
  properties?: Array<{ propertyId?: string; name?: string; value?: unknown }>;
}): string | null {
  const properties = metadata.properties ?? [];
  const match =
    properties.find(
      (property) => property.propertyId === PART_NUMBER_PROPERTY_ID
    ) ?? properties.find((property) => property.name === "Part number");
  const value = match?.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The assemblies in a version, each with its real part number.
 *
 * The legacy elements loader returns Onshape's raw element list, whose only
 * human-readable field is `name`. A picker built on that has to present the
 * name and — worse — pass it along as though it were the part number, which is
 * wrong whenever the two differ. The part number is what becomes the Carbon
 * item, so it is what the user has to be choosing.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    view: "parts"
  });

  const url = new URL(request.url);
  const documentId = url.searchParams.get("did");
  const versionId = url.searchParams.get("vid");
  if (!documentId || !versionId) {
    return { data: null, error: "Document and version are required" };
  }

  const serviceRole = getCarbonServiceRole();
  // Company configuration, read with the service role: the user's client would
  // silently require settings_view on top of the parts permission declared here.
  const settings = await getOnshapeV2Settings(serviceRole, companyId);
  if (settings.readFailed) {
    return {
      data: null,
      error: "Could not read the Onshape settings just now. Try again."
    };
  }
  if (!settings.active) {
    return {
      data: null,
      error: "Onshape v2 is not connected for this company"
    };
  }

  const connection = await getOnshapeClient(
    serviceRole,
    companyId,
    userId,
    ONSHAPE_V2_INTEGRATION_ID
  );
  if (!connection.client) {
    return {
      data: null,
      error: connection.error ?? "Onshape is not connected"
    };
  }
  const onshape = connection.client;

  try {
    const raw = await onshape.getElements(
      {
        documentId,
        wvm: OnshapeWVMType.VERSION,
        wvmId: versionId
      },
      OnshapeElementType.ASSEMBLY
    );
    const assemblies: Array<{ id: string; name?: string }> = Array.isArray(raw)
      ? raw
      : [];
    const truncated = assemblies.length > MAX_ELEMENTS;

    // Sequential, not Promise.all: this is the only fan-out in the v2 routes,
    // and 50 concurrent calls is exactly how a company trips Onshape's rate
    // limit. A loader has no `withRateLimitRetry` (that is jobs-only), so the
    // cheapest correct answer is not to race in the first place.
    const elements: OnshapeV2Element[] = [];
    let metadataFailed = false;
    for (const element of assemblies.slice(0, MAX_ELEMENTS)) {
      let partNumber: string | null = null;
      try {
        partNumber = readPartNumber(
          await onshape.getElementMetadata(documentId, versionId, element.id)
        );
      } catch (error) {
        // A metadata read that fails is not a reason to drop the assembly — it
        // is still importable, the label is just thinner. But the caller has to
        // be told, or a rate-limited read renders as "No part number", which is
        // indistinguishable from an assembly that genuinely has none.
        metadataFailed = true;
        logger.error("Failed to read Onshape element metadata", {
          error,
          elementId: element.id
        });
      }
      elements.push({
        id: element.id,
        name: element.name ?? element.id,
        partNumber
      });
    }

    return {
      data: {
        elements,
        truncated,
        partNumbersIncomplete: metadataFailed
      } satisfies OnshapeV2ElementsResult,
      error: null
    };
  } catch (error) {
    logger.error("Failed to list Onshape assemblies", { error });
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to read assemblies from Onshape"
    };
  }
}
