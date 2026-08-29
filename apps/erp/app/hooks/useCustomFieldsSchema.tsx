import type { Json } from "@carbon/database";
import { useRouteData } from "@carbon/react";
import { useMemo } from "react";
import { z } from "zod";
import { path } from "~/utils/path";

export function useCustomFieldsSchema() {
  const data = useRouteData<{
    customFields: { table: string; name: string; fields: Json[] }[];
  }>(path.to.authenticatedRoot);

  const customFields = useMemo<Record<string, Fields>>(() => {
    let result: Record<string, Fields> = {};
    if (!data?.customFields || !Array.isArray(data.customFields)) return result;

    data.customFields.forEach((field) => {
      const fields = fieldValidator.safeParse(field.fields);
      if (fields.success && "table" in field) {
        result[field.table] = fields.data;
      }
    });

    return result;
  }, [data?.customFields]);

  return customFields;
}

const fieldValidator = z
  .array(
    z.object({
      // Absent on older rows; the view emits it, and zod would otherwise strip it.
      active: z
        .boolean()
        .nullish()
        .transform((v) => v ?? true),
      dataTypeId: z.number(),
      id: z.string(),
      listOptions: z.array(z.string()).nullable(),
      name: z.string(),
      required: z.boolean().default(false),
      sortOrder: z.number(),
      tags: z.array(z.string()).nullable()
    })
  )
  .nullable();
type Fields = z.infer<typeof fieldValidator>;
