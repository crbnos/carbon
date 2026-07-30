import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  importQuotes,
  isQuoteImportTable
} from "~/modules/sales/sales.import.server";
import { importCsv, importPermissions, importSchemas } from "~/modules/shared";

export async function action({ request, params }: ActionFunctionArgs) {
  const { tableId } = params;
  if (!tableId) {
    throw notFound("No table ID provided");
  }
  const table = tableId as keyof typeof importPermissions;

  if (!(table in importPermissions)) {
    throw notFound("Table not found in the list of supported tables");
  }

  const { companyId, companyGroupId, userId } = await requirePermissions(
    request,
    {
      update: importPermissions[table]
    }
  );

  const schema = importSchemas[table].extend({
    filePath: z.string().min(1, { message: "Path is required" }),
    enumMappings: z.string().optional()
  });

  const validation = await validator(schema).validate(await request.formData());

  if (validation.error) {
    return {
      success: false,
      message: "Validation failed"
    };
  }

  const { filePath, enumMappings, ...columnMappings } = validation.data;
  let parsedEnumMappings: Record<string, Record<string, string>> | undefined;
  if (enumMappings) {
    try {
      parsedEnumMappings = JSON.parse(enumMappings as string);
    } catch {
      // Malformed client-supplied JSON — treat as a validation failure rather
      // than letting the parse throw escape as a 500.
      return {
        success: false,
        message: "Validation failed"
      };
    }
  }

  const serviceRole = getCarbonServiceRole();
  // Quotes are created through the sales services (Option B) so quote side
  // effects — opportunity, payment, shipment, external link — are preserved;
  // all other tables run through the generic import-csv edge function.
  const importResult = isQuoteImportTable(table)
    ? await importQuotes(serviceRole, {
        table,
        filePath: filePath as string,
        columnMappings: columnMappings as Record<string, string>,
        enumMappings: parsedEnumMappings,
        companyId,
        companyGroupId,
        userId
      })
    : await importCsv(serviceRole, {
        table,
        filePath: filePath as string,
        columnMappings,
        // The edge-fn wrapper types enumMappings loosely (Record<string,
        // string[]>); the real payload is field → { value → mapped }.
        enumMappings: parsedEnumMappings as unknown as Record<string, string[]>,
        companyId,
        userId
      });

  if (importResult.error) {
    return {
      success: false,
      message: importResult.error.message
    };
  }

  type RowIssue = {
    row: number;
    reason: string;
    values: Record<string, string>;
  };
  const data = (importResult.data ?? {}) as {
    inserted?: number;
    updated?: number;
    errors?: RowIssue[];
    skipped?: RowIssue[];
  };

  return {
    success: true,
    message: "Import successful",
    inserted: data.inserted ?? 0,
    updated: data.updated ?? 0,
    errors: data.errors ?? [],
    skipped: data.skipped ?? []
  };
}
