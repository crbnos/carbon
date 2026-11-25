// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noChainedClientWrites } from "./no-chained-client-writes";

const SERVICE = "apps/erp/app/modules/sales/sales.service.ts";
const scan = (contents: string, file = SERVICE) =>
  noChainedClientWrites
    .scan(file, contents)
    .map(({ line, snippet }) => ({ line, snippet }));

describe("no-chained-client-writes", () => {
  // git show efd366dba0^:apps/erp/app/modules/sales/sales.service.ts, lines 3871–3962
  it("flags the quote line price delete and re-insert from before efd366dba0", () => {
    expect(
      scan(`export async function upsertQuoteLinePrices(
  client: SupabaseClient<Database>,
  quoteId: string,
  lineId: string,
  quoteLinePrices: {
    quoteLineId: string;
    unitPrice: number;
    leadTime: number;
    discountPercent: number;
    quantity: number;
    createdBy: string;
    categoryMarkups?: Record<string, number>;
    priceSource?: "system" | "manual";
  }[]
) {
  const existingPrices = await client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteLineId", lineId);
  if (existingPrices.error) {
    return existingPrices;
  }

  const deletePrices = await client
    .from("quoteLinePrice")
    .delete()
    .eq("quoteLineId", lineId);
  if (deletePrices.error) {
    return deletePrices;
  }

  const quoteExchangeRate = await client
    .from("quote")
    .select("id, exchangeRate")
    .eq("id", quoteId)
    .single();

  const quoteLineUnitPricePrecision = await client
    .from("quoteLine")
    .select("unitPricePrecision")
    .eq("id", lineId)
    .single();

  const pricesByQuantity = existingPrices.data.reduce<
    Record<
      number,
      {
        discountPercent: number;
        leadTime: number;
        shippingCost: number;
        categoryMarkups: unknown;
        priceSource: string;
      }
    >
  >((acc, price) => {
    acc[price.quantity] = price;
    return acc;
  }, {});

  const pricesWithExistingDiscountsAndLeadTimes = quoteLinePrices.map((p) => {
    const existing = pricesByQuantity[p.quantity];
    const roundedUnitPrice = Number(
      p.unitPrice.toFixed(
        quoteLineUnitPricePrecision.data?.unitPricePrecision ?? 2
      )
    );

    return {
      ...p,
      unitPrice: roundedUnitPrice,
      discountPercent: existing?.discountPercent ?? p.discountPercent,
      leadTime: existing?.leadTime ?? p.leadTime,
      // Shipping is entered per quantity break and is independent of the price
      // being rewritten — without this the delete+reinsert resets it to the
      // column default of 0.
      shippingCost: existing?.shippingCost ?? 0,
      categoryMarkups: p.categoryMarkups ?? existing?.categoryMarkups ?? {},
      // Explicit caller intent wins; otherwise keep the row's provenance so a
      // delete+reinsert can never turn a manual price back into a system one.
      priceSource: p.priceSource ?? existing?.priceSource ?? "system",
      quoteId: quoteId,
      exchangeRate: quoteExchangeRate.data?.exchangeRate ?? 1
    };
  });

  return (
    client
      .from("quoteLinePrice")
      // @ts-expect-error - categoryMarkups is a Json object
      .insert(pricesWithExistingDiscountsAndLeadTimes)
  );
}`)
    ).toEqual([
      {
        line: 87,
        snippet:
          "upsertQuoteLinePrices: quoteLinePrice.delete, quoteLinePrice.insert"
      }
    ]);
  });

  // git show efd366dba0:apps/erp/app/modules/sales/sales.service.ts, lines 3871–3956
  it("passes the price rewrite in one Kysely transaction (efd366dba0)", () => {
    expect(
      scan(`export async function upsertQuoteLinePrices(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  quoteId: string,
  lineId: string,
  quoteLinePrices: {
    quoteLineId: string;
    unitPrice: number;
    leadTime: number;
    discountPercent: number;
    quantity: number;
    createdBy: string;
    categoryMarkups?: Record<string, number>;
    priceSource?: "system" | "manual";
  }[]
) {
  // Rewriting a line's prices is a delete + reinsert, so it has to be atomic:
  // if the insert failed after the delete had already committed, the line would
  // be left with no pricing at all and the previous values unrecoverable.
  // Kysely bypasses RLS, so every statement is scoped by companyId explicitly.
  return db.transaction().execute(async (trx) => {
    const existingPrices = await trx
      .selectFrom("quoteLinePrice")
      .selectAll()
      .where("quoteLineId", "=", lineId)
      .where("companyId", "=", companyId)
      .execute();

    await trx
      .deleteFrom("quoteLinePrice")
      .where("quoteLineId", "=", lineId)
      .where("companyId", "=", companyId)
      .execute();

    if (quoteLinePrices.length === 0) return;

    const quote = await trx
      .selectFrom("quote")
      .select("exchangeRate")
      .where("id", "=", quoteId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    const quoteLine = await trx
      .selectFrom("quoteLine")
      .select("unitPricePrecision")
      .where("id", "=", lineId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    const existingByQuantity = new Map(
      existingPrices.map((price) => [price.quantity, price])
    );

    await trx
      .insertInto("quoteLinePrice")
      .values(
        quoteLinePrices.map((p) => {
          const existing = existingByQuantity.get(p.quantity);

          return {
            ...p,
            companyId,
            quoteId,
            unitPrice: Number(
              p.unitPrice.toFixed(quoteLine?.unitPricePrecision ?? 2)
            ),
            discountPercent: existing?.discountPercent ?? p.discountPercent,
            leadTime: existing?.leadTime ?? p.leadTime,
            // Shipping is entered per quantity break and is independent of the
            // price being rewritten — without this the delete+reinsert resets
            // it to the column default of 0.
            shippingCost: existing?.shippingCost ?? 0,
            categoryMarkups:
              p.categoryMarkups ?? existing?.categoryMarkups ?? {},
            // Explicit caller intent wins; otherwise keep the row's provenance
            // so a delete+reinsert can never turn a manual price back into a
            // system one.
            priceSource: p.priceSource ?? existing?.priceSource ?? "system",
            exchangeRate: quote?.exchangeRate ?? 1
          };
        })
      )
      .execute();
  });
}`)
    ).toEqual([]);
  });

  // git show 37f71945a4^:apps/erp/app/modules/items/items.service.ts, lines 4302–4341
  it("flags the Draft insert and source activation from before 37f71945a4", () => {
    expect(
      scan(
        `export async function upsertMakeMethodVersion(
  client: SupabaseClient<Database>,
  makeMethodVersion: z.infer<typeof makeMethodVersionValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  const currentMakeMethod = await client
    .from("makeMethod")
    .select("*")
    .eq("id", makeMethodVersion.copyFromId)
    .eq("companyId", makeMethodVersion.companyId)
    .single();

  if (currentMakeMethod.error) return currentMakeMethod;

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, version, ...data } = currentMakeMethod.data;

  const insert = await client
    .from("makeMethod")
    .insert({
      ...data,
      status: "Draft",
      version: makeMethodVersion.version,
      createdBy: makeMethodVersion.createdBy
    })
    .select("id, ...item(itemId:id, type)")
    .single();

  if (insert.error) return insert;

  if (makeMethodVersion.activeVersionId) {
    await client
      .from("makeMethod")
      .update({ status: "Active" })
      .eq("id", makeMethodVersion.activeVersionId);
  }

  return insert;`,
        "apps/erp/app/modules/items/items.service.ts"
      )
    ).toEqual([
      {
        line: 34,
        snippet: "upsertMakeMethodVersion: makeMethod.insert, makeMethod.update"
      }
    ]);
  });

  // git show 37f71945a4:apps/erp/app/modules/items/items.service.ts, lines 4312–4428
  it("passes the version insert, activation and copy in withTransaction (37f71945a4)", () => {
    expect(
      scan(
        `export async function createMakeMethodVersion(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    copyFromId: string;
    version: number;
    /** Set a Draft source Active. An Active or Archived source is left alone. */
    activate?: boolean;
    /** The change notice the new Draft belongs to; else the source's. */
    changeOrderId?: string;
    companyId: string;
    createdBy: string;
  }
): Promise<
  | {
      data: {
        id: string;
        itemId: string;
        type: Database["public"]["Tables"]["item"]["Row"]["type"];
      };
      error: null;
    }
  | { data: null; error: ServiceError | ServerFnError }
> {
  const { copyFromId, version, companyId, createdBy } = args;

  const source = await client
    .from("makeMethod")
    .select("itemId, status, customFields, tags, changeOrderId, ...item(type)")
    .eq("id", copyFromId)
    .eq("companyId", companyId)
    .single();
  if (source.error) return { data: null, error: source.error };

  // The makeMethod policies ask for parts_create to insert and parts_update to
  // set a version Active.
  const activate = args.activate === true && source.data.status === "Draft";
  const permitted = await requireCompanyPermission(
    client,
    companyId,
    "parts_create"
  );
  if (permitted.error) return { data: null, error: permitted.error };
  if (activate) {
    const canActivate = await requireCompanyPermission(
      client,
      companyId,
      "parts_update"
    );
    if (canActivate.error) return { data: null, error: canActivate.error };
  }

  try {
    const draftId = await withTransaction(db, async (trx) => {
      const draft = await trx
        .insertInto("makeMethod")
        .values({
          itemId: source.data.itemId,
          customFields: toJson(source.data.customFields),
          tags: source.data.tags,
          changeOrderId: args.changeOrderId ?? source.data.changeOrderId,
          status: "Draft",
          version,
          companyId,
          createdBy
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      if (activate) {
        // A source set Active meanwhile, or archived behind a newer Active, is
        // not outranked by the new Draft either: nothing to refuse.
        await trx
          .updateTable("makeMethod")
          .set({ status: "Active" })
          .where("id", "=", copyFromId)
          .where("companyId", "=", companyId)
          .where("status", "=", "Draft")
          .execute();
      }

      const copy = await copyMakeMethod(getCarbonServiceRole(), trx, {
        sourceId: copyFromId,
        targetId: draft.id,
        billOfMaterial: true,
        billOfProcess: true,
        parameters: true,
        tools: true,
        steps: true,
        workInstructions: true,
        companyId,
        userId: createdBy
      });
      if (copy.error) throw copy.error;

      return draft.id;
    });

    return {
      data: { id: draftId, itemId: source.data.itemId, type: source.data.type },
      error: null
    };
  } catch (error) {
    // The copy's refusal, with the status its category is read from.
    if (error instanceof ServerFnError) return { data: null, error };
    // A taken version number is the caller's to retry.
    if (!isUniqueViolation(error)) {
      logger.error("Failed to create make method version", {
        companyId,
        copyFromId,
        version,
        error
      });
    }
    return { data: null, error: writeError(error) };
  }
}`,
        "apps/erp/app/modules/items/items.service.ts"
      )
    ).toEqual([]);
  });

  // git show f922057bbc^:apps/erp/app/modules/sales/sales.service.ts, lines 2133–2176
  it("flags the contact insert and its customer link from before f922057bbc", () => {
    expect(
      scan(`export async function insertCustomerContact(
  client: SupabaseClient<Database>,
  customerContact: {
    customerId: string;
    companyId: string;
    contact: PickPartial<z.infer<typeof customerContactValidator>, "email">;
    customerLocationId?: string;
    customFields?: Json;
  }
) {
  const insertContact = await client
    .from("contact")
    .insert([
      {
        ...customerContact.contact,
        isCustomer: true,
        companyId: customerContact.companyId
      }
    ])
    .select("id")
    .single();
  if (insertContact.error) {
    return insertContact;
  }

  const contactId = insertContact.data?.id;
  if (!contactId) {
    return { data: null, error: new Error("Contact ID not found") };
  }

  return client
    .from("customerContact")
    .insert([
      {
        customerId: customerContact.customerId,
        contactId,
        customerLocationId: customerContact.customerLocationId,
        companyId: customerContact.companyId,
        customFields: customerContact.customFields
      }
    ])
    .select("id")
    .single();
}`)
    ).toEqual([
      {
        line: 31,
        snippet: "insertCustomerContact: contact.insert, customerContact.insert"
      }
    ]);
  });

  // git show f922057bbc:apps/erp/app/modules/sales/sales.service.ts, lines 2138–2211
  it("passes the contact and its link in one withTransaction (f922057bbc)", () => {
    expect(
      scan(`export async function insertCustomerContact(
  db: Kysely<KyselyDatabase>,
  customerContact: {
    customerId: string;
    companyId: string;
    contact: PickPartial<z.infer<typeof customerContactValidator>, "email">;
    customerLocationId?: string;
    customFields?: Json;
  }
) {
  const { customerId, companyId, customerLocationId, contact } =
    customerContact;
  try {
    // One transaction: a contact with no customer link is invisible in the app.
    const id = await withTransaction(db, async (trx) => {
      const owner = await trx
        .selectFrom("customer")
        .select("id")
        .where("id", "=", customerId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!owner) return "Customer not found";
      if (customerLocationId) {
        const location = await trx
          .selectFrom("customerLocation")
          .select("id")
          .where("id", "=", customerLocationId)
          .where("customerId", "=", customerId)
          .executeTakeFirst();
        if (!location) return "Location not found";
      }

      const inserted = await trx
        .insertInto("contact")
        .values({
          companyId,
          isCustomer: true,
          firstName: contact.firstName,
          lastName: contact.lastName,
          title: contact.title,
          email: contact.email,
          mobilePhone: contact.mobilePhone,
          homePhone: contact.homePhone,
          workPhone: contact.workPhone,
          notes: contact.notes
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const link = await trx
        .insertInto("customerContact")
        .values({
          customerId,
          contactId: inserted.id,
          customerLocationId,
          companyId,
          customFields: toJson(customerContact.customFields)
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { id: link.id };
    });
    return typeof id === "string"
      ? { data: null, error: ruleError(id) }
      : { data: id, error: null };
  } catch (error) {
    logger.error("Failed to create customer contact", {
      companyId,
      customerId,
      error
    });
    return { data: null, error: error as Error };
  }
}`)
    ).toEqual([]);
  });

  it("flags writes fanned out with Promise.all, in a service function's run", () => {
    expect(
      scan(
        `export const cancelOrder = defineServiceFn({
  input,
  permission,
  async run(ctx, input) {
    const client = ctx.asSystem.supabase;
    const [lines, header] = await Promise.all([
      client.from("salesOrderLine").update({ status: "Cancelled" }).eq("salesOrderId", input.id),
      client.from("salesOrder").update({ status: "Cancelled" }).eq("id", input.id)
    ]);
    return unwrap(ctx, lines, header);
  }
});`,
        "apps/erp/app/modules/sales/sales.server.ts"
      )
    ).toEqual([
      {
        line: 8,
        snippet: "cancelOrder: salesOrderLine.update, salesOrder.update"
      }
    ]);
  });

  it("counts a write in a callback toward the function that calls it", () => {
    expect(
      scan(`export async function replaceTags(client, id, tags) {
  await client.from("tag").delete().eq("documentId", id);
  await Promise.all(
    tags.map((tag) => client.from("tag").insert({ documentId: id, tag }))
  );
}`)
    ).toEqual([{ line: 4, snippet: "replaceTags: tag.delete, tag.insert" }]);
  });

  it("passes the two branches of an upsert", () => {
    expect(
      scan(`export async function upsertThing(client, thing) {
  if ("id" in thing) {
    return client.from("thing").update(thing).eq("id", thing.id);
  }
  return client.from("thing").insert([thing]).select("id").single();
}

export async function upsertOther(client, other) {
  if (other.id) {
    const updated = await client.from("other").update(other).eq("id", other.id);
    if (updated.error) return updated;
    return updated;
  } else {
    return client.from("other").insert(other);
  }
}

export async function saveMode(client, mode, row) {
  return mode === "edit"
    ? client.from("x").update(row).eq("id", row.id)
    : client.from("x").insert(row);
}

export async function byIntent(client, intent, row) {
  switch (intent) {
    case "archive":
      return client.from("x").update({ archived: true }).eq("id", row.id);
    case "delete":
      return client.from("x").delete().eq("id", row.id);
  }
}`)
    ).toEqual([]);
  });

  it("passes writes inside a Kysely transaction callback, and a single write", () => {
    expect(
      scan(`export async function one(client, row) {
  return client.from("x").insert(row);
}

export async function inTransaction(db, client, row) {
  return withTransaction(db, async (trx) => {
    await client.from("x").delete().eq("id", row.id);
    await client.from("x").insert(row);
  });
}`)
    ).toEqual([]);
  });

  it("does not let a return inside a callback end the outer function", () => {
    expect(
      scan(`export async function reset(client, ids) {
  await Promise.all(
    ids.map(async (id) => {
      await client.from("x").delete().eq("id", id);
      return id;
    })
  );
  await client.from("y").insert({ ids });
}`)
    ).toEqual([{ line: 8, snippet: "reset: x.delete, y.insert" }]);
  });

  it("leaves reads, storage and Array.from alone", () => {
    expect(
      scan(`export async function files(client, rows) {
  await client.storage.from("private").update(path, file);
  await client.storage.from("private").remove([path]);
  const copy = Array.from(rows).delete;
  await client.from("x").select("id");
  return client.from("x").update({ a: 1 }).eq("id", 1);
}`)
    ).toEqual([]);
  });

  it("passes an update-else-insert upsert of one row, and insert-if-absent then update", () => {
    expect(
      scan(`export async function upsertOverride(client, row) {
  const update = await client
    .from("exchangeRateOverride")
    .update({ rate: row.rate })
    .eq("currencyCode", row.currencyCode)
    .select("id");
  if (update.error) return update;
  if (update.data.length > 0) return update;
  return client.from("exchangeRateOverride").insert(row);
}

export async function markInstalled(client, row) {
  const inserted = await client
    .from("companyIntegration")
    .upsert(row, { ignoreDuplicates: true });
  if (inserted.error) return inserted;
  return client
    .from("companyIntegration")
    .update({ active: true })
    .eq("id", row.id)
    .eq("active", false);
}`)
    ).toEqual([]);
  });

  it("still flags two updates of one table (archive the old, publish the new)", () => {
    expect(
      scan(`export async function activateVersion(client, id, others) {
  await client.from("instruction").update({ status: "Archived" }).in("id", others);
  return client.from("instruction").update({ status: "Published" }).eq("id", id);
}`)
    ).toEqual([{ line: 3, snippet: "activateVersion: instruction.update" }]);
  });

  it("names a callback option after the function that passes it", () => {
    expect(
      scan(
        `export const attachFile = defineServiceFn({
  input,
  permission,
  async run(ctx, input) {
    return service.placeFile(ctx, {
      setModel: async (id) => {
        await ctx.client.from("quoteLine").update({ id }).eq("id", input.lineId);
        await ctx.client.from("item").update({ id }).eq("id", input.itemId);
      }
    });
  }
});`,
        "apps/erp/app/modules/sales/sales.server.ts"
      )
    ).toEqual([
      { line: 8, snippet: "attachFile.setModel: quoteLine.update, item.update" }
    ]);
  });

  it("scans only ERP module server files and MES services", () => {
    const code = `export async function two(client) {
  await client.from("a").insert({});
  await client.from("b").insert({});
}`;
    expect(scan(code, "apps/erp/app/routes/x+/a.tsx")).toEqual([]);
    expect(scan(code, "apps/erp/app/modules/a/a.models.ts")).toEqual([]);
    expect(scan(code, "apps/mes/app/services/operations.service.ts")).toEqual([
      { line: 3, snippet: "two: a.insert, b.insert" }
    ]);
  });
});
