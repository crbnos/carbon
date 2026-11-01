// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type {
  OnshapePropertyValue,
  PartPlan,
  PlanItemRow,
  PlanMappingContext,
  PlanMappingRow,
  StandardSources
} from "@carbon/ee";
import {
  buildPartPlan,
  hasIdentityOverride,
  mapsPartProperties,
  normalizeConfiguration,
  withIdentitySources
} from "@carbon/ee";
import type { OnshapeDocument } from "@carbon/ee/onshape";
import {
  createPanelPlan,
  getOnshapeClient,
  loadPlanMapping,
  loadPlanOptions,
  loadReleasedRevisions,
  loadStandardSources,
  ONSHAPE_V2_INTEGRATION_ID,
  OnshapeWVMType,
  onshapeFailure,
  selectInBatches
} from "@carbon/ee/onshape";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import { readPartProperties } from "@carbon/ee/onshape.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "integrations-onshape-panel-plan-part");

const payloadSchema = z.object({
  documentId: z.string().min(1),
  // Exports need a workspace or a version, not a microversion.
  wv: z.enum(["w", "v"]),
  wvId: z.string().min(1),
  elementId: z.string().min(1),
  configuration: z.string().nullish(),
  partIds: z.array(z.string().min(1)).min(1).max(50)
});

const ITEM_COLUMNS =
  "id, readableId, revision, active, name, description, type, replenishmentSystem, defaultMethodType, itemTrackingType, sourcingType, unitOfMeasureCode, mpn";

