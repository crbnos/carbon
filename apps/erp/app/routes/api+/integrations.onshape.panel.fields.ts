// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Json } from "@carbon/database";
import type {
  OnshapePropertyValue,
  PlanCustomFieldDefinition,
  PropertyMapEntry
} from "@carbon/ee";
import {
  MAPPABLE_VALUE_TYPES,
  parseProperties,
  parsePropertyMap
} from "@carbon/ee";
import type { OnshapeDocument } from "@carbon/ee/onshape";
import {
  getOnshapeClient,
  loadPartCustomFieldDefinitions,
  ONSHAPE_V2_INTEGRATION_ID,
  OnshapeWVMType,
  onshapeFailure
} from "@carbon/ee/onshape";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import { readPartProperties } from "@carbon/ee/onshape.server";
import { getLogger } from "@carbon/logger";
import { sql } from "kysely";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getDatabaseClient } from "~/services/database.server";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "onshape", "panel-fields");

const querySchema = z.object({
  documentId: z.string().min(1),
  wv: z.enum(["w", "v", "m"]),
  wvId: z.string().min(1),
  elementId: z.string().min(1)
});

/** Fields editor data: properties, property map, custom field definitions. */
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
    elementId: url.searchParams.get("elementId")
  });
  if (!parsed.success) {
    return data({ error: "Missing Onshape context" }, { status: 400 });
  }
  const { documentId, wv, wvId, elementId } = parsed.data;

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

  // A part studio's properties live on its parts, so take the union across
  // them; an assembly's live on the element.
  let properties: OnshapePropertyValue[];
  try {
    const elements = await onshape.client.getElementsIn(document);
    const element = elements.find((e) => e.id === elementId);
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
      properties = parseProperties(
        await onshape.client.getElementMetadata(document, elementId)
      );
    }
  } catch (error) {
    const failure = onshapeFailure(error);
    return data(failure.body, { status: failure.status });
  }

  // loadPartCustomFieldDefinitions throws on a failed read; an empty list
  // would read as every mapped field deleted.
  const reads = await Promise.all([
    client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", ONSHAPE_V2_INTEGRATION_ID)
      .eq("companyId", companyId)
      .maybeSingle(),
    loadPartCustomFieldDefinitions(client, companyId)
  ]).catch((error) => {
    logger.error("Failed to read custom fields", { companyId, error });
    return null;
  });
  if (!reads) {
    return data({ error: "Failed to read custom fields" }, { status: 500 });
  }
  const [integration, definitions] = reads;
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
        mappable: Object.hasOwn(MAPPABLE_VALUE_TYPES, property.valueType)
      })),
      map: parsePropertyMap(integration.data?.metadata),
      definitions
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const entrySchema = z.object({
  onshapePropertyId: z.string().min(1),
  onshapeName: z.string(),
  valueType: z.string().min(1),
  carbonFieldId: z.string().min(1)
});

const payloadSchema = z.object({
  entries: z
    .array(entrySchema)
    .max(100)
    // A duplicate propertyId would make one entry silently win.
    .refine(
      (entries) =>
        new Set(entries.map((e) => e.onshapePropertyId)).size === entries.length
    )
});

type FieldError = { key: string; errors: string[] };

function duplicates(values: string[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) twice.add(value);
    else seen.add(value);
  }
  return twice;
}

/** Replace the property map; the panel always posts the whole list. */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requireOnshapePanelPermissions(request, {
    update: "settings"
  });

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid property map payload" }, { status: 400 });
  }
  const { entries } = parsed.data;

  const fieldErrors: FieldError[] = [];

  // The editor hides unmappable rows; this guards a hand-made payload.
  for (const entry of entries) {
    if (!Object.hasOwn(MAPPABLE_VALUE_TYPES, entry.valueType)) {
      fieldErrors.push({
        key: entry.onshapePropertyId,
        errors: [`${entry.valueType} properties cannot be mapped`]
      });
    }
  }

  const duplicateFieldIds = duplicates(
    entries.map((entry) => entry.carbonFieldId)
  );
  for (const entry of entries) {
    if (duplicateFieldIds.has(entry.carbonFieldId)) {
      fieldErrors.push({
        key: entry.onshapePropertyId,
        errors: ["Another property already maps to this Carbon field"]
      });
    }
  }

  const existingIds = [...new Set(entries.map((entry) => entry.carbonFieldId))];
  if (existingIds.length > 0) {
    const existing = await client
      .from("customField")
      .select("id, dataTypeId")
      .eq("companyId", companyId)
      .eq("table", "part")
      .in("id", existingIds);
    if (existing.error) {
      logger.error("Failed to read custom fields", {
        companyId,
        error: existing.error
      });
      return data({ error: "Failed to read custom fields" }, { status: 500 });
    }
    const dataTypes = new Map(
      (existing.data ?? []).map((row) => [row.id, row.dataTypeId])
    );
    for (const entry of entries) {
      const dataTypeId = dataTypes.get(entry.carbonFieldId);
      if (dataTypeId === undefined) {
        fieldErrors.push({
          key: entry.onshapePropertyId,
          errors: ["The mapped Carbon field no longer exists"]
        });
      } else if (
        Object.hasOwn(MAPPABLE_VALUE_TYPES, entry.valueType) &&
        !MAPPABLE_VALUE_TYPES[entry.valueType]?.includes(dataTypeId)
      ) {
        fieldErrors.push({
          key: entry.onshapePropertyId,
          errors: [
            `An Onshape ${entry.valueType} property can't be stored in this field's type`
          ]
        });
      }
    }
  }
  if (fieldErrors.length > 0) {
    return data(
      { error: "Some field mappings are not valid", fieldErrors },
      { status: 422 }
    );
  }

  // One mode: Onshape always wins (see `properties.ts`).
  const mapEntries: PropertyMapEntry[] = entries.map((entry) => ({
    onshapePropertyId: entry.onshapePropertyId,
    onshapeName: entry.onshapeName,
    valueType: entry.valueType,
    carbonFieldId: entry.carbonFieldId,
    mode: "owned"
  }));

  // jsonb_set patches only propertyMap; other writers own the sibling keys.
  // The column is json, hence the casts.
  const db = getDatabaseClient();
  let updatedRows: bigint;
  try {
    const updated = await db
      .updateTable("companyIntegration")
      .set({
        metadata: sql<Json>`jsonb_set(metadata::jsonb, '{propertyMap}', ${JSON.stringify(
          mapEntries
        )}::jsonb, true)::json`
      })
      .where("id", "=", ONSHAPE_V2_INTEGRATION_ID)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    updatedRows = updated.numUpdatedRows;
  } catch (error) {
    logger.error("Failed to save the property map", { companyId, error });
    return data({ error: "Failed to save the property map" }, { status: 500 });
  }
  if (Number(updatedRows) === 0) {
    return data(
      { error: "Onshape is not connected for this company" },
      { status: 422 }
    );
  }

  // The map is saved; a failed re-read is a warning, not a failed save.
  let definitions: PlanCustomFieldDefinition[] | null = null;
  let warning: string | undefined;
  try {
    definitions = await loadPartCustomFieldDefinitions(client, companyId);
  } catch (error) {
    logger.error("Failed to re-read custom fields after saving the map", {
      companyId,
      error
    });
    warning =
      "Saved. The custom field list couldn't be refreshed — press Refresh to see the latest fields.";
  }

  return data(
    { map: mapEntries, definitions, ...(warning ? { warning } : {}) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
