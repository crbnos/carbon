import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  buildElementExternalId,
  getOnshapeClient,
  getOnshapeV2Settings,
  ONSHAPE_ELEMENT_INTEGRATION,
  ONSHAPE_MAPPING_ENTITY_TYPE
} from "@carbon/ee/onshape";
import { getLogger } from "@carbon/logger";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";

const logger = getLogger("erp", "integrations-onshape-v2-revisions");

export const shouldRevalidate: ShouldRevalidateFunction = () => {
  return false;
};

// Onshape returns released revisions 50 at a time and its own `next` cursor is
// the only reliable way to page (offset is capped at 100 server-side). Bound
// the sweep so a large company can't turn one picker open into hundreds of
// calls — and report the truncation rather than presenting a partial list as
// complete.
const PAGE_SIZE = 50;
const MAX_PAGES = 20;

// Numeric Onshape elementType. A released DRAWING is its own DRW-xxxx element
// that shares the number of the model it documents; its PDF attaches to the
// MODEL item and a DRW- item is never created. Offering drawings in a
// create-an-item picker would mint junk parts, so they are excluded here just
// as release import excludes them.
const ELEMENT_TYPE_DRAWING = 2;

export type OnshapeV2Revision = {
  partNumber: string;
  revision: string;
  name: string | null;
  documentId: string;
  versionId: string;
  elementId: string;
  elementType: number;
  partId: string | null;
  releaseId: string | null;
  /** Stable identity for this CAD thing — the picker echoes it straight back. */
  externalId: string;
  /** True when some Carbon item is already linked to this CAD thing. */
  linked: boolean;
};

export async function loader({ request }: LoaderFunctionArgs) {
  // Gated on PARTS, not on settings. The picker exists to create and link
  // parts, so a parts user must be able to open it; the Onshape connection is
  // then read with the service role rather than requiring that same user to
  // hold settings access. (Under the legacy routes the connection is read with
  // the user's client, so these reads silently require settings_view — and the
  // token refresh they trigger silently fails without settings_update.)
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts"
  });

  const serviceRole = getCarbonServiceRole();

  const settings = await getOnshapeV2Settings(client, companyId);
  if (!settings.isV2) {
    return {
      data: null,
      error: "Onshape v2 is not enabled for this company"
    };
  }

  const result = await getOnshapeClient(serviceRole, companyId, userId);
  // Narrow on the CLIENT, not on `error`. getOnshapeClient's union is
  // `{client, error: null} | {client: null, error: string}`, and a truthiness
  // check cannot discriminate it because "" is a valid (falsy) error string —
  // which is why the legacy routes carry a @ts-expect-error here instead.
  if (!result.client) {
    return { data: null, error: result.error ?? "Onshape is not connected" };
  }
  const onshapeClient = result.client;

  try {
    let onshapeCompanyId = settings.onshapeCompanyId;
    if (!onshapeCompanyId) {
      const companies = await onshapeClient.getCompanies();
      onshapeCompanyId = Array.isArray(companies)
        ? (companies[0]?.id ?? null)
        : null;
    }

    if (!onshapeCompanyId) {
      return {
        data: null,
        error:
          "No Onshape company found for this connection. Onshape release data is company-scoped, so an enterprise Onshape account is required."
      };
    }

    const revisions: OnshapeV2Revision[] = [];
    let truncated = false;

    let page = await onshapeClient.getCompanyRevisions(onshapeCompanyId, {
      limit: PAGE_SIZE
    });

    for (let pageIndex = 0; ; pageIndex++) {
      for (const item of page.items ?? []) {
        // An obsolete revision is superseded in Onshape; offering it would
        // create a Carbon item for something the CAD system has retired.
        if (item.isObsolete) continue;
        if (item.elementType === ELEMENT_TYPE_DRAWING) continue;
        if (!item.partNumber || !item.documentId || !item.elementId) continue;

        revisions.push({
          partNumber: item.partNumber,
          revision: item.revision,
          name: item.name ?? null,
          documentId: item.documentId,
          versionId: item.versionId,
          elementId: item.elementId,
          elementType: item.elementType,
          partId: item.partId ?? null,
          releaseId: item.releaseId ?? null,
          externalId: buildElementExternalId({
            documentId: item.documentId,
            elementId: item.elementId,
            partId: item.partId
          }),
          linked: false
        });
      }

      if (!page.next) break;
      if (pageIndex + 1 >= MAX_PAGES) {
        truncated = true;
        break;
      }
      page = await onshapeClient.getCompanyRevisionsPage(page.next);
    }

    // Mark the ones Carbon already knows about, so the picker can say "already
    // linked" instead of letting someone create a duplicate item. One query for
    // the whole page set rather than one per row.
    const externalIds = Array.from(new Set(revisions.map((r) => r.externalId)));
    const linked = new Set<string>();

    const CHUNK = 200;
    for (let index = 0; index < externalIds.length; index += CHUNK) {
      const chunk = externalIds.slice(index, index + CHUNK);
      const mapped = await client
        .from("externalIntegrationMapping")
        .select("externalId")
        .eq("integration", ONSHAPE_ELEMENT_INTEGRATION)
        .eq("entityType", ONSHAPE_MAPPING_ENTITY_TYPE)
        .eq("companyId", companyId)
        .in("externalId", chunk);

      if (mapped.error) {
        // Don't fail the picker over this — but don't claim "not linked"
        // either, since that invites a duplicate item. Surface it.
        logger.error("Failed to read Onshape element mappings", {
          error: mapped.error
        });
        return {
          data: null,
          error: "Could not determine which Onshape parts are already linked"
        };
      }

      for (const row of mapped.data ?? []) {
        if (row.externalId) linked.add(row.externalId);
      }
    }

    for (const revision of revisions) {
      revision.linked = linked.has(revision.externalId);
    }

    return {
      data: { revisions, truncated, maxPages: MAX_PAGES },
      error: null
    };
  } catch (error) {
    logger.error("Failed to list Onshape revisions", { error });
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get released revisions from Onshape"
    };
  }
}