/** Plan a part push without writing; the apply makes no Onshape call. */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requireOnshapePanelPermissions(
    request,
    {
      create: "parts",
      update: "parts"
    }
  );

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid plan payload" }, { status: 400 });
  }
  const { documentId, wv, wvId, elementId } = parsed.data;
  const configuration = normalizeConfiguration(parsed.data.configuration);
  const partIds = [...new Set(parsed.data.partIds)];

  const serviceRole = getCarbonServiceRole();
  const onshape = await getOnshapeClient(
    serviceRole,
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

  const document: OnshapeDocument = {
    documentId,
    wvm: wv === "w" ? OnshapeWVMType.WORKSPACE : OnshapeWVMType.VERSION,
    wvmId: wvId
  };

  let parts: Awaited<ReturnType<typeof onshape.client.getPartsInElement>>;
  try {
    parts = await onshape.client.getPartsInElement(
      document,
      elementId,
      configuration
    );
  } catch (error) {
    const failure = onshapeFailure(error);
    return data(failure.body, { status: failure.status });
  }
  // Hidden parts are not shown in the panel, so they cannot be pushed.
  parts = parts.filter((part) => !part.isHidden);

  // On a workspace, what names each part's model and decides "unchanged":
  // Onshape's part microversion is the whole document's, so a drawing or
  // assembly edit would read as a change to every part. Unread, every part
  // exports.
  let sourceState: string | null | undefined;
  if (wv === "w") {
    try {
      sourceState = (
        await onshape.client.getWorkspaceSourceStates(documentId, wvId)
      ).parts;
    } catch (error) {
      logger.warn("Onshape source state read failed; every part exports", {
        companyId,
        documentId,
        error
      });
      sourceState = null;
    }
  }

  let sources: StandardSources;
  try {
    sources = await loadStandardSources(serviceRole, companyId);
  } catch (error) {
    logger.error("Failed to read the Onshape property map", {
      companyId,
      error
    });
    return data(
      { error: "Failed to read the Onshape property map" },
      { status: 500 }
    );
  }
  // A part number from another property: the part metadata is read now, and
  // the property map reuses it below.
  let identityProperties: Map<string, OnshapePropertyValue[]> | undefined;
  if (hasIdentityOverride(sources)) {
    try {
      identityProperties = await readPartProperties(
        onshape.client,
        document,
        elementId,
        partIds,
        configuration
      );
    } catch (error) {
      const failure = onshapeFailure(error);
      return data(failure.body, { status: failure.status });
    }
    parts = withIdentitySources(parts, identityProperties, sources);
  }

  const requested = parts.filter((part) => partIds.includes(part.partId));
  const partNumbers = [
    ...new Set(
      requested
        .map((part) => part.partNumber)
        .filter((number): number is string => !!number)
    )
  ];

  const [mappings, matches, options] = await Promise.all([
    client
      .from("externalIntegrationMapping")
      .select("entityId, externalId, lastSyncedAt, metadata")
      .eq("companyId", companyId)
      .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
      .eq("entityType", "item")
      .like("externalId", `${documentId}:${elementId}:%`),
    selectInBatches(partNumbers, (batch) =>
      client
        .from("item")
        .select(ITEM_COLUMNS)
        .eq("companyId", companyId)
        .in("readableId", batch)
        .order("revision")
    ),
    loadPlanOptions(serviceRole, companyId)
  ]);

  if (mappings.error) {
    return data({ error: "Failed to read Onshape mappings" }, { status: 500 });
  }
  if (matches.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }

  const mappingRows: PlanMappingRow[] = (mappings.data ?? []).map((row) => ({
    entityId: row.entityId,
    externalId: row.externalId,
    lastSyncedAt: row.lastSyncedAt,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null
  }));
  const matchedItems = (matches.data ?? []) as PlanItemRow[];

  // A linked item renumbered since is not in `matches`; reading it by id tells
  // a live link from a stale mapping row.
  const mappedItemIds = [
    ...new Set(
      mappingRows
        .map((row) => row.entityId)
        .filter((id) => !matchedItems.some((item) => item.id === id))
    )
  ];
  const mappedResult = await selectInBatches(mappedItemIds, (batch) =>
    client
      .from("item")
      .select(ITEM_COLUMNS)
      .eq("companyId", companyId)
      .in("id", batch)
  );
  if (mappedResult.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  const mappedItems = mappedResult.data as PlanItemRow[];

  const candidates = [...matchedItems, ...mappedItems];
  let released: Awaited<ReturnType<typeof loadReleasedRevisions>>;
  try {
    released = await loadReleasedRevisions(client, companyId, matchedItems);
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error ? error.message : "Failed to read Carbon items"
      },
      { status: 500 }
    );
  }

  let mapping: PlanMappingContext;
  try {
    mapping = await loadPlanMapping(
      serviceRole,
      companyId,
      candidates.map((item) => item.readableId)
    );
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read the Onshape property map"
      },
      { status: 500 }
    );
  }

  // No map means no extra Onshape read. Unchanged parts are read too: a
  // property mapped after the last push must reach Carbon.
  let propertiesByPartId = identityProperties;
  if (
    !propertiesByPartId &&
    mapsPartProperties(mapping.map) &&
    requested.length > 0
  ) {
    try {
      propertiesByPartId = await readPartProperties(
        onshape.client,
        document,
        elementId,
        partIds,
        configuration
      );
    } catch (error) {
      const failure = onshapeFailure(error);
      return data(failure.body, { status: failure.status });
    }
  }

  const rows = buildPartPlan({
    documentId,
    elementId,
    configuration,
    parts,
    requestedPartIds: partIds,
    mappings: mappingRows,
    items: candidates,
    options,
    mapping,
    propertiesByPartId,
    released,
    sourceState
  });
  if (rows.length === 0) {
    return data(
      { error: "None of the selected parts are in this element" },
      { status: 422 }
    );
  }

  const plan: PartPlan = {
    kind: "part",
    documentId,
    wv,
    wvId,
    elementId,
    configuration,
    rows,
    options
  };
  const stored = await createPanelPlan({ companyId, userId, plan });
  if (!stored) {
    return data(
      { error: "Carbon couldn't save this review. Try again." },
      { status: 503 }
    );
  }

  return data(
    { planId: stored.planId, expiresAt: stored.expiresAt, plan },
    { headers: { "Cache-Control": "no-store" } }
  );
}
