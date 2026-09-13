import { hasPermission } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getUserClaims } from "@carbon/auth/users.server";
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
  onshapeFailure,
  readPartProperties
} from "@carbon/ee/onshape";
import { sql } from "kysely";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getDatabaseClient } from "~/services/database.server";

export const config = {
  runtime: "nodejs"
};

const querySchema = z.object({
  documentId: z.string().min(1),
  // Like the status route: a microversion context may read properties too.
  wv: z.enum(["w", "v", "m"]),
  wvId: z.string().min(1),
  elementId: z.string().min(1)
});

/**
 * The Fields editor's data: the current element's Onshape properties, the
 * company's property map, and the part custom field definitions.
 *
 * View-only permission on purpose — the editor is also how a non-admin
 * understands what a push will write. `canEdit` tells the panel whether to
 * offer Save; the POST below enforces it regardless.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId, sessionUserId } = await requirePermissions(
    request,
    { view: "parts" }
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

  // Which properties exist depends on the element kind: a part studio's live
  // on its parts (union across them — company property schemas are uniform,
  // but a property with no value anywhere on one part may still exist on
  // another), an assembly's on the element itself.
  let properties: OnshapePropertyValue[];
  try {
    const elements = await onshape.client.getElementsIn(document);
    const element = elements.find((e) => e.id === elementId);
    if (element?.elementType === "PARTSTUDIO") {
      // Hidden parts included: the map is per-property, not per-part, and a
      // property that only appears on a hidden part is still mappable.
      const parts = await onshape.client.getPartsInElement(document, elementId);
      const byPartId = await readPartProperties(
        onshape.client,
        document,
        elementId,
        parts.map((part) => part.partId)
      );
      // One row per propertyId; the first occurrence names it (Onshape keeps
      // name/valueType consistent per property across parts of a document).
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

  // The map lives on the integration's metadata; `getOnshapeClient` read the
  // row already but does not expose it, so this is the same RLS read again.
  // `loadPartCustomFieldDefinitions` throws on a failed read rather than
  // returning an empty list, which would call every mapped field deleted.
  const reads = await Promise.all([
    client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", ONSHAPE_V2_INTEGRATION_ID)
      .eq("companyId", companyId)
      .maybeSingle(),
    loadPartCustomFieldDefinitions(client, companyId)
  ]).catch(() => null);
  if (!reads) {
    return data({ error: "Failed to read custom fields" }, { status: 500 });
  }
  const [integration, definitions] = reads;
  if (integration.error) {
    return data({ error: "Failed to read the property map" }, { status: 500 });
  }

  // `requirePermissions` cannot be probed twice without side effects (denial
  // logging, and a thrown redirect on cookie sessions), so `canEdit` re-runs
  // its claims check directly — the `getUserClaims` + `hasPermission` pair the
  // MCP endpoints use for exactly this. Claims belong to the session user
  // (`userId` may be a console-mode effective user), matching what the POST's
  // own `requirePermissions` will enforce.
  const claims = await getUserClaims(sessionUserId, companyId);
  const canEdit = hasPermission(
    claims?.permissions,
    "settings",
    "update",
    companyId
  );

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
      definitions,
      canEdit
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/*
 * A mapping needs an existing Carbon field. The panel cannot create one:
 * defining a custom field is a settings change with its own form, and a
 * second place to define one is a second set of rules to keep in step.
 */
const entrySchema = z.object({
  onshapePropertyId: z.string().min(1),
  onshapeName: z.string(),
  valueType: z.string().min(1),
  mode: z.enum(["owned", "default"]),
  carbonFieldId: z.string().min(1)
});

const payloadSchema = z.object({
  entries: z
    .array(entrySchema)
    .max(100)
    // The map is keyed by propertyId; a duplicate would make one entry
    // silently win, so it is a client bug worth rejecting outright.
    .refine(
      (entries) =>
        new Set(entries.map((e) => e.onshapePropertyId)).size === entries.length
    )
});

type FieldError = { key: string; errors: string[] };

/** The values that appear more than once. */
function duplicates(values: string[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) twice.add(value);
    else seen.add(value);
  }
  return twice;
}

/**
 * Replace the company's property map. The panel always posts the whole list
 * (an empty array clears the map), so there is no partial-update ambiguity:
 * what was posted is the map.
 *
 * The only write is the map itself — every target must already exist — so
 * this cannot half-succeed.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid property map payload" }, { status: 400 });
  }
  const { entries } = parsed.data;

  // ---- Validate before the write ------------------------------------------
  const fieldErrors: FieldError[] = [];

  // A value type with no Carbon target cannot be mapped at all. The editor
  // hides those rows, so this is the guard for a hand-made payload.
  for (const entry of entries) {
    // `MAPPABLE_VALUE_TYPES` is a plain object, so an inherited key like
    // "constructor" would hand back a function rather than a type list.
    if (!Object.hasOwn(MAPPABLE_VALUE_TYPES, entry.valueType)) {
      fieldErrors.push({
        key: entry.onshapePropertyId,
        errors: [`${entry.valueType} properties cannot be mapped`]
      });
    }
  }

  // Two entries resolving to one Carbon field make a single property's value
  // win by array order, silently.
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
      .select("id")
      .eq("companyId", companyId)
      .eq("table", "part")
      .in("id", existingIds);
    if (existing.error) {
      return data({ error: "Failed to read custom fields" }, { status: 500 });
    }
    const found = new Set((existing.data ?? []).map((row) => row.id));
    for (const entry of entries) {
      if (!found.has(entry.carbonFieldId)) {
        fieldErrors.push({
          key: entry.onshapePropertyId,
          errors: ["The mapped Carbon field no longer exists"]
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

  const mapEntries: PropertyMapEntry[] = entries.map((entry) => ({
    onshapePropertyId: entry.onshapePropertyId,
    onshapeName: entry.onshapeName,
    valueType: entry.valueType,
    carbonFieldId: entry.carbonFieldId,
    mode: entry.mode
  }));

  // ---- Write the map ------------------------------------------------------
  // Only this key is written, and the merge happens in the database. The
  // metadata column also carries `baseUrl`, `onshapeCompanyId`,
  // `assetSyncEnabled` (and `credentials` on editions that keep them inline),
  // and other writers — the token refresh inside `getOnshapeClient`, the
  // integration settings save — update the whole column from a copy read
  // before their own round trip. A read-spread-write here is reverted by
  // whichever of those lands in between; `jsonb_set` leaves every sibling key
  // exactly as the row holds it. The column is `json`, hence the casts.
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
  } catch {
    return data({ error: "Failed to save the property map" }, { status: 500 });
  }
  // No row to update means the company never connected Onshape.
  if (Number(updatedRows) === 0) {
    return data(
      { error: "Onshape is not connected for this company" },
      { status: 422 }
    );
  }

  /*
   * Definitions are re-read so the editor shows the fields as they now stand.
   * The map is saved by this point, so a failure here is NOT a failed save and
   * must not answer like one: a 500 made the panel say "Couldn't save the map"
   * about a saved map, keep the draft dirty, and invite a second save. It is a
   * 200 with the definitions missing and a warning saying exactly that.
   */
  let definitions: PlanCustomFieldDefinition[] | null = null;
  let warning: string | undefined;
  try {
    definitions = await loadPartCustomFieldDefinitions(client, companyId);
  } catch {
    warning =
      "Saved. The custom field list couldn't be refreshed — press Refresh to see the latest fields.";
  }

  return data(
    { map: mapEntries, definitions, ...(warning ? { warning } : {}) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
