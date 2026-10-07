// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Json } from "@carbon/database";
import type {
  DescriptionModes,
  OnshapePropertyValue,
  PlanCustomFieldDefinition,
  PropertyMapEntry
} from "@carbon/ee";
import {
  CUSTOM_FIELD_TYPE_LABELS,
  MAPPABLE_VALUE_TYPES,
  MAPPING_MODES,
  parseDescriptionModes,
  parseProperties,
  parsePropertyMap,
  STANDARD_FIELD_IDS,
  standardField,
  targetKey,
  translationErrors
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

/**
 * Fields editor data: properties, the property map, the description modes,
 * the custom field definitions and the company's units.
 */
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
    loadPartCustomFieldDefinitions(client, companyId),
    loadPlanOptions(client, companyId)
  ]).catch((error) => {
    logger.error("Failed to read custom fields", { companyId, error });
    return null;
  });
  if (!reads) {
    return data({ error: "Failed to read custom fields" }, { status: 500 });
  }
  const [integration, definitions, options] = reads;
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
      descriptionModes: parseDescriptionModes(integration.data?.metadata),
      definitions,
      units: options.unitsOfMeasure
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const modeSchema = z.enum(MAPPING_MODES);

const entrySchema = z.object({
  onshapePropertyId: z.string().min(1),
  onshapeName: z.string(),
  valueType: z.string().min(1),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("customField"), fieldId: z.string().min(1) }),
    z.object({ kind: z.literal("item"), field: z.enum(STANDARD_FIELD_IDS) })
  ]),
  mode: modeSchema,
  translations: z
    .array(
      z.object({
        onshape: z.string().max(255),
        carbon: z.string().nullable()
      })
    )
    .max(100)
    .optional()
});

const payloadSchema = z.object({
  entries: z
    .array(entrySchema)
    .max(100)
    // A duplicate propertyId would make one entry silently win.
    .refine(
      (entries) =>
        new Set(entries.map((e) => e.onshapePropertyId)).size === entries.length
    ),
  descriptionModes: z.object({ name: modeSchema, description: modeSchema })
});

type FieldError = { key: string; errors: string[] };

/** "A, B or C". */
function orList(values: readonly string[]): string {
  return values.length > 1
    ? `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`
    : (values[0] ?? "");
}

/**
 * Replace the property map and the description modes; the panel always posts
 * the whole list.
 */
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
  const descriptionModes: DescriptionModes = parsed.data.descriptionModes;

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

  // A target takes one property; each clashing entry names the others.
  const namesByTarget = new Map<string, string[]>();
  for (const entry of entries) {
    const key = targetKey(entry.target);
    namesByTarget.set(key, [
      ...(namesByTarget.get(key) ?? []),
      entry.onshapeName || entry.onshapePropertyId
    ]);
  }
  for (const entry of entries) {
    const own = entry.onshapeName || entry.onshapePropertyId;
    const others = (namesByTarget.get(targetKey(entry.target)) ?? []).filter(
      (name) => name !== own
    );
    if (others.length > 0) {
      fieldErrors.push({
        key: entry.onshapePropertyId,
        errors: [
          `${others.join(", ")} already maps to this Carbon field. A Carbon field takes one property.`
        ]
      });
    }
  }

  // Item fields: the value type the field takes, and a translation whose
  // every Carbon value is one the field allows.
  const itemEntries = entries.filter((entry) => entry.target.kind === "item");
  let units: Awaited<ReturnType<typeof loadPlanOptions>>["unitsOfMeasure"] = [];
  if (itemEntries.length > 0) {
    units = (await loadPlanOptions(client, companyId)).unitsOfMeasure;
  }
  for (const entry of itemEntries) {
    if (entry.target.kind !== "item") continue;
    const field = standardField(entry.target.field);
    if (!field) continue;
    const errors: string[] = [];
    if (!field.valueTypes.includes(entry.valueType)) {
      errors.push(
        `An Onshape ${entry.valueType} property can't set ${field.label}. It takes ${orList(field.valueTypes)} properties.`
      );
    }
    errors.push(...translationErrors(field, entry.translations ?? [], units));
    if (errors.length > 0) {
      fieldErrors.push({ key: entry.onshapePropertyId, errors });
    }
  }

  const customFieldIds = entries.flatMap((entry) =>
    entry.target.kind === "customField" ? [entry.target.fieldId] : []
  );
  const existingIds = [...new Set(customFieldIds)];
  if (existingIds.length > 0) {
    const existing = await client
      .from("customField")
      .select("id, name, dataTypeId")
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
    const fields = new Map((existing.data ?? []).map((row) => [row.id, row]));
    for (const entry of entries) {
      if (entry.target.kind !== "customField") continue;
      const field = fields.get(entry.target.fieldId);
      const dataTypeId = field?.dataTypeId;
      if (field === undefined || dataTypeId === undefined) {
        fieldErrors.push({
          key: entry.onshapePropertyId,
          errors: ["The mapped Carbon field no longer exists"]
        });
      } else if (
        Object.hasOwn(MAPPABLE_VALUE_TYPES, entry.valueType) &&
        !MAPPABLE_VALUE_TYPES[entry.valueType]?.includes(dataTypeId)
      ) {
        const needed = orList(
          (MAPPABLE_VALUE_TYPES[entry.valueType] ?? []).map(
            (id) => CUSTOM_FIELD_TYPE_LABELS[id] ?? String(id)
          )
        );
        fieldErrors.push({
          key: entry.onshapePropertyId,
          errors: [
            `${field.name} is a ${CUSTOM_FIELD_TYPE_LABELS[dataTypeId] ?? "different"} field. An Onshape ${entry.valueType} property needs a ${needed} field.`
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

  // A translation is kept for a list item field only; text fields take the
  // value as it is.
  const mapEntries: PropertyMapEntry[] = entries.map((entry) => {
    const field =
      entry.target.kind === "item" ? standardField(entry.target.field) : null;
    return {
      onshapePropertyId: entry.onshapePropertyId,
      onshapeName: entry.onshapeName,
      valueType: entry.valueType,
      target: entry.target,
      mode: entry.mode,
      ...(field?.kind === "list"
        ? {
            translations: (entry.translations ?? []).map((row) => ({
              onshape: row.onshape.trim(),
              carbon: row.carbon
            }))
          }
        : {})
    };
  });

  // jsonb_set patches only propertyMap and descriptionModes; other writers
  // own the sibling keys. The column is json, hence the casts.
  const db = getDatabaseClient();
  let updatedRows: bigint;
  try {
    const updated = await db
      .updateTable("companyIntegration")
      .set({
        metadata: sql<Json>`jsonb_set(jsonb_set(metadata::jsonb, '{propertyMap}', ${JSON.stringify(
          mapEntries
        )}::jsonb, true), '{descriptionModes}', ${JSON.stringify(
          descriptionModes
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
    {
      map: mapEntries,
      descriptionModes,
      definitions,
      ...(warning ? { warning } : {})
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
