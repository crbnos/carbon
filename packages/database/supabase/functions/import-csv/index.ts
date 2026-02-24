import { parse } from "https://deno.land/std@0.175.0/encoding/csv.ts";
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { sql } from "npm:kysely@0.27.6";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";
import { getReadableIdWithRevision } from "../lib/utils.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const importCsvValidator = z.object({
  table: z.enum([
    "consumable",
    "customer",
    "customerContact",
    "fixture",
    "material",
    "methodMaterial",
    "part",
    "supplier",
    "supplierContact",
    "tool",
  ]),
  filePath: z.string(),
  columnMappings: z.record(z.string()),
  enumMappings: z.record(z.record(z.string())).optional(),
  companyId: z.string(),
  userId: z.string(),
});

const EXTERNAL_ID_KEY = "csv";

/**
 * Build a map of CSV external IDs → entity IDs from the externalIntegrationMapping table.
 */
async function getCsvExternalIdMap(
  entityType: string,
  cId: string
): Promise<Map<string, string>> {
  const result = await db
    .selectFrom("externalIntegrationMapping")
    .select(["externalId", "entityId"])
    .where("entityType", "=", entityType)
    .where("integration", "=", EXTERNAL_ID_KEY)
    .where("companyId", "=", cId)
    .execute();

  return new Map(
    result
      .filter((r): r is typeof r & { externalId: string } => r.externalId !== null)
      .map((r) => [r.externalId, r.entityId])
  );
}

/**
 * Upsert CSV external ID mappings into the externalIntegrationMapping table.
 * Uses ON CONFLICT to handle re-imports idempotently.
 */
