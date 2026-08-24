import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getOnshapeClient, getOnshapeSettings } from "@carbon/ee/onshape";
import {
  readPurchasingLevelFromMetadata,
  resolveOnshapeReplenishment
} from "@carbon/ee/onshape/replenishment";
import { getLogger } from "@carbon/logger";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";

const logger = getLogger("erp", "integrations-onshape-replenishment");

export const shouldRevalidate: ShouldRevalidateFunction = () => false;

/**
 * What Onshape says a part IS — bought or made — for one released element.
 *
 * The new-part form seeds Replenishment System and Default Method Type from
 * this. Seeding them from the element type alone (assembly → Make, body → Buy)
 * is what the form used to do, and it disagrees with every other path: the
 * release mint and the BOM import both give Onshape's own "Purchasing Level"
 * column the final say. The user then watched Carbon fill in "Buy", and a BOM
 * import corrected it to "Make" minutes later — which reads as Carbon changing
 * its mind rather than as one rule applied consistently.
 *
 * NOT part of the revisions list. That list comes from the company revision
 * catalog, which carries no metadata, so a Purchasing Level per row would be
 * one Onshape call per row — the fan-out every other picker route exists to
 * avoid. One selection, one call.
 *
 * A failure is answered, not raised: Purchasing Level is an OPTIONAL company
 * column that most companies never define, so "could not read it" and "there is
 * none" land in the same place — the structural guess. Failing the request
 * would block a part over a field that is usually absent anyway.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    view: "parts"
  });

  const url = new URL(request.url);
  const documentId = url.searchParams.get("did");
  const versionId = url.searchParams.get("vid");
  const elementId = url.searchParams.get("eid");
  const partId = url.searchParams.get("pid");
  const elementTypeParam = url.searchParams.get("type");
  const elementType = Number(elementTypeParam);

  if (
    !documentId ||
    !versionId ||
    !elementId ||
    !Number.isFinite(elementType)
  ) {
    return { data: null, error: "Onshape element is required" };
  }

  // The structural answer, which is what a company with no Purchasing Level
  // column gets and what every failure below falls back to.
  const structural = resolveOnshapeReplenishment({ elementType });

  const serviceRole = getCarbonServiceRole();
  // Company CONFIGURATION, read with the service role. The user's own client
  // would silently require settings_view on top of the parts permission this
  // route declares.
  const settings = await getOnshapeSettings(serviceRole, companyId);
  if (!settings.active) {
    return { data: structural, error: null };
  }

  const connection = await getOnshapeClient(serviceRole, companyId, userId);
  if (!connection.client) {
    return { data: structural, error: null };
  }

  try {
    // PART level for a Part Studio body, element level otherwise. A company
    // property scoped to the Part category lives on the BODY: with it set on
    // one body, the element-level read returns nothing at all, so reading the
    // element here would make the whole feature silently inert for every Part
    // Studio part.
    const metadata = partId
      ? await connection.client.getPartMetadata(
          documentId,
          versionId,
          elementId,
          partId
        )
      : await connection.client.getElementMetadata(
          documentId,
          versionId,
          elementId
        );

    const purchasingLevel = readPurchasingLevelFromMetadata(metadata);

    return {
      data: resolveOnshapeReplenishment({ purchasingLevel, elementType }),
      error: null
    };
  } catch (error) {
    logger.warn("Could not read Onshape metadata for replenishment", { error });
    return { data: structural, error: null };
  }
}
