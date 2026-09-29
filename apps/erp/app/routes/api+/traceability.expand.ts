import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import {
  fetchLineageSubgraph,
  type LineageDirection
} from "~/modules/inventory/lineage.server";
import { requireCompanyRecord } from "~/modules/shared/shared.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    bypassRls: true
  });

  const url = new URL(request.url);
  const trackedEntityId = url.searchParams.get("trackedEntityId");
  const directionParam = url.searchParams.get("direction") ?? "both";
  const depthParam = url.searchParams.get("depth");

  if (!trackedEntityId) {
    return Response.json(
      { error: "trackedEntityId is required" },
      { status: 400 }
    );
  }

  // bypassRls makes `client` the service role and the lineage reads are not
  // company-scoped, so the root id must be proven to be this company's first.
  await requireCompanyRecord(client, "trackedEntity", companyId, {
    id: trackedEntityId
  });

  const direction: LineageDirection =
    directionParam === "up" || directionParam === "down"
      ? directionParam
      : "both";
  const depth = Math.min(Math.max(1, Number(depthParam) || 1), 5);

  const payload = await fetchLineageSubgraph(
    client,
    trackedEntityId,
    companyId,
    depth,
    direction
  );
  return Response.json(payload);
}
