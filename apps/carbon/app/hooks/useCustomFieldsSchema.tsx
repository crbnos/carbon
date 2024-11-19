import type { Json } from "@carbon/database";
import { useMemo } from "react";
import { z } from "zod";
import { path } from "~/utils/path";
import { useRouteData } from "./useRouteData";

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
      dataTypeId: z.number(),
      id: z.string(),
      listOptions: z.array(z.string()).nullable(),
      name: z.string(),
      sortOrder: z.number(),
      tags: z.array(z.string()).nullable(),
    })
  )
  .nullable();
type Fields = z.infer<typeof fieldValidator>;
