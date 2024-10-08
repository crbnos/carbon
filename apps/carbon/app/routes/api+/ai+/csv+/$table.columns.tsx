import { openai } from "@ai-sdk/openai";
import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { generateObject } from "ai";
import type { ZodSchema } from "zod";
import { z } from "zod";

const inputSchema = z.object({
  fieldColumns: z.array(z.string()),
  firstRows: z.array(z.record(z.string())),
});

const importSchemas: Record<string, z.ZodType> = {
  customer: z.object({
    id: z
      .string()
      .describe(
        "The id of the customer, usually a number or set of alphanumeric characters."
      ),
    name: z.string().describe("The name of the customer"),
    taxId: z
      .string()
      .optional()
      .describe("The tax identification number of the customer"),
    website: z
      .string()
      .optional()
      .describe("The website url. Usually begins with http:// or https://"),
  }),
};

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    update: "settings",
  });

  const { table } = params;
  if (!table) {
    return notFound("No table parameter provided");
  }

  const result = inputSchema.safeParse(await request.json());
  if (!result.success) {
    return json(
      { error: "Invalid input data", details: result.error.format() },
      { status: 400 }
    );
  }

  const { fieldColumns, firstRows } = result.data;

  const schema = importSchemas[table];

  if (!schema) {
    return json(
      { error: "Table not found in the list of supported tables" },
      { status: 404 }
    );
  }

  const { object } = await generateObject<Record<string, string>>({
    model: openai("gpt-4o-mini"),
    schema,
    prompt: `
        The following columns are the headings from a CSV import file for importing a ${table}. 
        Map these column names to the correct fields in our database (${[
          ...Object.keys(getZodSchemaFieldsShallow(schema)),
        ].join(", ")}) by providing the matching column name for each field.
        You may also consult the first few rows of data to help you make the mapping, but you are mapping the columns, not the values. 
        If you are not sure or there is no matching column, omit the value. Only include the columns as possible values. Don't include data from the first few rows.
        Columns:
        ${fieldColumns.join(",")}
        First few rows of data:
        ${firstRows.map((row) => JSON.stringify(row)).join("\n")}
      `,
    temperature: 0.2,
  });

  return json(object);
}

export function getZodSchemaFieldsShallow(schema: ZodSchema) {
  const fields: Record<string, true> = {};
  const proxy = new Proxy(fields, {
    get(_, key) {
      if (key === "then" || typeof key !== "string") {
        return;
      }
      fields[key] = true;
    },
  });
  schema.safeParse(proxy);
  return fields;
}
