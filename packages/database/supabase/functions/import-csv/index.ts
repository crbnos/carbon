import { parse } from "https://deno.land/std@0.175.0/encoding/csv.ts";
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import z from "https://deno.land/x/zod@v3.21.4/index.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const importCsvValidator = z.object({
  table: z.enum(["customer", "supplier"]),
  filePath: z.string(),
  mappings: z.record(z.string()),
  companyId: z.string(),
  userId: z.string(),
});

const EXTERNAL_ID_KEY = "csv";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  try {
    const { table, filePath, mappings, companyId, userId } =
      importCsvValidator.parse(payload);

    console.log({
      function: "import-csv",
      table,
      filePath,
      mappings,
      companyId,
      userId,
    });

    const client = getSupabaseServiceRole(req.headers.get("Authorization"));
    const csvFile = await client.storage.from("private").download(filePath);
    if (!csvFile.data) {
      throw new Error("Failed to download file");
    }
    const csvText = new TextDecoder().decode(
      new Uint8Array(await csvFile.data.arrayBuffer())
    );
    const parsedCsv = parse(csvText, { skipFirstRow: true }) as Record<
      string,
      string
    >[];

    const mappedRecords = parsedCsv.map((row) => {
      const record: Record<string, string> = {};
      for (const [key, value] of Object.entries(mappings)) {
        if (row[value]) {
          record[key] = row[value];
        }
      }
      return record;
    });

    switch (table) {
      case "customer": {
        const currentCustomers = await db
          .selectFrom(table)
          .where("companyId", "=", companyId)
          .select(["id", "externalId"])
          .execute();

        const externalIdMap = new Map(
          currentCustomers.reduce((acc, customer) => {
            if (
              customer.externalId &&
              typeof customer.externalId === "object" &&
              EXTERNAL_ID_KEY in customer.externalId
            ) {
              acc.set(customer.externalId[EXTERNAL_ID_KEY] as string, {
                id: customer.id!,
                externalId: customer.externalId as Record<string, string>,
              });
            }
            return acc;
          }, new Map<string, { id: string; externalId: Record<string, string> }>())
        );

        await db.transaction().execute(async (trx) => {
          const customerInserts: Database["public"]["Tables"]["customer"]["Insert"][] =
            [];
          const customerUpdates: {
            id: string;
            data: Database["public"]["Tables"]["customer"]["Update"];
          }[] = [];

          const isCustomerValid = (
            record: Record<string, string>
          ): record is { name: string } => {
            return typeof record.name === "string" && record.name.trim() !== "";
          };

          for (const record of mappedRecords) {
            const { id, ...rest } = record;
            if (externalIdMap.has(id)) {
              const existingCustomer = externalIdMap.get(id)!;
              if (isCustomerValid(rest)) {
                customerUpdates.push({
                  id: existingCustomer.id,
                  data: {
                    ...rest,
                    updatedAt: new Date().toISOString(),
                    updatedBy: userId,
                    externalId: {
                      ...existingCustomer.externalId,
                    },
                  },
                });
              }
            } else if (isCustomerValid(rest)) {
              customerInserts.push({
                ...rest,
                companyId,
                createdAt: new Date().toISOString(),
                createdBy: userId,
                externalId: {
                  [EXTERNAL_ID_KEY]: id,
                },
              });
            }
          }

          if (customerInserts.length > 0) {
            await trx.insertInto(table).values(customerInserts).execute();
          }
          if (customerUpdates.length > 0) {
            for (const update of customerUpdates) {
              await trx
                .updateTable(table)
                .set(update.data)
                .where("id", "=", update.id)
                .execute();
            }
          }
        });
        break;
      }
      case "supplier": {
        const currentSuppliers = await db
          .selectFrom(table)
          .where("companyId", "=", companyId)
          .select(["id", "externalId"])
          .execute();

        const externalIdMap = new Map(
          currentSuppliers.reduce((acc, supplier) => {
            if (
              supplier.externalId &&
              typeof supplier.externalId === "object" &&
              EXTERNAL_ID_KEY in supplier.externalId
            ) {
              acc.set(supplier.externalId[EXTERNAL_ID_KEY] as string, {
                id: supplier.id!,
                externalId: supplier.externalId as Record<string, string>,
              });
            }
            return acc;
          }, new Map<string, { id: string; externalId: Record<string, string> }>())
        );

        await db.transaction().execute(async (trx) => {
          const supplierInserts: Database["public"]["Tables"]["supplier"]["Insert"][] =
            [];
          const supplierUpdates: {
            id: string;
            data: Database["public"]["Tables"]["supplier"]["Update"];
          }[] = [];

          const isSupplierValid = (
            record: Record<string, string>
          ): record is { name: string } => {
            return typeof record.name === "string" && record.name.trim() !== "";
          };

          for (const record of mappedRecords) {
            const { id, ...rest } = record;
            if (externalIdMap.has(id)) {
              const existingSupplier = externalIdMap.get(id)!;
              if (isSupplierValid(rest)) {
                supplierUpdates.push({
                  id: existingSupplier.id,
                  data: {
                    ...rest,
                    updatedAt: new Date().toISOString(),
                    updatedBy: userId,
                    externalId: {
                      ...existingSupplier.externalId,
                    },
                  },
                });
              }
            } else if (isSupplierValid(rest)) {
              supplierInserts.push({
                ...rest,
                companyId,
                createdAt: new Date().toISOString(),
                createdBy: userId,
                externalId: {
                  [EXTERNAL_ID_KEY]: id,
                },
              });
            }
          }

          if (supplierInserts.length > 0) {
            await trx.insertInto(table).values(supplierInserts).execute();
          }
          if (supplierUpdates.length > 0) {
            for (const update of supplierUpdates) {
              await trx
                .updateTable(table)
                .set(update.data)
                .where("id", "=", update.id)
                .execute();
            }
          }
        });
        break;
      }
      default: {
        throw new Error("Invalid type");
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
