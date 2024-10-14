import { getCarbonServiceRole, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
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
    update: importPermissions[table],
  });

  const schema = importSchemas[table].extend({
    filePath: z.string().min(1, { message: "Path is required" }),
    enumMappings: z.string().optional(),
  });

  const validation = await validator(schema).validate(await request.formData());

  if (validation.error) {
    return json({
      success: false,
      message: "Validation failed",
    });
  }

  const { filePath, enumMappings, ...columnMappings } = validation.data;

  const serviceRole = getCarbonServiceRole();
  const importResult = await importCsv(serviceRole, {
    table,
    filePath: filePath as string,
    columnMappings,
    enumMappings: enumMappings ? JSON.parse(enumMappings as string) : undefined,
    companyId,
    userId,
  });

  if (importResult.error) {
    return json({
      success: false,
      message: importResult.error.message,
    });
  }

  return json({
    success: true,
    message: "Import successful",
  });
}
