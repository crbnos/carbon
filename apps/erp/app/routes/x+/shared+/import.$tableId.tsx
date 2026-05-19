import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
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

  await requirePermissions(request, {
    update: importPermissions[table]
  });

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

  const importResult = await importCsv({
    table,
    filePath: filePath as string,
    columnMappings,
    enumMappings: enumMappings ? JSON.parse(enumMappings as string) : undefined
  });

  if (importResult.error) {
    return {
      success: false,
      message: importResult.error.message
    };
  }

  return {
    success: true,
    message: "Import successful"
  };
}
