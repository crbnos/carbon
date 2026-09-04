import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
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

  const { companyId, userId } = await requirePermissions(request, {
    update: importPermissions[table]
  });

  const schema = importSchemas[table].extend({
    filePath: z.string().min(1, { message: "Path is required" }),
    enumMappings: z.string().optional(),
    // "true" plans without writing; importers that plan (account) return it.
    dryRun: z.enum(["true", "false"]).optional(),
    // JSON from a per-table review step (structure choice, conflict resolutions).
    options: z.string().optional()
  });

  const validation = await validator(schema).validate(await request.formData());

  if (validation.error) {
    return {
      success: false,
      message: "Validation failed"
    };
  }

  const { filePath, enumMappings, dryRun, options, ...columnMappings } =
    validation.data;

  let parsedOptions: Record<string, unknown> | undefined;
  if (options) {
    try {
      parsedOptions = JSON.parse(options as string);
    } catch {
      return { success: false, message: "Invalid import options" };
    }
  }

  const serviceRole = getCarbonServiceRole();
  const importResult = await importCsv(serviceRole, {
    table,
    filePath: filePath as string,
    columnMappings,
    enumMappings: enumMappings ? JSON.parse(enumMappings as string) : undefined,
    companyId,
    userId,
    dryRun: dryRun === "true",
    options: parsedOptions
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
    plan?: unknown;
  };

  return {
    success: true,
    dryRun: dryRun === "true",
    message: dryRun === "true" ? "Plan ready" : "Import successful",
    inserted: data.inserted ?? 0,
    updated: data.updated ?? 0,
    errors: data.errors ?? [],
    skipped: data.skipped ?? [],
    plan: data.plan
  };
}
