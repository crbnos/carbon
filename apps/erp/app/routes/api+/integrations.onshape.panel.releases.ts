import { requirePermissions } from "@carbon/auth/auth.server";
import type { ReleaseCarbonItemRow } from "@carbon/ee";
import {
  groupRevisionsIntoReleases,
  isModelReleaseItem,
  resolveReleaseStates
} from "@carbon/ee";
import { getOnshapeClient } from "@carbon/ee/onshape";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

const MAX_RELEASES = 20;

/**
 * Releases for the current Onshape document: the document revisions list (one
 * live call, dev-cached) grouped by releaseId, joined to Carbon items by
 * part number + revision letter so the panel can show what each release
 * already has in Carbon.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts"
  });

  const url = new URL(request.url);
  const documentId = url.searchParams.get("documentId");
  if (!documentId) {
    return data({ error: "Missing Onshape context" }, { status: 400 });
  }

  const onshape = await getOnshapeClient(client, companyId, userId);
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
    return data(
      {
        error: error instanceof Error ? error.message : "Onshape request failed"
      },
      { status: 502 }
    );
  }

  const releases = groupRevisionsIntoReleases(revisions.items ?? []).slice(
    0,
    MAX_RELEASES
  );

  const partNumbers = [
    ...new Set(
      releases.flatMap((release) =>
        release.items.filter(isModelReleaseItem).map((item) => item.partNumber)
      )
    )
  ];

  let carbonRows: ReleaseCarbonItemRow[] = [];
  if (partNumbers.length > 0) {
    const rows = await client
      .from("item")
      .select("id, readableId, revision")
      .eq("companyId", companyId)
      .in("readableId", partNumbers);
    if (rows.error) {
      return data({ error: "Failed to read Carbon items" }, { status: 500 });
    }
    carbonRows = (rows.data ?? []) as ReleaseCarbonItemRow[];
  }

  return data(
    { releases: resolveReleaseStates(releases, carbonRows) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
