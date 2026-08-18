import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getOnshapeClient, getOnshapeV2Settings } from "@carbon/ee/onshape";
import { getLogger } from "@carbon/logger";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";

const logger = getLogger("erp", "integrations-onshape-v2-versions");

export const shouldRevalidate: ShouldRevalidateFunction = () => false;

const PAGE_SIZE = 20;
const MAX_PAGES = 25;

export type OnshapeV2Version = {
  id: string;
  name: string;
  /** True when a released revision exists at this version. */
  released: boolean;
};

/**
 * A document's versions, each marked released or not.
 *
 * Nothing in Onshape's version object says whether it was released — a version
 * is just an immutable snapshot, and a release is a separate workflow that
 * happens to produce one. The only source of released-ness is the revisions
 * API, so it is derived by joining the document's versions against the set of
 * versionIds that carry a revision.
 *
 * WORKSPACES ARE DELIBERATELY NOT OFFERED. getBillOfMaterials, getParts and all
 * three translation endpoints hardcode /v/{versionId}; a workspace would 404 at
 * BOM time rather than at pick time, which is a worse place to find out.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    view: "parts"
  });

  const url = new URL(request.url);
  const documentId = url.searchParams.get("did");
  if (!documentId) {
    return { data: null, error: "Document is required" };
  }

  const serviceRole = getCarbonServiceRole();
  // The gate is company CONFIGURATION, not user data. Reading it with the
  // user's client silently requires settings_view on top of the parts
  // permission this route declares.
  const settings = await getOnshapeV2Settings(serviceRole, companyId);
  if (!settings.isV2) {
    return { data: null, error: "Onshape v2 is not enabled for this company" };
  }
  if (!settings.allowUnreleasedSync) {
    return {
      data: null,
      error:
        "Syncing unreleased versions is turned off for this company. Turn it on in the Onshape integration settings."
    };
  }

  const connection = await getOnshapeClient(serviceRole, companyId, userId);
  if (!connection.client) {
    return {
      data: null,
      error: connection.error ?? "Onshape is not connected"
    };
  }
  const onshape = connection.client;

  try {
    const versions: Array<{ id: string; name: string }> = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await onshape.getVersions(
        documentId,
        PAGE_SIZE,
        page * PAGE_SIZE
      );
      if (!Array.isArray(batch) || batch.length === 0) break;
      versions.push(
        ...batch.map((v: { id: string; name?: string }) => ({
          id: v.id,
          name: v.name ?? v.id
        }))
      );
      if (batch.length < PAGE_SIZE) break;
    }

    // Which of them are released. One company-wide sweep is cheaper than a
    // per-version probe and is the same call the picker already makes.
    const releasedVersionIds = new Set<string>();
    let onshapeCompanyId = settings.onshapeCompanyId;
    if (!onshapeCompanyId) {
      const companies = await onshape.getCompanies();
      onshapeCompanyId = Array.isArray(companies)
        ? (companies[0]?.id ?? null)
        : null;
    }
    if (onshapeCompanyId) {
      let page = await onshape.getCompanyRevisions(onshapeCompanyId, {
        limit: 50
      });
      for (let index = 0; index < MAX_PAGES; index++) {
        for (const item of page.items ?? []) {
          if (item.documentId === documentId && item.versionId) {
            releasedVersionIds.add(item.versionId);
          }
        }
        if (!page.next) break;
        page = await onshape.getCompanyRevisionsPage(page.next);
      }
    }

    return {
      data: {
        versions: versions.map((v) => ({
          ...v,
          released: releasedVersionIds.has(v.id)
        })) satisfies OnshapeV2Version[]
      },
      error: null
    };
  } catch (error) {
    logger.error("Failed to list Onshape versions", { error });
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to read versions from Onshape"
    };
  }
}