async function upsertCsvMappings(
  trx: typeof db,
  entityType: string,
  mappings: Array<{ entityId: string; externalId: string }>,
  cId: string,
  userId: string
): Promise<void> {
  if (mappings.length === 0) return;

  const now = new Date().toISOString();

  await trx
    .insertInto("externalIntegrationMapping")
    .values(
      mappings.map((m) => ({
        entityType,
        entityId: m.entityId,
        integration: EXTERNAL_ID_KEY,
        externalId: m.externalId,
        companyId: cId,
        allowDuplicateExternalId: false,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      }))
    )
    .onConflict((oc) =>
      oc
        .columns(["entityType", "entityId", "integration", "companyId"])
        .doUpdateSet((eb) => ({
          externalId: eb.ref("excluded.externalId"),
          updatedAt: eb.ref("excluded.updatedAt"),
        }))
    )
    .execute();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  try {
    const {
      table,
      filePath,
      columnMappings,
      enumMappings = {},
      companyId,
      userId,
    } = importCsvValidator.parse(payload);

    console.log({
      function: "import-csv",
      table,
      filePath,
      columnMappings,
      enumMappings,
      companyId,
      userId,
    });

    console.log({ enumMappings });

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

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

    let mappedRecords = parsedCsv.map((row) => {
      const record: Record<string, string> = {};
      for (const [key, value] of Object.entries(columnMappings)) {
        if (key in enumMappings) {
          const enumMapping = enumMappings[key];
          const csvValue = row[value];
          if (csvValue in enumMapping) {
            record[key] = enumMapping[csvValue];
          } else {
            record[key] = enumMapping["Default"];
          }
        } else if (value && value !== "N/A") {
          record[key] = row[value] || "";
        }
      }
      return record;
    });

    // Determine which enum keys are missing from the first record
    const missingEnumKeys = Object.keys(enumMappings).filter(
      (key) => !(key in mappedRecords[0])
    );

    if (missingEnumKeys.length > 0) {
      // Add default values for missing enum keys
      mappedRecords = mappedRecords.map((record) => {
        const processedRecord = { ...record };

        // Add default values for missing enum keys
        missingEnumKeys.forEach((key) => {
          processedRecord[key] = enumMappings[key]["Default"];
        });

        return processedRecord;
      });
    }

    switch (table) {
      case "customer": {
        const externalIdMap = await getCsvExternalIdMap("customer", companyId);
        const customerIds = new Set();

        await db.transaction().execute(async (trx) => {
          const customerInserts: Database["public"]["Tables"]["customer"]["Insert"][] =
            [];
          const csvIdsForInserts: string[] = [];
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
              const existingEntityId = externalIdMap.get(id)!;
              if (isCustomerValid(rest) && !customerIds.has(id)) {
                customerIds.add(id);
                customerUpdates.push({
                  id: existingEntityId,
                  data: {
                    ...rest,
                    updatedAt: new Date().toISOString(),
                    updatedBy: userId,
                  },
                });
              }
            } else if (isCustomerValid(rest) && !customerIds.has(id)) {
              customerIds.add(id);
              customerInserts.push({
                ...rest,
                companyId,
                createdAt: new Date().toISOString(),
                createdBy: userId,
              });
              csvIdsForInserts.push(id);
            }
          }

          console.log({
            totalRecords: mappedRecords.length,
            customerInserts: customerInserts.length,
            customerUpdates: customerUpdates.length,
          });

          if (customerInserts.length > 0) {
            const inserted = await trx
              .insertInto(table)
              .values(customerInserts)
              .returning(["id"])
              .execute();
            await upsertCsvMappings(
              trx,
              "customer",
              inserted.map((row, i) => ({
                entityId: row.id!,
                externalId: csvIdsForInserts[i],
              })),
              companyId,
              userId
            );
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
        const externalIdMap = await getCsvExternalIdMap("supplier", companyId);
        const supplierIds = new Set();

        await db.transaction().execute(async (trx) => {
          const supplierInserts: Database["public"]["Tables"]["supplier"]["Insert"][] =
            [];
          const csvIdsForInserts: string[] = [];
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
            if (externalIdMap.has(id) && !supplierIds.has(id)) {
              supplierIds.add(id);
              const existingEntityId = externalIdMap.get(id)!;
              if (isSupplierValid(rest)) {
                supplierUpdates.push({
                  id: existingEntityId,
                  data: {
                    ...rest,
                    updatedAt: new Date().toISOString(),
                    updatedBy: userId,
                  },
                });
              }
            } else if (isSupplierValid(rest) && !supplierIds.has(id)) {
              supplierIds.add(id);
              supplierInserts.push({
                ...rest,
                companyId,
                createdAt: new Date().toISOString(),
                createdBy: userId,
              });
              csvIdsForInserts.push(id);
            }
          }

          console.log({
            totalRecords: mappedRecords.length,
            supplierInserts: supplierInserts.length,
            supplierUpdates: supplierUpdates.length,
          });

          if (supplierInserts.length > 0) {
            const inserted = await trx
              .insertInto(table)
              .values(supplierInserts)
              .returning(["id"])
              .execute();
            await upsertCsvMappings(
              trx,
              "supplier",
              inserted.map((row, i) => ({
                entityId: row.id!,
                externalId: csvIdsForInserts[i],
              })),
              companyId,
              userId
            );
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
      case "material":
      case "consumable":
      case "tool":
      case "fixture":
      case "part": {
        const getExternalId = (id: string) => {
          return `${table}:${id}`;
        };

        const externalIdMap = await getCsvExternalIdMap("item", companyId);
        const readableIds = new Set();

        await db.transaction().execute(async (trx) => {
          const itemInserts: Database["public"]["Tables"]["item"]["Insert"][] =
            [];
          const csvIdsForInserts: string[] = [];
          const itemUpdates: {
            id: string;
            data: Database["public"]["Tables"]["item"]["Update"];
          }[] = [];
          const materialPartialInserts: Record<
            string,
            Database["public"]["Tables"]["material"]["Insert"]
          > = {};

          const materialUpdates: {
            id: string;
            data: Database["public"]["Tables"]["material"]["Update"];
          }[] = [];

          const itemValidator = z.object({
            id: z.string(),
            readableId: z.string(),
            revision: z.string().optional(),
            name: z.string(),
            description: z.string().optional(),
            active: z.string().optional(),
            unitOfMeasureCode: z.string().optional(),
            replenishmentSystem: z
              .enum(["Buy", "Make", "Buy and Make"])
              .optional(),
            defaultMethodType: z.enum(["Buy", "Make", "Pick"]).optional(),
            itemTrackingType: z.enum([
              "Inventory",
              "Non-Inventory",
              "Serial",
              "Batch",
            ]),
          });

          const materialValidator = itemValidator.extend({
            materialSubstanceId: z.string().optional(),
            materialFormId: z.string().optional(),
            finishId: z.string().optional(),
            dimensionId: z.string().optional(),
            gradeId: z.string().optional(),
          });

          for (const record of mappedRecords) {
            const item = itemValidator.safeParse(record);

            if (!item.success) {
              console.error(item.error.message);
              continue;
            }

            const { id, ...rest } = item.data;
            const readableIdWithRevision = getReadableIdWithRevision(
              item.data.readableId,
              item.data.revision
            );

            if (
              externalIdMap.has(getExternalId(id)) &&
              !readableIds.has(readableIdWithRevision)
            ) {
              const existingEntityId = externalIdMap.get(getExternalId(id))!;

              readableIds.add(readableIdWithRevision);
              itemUpdates.push({
                id: existingEntityId,
                data: {
                  ...rest,
                  revision: rest.revision ?? "0",
                  active: rest.active?.toLowerCase() !== "false" ?? true,
                  unitOfMeasureCode: rest.unitOfMeasureCode || undefined,
                  description: rest.description || undefined,
                  replenishmentSystem: rest.replenishmentSystem || undefined,
                  defaultMethodType: rest.defaultMethodType || undefined,
                  updatedAt: new Date().toISOString(),
                  updatedBy: userId,
                },
              });

              if (table === "material") {
                const material = materialValidator.safeParse(record);
                if (material.success) {
                  materialUpdates.push({
                    id: material.data.readableId,
                    data: {
                      materialSubstanceId:
                        material.data.materialSubstanceId || undefined,
                      materialFormId: material.data.materialFormId || undefined,
                      dimensionId: material.data.dimensionId || undefined,
                      gradeId: material.data.gradeId || undefined,
                      finishId: material.data.finishId || undefined,
                      companyId,
                      updatedAt: new Date().toISOString(),
                      updatedBy: userId,
                    },
                  });
                }
              }
            } else if (!readableIds.has(readableIdWithRevision)) {
              readableIds.add(readableIdWithRevision);
              const newItem = {
                ...rest,
                replenishmentSystem: rest.replenishmentSystem ?? "Buy",
                active: rest.active?.toLowerCase() !== "false" ?? true,
                unitOfMeasureCode: rest.unitOfMeasureCode || undefined,
                description: rest.description || undefined,
                defaultMethodType: rest.defaultMethodType || undefined,
                type: capitalize(table) as
                  | "Part"
                  | "Service"
                  | "Material"
                  | "Tool"
                  | "Fixture"
                  | "Consumable",
                companyId,
                revision: rest.revision ?? "0",
                createdAt: new Date().toISOString(),
                createdBy: userId,
              };
              itemInserts.push(newItem);
              csvIdsForInserts.push(getExternalId(id));

              if (table === "material") {
                const material = materialValidator.safeParse(record);
                if (!material.success) {
                  console.error(material.error.message);
                  continue;
                }
                if (material.success) {
                  materialPartialInserts[material.data.readableId!] = {
                    ...material.data,
                    id: material.data.readableId,
                    companyId,
                    createdAt: new Date().toISOString(),
                    createdBy: userId,
                  };
                }
              }
            }
          }

          if (itemInserts.length > 0) {
            const insertedItems = await trx
              .insertInto("item")
              .values(itemInserts)
              .onConflict((oc) =>
                oc.constraint("item_unique").doUpdateSet({
                  updatedAt: new Date().toISOString(),
                  updatedBy: userId,
                  name: sql`EXCLUDED."name"`,
                  description: sql`EXCLUDED."description"`,
                  active: sql`EXCLUDED."active"`,
                  unitOfMeasureCode: sql`EXCLUDED."unitOfMeasureCode"`,
                  replenishmentSystem: sql`EXCLUDED."replenishmentSystem"`,
                  defaultMethodType: sql`EXCLUDED."defaultMethodType"`,
                  itemTrackingType: sql`EXCLUDED."itemTrackingType"`,
                })
              )
              .returning(["id", "readableId"])
              .execute();

            // Create CSV mappings for newly inserted items
            await upsertCsvMappings(
              trx,
              "item",
              insertedItems.map((item, i) => ({
                entityId: item.id!,
                externalId: csvIdsForInserts[i],
              })),
              companyId,
              userId
            );

            if (["part", "fixture", "tool", "consumable"].includes(table)) {
              const specificInserts = insertedItems.map((item) => ({
                id: item.readableId,
                approved: true,
                companyId,
                createdAt: new Date().toISOString(),
                createdBy: userId,
              }));

              await trx
                .insertInto(table)
                .values(specificInserts as unknown as never)
                .execute();
            }

            if (
              table === "material" &&
              Object.keys(materialPartialInserts).length > 0
            ) {
              const materialInserts = insertedItems.reduce<
                Database["public"]["Tables"]["material"]["Insert"][]
              >((acc, item) => {
                const materialData = materialPartialInserts[item.readableId];
                if (materialData) {
                  acc.push({
                    id: item.readableId,
                    materialSubstanceId:
                      materialData.materialSubstanceId || undefined,
                    materialFormId: materialData.materialFormId || undefined,
                    dimensionId: materialData.dimensionId || undefined,
                    gradeId: materialData.gradeId || undefined,
                    finishId: materialData.finishId || undefined,
                    companyId,
                    createdAt: new Date().toISOString(),
                    createdBy: userId,
                  });
                }
                return acc;
              }, []);

              await trx
                .insertInto("material")
                .values(materialInserts)
                .execute();
            }
          }

          console.log({
            totalRecords: mappedRecords.length,
            itemInserts: itemInserts.length,
            itemUpdates: itemUpdates.length,
            materialInserts: Object.keys(materialPartialInserts).length,
            materialUpdates: materialUpdates.length,
          });

          if (itemUpdates.length > 0) {
            // Get current readableIds to detect changes
            const currentItems = await trx
              .selectFrom("item")
              .select(["id", "readableId"])
              .where(
                "id",
                "in",
                itemUpdates.map((u) => u.id)
              )
              .execute();
            const currentReadableIdMap = new Map(
              currentItems.map((i) => [i.id, i.readableId])
            );

            for (const update of itemUpdates) {
              await trx
                .updateTable("item")
                .set(update.data)
                .where("id", "=", update.id)
                .execute();
            }

            // Update type-specific table id when readableId changes
            for (const update of itemUpdates) {
              const oldReadableId = currentReadableIdMap.get(update.id);
              const newReadableId = update.data.readableId;
              if (
                newReadableId &&
                oldReadableId &&
                oldReadableId !== newReadableId
              ) {
                await trx
                  .updateTable(table)
                  .set({ id: newReadableId } as never)
                  .where("id", "=", oldReadableId)
                  .where("companyId", "=", companyId)
                  .execute();
              }
            }

            if (materialUpdates.length > 0) {
              for (const update of materialUpdates) {
                await trx
                  .updateTable("material")
                  .set(update.data)
                  .where("id", "=", update.id)
                  .execute();
              }
            }
          }
        });

        break;
      }
      case "customerContact": {
        const externalContactIdMap = await getCsvExternalIdMap("contact", companyId);
        const externalCustomerIdMap = await getCsvExternalIdMap("customer", companyId);

        await db.transaction().execute(async (trx) => {
          const contactInserts: Database["public"]["Tables"]["contact"]["Insert"][] =
            [];
          const csvIdsForContactInserts: string[] = [];
          const contactUpdates: {
            id: string;
            data: Database["public"]["Tables"]["contact"]["Update"];
          }[] = [];
          const customerContactInserts: Database["public"]["Tables"]["customerContact"]["Insert"][] =
            [];

          const isContactValid = (
            record: Record<string, string>
          ): record is {
            email: string;
          } => {
            return (
              typeof record.email === "string" && record.email.trim() !== ""
            );
          };

          for (const record of mappedRecords) {
            const { id, companyId: customerId, ...contactData } = record;

            if (externalContactIdMap.has(id)) {
              const existingEntityId = externalContactIdMap.get(id)!;
              if (isContactValid(contactData)) {
                contactUpdates.push({
                  id: existingEntityId,
                  data: {
                    ...contactData,
                  },
                });
              }
            } else if (
              isContactValid(contactData) &&
              externalCustomerIdMap.has(customerId)
            ) {
              const existingCustomerId = externalCustomerIdMap.get(customerId)!;
              const contactId = nanoid();
              const newContact = {
                id: contactId,
                ...contactData,
                companyId,
              };

              contactInserts.push(newContact);
              csvIdsForContactInserts.push(id);
              customerContactInserts.push({
                contactId,
                customerId: existingCustomerId,
                customFields: {},
              });
            }
          }

          console.log({
            totalRecords: mappedRecords.length,
            contactInserts: contactInserts.length,
            contactUpdates: contactUpdates.length,
            customerContactInserts: customerContactInserts.length,
          });

          if (contactInserts.length > 0) {
            const inserted = await trx
              .insertInto("contact")
              .values(contactInserts)
              .returning(["id"])
              .execute();
            await upsertCsvMappings(
              trx,
              "contact",
              inserted.map((row, i) => ({
                entityId: row.id!,
                externalId: csvIdsForContactInserts[i],
              })),
              companyId,
              userId
            );
          }

          if (contactUpdates.length > 0) {
            for (const update of contactUpdates) {
              await trx
                .updateTable("contact")
                .set(update.data)
                .where("id", "=", update.id)
                .execute();
            }
          }

          if (customerContactInserts.length > 0) {
            await trx
              .insertInto("customerContact")
              .values(customerContactInserts)
              .execute();
          }
        });

        break;
      }
      case "supplierContact": {
        const externalContactIdMap = await getCsvExternalIdMap("contact", companyId);
        const externalSupplierIdMap = await getCsvExternalIdMap("supplier", companyId);

        await db.transaction().execute(async (trx) => {
          const contactInserts: Database["public"]["Tables"]["contact"]["Insert"][] =
            [];
          const csvIdsForContactInserts: string[] = [];
          const contactUpdates: {
            id: string;
            data: Database["public"]["Tables"]["contact"]["Update"];
          }[] = [];
          const supplierContactInserts: Database["public"]["Tables"]["supplierContact"]["Insert"][] =
            [];

          const isContactValid = (
            record: Record<string, string>
          ): record is {
            email: string;
          } => {
            return (
              typeof record.email === "string" && record.email.trim() !== ""
            );
          };

          for (const record of mappedRecords) {
            const { id, companyId: supplierId, ...contactData } = record;

            if (externalContactIdMap.has(id)) {
              const existingEntityId = externalContactIdMap.get(id)!;
              if (isContactValid(contactData)) {
                contactUpdates.push({
                  id: existingEntityId,
                  data: {
                    ...contactData,
                  },
                });
              }
            } else if (
              isContactValid(contactData) &&
              externalSupplierIdMap.has(supplierId)
            ) {
              const existingSupplierId = externalSupplierIdMap.get(supplierId)!;
              const contactId = nanoid();
              const newContact = {
                id: contactId,
                ...contactData,
                companyId,
              };
              contactInserts.push(newContact);
              csvIdsForContactInserts.push(id);
              supplierContactInserts.push({
                contactId,
                supplierId: existingSupplierId,
                customFields: {},
              });
            }
          }

          console.log({
            totalRecords: mappedRecords.length,
            contactInserts: contactInserts.length,
            contactUpdates: contactUpdates.length,
            supplierContactInserts: supplierContactInserts.length,
          });

          if (contactInserts.length > 0) {
            const inserted = await trx
              .insertInto("contact")
              .values(contactInserts)
              .returning(["id"])
              .execute();
            await upsertCsvMappings(
              trx,
              "contact",
              inserted.map((row, i) => ({
                entityId: row.id!,
                externalId: csvIdsForContactInserts[i],
              })),
              companyId,
              userId
            );
          }

          if (contactUpdates.length > 0) {
            for (const update of contactUpdates) {
              await trx
                .updateTable("contact")
                .set(update.data)
                .where("id", "=", update.id)
                .execute();
            }
          }

          if (supplierContactInserts.length > 0) {
            await trx
              .insertInto("supplierContact")
              .values(supplierContactInserts)
              .execute();
          }
        });

        break;
      }
      case "methodMaterial": {
        throw new Error("Not implemented");
      }
      default: {
        throw new Error(`Invalid table: ${table}`);
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

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
