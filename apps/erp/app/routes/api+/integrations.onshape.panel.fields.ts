// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import type { OnshapePropertyValue } from "@carbon/ee";
import {
  bomColumnIds,
  MAPPABLE_VALUE_TYPES,
  parseDescriptionModes,
  parsePropertyMap
} from "@carbon/ee";
import type { OnshapeDocument } from "@carbon/ee/onshape";
import {
  getOnshapeClient,
  loadPartCustomFieldDefinitions,
  loadPlanOptions,
  ONSHAPE_V2_INTEGRATION_ID,
  OnshapeWVMType,
  onshapeFailure
} from "@carbon/ee/onshape";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import {
  readAssemblyProperties,
  readPartProperties
} from "@carbon/ee/onshape.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { panelResponse } from "~/modules/settings/settings.service";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "onshape", "panel-fields");
const querySchema = z.object({
  documentId: z.string().min(1),
  wv: z.enum(["w", "v", "m"]),
  wvId: z.string().min(1),
  elementId: z.string().min(1),
  configuration: z.string().nullish()
});

/** Fields page data for the element the panel is open on. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requireOnshapePanelPermissions(
    request,
    { update: "settings" }
  );

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    documentId: url.searchParams.get("documentId"),
    wv: url.searchParams.get("wv"),
    wvId: url.searchParams.get("wvId"),
    elementId: url.searchParams.get("elementId"),
    configuration: url.searchParams.get("configuration")
  });
  if (!parsed.success) {
    return data({ error: "Missing Onshape context" }, { status: 400 });
  }
  const { documentId, wv, wvId, elementId, configuration } = parsed.data;

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

  const document: OnshapeDocument = {
    documentId,
    wvm:
      wv === "w"
        ? OnshapeWVMType.WORKSPACE
        : wv === "v"
          ? OnshapeWVMType.VERSION
          : OnshapeWVMType.MICROVERSION,
    wvmId: wvId
  };

  // A part studio's properties live on its parts: take the union across them.
  let properties: OnshapePropertyValue[];
  let isAssembly = false;
  try {
    const elements = await onshape.client.getElementsIn(document);
    const element = elements.find((e) => e.id === elementId);
    isAssembly = element?.elementType === "ASSEMBLY";
    if (element?.elementType === "PARTSTUDIO") {
      // Hidden parts count: a property only on a hidden part is still mappable.
      const parts = await onshape.client.getPartsInElement(document, elementId);
      const byPartId = await readPartProperties(
        onshape.client,
        document,
        elementId,
        parts.map((part) => part.partId)
      );
      const seen = new Map<string, OnshapePropertyValue>();
      for (const partProperties of byPartId.values()) {
        for (const property of partProperties) {
          if (!seen.has(property.propertyId)) {
            seen.set(property.propertyId, property);
          }
        }
      }
      properties = [...seen.values()];
    } else {
      properties = await readAssemblyProperties(
        onshape.client,
        document,
        elementId
      );
    }
  } catch (error) {
    const failure = onshapeFailure(error);
    return data(failure.body, { status: failure.status });
  }

  // An assembly's BOM columns: the Item and Quantity rows show the one
  // detected, or offer the columns when none is. Non-fatal: the rest of the
  // page needs no BOM.
  let bom: {
    columns: {
      propertyId: string;
      name: string;
      valueType: string;
      propertyName?: string;
    }[];
    detected: { item: string | null; quantity: string | null };
  } | null = null;
  if (isAssembly) {
    try {
      // Only the headers are used, and the top level has them all. The
      // configuration is the one a push of this element reads.
      const payload = (await onshape.client.getBillOfMaterialsIn(
        document,
        elementId,
        configuration,
        { topLevelOnly: true }
      )) as { headers?: unknown };
      const headers = (
        Array.isArray(payload?.headers) ? payload.headers : []
      ).flatMap((header: Record<string, unknown>) =>
        typeof header?.id === "string" && typeof header.name === "string"
          ? [
              {
                id: header.id,
                name: header.name,
                propertyName: header.propertyName,
                valueType:
                  typeof header.valueType === "string"
                    ? header.valueType
                    : "STRING"
              }
            ]
          : []
      );
      const detected = bomColumnIds(headers);
      bom = {
        columns: headers.map((header) => ({
          propertyId: header.id,
          name: header.name,
          valueType: header.valueType,
          ...(typeof header.propertyName === "string"
            ? { propertyName: header.propertyName }
            : {})
        })),
        detected: { item: detected.item, quantity: detected.quantity }
      };
    } catch (error) {
      logger.warn("Failed to read the BOM columns for the Fields page", {
        companyId,
        documentId,
        elementId,
        error
      });
    }
  }

  const reads = await Promise.all([
    client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", ONSHAPE_V2_INTEGRATION_ID)
      .eq("companyId", companyId)
      .maybeSingle(),
    loadPartCustomFieldDefinitions(client, companyId),
    loadPlanOptions(client, companyId),
    // Changing where part numbers come from re-matches these on the next push.
    client
      .from("externalIntegrationMapping")
      .select("entityId", { count: "exact", head: true })
      .eq("companyId", companyId)
      .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
      .eq("entityType", "item")
  ]).catch((error) => {
    logger.error("Failed to read custom fields", { companyId, error });
    return null;
  });
  if (!reads) {
    return data({ error: "Failed to read custom fields" }, { status: 500 });
  }
  const [integration, definitions, options, links] = reads;
  if (links.error) {
    logger.warn("Failed to count the panel's item links", {
      companyId,
      error: links.error
    });
  }
  if (integration.error) {
    logger.error("Failed to read the property map", {
      companyId,
      error: integration.error
    });
    return data({ error: "Failed to read the property map" }, { status: 500 });
  }

  return data(
    {
      properties: properties.map((property) => ({
        propertyId: property.propertyId,
        name: property.name,
        valueType: property.valueType,
        // Own keys only: `in` calls a property named "constructor" mappable.
        mappable: Object.hasOwn(MAPPABLE_VALUE_TYPES, property.valueType),
        ...(property.options ? { options: property.options } : {})
      })),
      map: parsePropertyMap(integration.data?.metadata),
      descriptionModes: parseDescriptionModes(integration.data?.metadata),
      pushDefaults: options.defaults,
      definitions,
      units: options.unitsOfMeasure,
      bom,
      // A failed count only loses the warning.
      linkedItems: links.count ?? 0
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** Replace the property map, the description modes and the push defaults. */
export async function action({ request }: ActionFunctionArgs) {
  const api = carbonFor(
    await requireOnshapePanelPermissions(request, { update: "settings" })
  );
  return panelResponse(
    await api.settings.saveOnshapePropertyMap(
      await request.json().catch(() => null)
    )
  );
}
