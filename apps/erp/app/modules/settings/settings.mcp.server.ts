import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { DataType } from "~/modules/shared/types";
import { ruleError } from "~/utils/supabase";
import type { customFieldValidator } from "./settings.models";
import {
  deleteCustomField as deleteCustomFieldDefinition,
  updateCustomFieldsSortOrder as updateCustomFieldDefinitionsSortOrder,
  upsertCustomField as upsertCustomFieldDefinition
} from "./settings.server";

// MCP/API tools for settings writes that live in `settings.server.ts` because
// they clear the redis custom-field cache (`@carbon/kv`), which cannot be
// reached from the client-bundled `settings.service.ts`. Server-only: never
// re-exported by the `~/modules/settings` barrel. `registry.server.ts` spreads
// these exports into the `settings` namespace and `scripts/generate-mcp.ts`
// publishes them (see `.claude/rules/mcp-tools-reference.md`).
//
// Every write here goes through the caller's RLS-bound client, so no
// `requireToolPermission` re-check is needed; each tool's published permission
// equals its route's `requirePermissions` (PERMISSION_OVERRIDES in
// scripts/lib/service-metadata.ts).

/**
 * Create or update a custom field definition on a table (e.g. `customer`,
 * `part`). Pass `_operation: "create"` with `table`, `name`, `dataTypeId`,
 * `required` (and `listOptions` for a List field) to append a field at the end
 * of the table's sort order; pass `_operation: "update"` with the field `id` to
 * edit it. A List field needs at least one non-empty option, as in the
 * settings UI. Clears the custom-field cache like the settings routes.
 */
export async function upsertCustomField(
  client: SupabaseClient<Database>,
  customField:
    | (Omit<z.infer<typeof customFieldValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof customFieldValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  // The route validates with customFieldValidator, whose refine rejects a
  // List field without options.
  if (
    customField.dataTypeId === DataType.List &&
    (!customField.listOptions ||
      customField.listOptions.length === 0 ||
      customField.listOptions.some((option) => option.length === 0))
  ) {
    return {
      data: null,
      error: ruleError("A List custom field needs at least one option.")
    };
  }

  if ("createdBy" in customField) {
    return upsertCustomFieldDefinition(client, customField);
  }
  // Update: the dispatch stamps companyId on every payload; it is not an
  // editable column of an existing field, so it never reaches the update.
  const { companyId: _companyId, ...update } =
    customField as typeof customField & {
      companyId?: string;
    };
  return upsertCustomFieldDefinition(client, update);
}

/**
 * Delete a custom field definition by id. Clears the company's custom-field
 * cache like the settings route.
 */
export async function deleteCustomField(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return deleteCustomFieldDefinition(client, id, companyId);
}

/**
 * Reorder a table's custom field definitions: one `{ id, sortOrder }` per field
 * to move. Returns an error when any row fails to update.
 */
export async function updateCustomFieldsSortOrder(
  client: SupabaseClient<Database>,
  userId: string,
  updates: { id: string; sortOrder: number }[]
) {
  const results = await updateCustomFieldDefinitionsSortOrder(
    client,
    updates.map(({ id, sortOrder }) => ({
      id,
      sortOrder,
      updatedBy: userId
    }))
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) return { data: null, error: failed.error };
  return {
    data: updates.map(({ id, sortOrder }) => ({ id, sortOrder })),
    error: null
  };
}
