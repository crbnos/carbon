// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReleaseCarbonItemRow } from "@carbon/ee";
import {
  groupRevisionsIntoReleases,
  isModelReleaseItem,
  resolveReleaseStates
} from "@carbon/ee";
import {
  getOnshapeClient,
  ONSHAPE_V2_INTEGRATION_ID,
  onshapeFailure,
  selectInBatches
} from "@carbon/ee/onshape";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "integrations-onshape-panel-releases");

const MAX_RELEASES = 20;

/**
 * Releases for the current Onshape document: the document revisions list (one
 * live call, dev-cached) grouped by releaseId, joined to Carbon items by
 * part number + revision letter so the panel can show what each release
 * already has in Carbon.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requireOnshapePanelPermissions(
    request,
    {
      view: "parts"
    }
  );

  const url = new URL(request.url);
  const documentId = url.searchParams.get("documentId");
  if (!documentId) {
    return data({ error: "Missing Onshape context" }, { status: 400 });
  }

  const onshape = await getOnshapeClient(
    client,
    companyId,
    userId,
    ONSHAPE_V2_INTEGRATION_ID
  );
  if (onshape.error || !onshape.client) {
    return data(
      { error: "Onshape is not connected for this company" },
      { status: 422 }
    );
  }

  let revisions: Awaited<
    ReturnType<typeof onshape.client.getDocumentRevisions>
  >;
  try {
    revisions = await onshape.client.getDocumentRevisions(documentId);
  } catch (error) {
    const failure = onshapeFailure(error);
    return data(failure.body, { status: failure.status });
  }

  const releases = groupRevisionsIntoReleases(revisions.items ?? []).slice(
    0,
    MAX_RELEASES
  );

  // Release management is an Onshape company feature, while a part can still
  // carry a revision letter as plain metadata. When the list is empty, one
  // call tells "none yet" from "not available to the connected account".
  let releaseManagementAvailable = true;
  if (releases.length === 0) {
    try {
      releaseManagementAvailable =
        (await onshape.client.getCompanies()).length > 0;
    } catch (error) {
      // The generic empty state is still correct; don't fail the read.
      logger.warn("Onshape companies read failed", { companyId, error });
    }
  }

  const partNumbers = [
    ...new Set(
      releases.flatMap((release) =>
        release.items.filter(isModelReleaseItem).map((item) => item.partNumber)
      )
    )
  ];

  const rows = await selectInBatches(partNumbers, (batch) =>
    client
      .from("item")
      .select("id, readableId, revision")
      .eq("companyId", companyId)
      .in("readableId", batch)
  );
  if (rows.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  const carbonRows = rows.data as ReleaseCarbonItemRow[];

  return data(
    {
      releases: resolveReleaseStates(releases, carbonRows),
      releaseManagementAvailable
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
