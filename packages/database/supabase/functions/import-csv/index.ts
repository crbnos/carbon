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
        } else if (value && value !== "N/A" && row[value]) {
          record[key] = row[value];
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

        const customerIds = new Set();

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
              if (isCustomerValid(rest) && !customerIds.has(id)) {
                customerIds.add(id);
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
            } else if (isCustomerValid(rest) && !customerIds.has(id)) {
              customerIds.add(id);
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

          console.log({
            totalRecords: mappedRecords.length,
            customerInserts: customerInserts.length,
            customerUpdates: customerUpdates.length,
          });

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

        const supplierIds = new Set();

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
            if (externalIdMap.has(id) && !supplierIds.has(id)) {
              supplierIds.add(id);
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
            } else if (isSupplierValid(rest) && !supplierIds.has(id)) {
              supplierIds.add(id);
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

          console.log({
            totalRecords: mappedRecords.length,
            supplierInserts: supplierInserts.length,
            supplierUpdates: supplierUpdates.length,
          });

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
      case "material":
      case "consumable":
      case "tool":
      case "fixture":
      case "part": {
        const getExternalId = (id: string) => {
          return `${table}:${id}`;
        };

        const currentItems = await db
          .selectFrom("item")
          .where("companyId", "=", companyId)
          .select(["id", "externalId"])
          .execute();

        const readableIds = new Set();

        const externalIdMap = new Map(
          currentItems.reduce((acc, item) => {
            if (
              item.externalId &&
              typeof item.externalId === "object" &&
              EXTERNAL_ID_KEY in item.externalId
            ) {
              acc.set(item.externalId[EXTERNAL_ID_KEY] as string, {
                id: item.id!,
                externalId: item.externalId as Record<string, string>,
              });
            }
            return acc;
          }, new Map<string, { id: string; externalId: Record<string, string> }>())
        );

        await db.transaction().execute(async (trx) => {
          const itemInserts: Database["public"]["Tables"]["item"]["Insert"][] =
            [];
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
            finish: z.string().optional(),
            dimensions: z.string().optional(),
            grade: z.string().optional(),
          });

          for (const record of mappedRecords) {
            let item = itemValidator.safeParse(record);

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
              const existingItem = externalIdMap.get(getExternalId(id))!;

              readableIds.add(readableIdWithRevision);
              itemUpdates.push({
                id: existingItem.id,
                data: {
                  ...rest,
                  revision: rest.revision ?? "0",
                  active: rest.active?.toLowerCase() !== "false" ?? true,
                  updatedAt: new Date().toISOString(),
                  updatedBy: userId,
                  externalId: {
                    ...existingItem.externalId,
                  },
                },
              });

              if (table === "material") {
                const material = materialValidator.safeParse(record);
                if (material.success) {
                  materialUpdates.push({
                    id: material.data.readableId,
                    data: {
                      materialSubstanceId: material.data.materialSubstanceId,
                      materialFormId: material.data.materialFormId,
                      dimensions: material.data.dimensions,
                      grade: material.data.grade,
                      finish: material.data.finish,
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
                externalId: {
                  [EXTERNAL_ID_KEY]: getExternalId(id),
                },
              };
              itemInserts.push(newItem);

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
                    externalId: {
                      [EXTERNAL_ID_KEY]: getExternalId(id),
                    },
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
                  externalId: sql`EXCLUDED."externalId"`,
                })
              )
              .returning(["id", "externalId", "readableId"])
              .execute();

            if (["part", "fixture", "tool", "consumable"].includes(table)) {
              const specificInserts: Database["public"]["Tables"]["part"]["Insert"][] =
                insertedItems.map((item) => ({
                  id: item.readableId,
                  approved: true,
                  externalId: item.externalId,
                  companyId,
                  createdAt: new Date().toISOString(),
                  createdBy: userId,
                }));

              await trx.insertInto(table).values(specificInserts).execute();
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
                    materialSubstanceId: materialData.materialSubstanceId,
                    materialFormId: materialData.materialFormId,
                    dimensions: materialData.dimensions,
                    grade: materialData.grade,
                    finish: materialData.finish,
                    externalId: item.externalId,
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
            for (const update of itemUpdates) {
              await trx
                .updateTable("item")
                .set(update.data)
                .where("id", "=", update.id)
                .execute();
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
        const currentContacts = await db
          .selectFrom("contact")
          .where("companyId", "=", companyId)
          .select(["id", "externalId"])
          .execute();

        const currentCustomers = await db
          .selectFrom("customer")
          .where("companyId", "=", companyId)
          .select(["id", "externalId"])
          .execute();

        const externalCustomerIdMap = new Map(
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

        const externalContactIdMap = new Map(
          currentContacts.reduce((acc, contact) => {
            if (
              contact.externalId &&
              typeof contact.externalId === "object" &&
              EXTERNAL_ID_KEY in contact.externalId
            ) {
              acc.set(contact.externalId[EXTERNAL_ID_KEY] as string, {
                id: contact.id!,
                externalId: contact.externalId as Record<string, string>,
              });
            }
            return acc;
          }, new Map<string, { id: string; externalId: Record<string, string> }>())
        );

        await db.transaction().execute(async (trx) => {
          const contactInserts: Database["public"]["Tables"]["contact"]["Insert"][] =
            [];
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
              const existingContact = externalContactIdMap.get(id)!;
              if (isContactValid(contactData)) {
                contactUpdates.push({
                  id: existingContact.id,
                  data: {
                    ...contactData,
                    externalId: {
                      ...existingContact.externalId,
                    },
                  },
                });
              }
            } else if (
              isContactValid(contactData) &&
              externalCustomerIdMap.has(customerId)
            ) {
              const existingCustomer = externalCustomerIdMap.get(customerId)!;
              const contactId = nanoid();
              const newContact = {
                id: contactId,
                ...contactData,
                companyId,
                externalId: {
                  [EXTERNAL_ID_KEY]: id,
                },
              };

              contactInserts.push(newContact);
              customerContactInserts.push({
                contactId,
                customerId: existingCustomer.id,
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
            await trx
              .insertInto("contact")
              .values(contactInserts)
              .returning(["id"])
              .execute();
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
        const currentContacts = await db
          .selectFrom("contact")
          .where("companyId", "=", companyId)
          .select(["id", "externalId"])
          .execute();

        const currentSuppliers = await db
          .selectFrom("supplier")
          .where("companyId", "=", companyId)
          .select(["id", "externalId"])
          .execute();

        const externalSupplierIdMap = new Map(
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

        const externalContactIdMap = new Map(
          currentContacts.reduce((acc, contact) => {
            if (
              contact.externalId &&
              typeof contact.externalId === "object" &&
              EXTERNAL_ID_KEY in contact.externalId
            ) {
              acc.set(contact.externalId[EXTERNAL_ID_KEY] as string, {
                id: contact.id!,
                externalId: contact.externalId as Record<string, string>,
              });
            }
            return acc;
          }, new Map<string, { id: string; externalId: Record<string, string> }>())
        );

        await db.transaction().execute(async (trx) => {
          const contactInserts: Database["public"]["Tables"]["contact"]["Insert"][] =
            [];
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
              const existingContact = externalContactIdMap.get(id)!;
              if (isContactValid(contactData)) {
                contactUpdates.push({
                  id: existingContact.id,
                  data: {
                    ...contactData,
                    externalId: {
                      ...existingContact.externalId,
                    },
                  },
                });
              }
            } else if (
              isContactValid(contactData) &&
              externalSupplierIdMap.has(supplierId)
            ) {
              const existingSupplier = externalSupplierIdMap.get(supplierId)!;
              const contactId = nanoid();
              const newContact = {
                id: contactId,
                ...contactData,
                companyId,
                externalId: {
                  [EXTERNAL_ID_KEY]: id,
                },
              };
              contactInserts.push(newContact);
              supplierContactInserts.push({
                contactId,
                supplierId: existingSupplier.id,
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
            await trx
              .insertInto("contact")
              .values(contactInserts)
              .returning(["id"])
              .execute();
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
