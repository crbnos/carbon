import { requirePermissions } from "@carbon/auth/auth.server";
import type { PanelItemRow } from "@carbon/ee";
import { buildPartStatuses } from "@carbon/ee";
import type { OnshapeDocument } from "@carbon/ee/onshape";
import { getOnshapeClient, OnshapeWVMType } from "@carbon/ee/onshape";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/**
 * Carbon status for every part of the current Onshape element.
 *
 * Exactly one live Onshape call (the element's part list); everything else is
 * Carbon's own database. Quota discipline: the annual per-account API limit is
 * the panel's scarcest resource — see build-plan §4.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts"
  });

  const url = new URL(request.url);
  const documentId = url.searchParams.get("documentId");
  const wv = url.searchParams.get("wv");
  const wvId = url.searchParams.get("wvId");
  const elementId = url.searchParams.get("elementId");

  if (
    !documentId ||
    !wvId ||
    !elementId ||
    (wv !== "w" && wv !== "v" && wv !== "m")
  ) {
    return data({ error: "Missing Onshape context" }, { status: 400 });
  }

  const onshape = await getOnshapeClient(client, companyId, userId);
  if (onshape.error || !onshape.client) {
    return data(
      { error: "Onshape is not connected for this company" },
      { status: 422 }
    );
  }

  const wvm =
    wv === "w"
      ? OnshapeWVMType.WORKSPACE
      : wv === "v"
        ? OnshapeWVMType.VERSION
        : OnshapeWVMType.MICROVERSION;
  const document: OnshapeDocument = { documentId, wvm, wvmId: wvId };

  let parts: Awaited<ReturnType<typeof onshape.client.getPartsInElement>>;
  try {
    parts = await onshape.client.getPartsInElement(document, elementId);
  } catch (error) {
    return data(
      {
        error: error instanceof Error ? error.message : "Onshape request failed"
      },
      { status: 502 }
    );
  }

  const [mappings, matches] = await Promise.all([
    client
      .from("externalIntegrationMapping")
      .select("entityId, externalId, lastSyncedAt")
      .eq("companyId", companyId)
      .eq("integration", "onshape")
      .eq("entityType", "item")
      .like("externalId", `${documentId}:${elementId}:%`),
    (async () => {
      const partNumbers = parts
        .map((p) => p.partNumber)
        .filter((n): n is string => !!n);
      if (partNumbers.length === 0) return { data: [], error: null };
      return client
        .from("item")
        .select("id, readableId, revision, name")
        .eq("companyId", companyId)
        .in("readableId", partNumbers);
    })()
  ]);

  if (mappings.error) {
    return data({ error: "Failed to read Onshape mappings" }, { status: 500 });
  }

  // Items referenced by mappings may not share the part number; fetch them too.
  const mappedItemIds = (mappings.data ?? [])
    .map((m) => m.entityId)
    .filter((id) => !(matches.data ?? []).some((i) => i.id === id));
  let mappedItems: PanelItemRow[] = [];
  if (mappedItemIds.length > 0) {
    const result = await client
      .from("item")
      .select("id, readableId, revision, name")
      .eq("companyId", companyId)
      .in("id", mappedItemIds);
    mappedItems = (result.data ?? []) as PanelItemRow[];
  }

  const statuses = buildPartStatuses({
    documentId,
    elementId,
    parts,
    mappings: mappings.data ?? [],
    items: [...((matches.data ?? []) as PanelItemRow[]), ...mappedItems]
  });

  return data(
    { parts: statuses },
    { headers: { "Cache-Control": "no-store" } }
  );
}
